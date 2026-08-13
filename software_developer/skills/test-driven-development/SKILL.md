---
name: test-driven-development
argument-hint: "[the feature, module or board item whose test strategy you are designing]"
description: The house test-driven development standard — the red/green/refactor loop, the five layers of the suite and what each is for, the dedicated test user stories every feature carries (unit, integration, and two to five human-readable cases), and the two entry points a project must always have — one command that runs the suite, and one gesture that debugs a single test. Use when planning a feature's tests, writing the test stories on the board, or judging whether a suite is any good.
intent: >-
  Give a feature a test suite that is designed rather than accumulated: the loop that writes it, the layer each test belongs in, the stories that make testing visible work on the board instead of invisible overhead, and the runnability and debuggability guarantees that decide whether anyone uses the suite six months later. Use this to plan testing for new work, to size the test stories, and to review a suite's shape before writing code.
type: workflow
theme: code-craft
best_for:
  - "Planning the tests for a feature before writing the implementation"
  - "Writing the test user stories that go on the board alongside the feature stories"
  - "Judging whether an existing suite is well shaped, not just green"
scenarios:
  - "We're starting the late-fee feature — what tests does it need and what stories go on the board?"
  - "Our suite is 90% green and nobody trusts it. What's wrong with its shape?"
  - "How do I make it easy for a new developer to debug a single test?"
estimated_time: "30-90 min per feature"
---

## Purpose

Tests are not a phase after the code and not a tax on it. They are how the
behaviour gets **specified**, how it stays specified, and — the part most teams
never cash in — how the next developer **learns** the system.

This skill covers four things:

1. **The loop** — test first, in the small, and why it changes the design.
2. **The five layers** of a suite and what each is uniquely for, so tests stop
   being written at whatever level the author found convenient.
3. **The test user stories** every feature carries on the board, so testing is
   visible, estimated and reviewable work rather than something absorbed into
   "implement X".
4. **The two entry points** — one command that runs everything, one gesture that
   debugs one test — which decide whether the suite is used or worked around.

The craft rules for the tests themselves (additive only, one behaviour per test,
name the behaviour, real objects over mocks) live in
`subagents/clean-code-developer.md` under *Tests: additive only*. Read that first;
this file is about the shape of the whole, not the shape of one test.

## Input

**Works best with:** the feature or story about to be built, its acceptance
criteria, and the module boundaries it will touch.

**Also useful:** the existing suite's layout and runtime, the board (`lpm`) the
stories will land on, and the language guides for whatever you are writing.

---

## Key Concepts

### The loop, and what it is actually for

**Red → green → refactor**, in units of minutes:

1. Write the smallest failing test that states the next behaviour. **Watch it
   fail, and read the failure message** — a test you never saw fail is a test you
   have not tested.
2. Write the least code that makes it pass. Ugly is allowed here.
3. Refactor with the test green, changing structure and not behaviour.

The output people notice is coverage. The output that matters is **design
pressure**: writing the test first makes you the first consumer of your own API,
and a painful test is a report about the code, not about testing. Hard to
construct means too many dependencies. Needs six mocks means the unit is doing
six things. Needs a database to check arithmetic means the arithmetic is in the
wrong layer. Cannot be checked without reading the implementation means the
contract is not expressible — see `skills/human-readable-tests/SKILL.md`, which
is this pressure applied deliberately.

**Where test-first is not dogma:** exploratory spikes (throw the spike away and
then write the tests), and pinning legacy behaviour before a refactor
(characterisation tests come first, but they describe what *is*, and the README
must say so). Everywhere else, the test goes first — and for a bug fix it is not
negotiable: see `skills/bug-fix-workflow/SKILL.md`.

### The five layers

Most bad suites are bad because everything got written in one layer. Each of
these answers a question the others cannot.

| Layer | Answers | Volume | Speed | Owns |
| --- | --- | --- | --- | --- |
| **Unit** | Does this function or class do what its name says, at every branch? | Hundreds–thousands | < 10 ms each | Branch and edge coverage, error paths |
| **Property / generated** | Does the invariant hold across the *input space*, not just my examples? | Tens | Seconds | Round trips, ordering, idempotence, "never crashes", oracle equivalence |
| **Human-readable cases** | What is this unit *supposed* to do, in data a person can check? | 2–5 per feature | Fast | Documentation, orderings, boundaries, proof-of-fix |
| **Integration** | Do the real adapters honour the ports — real DB, real HTTP, real files? | Tens | Seconds each | Serialisation, migrations, transactions, wire contracts, wiring |
| **End-to-end** | Can a user complete the journey through the deployed thing? | A handful | Minutes | The few flows whose breakage is a business incident |

Two rules about the shape:

- **Push tests down.** Anything provable one layer lower belongs one layer lower.
  Business rules tested through HTTP are slow, flaky and imprecise about which
  rule broke.
- **But do not skip a layer.** A suite of ten thousand unit tests and no
  integration test is a system where every part works and nothing is connected.
  Mocks agreeing with each other is not evidence.

**Human-readable cases are not a substitute for unit tests.** They are the
readable subset — deliberately few, deliberately data-driven, and worth their
maintenance because they document. A feature whose only tests are case folders
has poor branch coverage and no property coverage.

### What "done" means for a feature

A feature is done when all of these are true. Put them in the definition of done
so it is not a matter of opinion:

- [ ] Unit tests cover every branch of the new logic, including the failure paths.
- [ ] At least one property or generated test exists wherever an invariant can be
      stated — see `skills/automatic-test-generation/SKILL.md`.
- [ ] **Two to five human-readable case folders** exist, each with a `README.md`
      whose walkthrough a developer can follow with a calculator.
- [ ] Integration tests cover each new adapter against the real thing it adapts.
- [ ] Every new test has been **watched failing** at least once.
- [ ] `make test` runs the lot with one command, from a clean clone.
- [ ] A single test and a single case can each be **debugged in one gesture**, and
      the case READMEs say how.
- [ ] No existing test was edited to make the change pass.

### Testing is board work, not overhead

If testing is absorbed into the implementation story, it is invisible: it cannot
be estimated, it cannot be reviewed, and it is what gets dropped when the sprint
tightens. So **every feature carries its own test stories** on the board, with
their own acceptance criteria.

The standard set, per feature:

| Story | Covers | Typical size |
| --- | --- | --- |
| **Unit tests for `<feature>`** | Branch-level coverage of the new domain logic and its error paths | S |
| **Human-readable cases for `<feature>`** | 2–5 case folders with READMEs, and the runner wired if it does not exist | M |
| **Integration tests for `<feature>`** | Each new adapter against the real dependency; the wiring | M |
| **Property tests for `<invariant>`** | Only where an invariant is genuinely statable | S, optional |

The human-readable-cases story is the one to protect. It is the story that
produces the documentation, and it is the first one a rushed team deletes.

**Sequencing on the board:** the test story for a unit is `blockedBy` nothing and
the implementation story is `blockedBy` the *design approval* of its tests — see
`skills/bug-fix-workflow/SKILL.md` for the same gate applied to defects. Writing
the test story first is what makes test-first survive contact with a task board.

`template.md` in this skill has the story templates, in the Mike Cohn + Gherkin
form the product bundle uses (`product_management/skills/user-story/SKILL.md`).

### The two entry points, and why they are non-negotiable

**One command runs the suite.**

```bash
make test              # everything the CI gate runs, from a clean clone
make test-unit         # the fast loop
make test-cases        # the human-readable case folders
make test-case CASE=overdue-invoice-fees
```

Whether it is a `Makefile`, `just`, `npm run`, `dotnet test` or a `task` file
matters less than that it is **one word, documented in the README, and identical
to what CI runs**. A suite whose invocation lives in someone's shell history is a
suite new joiners do not run.

**One gesture debugs a single test.** This is the requirement teams skip and the
one with the highest return, because *stepping through a small test with known
inputs is the single most effective way to learn a codebase*. Every project must
have, and document:

- a way to run **one** test by name from the command line (`-k`, `-t`, `--filter`,
  `-define:ODIN_TEST_NAMES`);
- a debugger entry point that needs no arguments to remember — a `launch.json`
  configuration, a run configuration, an IDE gutter button;
- for the human-readable cases, a **plain executable entry point** that runs one
  case with no test framework on the stack (`assets/*/run-case.*` in
  `skills/human-readable-tests/`), so the first breakpoint is three frames from
  the domain code;
- a way to attach when the failure only happens in CI or under a container.

If a developer cannot get a breakpoint into a failing test in under a minute,
fix that before writing more tests. It is worth more than the next fifty of them.

---

## Application

### Step 1: List the behaviours before the tests

Write the behaviour list from the acceptance criteria — one line each, in the
domain's language. "A settled invoice never accrues a fee." "Grace is inclusive
at five days." Then mark each one with the layer that should own it. This list
becomes the test names, and gaps in it are the gaps in the requirement — find
them now, when they cost a question rather than a release.

### Step 2: Put the test stories on the board

Use `template.md`. Size them honestly; a human-readable case with a real
walkthrough is a half-day, not ten minutes. Link them to the feature and sequence
the implementation behind the test design approval.

### Step 3: Design the tests, and get the design reviewed

**Before implementation.** The reviewer is a Sr. Developer or Tech Lead, and the
question is not "are these tests written well" but "**would these tests actually
detect the failure they claim to?**" — see `subagents/test-design-reviewer.md`.
Reviewing the design costs an hour; discovering after the fix that the test could
never have caught the bug costs the whole cycle.

### Step 4: Run the loop

Red, green, refactor, in minutes. Watch every test fail once. Push each test to
the lowest layer that can prove it.

### Step 5: Wire the entry points before you need them

`make test`, `make test-unit`, `make test-cases`, `make test-case`,
`make debug-case`, plus the launch configurations. Do it on the first feature,
not the fifth.

### Step 6: Check the shape, not the number

Coverage is a **diagnostic, not a target**. A line at 100% coverage with no
assertion about its result is covered and untested. Read the uncovered branches;
that list is useful. The percentage is not.

For a genuine measure, run **mutation testing** on the modules that matter —
`mutmut`/`cosmic-ray` (Python), Stryker (TS/C#) — and ask what fraction of
injected faults the suite kills. It is slow, so run it on the core domain and on
a schedule, not on every push. See `skills/automatic-test-generation/SKILL.md`.

### Step 7: Report what you saw

Paste the actual run. A test result you did not observe is the one unrecoverable
mistake, because everything after it is built on the claim.

---

## Examples

`examples/sample.md` walks one feature — late-fee accrual — from acceptance
criteria to a behaviour list, to the four test stories on the board with their
Gherkin criteria, to the finished suite's layout and runtimes.

---

## Common Pitfalls

### Pitfall 1: Tests written after, at whatever level was convenient
**Symptom:** every test drives the HTTP endpoint, because that was the entry
point the author had.
**Consequence:** slow, flaky, and a failure names the request rather than the
rule. Design pressure is lost entirely.
**Fix:** the behaviour list with a layer beside each line, written first.

### Pitfall 2: Testing absorbed into the implementation story
**Symptom:** "Implement late fees (includes tests)".
**Consequence:** untestable estimates, invisible progress, and tests as the
release-week casualty.
**Fix:** separate stories with their own acceptance criteria. `template.md`.

### Pitfall 3: A green suite nobody trusts
**Symptom:** people re-run failures to see if they pass this time; `@skip` is
common; nobody reads a red build carefully.
**Consequence:** the suite has stopped being evidence, and its cost is now pure.
**Fix:** treat flakiness as a P1 defect with its own ticket. Delete tests that
assert nothing. Find the ambient input — clock, ordering, network, shared state —
and make it explicit.

### Pitfall 4: Mocks all the way down
**Symptom:** a "unit test" with six mocks that asserts which methods were called.
**Consequence:** it pins the implementation, breaks on every refactor, and proves
nothing about behaviour. Six mocks is also the SUT telling you it does six things.
**Fix:** mock only at ports you own. Prefer a hand-written fake implementing the
port — it type-checks and reads. Test the pure core with no mocks at all.

### Pitfall 5: Coverage as a target
**Symptom:** a CI gate at 85%, met with tests that call code and assert nothing.
**Consequence:** effort spent on the number instead of the risk.
**Fix:** use coverage to find *unexercised branches*, use mutation testing to
judge assertion quality, and spend the effort on the modules where a defect is
expensive.

### Pitfall 6: A suite that takes 40 minutes
**Symptom:** developers push and hope.
**Consequence:** the feedback loop is gone, so the tests no longer influence the
code being written.
**Fix:** `make test-unit` under a minute is the target. Push tests down a layer,
parallelise, replace container round-trips with contract tests, and keep the slow
suites on a separate target CI runs.

### Pitfall 7: No documented way to debug a single test
**Symptom:** print statements, and a new developer taking three weeks to become
useful.
**Consequence:** the single largest avoidable onboarding cost in most codebases.
**Fix:** Step 5, on day one — and a README section pointing at it.

---

## References

### Related skills
- `skills/human-readable-tests/SKILL.md` — the readable layer, in detail.
- `skills/automatic-test-generation/SKILL.md` — the property, fuzz and generated
  layer, and mutation testing.
- `skills/bug-fix-workflow/SKILL.md` — TDD applied to a defect, with the design
  gate.
- `skills/testing-python|typescript|csharp|odin|svelte5/SKILL.md` — frameworks,
  runners, and debugger entry points per language.
- `skills/lpm-contributor/SKILL.md` — putting the test stories on the board.
- `product_management/skills/user-story/SKILL.md` — the story and Gherkin format
  `template.md` follows.

### Related agents
- `subagents/test-engineer.md` — designs and writes the suite.
- `subagents/test-design-reviewer.md` — the Sr. Developer gate before
  implementation.
- `subagents/bug-fixer.md` — the defect loop.

### External
- Kent Beck, *Test-Driven Development: By Example*.
- Michael Feathers, *Working Effectively with Legacy Code* — seams and
  characterisation tests.
- Freeman & Pryce, *Growing Object-Oriented Software, Guided by Tests* — ports,
  adapters, and what to mock.
