---
name: testing-odin
description: The Odin testing stack for this bundle — core:testing and `odin test`, the tracking allocator as a correctness assertion, hand-rolled seeded property sampling where no library exists, the case-folder runner, table tests without a test framework's help, and debugging with a purpose-built single-case executable under RAD Debugger/gdb/lldb. Covers the raylib and hot-reload testing boundary. Use before writing or reviewing any Odin test.
type: reference
theme: code-craft
best_for:
  - "Writing tests in a language with no mocking library, no property library and no closures"
  - "Proving an Odin package leaks no memory as part of its test suite"
  - "Testing gameplay logic without linking raylib into the test binary"
---

## Purpose

The Odin form of `skills/test-driven-development/SKILL.md`. Read
`skills/clean-code-odin/SKILL.md` first, especially its memory-lifetime section —
here it matters twice over, because **a leak is a test failure**.

Odin has no mocking library, no property-testing library, no snapshot library and
no closures. That sounds like a limitation and mostly is not: the pattern this
bundle recommends — explicit inputs, data in, data out, dependencies as a
procedure-pointer struct — is the *only* comfortable way to write Odin anyway, so
the tests come out simple. What you lose is convenience; what you build instead is
about forty lines of shared machinery.

---

## The stack

| Job | Use |
| --- | --- |
| Runner | **`core:testing`** + `odin test`, `@(test)` procs taking `^testing.T` |
| Assertions | `testing.expect`, `testing.expectf`, `testing.expect_value` |
| Selecting tests | `-define:ODIN_TEST_NAMES=pkg.proc_name` (comma-separated) |
| Leak detection | `-define:ODIN_TEST_TRACK_MEMORY=true`, plus `mem.Tracking_Allocator` |
| Memory errors | `-sanitize:address`, `-sanitize:memory` |
| Fakes | a struct of procedure pointers + a data pointer — the same "port" the code already uses |
| Table tests | a `[]Case` slice and a `for` loop |
| Property tests | hand-rolled: seeded `rand.Generator`, a loop, a printed seed |
| Case folders | `core:encoding/json` + `core:os` + a walker (see assets) |
| Benchmarks | `time.tick_now`/`time.tick_since`, or `core:testing`'s benchmark support |
| CI | `odin check` with `-vet -strict-style`, then `odin test` |

---

## Layout

```
src/billing/            late_fees.odin       # domain, no vendor imports
                        late_fees_test.odin  # @(test) procs, same package
tests/                  case_runner.odin     # case folders + the walker
                        cases/overdue-invoice-fees/{inputs,outputs,README.md}
tools/case_debug/       case_debug.odin      # single-case executable, -debug
```

Tests for a package normally live **in the package**, in a `_test.odin` file — the
file is only compiled under `odin test`, and it gives access to private procs. Put
the cross-package, data-driven suites in `tests/`.

---

## Constructs, by what you are proving

### The table test, which is most tests

```odin
@(test)
test_invoice_not_past_grace_is_skipped :: proc(t: ^testing.T) {
	Case :: struct {
		name:         string,
		days_overdue: int,
		expected:     Skip_Reason,
	}
	cases := []Case {
		{"future",         -1, .Not_Yet_Due},
		{"due today",       0, .Within_Grace_Period},
		{"last grace day",  5, .Within_Grace_Period},   // boundary, inclusive
		{"first charged",   6, .None},                  // the other side of it
	}

	for c in cases {
		invoice := an_invoice(due_date = date_minus_days(AS_OF, c.days_overdue))

		assessment := assess_late_fees({invoice}, POLICY, AS_OF, context.temp_allocator)

		testing.expectf(
			t,
			skip_reason_of(assessment, invoice.invoice_id) == c.expected,
			"%s: expected %v, got %v",
			c.name,
			c.expected,
			skip_reason_of(assessment, invoice.invoice_id),
		)
	}
	free_all(context.temp_allocator)
}
```

Two things carry the weight here and neither is Odin-specific: the `name` field
(without it, a failure says "case 3"), and the `6` row next to the `5` row.

### Errors are values, so assert on the value

```odin
policy, err := make_policy(daily_rate_bps = -1)
testing.expect_value(t, err, Policy_Error.Negative_Rate)
```

No exceptions, so no "did it throw" ambiguity — assert the exact enum member, not
just that `err != nil`.

### Fakes are the port you already have

Odin has no interfaces, so a dependency is a struct of procedure pointers plus a
data pointer (`skills/design-patterns-odin/SKILL.md`). Which means a fake is just
another instance of it:

```odin
Invoice_Repository :: struct {
	data: rawptr,
	get:  proc(data: rawptr, id: string) -> (Invoice, bool),
}

fake_repo_get :: proc(data: rawptr, id: string) -> (Invoice, bool) {
	store := cast(^map[string]Invoice)data
	invoice, ok := store[id]
	return invoice, ok
}

// in the test
store := map[string]Invoice{"INV-1001" = an_invoice()}
repo := Invoice_Repository{data = &store, get = fake_repo_get}
```

No mocking library needed, and no mocking library possible. The upside: a fake
that no longer matches the port fails to compile.

### Memory is part of the contract

```odin
@(test)
test_assess_late_fees_leaks_nothing :: proc(t: ^testing.T) {
	tracker: mem.Tracking_Allocator
	mem.tracking_allocator_init(&tracker, context.allocator)
	defer mem.tracking_allocator_destroy(&tracker)
	context.allocator = mem.tracking_allocator(&tracker)

	assessment := assess_late_fees(SAMPLE_INVOICES, POLICY, AS_OF)
	free_assessment(assessment)

	testing.expectf(t, len(tracker.allocation_map) == 0, "leaked %d allocations", len(tracker.allocation_map))
	testing.expectf(t, len(tracker.bad_free_array) == 0, "%d bad frees", len(tracker.bad_free_array))
}
```

In a language with no GC this is not an extra: **a leak is a defect and the suite
should say so**. `-define:ODIN_TEST_TRACK_MEMORY=true` does the same check around
every test; the explicit version is for when you want the assertion in the test's
name.

Prefer `context.temp_allocator` inside tests with one `free_all` at the end — it
makes most lifetime questions disappear.

---

## Human-readable case folders

Pattern: `skills/human-readable-tests/SKILL.md`. Working code:
`skills/human-readable-tests/assets/odin/` — `case_runner.odin`,
`case_debug.odin`, `Makefile`.

Odin-specific notes:

- **No runtime test registration**, so each case gets a three-line `@(test)` proc
  delegating to `run_and_compare`. That costs one stanza per case and buys a
  symbol name — which is what `-define:ODIN_TEST_NAMES` and the debugger use.
- **`json.marshal` with `Marshal_Options{pretty = true, use_spaces = true,
  spaces = 2}`** is the canonical form; compare trimmed strings so a trailing
  newline is not a failure.
- **Struct tags** (`` `json:"invoice_id"` ``) keep the wire names out of the Odin
  naming convention.
- **Allocate everything from `context.temp_allocator`** in the runner, with one
  `free_all` per case, so a case cannot leak into the next.
- Keep `run_case` free of any `core:testing` import — that is what lets
  `tools/case_debug` call it with a debugger attached.

---

## Generated tests, without a library

No hypothesis, no fast-check. Forty lines gets you the useful 80%:

```odin
@(test)
test_fee_never_exceeds_cap :: proc(t: ^testing.T) {
	seed := u64(0)
	if s, ok := os.lookup_env("TEST_SEED", context.temp_allocator); ok {
		seed, _ = strconv.parse_u64(s)
	} else {
		seed = u64(time.now()._nsec)
	}
	// Print it ALWAYS, not just on failure: a counterexample you cannot re-run is a rumour.
	log.infof("seed = %d  (TEST_SEED=%d to reproduce)", seed, seed)

	rng := rand.create(seed)
	iterations := 1000
	for _ in 0 ..< iterations {
		invoice := random_invoice(&rng)
		policy := random_policy(&rng)

		fee, charged := assess_one(invoice, policy, AS_OF)
		cap := invoice.total_minor_units * policy.max_fee_ratio_bps / BPS_DENOMINATOR

		if charged && fee.fee_minor_units > cap {
			testing.errorf(t, "seed %d: fee %d exceeds cap %d for %v", seed, fee.fee_minor_units, cap, invoice)
			return   // stop at the first counterexample; there is no shrinker
		}
	}
}
```

What you give up is **shrinking**, so bias the generators hard toward boundaries
(0, 1, max, negative, exactly-at-limit) rather than relying on volume, and shrink
by hand when you get a hit. Then do the thing that matters most and is free:
**commit the counterexample as a fixed table-test row**, permanently.

For byte-consuming code — a file format parser, a network frame decoder — the
better tool is **libFuzzer via a C shim plus `-sanitize:address`**. That is where
Odin's lack of memory safety makes fuzzing worth real effort.

---

## Running the suite

`skills/human-readable-tests/assets/odin/Makefile` is the copyable version.

```bash
make test                                     # check + unit + cases
make test-unit                                # odin test src -all-packages
make test-cases
make test-case CASE=overdue_invoice_fees      # -define:ODIN_TEST_NAMES=…
make memcheck                                 # track memory + ASan
```

Always run tests with `-vet -strict-style`. In Odin a large share of what other
languages catch in tests is caught by the vet flags, and leaving them off gives up
free coverage.

---

## Debugging a test — the part that matters

```bash
make debug-case CASE=overdue-invoice-fees     # builds tools/case_debug -debug, runs one case
make debug-test                               # builds the test binary with symbols
```

- **`-debug` is not optional.** Without it there are no line numbers and stepping
  is meaningless.
- **`tools/case_debug`** is the entry point to reach for: a normal executable with
  a normal `main`, so every debugger works with no configuration. Breakpoint,
  step into the domain proc, and each loop iteration is one row of the case
  README's walkthrough.
- **RAD Debugger** (Windows) is the best experience for Odin today; **gdb** and
  **lldb** both work on the DWARF output. VS Code: `cppvsdbg` on Windows or
  CodeLLDB elsewhere, pointing at the built executable.
- `log.debugf` with `context.logger` set in the test is the fallback, and
  `testing.expectf`'s message is where the values belong — a bare
  `testing.expect(t, ok)` tells you nothing at 3 a.m.

---

## Odin-specific test traps

- **`context.allocator` is per-goroutine-ish state**: set it inside the test, and
  restore or scope it, or the next test inherits your tracking allocator.
- **`temp_allocator` is not freed automatically** in a test binary. One
  `free_all(context.temp_allocator)` per test, via `defer`.
- **Slices alias their backing array.** A test that mutates a slice it took from
  the fixture corrupts the next test's data. Copy when in doubt.
- **`==` on structs containing slices or pointers compares the pointer**, not the
  contents. Write an explicit comparison proc, or compare the canonical JSON.
- **Map iteration order is unspecified.** Never build an expected output from a
  map without sorting.
- **`cstring` from `strings.clone_to_cstring` must be freed**, and a raylib
  boundary in a test is a leak waiting to be reported.
- **Do not link raylib into logic tests.** Keep gameplay rules in a package with
  no `vendor:raylib` import; then `odin test` needs no window, no GPU and no
  display — which is also what makes the case-folder pattern work for a game.
- **Hot reload**: test the game DLL's pure logic directly. The reload harness
  itself is integration territory; assert that state survives a reload, not that
  a frame rendered.
- **Floating point** — compare with an epsilon and say what it is; `math.abs(a-b)
  < EPSILON` with a named constant, never `==`.

---

## References

- `skills/clean-code-odin/SKILL.md` — memory lifetimes, vet flags, the raylib
  boundary.
- `skills/design-patterns-odin/SKILL.md` — the procedure-pointer port that makes
  fakes possible.
- `skills/test-driven-development/SKILL.md`, `skills/human-readable-tests/SKILL.md`
  (+ `assets/odin/`), `skills/automatic-test-generation/SKILL.md`,
  `skills/bug-fix-workflow/SKILL.md`.
