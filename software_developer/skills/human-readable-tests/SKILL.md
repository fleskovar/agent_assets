---
name: human-readable-tests
argument-hint: "[the function, use case or feature the case should pin down]"
description: Build and review human-solvable golden test cases — a `case-name/inputs/`, `case-name/outputs/`, `README.md` folder that a developer can solve with pen and paper, that doubles as the executable documentation for a unit of behaviour. Use when adding the readable subset of a feature's test suite, when writing the test that will prove a bug fix, or when a piece of code has tests nobody can read.
intent: >-
  Produce test cases that a developer can verify by hand — explicit inputs on disk, a baseline output on disk, and a README that walks the reader from one to the other step by step — so that the expected behaviour of a unit is stated in data a human can check rather than in assertions only the author understood. Use this to create the readable subset of a suite, to give a feature its onboarding documentation, and to make the design pressure toward dependency injection and explicit inputs concrete.
type: workflow
theme: code-craft
best_for:
  - "Giving a feature a small set of tests a new developer can read and solve by hand"
  - "Pinning the exact expected output of a transform, calculation or pipeline before changing it"
  - "Writing the proof-of-fix test for a reported bug"
scenarios:
  - "Add human-readable test cases for the late-fee calculation"
  - "I need a golden case that pins the rounding rule so the refactor cannot change it"
  - "Nobody understands this module — build the case folder that documents it"
estimated_time: "20-60 min per case"
---

## Purpose

Most of a suite is written for the machine. **A small subset should be written for
the human**, and this is that subset: a folder of real input files, a folder of
expected output files, and a `README.md` that walks a reader from one to the other
in steps they can check with a calculator.

```text
tests/cases/overdue-invoice-fees/
    inputs/
        invoices.json
        policy.json
        as_of.json
    outputs/
        assessed_fees.json
        skipped.json
    README.md
```

Two jobs, and the second is the one people underestimate:

1. **Proof.** The outputs are the baseline — produced by hand, by the spec, or by
   the code that already works — and the test fails the moment behaviour drifts
   from them.
2. **Documentation that cannot go stale.** A developer meeting the module for the
   first time opens `README.md`, reads the walkthrough, opens `inputs/`, opens
   `outputs/`, then steps a debugger through the test. Twenty minutes later they
   understand the unit. Prose documentation rots silently; a case folder that rots
   turns the build red.

These do **not** replace unit tests, property tests or integration tests. They are
a deliberately small, deliberately readable layer on top — typically **two to five
per feature**, each pinning one behaviour that matters.

## Input

**Works best with:** the unit under test (a pure function, a use case, a
pipeline stage), its rules, and a real or realistic sample of its input.

**Also useful:** the spec paragraph or requirement the behaviour comes from, the
existing implementation if you are pinning current behaviour, and the bug report
if this case exists to prove a fix.

**Arriving empty-handed?** Start from the smallest unit whose output a person
could compute in under five minutes. If no such unit exists, that is the finding —
see *When you cannot write the case*.

---

## Key Concepts

### "Human-solvable" is the acceptance criterion

A case is human-solvable when **a developer who has never seen the code can read
`inputs/`, apply the rules in `README.md`, and arrive at `outputs/` — without
running anything.** That single test decides almost every question below.

It forces:

- **Small data.** Six invoices, not six thousand. Four rows of CSV, not a
  production export. If a rule needs volume to show up, it needs a different kind
  of test — a property test or a benchmark.
- **Round, meaningful numbers.** `120000` minor units and a `25 bps` rate, chosen
  so the arithmetic is clean and each row demonstrates one rule.
- **One behaviour per case folder.** "Late fees are assessed" — not "late fees are
  assessed and the ledger is updated and the email goes out".
- **Determinism.** No wall clock, no `uuid4`, no unseeded random, no dictionary
  iteration order, no locale-dependent formatting, no absolute paths. Every
  ambient input becomes an input **file** — `as_of.json` holding the date is the
  clock, and the fact that you can write it down is the design win.

A case whose baseline you cannot justify line by line is not a test. It is a
screenshot of whatever the code did on the day you ran it.

### Every row earns its place

The input is not a sample, it is a **table of rules**. Each row exists to
demonstrate exactly one thing, and the README says which:

| Row | Demonstrates |
| --- | --- |
| `INV-1001` | The normal accrual path |
| `INV-1002` | The cap beats the minimum when they disagree |
| `INV-1003` | The grace boundary is inclusive — exactly 5 days is not overdue |
| `INV-1004` | Non-open invoices are skipped before any date maths |
| `INV-1005` | Rounding is half-up, at a value that ends in exactly `.5` |

If you cannot say what a row is for, delete it. Rows that are there "for realism"
are the reason golden files grow to 4,000 lines and nobody reads them again.

### Where the baseline comes from, and why it must be written down

A baseline is only evidence if its provenance is known. There are three legitimate
sources, and the README **must name which one**:

- **Computed by hand** from the specification — the strongest, and the default for
  new behaviour. The walkthrough *is* the derivation.
- **Taken from an oracle** — the legacy implementation being replaced, a
  reference tool, a vendor's published example, a spreadsheet the domain expert
  keeps. Name the oracle and its version.
- **Generated by the current code and then reviewed line by line by a human who
  can justify every value.** Legitimate only for characterisation tests wrapping
  code you are about to refactor, and only with the review actually done. Say so
  in the README, because a future reader must know these numbers describe what the
  code *did*, not what the requirement *says*.

**Generated by the current code and glanced at** is not on the list. That is the
single most common way this practice fails.

### The design pressure is the point

A case folder is only writable when the unit's inputs are all *sayable*. That
makes it a testability probe — the difficulty you hit writing one is the exact
defect in the design:

| You cannot write the case because… | The design fix |
| --- | --- |
| The function reads the wall clock | Take `now` as a parameter, or inject a `Clock` port |
| It generates ids or random values internally | Inject an `IdSource` / seeded RNG |
| It reads config from the environment mid-call | Load config once at startup into an immutable settings object, pass it in |
| It queries a database or an HTTP API | Put a port at the boundary, inject a fake or a fixture-backed adapter |
| It writes its result to instance state instead of returning it | Return the result (`clean-code-developer.md`, *Explicit dependencies* rule 3) |
| The output depends on things not in `inputs/` | Those are hidden inputs. Find them and make them explicit |
| The unit does five things and the output is enormous | Split the unit. Case-test the pieces and one thin orchestrator |

So the sequence "write the case, discover you cannot, fix the seam, write the
case" is not a detour. It is the practice working.

### These cases are also the debugger's front door

The most efficient way to learn an unfamiliar codebase is to set a breakpoint
inside a small test with known inputs and step. A case folder is purpose-built for
it: the input is fixed, the expected output is known, and the runner is three
frames deep. Every language guide in this bundle therefore requires **a documented
way to run one single case under a debugger** — `make debug-case CASE=...`, a
`launch.json` entry, a `--filter`. If a case cannot be debugged in one gesture,
half its value is unrealised.

---

## Application

### Step 1: Choose the unit, and check it is case-shaped

Pick something whose contract is *data in, data out*: a pricing rule, a parser, a
scheduler, a state transition, a report projection, a use case orchestrating
injected ports. Reject, for now, anything whose output is "it called the mailer" —
that is an interaction test and it belongs in the unit layer.

Ask the human-solvable question **before writing anything**: could a colleague
compute this output from this input in under five minutes? If no, shrink the input
or split the unit.

### Step 2: Design the input rows as a rule table

Write the rule table (see *Every row earns its place*) **before** you write the
JSON. Cover, at minimum: the normal path, each boundary — inclusive or exclusive,
stated — one interaction between two rules that could disagree, one excluded or
rejected input, and the empty case if it is legal.

Keep every file in `inputs/` in a diffable text format: JSON, CSV, YAML, plain
text, `.sql`, a small image only when the unit is genuinely about images. One
concept per file, named for the concept — `policy.json`, not `config2.json`.

### Step 3: Produce the baseline, honestly

Compute the outputs by the route you chose in *Where the baseline comes from*.
Write them into `outputs/` in a **canonical** form:

- **Stable order.** Sort by a documented key. Never rely on hash or filesystem
  order.
- **Stable formatting.** Pretty-printed JSON, sorted keys, fixed float formatting
  or — better — integers in minor units. The diff on failure should show the one
  field that changed, not a reflow.
- **No environment in the file.** No timestamps, absolute paths, machine names,
  version banners or run ids. If the real output has them, the adapter that
  produces them is a boundary; normalise at it and say so in the README.
- **Split by concern.** `assessed_fees.json` and `skipped.json` beat one blob:
  a failure names which half broke.

### Step 4: Write `README.md`

Use `template.md`. The walkthrough is the section that carries the value, and it
is the one people skimp on. Write it so that a reader can follow it with a
calculator, referencing real values from the files:

```markdown
### INV-1002 — the cap beats the minimum

1. Status is `OPEN`, so it is assessed.
2. `2026-03-20` → `2026-03-31` is **11 days overdue**; 11 > 5, so it is past grace.
3. Chargeable days = 11 − 5 = **6**.
4. Raw fee = 4000 × 25 bps × 6 = 4000 × 0.0025 × 6 = **60**.
5. 60 is below the 500 minimum, so the minimum applies: **500**.
6. The cap is 10% of 4000 = **400**, and the cap is applied *after* the minimum.
7. Fee = min(500, 400) = **400**, recorded as `rule: "capped"`.
```

Step 6 is the entire reason this case exists — the ordering of minimum and cap is
a decision no signature can express and no unit test name conveys. Written here,
it survives.

### Step 5: Wire the runner

One test per case folder, discovered from disk, so that **adding a case is adding
a folder** — never editing a test file. Load the inputs, call the system under
test, compare against `outputs/` with a diff-friendly assertion, and name the test
after the folder so the failure output names the case.

Every language asset in `assets/` is a working runner of exactly this shape:

| Language | Asset | Framework |
| --- | --- | --- |
| Python | `assets/python/` | pytest, parametrised over case directories |
| TypeScript | `assets/typescript/case-runner.test.ts` | Vitest, `describe.each` over case directories |
| C# | `assets/csharp/CaseRunnerTests.cs` | xUnit `[Theory]` with a `MemberData` case source |
| Odin | `assets/odin/case_runner.odin` | `core:testing`, one `@(test)` proc per case plus a walker |
| Svelte 5 | `assets/svelte5/case-runner.svelte.test.ts` | Vitest + Testing Library, over the view-model |

The per-language testing skills (`skills/testing-<language>/SKILL.md`) cover the
rest of that language's stack.

### Step 6: Make it runnable and debuggable in one gesture

Before you call the case done, both of these must exist and be in the README:

```bash
make test-cases                 # every case folder
make test-case CASE=overdue-invoice-fees
make debug-case CASE=overdue-invoice-fees
```

Plus a debugger entry point that does not require typing a command — a
`launch.json` configuration, a run-configuration, an IDE gutter action. See the
per-language skill for the exact form.

### Step 7: Prove it can fail

**Break the implementation deliberately and watch the case go red**, then undo it.
A golden test asserting against a baseline it accidentally regenerates, or
comparing two things that are the same object, passes forever and proves nothing.
Ten seconds of mutation is the only evidence the case works. Paste what you saw.

---

## Regenerating a baseline

A `UPDATE_BASELINES=1 make test-cases` escape hatch is worth having and dangerous
to have. Rules:

1. **A regenerated baseline is a diff a human reads, line by line, before it is
   committed.** If you cannot explain every changed line, stop.
2. **Never regenerate to make a red build green.** A case that turns red is
   either a real regression or a genuine requirement change — and the second one
   is a product decision, not yours. Stop and ask, naming the case and quoting the
   changed values (`clean-code-developer.md`, *Tests: additive only*).
3. **Requirement changes get a new case, not an overwritten one**, whenever the
   old behaviour still holds for other inputs.
4. **The regenerating commit changes baselines and nothing else**, so review can
   see it.

---

## When you cannot write the case

Report it; do not force it. Two honest outcomes:

- **The unit is untestable as written** — hidden clock, internal I/O, output only
  visible as instance state. Say so, name the seam, and — if the task allows —
  fix the seam first. This is a finding worth more than the test.
- **The behaviour is not case-shaped** — concurrency, performance, cache eviction,
  UI pixels, anything whose truth is a distribution rather than a value. Use the
  right tool (property test, benchmark, fuzz, visual snapshot) and say why the
  case folder was the wrong shape.

---

## Examples

`examples/cases/overdue-invoice-fees/` is a complete, self-contained case folder —
seven input rows, two baseline files, and a README whose walkthrough you can check
with a calculator. Read it before writing your first one.

`examples/sample.md` shows the same case in review: what a Sr. Developer accepts,
and four rejected variants with the reason each fails.

---

## Common Pitfalls

### Pitfall 1: The baseline nobody derived
**Symptom:** `outputs/` was produced by running the code, and the README says
"expected output of the current implementation".
**Consequence:** The test pins whatever the bug was. It will defend the defect for
years and fail every correct fix.
**Fix:** Derive by hand, or name the oracle, or state explicitly that this is a
characterisation test around a refactor — and have a human justify every line.

### Pitfall 2: The 4,000-line golden file
**Symptom:** A production export as input, a giant blob as output.
**Consequence:** Not human-solvable, not reviewable, and its failure diff is
unreadable — so the first response to red is regeneration.
**Fix:** Cut to the rows that demonstrate rules. Keep the big file, if you must,
as a separate smoke test that asserts a shape rather than a value.

### Pitfall 3: The clock in the code
**Symptom:** The case passes today and fails in March.
**Consequence:** Flaky suite, eroded trust, `@skip`.
**Fix:** `as_of.json`. Every ambient input becomes a file.

### Pitfall 4: The walkthrough that restates the code
**Symptom:** "Calls `assess_fees`, which loops over the invoices and applies the
policy."
**Consequence:** The reader learns nothing they could not get from the source, and
the README stops being read.
**Fix:** Do the arithmetic. Name the decision each row pins. If a step has no
number and no rule name, it is not a step.

### Pitfall 5: One case, five behaviours
**Symptom:** A case named `full-pipeline` with eleven output files.
**Consequence:** One failure and you cannot tell which rule broke; the walkthrough
is a chapter.
**Fix:** One behaviour per folder. Orchestration gets its own thin case that
asserts the pieces were wired, not what each piece computed.

### Pitfall 6: The case that cannot fail
**Symptom:** The runner compares the output to itself, writes the baseline when it
is missing, or swallows the comparison in a `try`.
**Consequence:** A permanently green test proving nothing.
**Fix:** Step 7 — break the code, watch it go red, restore.

### Pitfall 7: Treating these as the whole suite
**Symptom:** Forty case folders and no unit tests.
**Consequence:** Slow, coarse, and blind to the input space; a rule with ten
branches gets five rows.
**Fix:** Two to five readable cases per feature, on top of a normal unit and
property layer. See `skills/test-driven-development/SKILL.md`.

---

## References

### Related skills
- `skills/test-driven-development/SKILL.md` — where this layer sits in the suite,
  and the test user stories every feature carries.
- `skills/automatic-test-generation/SKILL.md` — property-based and generated tests,
  the layer that covers the input space these cases deliberately do not.
- `skills/bug-fix-workflow/SKILL.md` — the workflow that turns a bug report into
  one of these cases before any fix is written.
- `skills/testing-python|typescript|csharp|odin|svelte5/SKILL.md` — frameworks,
  runners, Makefile targets and debugger entry points per language.
- `subagents/clean-code-developer.md` — the craft rules (injected collaborators,
  explicit inputs, additive-only tests) that make cases writable.

### Related agents
- `subagents/test-engineer.md` — builds these.
- `subagents/test-design-reviewer.md` — the Sr. Developer gate that approves a case
  design *before* implementation starts.

### External
- Michael Feathers, *Working Effectively with Legacy Code* — characterisation tests.
- Approval / golden testing: `Verify` (.NET), `syrupy` (Python), Vitest file
  snapshots (TS).
