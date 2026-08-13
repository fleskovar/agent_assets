---
name: automatic-test-generation
argument-hint: "[the function or module whose input space you want covered]"
description: Cover the input space instead of a handful of examples — property-based testing, generators and shrinking, metamorphic and differential (oracle) testing, stateful/model-based tests, coverage-guided fuzzing, schema-driven API testing, and mutation testing as the check on whether any of it is working. Includes the library to use per language (hypothesis, fast-check, CsCheck/FsCheck, Odin's hand-rolled sampling) and the failure modes that make generated tests worthless.
intent: >-
  Take a function and try many inputs against it automatically, in a way that produces a shrunk, reproducible counterexample rather than noise — by stating invariants in domain language first, writing generators that produce valid-but-awkward data, and turning every counterexample into a permanent named regression test. Use when example-based tests have plateaued, when a unit has a wide input space, or when a defect class keeps escaping.
type: reference
theme: code-craft
best_for:
  - "Deciding what property to assert about a function whose input space is large"
  - "Choosing and configuring the property/fuzzing library for a language"
  - "Finding out whether an existing suite would actually catch a defect"
scenarios:
  - "Generate tests for this parser by sampling its input space"
  - "What invariant can I state about the fee calculation?"
  - "Our coverage is 92% and bugs still ship — what should we run?"
estimated_time: "1-3 h per module"
---

## Purpose

Example-based tests check the inputs you thought of. Generated tests check the
ones you did not — and the ones you did not are where the defects live.

This file covers the whole family:

| Technique | The question it answers |
| --- | --- |
| **Property-based** | Does this invariant hold for *any* valid input? |
| **Differential / oracle** | Does the new implementation agree with the old one, everywhere? |
| **Metamorphic** | When I change the input this way, does the output change the way it must? |
| **Stateful / model-based** | Does any *sequence* of operations break the object's invariants? |
| **Fuzzing** | Can any byte string crash it, hang it, or corrupt memory? |
| **Schema-driven** | Does the API honour its own contract for every documented shape? |
| **Mutation testing** | If I inject a defect, does the suite notice? |

**What generated tests are not:** documentation. A `@given` block tells a reader
that fees never exceed the cap; it never tells them what a fee *is* or why 400 is
right for `INV-1002`. Keep the readable layer
(`skills/human-readable-tests/SKILL.md`) — the two are complements, and a suite
missing either is missing something the other cannot supply.

## Input

**Works best with:** a function whose contract you can state in one sentence, and
whose inputs have a describable valid range.

**Also useful:** the legacy implementation (a free oracle), the API schema, and
the defect history — the classes of bug that keep escaping tell you which
technique to reach for.

---

## Key Concepts

### Start from the invariant, not the generator

The hard part is never generating data; it is knowing what to assert about data
you have not seen. Work through this list against your function — most units have
two or three, and if you have none, you probably have a *transformation* that
wants a case folder rather than a property.

| Family | Shape | Example |
| --- | --- | --- |
| **Round trip** | `decode(encode(x)) == x` | Serialisers, parsers, compression, ORM mappings |
| **Invariant / postcondition** | Something is always true of the output | `fee <= cap`, result sorted, no duplicates, sum preserved |
| **Oracle** | `new(x) == old(x)` | Refactors, rewrites, a slow reference implementation |
| **Metamorphic** | Relating two runs, when you cannot name the answer | Doubling every invoice total doubles the accrual; reordering the input does not change the totals |
| **Idempotence** | `f(f(x)) == f(x)` | Normalisation, migrations, deduplication, `apply` operations |
| **Commutativity / order-independence** | `f(a,b) == f(b,a)` | Merges, set operations, batch processing |
| **Never crashes** | No unhandled failure on any *valid* input | Parsers, adapters, anything taking outside data |
| **Error totality** | Every *invalid* input yields a *documented* error, never a wrong answer | Validation, config loading |

Metamorphic properties are the underused one. When you cannot compute the
expected output, you can almost always name a relationship between two runs, and
that catches real defects.

### The generator is where the value is

A generator producing bland, plausible data finds nothing. Bias it, on purpose,
toward the values that break things:

- **Boundaries:** 0, 1, −1, max, max−1, empty, single-element, exactly-at-limit.
- **Structure:** duplicates, already-sorted, reverse-sorted, all-identical.
- **Text:** empty string, whitespace-only, unicode combining marks, emoji, RTL,
  embedded newlines and NULs, very long strings.
- **Numbers:** negative zero, NaN and infinities where the type allows them,
  values that lose precision in float, values that overflow 32 bits.
- **Time:** leap days, DST transitions, month ends, year boundaries, timezones
  either side of UTC.

**Generate valid domain objects, not raw primitives.** A generator that builds an
`Invoice` with a due date, a status and a total from a *composed* generator finds
domain bugs; four independent primitive generators mostly find validation errors
you already handle. Build a library of domain generators — `invoices()`,
`policies()` — and reuse them across the suite.

**Constrain by construction, not by filtering.** `filter`/`assume` that rejects
most candidates makes the run slow and can starve the search entirely. Build the
constraint in: to need `due_date <= as_of`, generate `as_of` and then an offset.

### Shrinking is what makes a failure usable

A good library, on failure, reduces the counterexample to something minimal —
`[0, 0]` rather than a 40-element array of random floats. That is the difference
between a bug report you can act on and noise. It is also why you should prefer a
library with real shrinking over a hand-rolled loop of random inputs.

### Determinism and the seed

A generated test that cannot be re-run identically is a rumour.

- **Print the seed on failure**, and make it settable from the environment.
- **Commit every counterexample as a named example-based test**, permanently.
  This is the single most important habit in this file: the property test is the
  net, and the unit test is what you keep from it. Hypothesis's `@example`, the
  `.fuzz-failures` corpus, `fast-check`'s reported counterexample — all of them
  become a checked-in test with a name that says what went wrong.
- **Pin the iteration count per environment**: modest on every push, large on the
  nightly or the release candidate. Never let a property test's runtime creep
  into the fast loop.

### Stateful / model-based testing

For objects with a lifecycle — a cache, a queue, a state machine, a repository —
generate *sequences of operations* and compare against a trivial model (a plain
dict, a list) after each step. It finds ordering, cleanup and interleaving bugs
that per-call properties cannot express. All the major libraries support it:
`hypothesis.stateful.RuleBasedStateMachine`, `fast-check`'s `commands`, CsCheck's
`Sample.Concurrent` / FsCheck's `Machine`.

### Fuzzing, and when it is worth it

Coverage-guided fuzzing mutates a corpus of inputs and follows code-coverage
feedback into weird corners. Worth it for **parsers, decoders, and anything
consuming bytes from outside the process** — file formats, network frames, image
loaders, and any hand-written binary handling in Odin or C. Not worth it for
business rules; a property test is a better fit and a thousand times faster to
write.

Fuzz targets check **liveness properties**: no crash, no hang, no assertion
failure, no leak, no memory error under a sanitiser. Keep the corpus and the
crash artifacts in the repository — that corpus is an asset.

### Mutation testing: the check on the checkers

Coverage says a line ran. Mutation testing changes `<=` to `<`, deletes a
statement, flips a boolean, and asks whether any test noticed. The surviving
mutants are a precise list of the assertions you are missing, and it is the only
mechanical answer to "is this suite any good".

It is slow. Run it on the domain core, on a schedule, and read the survivors —
not as a percentage to chase, but as a to-do list. A surviving mutant on the
grace-period comparison is exactly the "pin the boundary from both sides" finding
from `skills/human-readable-tests/`, found mechanically.

### LLM-generated tests

Useful for the *enumeration* — "list the edge cases for a date-range parser",
"draft thirty parametrised cases from this behaviour list". Dangerous for the
*expectations*: a model asked for expected outputs will happily produce values
derived from reading the implementation, which is the "baseline nobody derived"
failure with extra confidence. Treat generated expectations as a draft a human
must derive from the specification, exactly as with a golden baseline. And never
let a model edit an existing test to make a change pass.

---

## Libraries by language

| Language | Property-based | Stateful | Fuzzing | Mutation | Snapshot |
| --- | --- | --- | --- | --- | --- |
| **Python** | `hypothesis` (the default; `hypothesis[numpy,pandas]` for arrays) | `hypothesis.stateful` | `atheris` (libFuzzer bindings) | `mutmut`, `cosmic-ray` | `syrupy` |
| **TypeScript** | `fast-check` (integrates with Vitest and Jest) | `fast-check` model-based `commands` | `jsfuzz`, or fast-check with a byte generator | `Stryker` | Vitest `toMatchFileSnapshot` |
| **C#** | `CsCheck` (fast, good shrinking), `FsCheck` (the classic, `FsCheck.Xunit`) | `CsCheck.Sample.Concurrent`, `FsCheck` `Machine` | `SharpFuzz` (AFL++) | `Stryker.NET` | `Verify` |
| **Odin** | none mature — hand-roll: a seeded `rand.Generator`, a loop, and a printed seed | hand-rolled operation sequences over a model struct | `-sanitize:address` + libFuzzer via a C shim, for byte parsers | none | compare canonical strings |
| **Svelte 5** | `fast-check` over the `.svelte.ts` view-model | `fast-check` `commands` over store actions | not applicable | `Stryker` | Playwright screenshots (e2e only) |

**API and schema-driven:** `schemathesis` (OpenAPI/GraphQL, Python, drives any
service), `Pact` for consumer-driven contracts, `RESTler` for stateful REST
fuzzing.

Per-language configuration, profiles and CI wiring live in
`skills/testing-<language>/SKILL.md`.

---

## Application

### Step 1: State the invariant in domain language, before touching a library

Write it as a sentence a domain expert would agree with. "A late fee never
exceeds ten percent of the invoice total." If you cannot write the sentence, you
do not yet have a property — reach for a case folder or a unit test instead.

### Step 2: Write the generator for valid domain objects

Compose it from smaller generators, constrain by construction, and bias toward
boundaries. Keep it beside the domain type so the whole suite shares it.

### Step 3: Assert the property, run it, and read the counterexample

```python
@given(invoices=lists(valid_invoices(), max_size=20), policy=valid_policies())
def test_fee_never_exceeds_cap(invoices, policy):
    assessment = assess_late_fees(tuple(invoices), policy, AS_OF)

    for fee in assessment.assessed:
        invoice = next(i for i in invoices if i.invoice_id == fee.invoice_id)
        cap = invoice.total_minor_units * policy.max_fee_ratio_bps // BPS_DENOMINATOR
        assert fee.fee_minor_units <= cap
```

Note what this does **not** do: recompute the fee. A property test that
reimplements the function is a tautology that passes forever — see Pitfall 1.

### Step 4: Turn every counterexample into a permanent named test

```python
def test_zero_total_invoice_accrues_no_fee() -> None:
    """Regression: hypothesis found total=0 produced a fee of 500 via the minimum."""
```

Then fix the code. The property test stays as the net; this test is the catch.

### Step 5: Add the second technique the module actually needs

- Replacing an implementation? **Differential test against the old one** — the
  highest-value property test in existence, and it is nearly free.
- Parsing bytes from outside? **Fuzz it**, and keep the corpus.
- Object with a lifecycle? **Model-based sequences**.
- Wide public API? **Schema-driven** against the spec.

### Step 6: Measure the suite with mutation testing, once

Run it on the domain core. Read the survivors. Each one is a missing assertion,
and fixing them is the highest-yield test work available. Then put it on a
schedule and stop thinking about the percentage.

---

## Examples

`examples/sample.md` works the late-fee module end to end: five invariants in
domain language, the generators, three real counterexamples with their shrunk
values and the permanent tests they became, and a mutation-testing run whose
survivors point straight back at a missing boundary row.

---

## Common Pitfalls

### Pitfall 1: The test that reimplements the function
**Symptom:** the property computes the expected fee the same way the code does.
**Consequence:** both share the bug, so it passes forever. The commonest way
property testing produces nothing.
**Fix:** assert a *relationship* — a bound, a round trip, a metamorphic
relation, agreement with an independent oracle — never a recomputation.

### Pitfall 2: The generator that avoids the interesting values
**Symptom:** `integers(min_value=1, max_value=100)` everywhere; nothing empty,
nothing at the limit, no unicode.
**Consequence:** thousands of runs through the middle of the space, and the
boundary defects survive.
**Fix:** bias to boundaries; check what the library reports as its distribution;
add `@example` for the values you know matter.

### Pitfall 3: Filtering instead of constructing
**Symptom:** `.filter(lambda i: i.due_date <= as_of)` rejecting 95% of candidates.
**Consequence:** slow runs, and libraries that give up and report "too many
filtered examples" — often silently weakening the test.
**Fix:** generate the offset, not the pair. Build validity into the generator.

### Pitfall 4: No seed, no counterexample committed
**Symptom:** a nightly failure nobody can reproduce; the fix is a re-run.
**Consequence:** the finding is lost, and the defect returns.
**Fix:** print and honour a seed; commit every shrunk counterexample as a named
test before fixing the code.

### Pitfall 5: Property tests in the fast loop, at full size
**Symptom:** `make test-unit` takes four minutes because three properties run
10,000 examples each.
**Consequence:** developers stop running it.
**Fix:** profiles — small on push, thorough nightly. `make props` is its own
target.

### Pitfall 6: Generated tests instead of readable ones
**Symptom:** an invariant-only suite; no case folder; a new developer has nothing
to read.
**Consequence:** high confidence, zero documentation, and orderings and
roundings still unpinned — properties rarely catch "the cap is applied after the
minimum".
**Fix:** both layers. `skills/test-driven-development/SKILL.md` sets the mix.

### Pitfall 7: Fuzzing business logic
**Symptom:** a fuzz target on the pricing engine, running for hours, finding
`ValueError`s on nonsense inputs.
**Consequence:** compute spent, noise produced, real properties unwritten.
**Fix:** fuzz byte-consuming boundaries; property-test business rules.

### Pitfall 8: Mutation score as a target
**Symptom:** a CI gate on mutation score, met by asserting on everything.
**Consequence:** brittle tests that fail on every refactor.
**Fix:** read the survivors as a to-do list. Judge them by whether the mutant is
a defect worth catching.

---

## References

### Related skills
- `skills/test-driven-development/SKILL.md` — where this layer sits and how much
  of it to have.
- `skills/human-readable-tests/SKILL.md` — the complement: what generated tests
  cannot document.
- `skills/bug-fix-workflow/SKILL.md` — a bug is often a missing property; this is
  where to look for it.
- `skills/testing-<language>/SKILL.md` — configuration and CI wiring.

### External
- John Hughes, *Testing the Hard Stuff and Staying Sane* — where properties come
  from, and model-based testing.
- Hypothesis, fast-check, CsCheck and FsCheck documentation — all four have
  excellent "what property should I write" guides.
- Chen et al., *Metamorphic Testing: A Review of Challenges and Opportunities*.
