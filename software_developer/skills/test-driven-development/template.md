# Templates: test user stories

Fill-in templates for the test stories every feature carries on the board. They
follow the Mike Cohn + Gherkin form used by
`product_management/skills/user-story/SKILL.md`, with two additions that matter
for test work: an explicit **layer** and an explicit **what this would catch**.

A test story whose acceptance criteria do not say what failure it detects is a
story to write coverage, not a story to write tests.

Delete every angle-bracket placeholder before committing.

---

## 1. Unit tests for a feature

```markdown
### Story: Unit tests for <feature>

- **Summary:** Prove every branch of <the new domain logic> behaves as specified

#### Use Case:
- **As a** developer maintaining <module>
- **I want to** have each rule in <feature> covered by a test named for its behaviour
- **so that** a regression in any single rule fails immediately and names itself

#### Layer: unit — pure, hermetic, no I/O, < 10 ms each

#### Acceptance Criteria:
- **Scenario:** Each documented rule has a test
- **Given:** the behaviour list agreed for <feature>
- **and Given:** the implementation exposes each rule as a callable unit
- **When:** `make test-unit` runs
- **Then:** every line of the behaviour list has a test named for it, and every
  test has been observed failing at least once

#### Behaviours to cover:
| Behaviour | Edge cases |
| --- | --- |
| <rule in domain language> | empty / single / boundary / duplicate / failure |

#### What this would catch:
- <the specific plausible regression, e.g. "grace period compared with < instead of <=">

#### Definition of done:
- [ ] Every behaviour above has a test named for the behaviour, not the method
- [ ] Failure paths asserted with the actual error, not "any exception"
- [ ] No existing test edited
- [ ] Each new test watched failing once
- [ ] `make test-unit` green, output pasted into the issue
```

---

## 2. Human-readable test cases for a feature

```markdown
### Story: Human-readable test cases for <feature>

- **Summary:** Give <feature> case folders a developer can solve by hand and learn from

#### Use Case:
- **As a** developer meeting <feature> for the first time
- **I want to** read explicit inputs, expected outputs and a step-by-step walkthrough
- **so that** I can understand and verify the behaviour without reading the implementation

#### Layer: human-readable cases — 2 to 5 folders, per `skills/human-readable-tests/SKILL.md`

#### Acceptance Criteria:
- **Scenario:** A developer verifies the expected behaviour by hand
- **Given:** `tests/cases/<case-name>/inputs/` holds every input, including the ones
  that would otherwise be ambient (clock, ids, config)
- **and Given:** `tests/cases/<case-name>/outputs/` holds the baseline, in canonical form
- **and Given:** `README.md` states what the case proves, where the baseline came from,
  and walks each row through the rules with real arithmetic
- **When:** a developer who has not seen the code follows the walkthrough
- **Then:** they arrive at the baseline outputs without running anything, in under
  five minutes per case

#### Cases to build:
| Case folder | Behaviour it pins | Baseline source |
| --- | --- | --- |
| `<case-name>` | <the one decision it makes impossible to break silently> | hand-computed / oracle / characterisation |

#### What this would catch:
- <ordering, boundary, rounding or skip-reason regressions — be specific>

#### Definition of done:
- [ ] Each case folder has `inputs/`, `outputs/` and a `README.md` from
      `skills/human-readable-tests/template.md`
- [ ] Every input row justified in the "why each row exists" table
- [ ] Every boundary pinned from both sides
- [ ] Baseline provenance stated and, if hand-computed, derived in the walkthrough
- [ ] The runner discovers cases from disk — adding a case is adding a folder
- [ ] `make test-case CASE=<case-name>` and `make debug-case CASE=<case-name>` both work
      and are documented in the case README
- [ ] Implementation deliberately broken once, case observed going red, evidence pasted
```

---

## 3. Integration tests for a feature

```markdown
### Story: Integration tests for <feature>

- **Summary:** Prove the real adapters honour the ports <feature> depends on

#### Use Case:
- **As a** developer changing <adapter or schema>
- **I want to** run <feature> against the real <database / HTTP API / filesystem / engine>
- **so that** a serialisation, migration or wire-contract break is caught before deploy

#### Layer: integration — real dependency, hermetic per test, seconds each

#### Acceptance Criteria:
- **Scenario:** The adapter round-trips against the real dependency
- **Given:** a <container / temp directory / test double server> started by the harness
- **and Given:** the schema at the version the application ships
- **When:** `make test-integration` runs
- **Then:** every port implementation is exercised against the real thing, each test
  cleans up after itself, and no test depends on another test's leftovers

#### Contracts to cover:
| Port | Real dependency | What must round-trip |
| --- | --- | --- |
| <PortName> | <Postgres 16 / vendor API / disk> | <fields, types, nulls, timezones, unicode> |

#### What this would catch:
- <e.g. "a Decimal column rounded to float on write", "a 429 retried forever">

#### Definition of done:
- [ ] Harness starts and stops the dependency itself; no manual setup step
- [ ] Runs from a clean clone with `make test-integration`
- [ ] Every test independent and order-insensitive
- [ ] Failure output shows the actual dependency's error, not a wrapped one
- [ ] Runtime recorded in the issue; if it exceeds <n> minutes, say so
```

---

## 4. Property / generated tests for an invariant

```markdown
### Story: Property tests for <invariant>

- **Summary:** Prove <invariant> holds across the input space, not just the examples

#### Use Case:
- **As a** developer changing <module>
- **I want to** have <invariant> checked against generated inputs
- **so that** an input nobody thought of does not become a production incident

#### Layer: property / generated — per `skills/automatic-test-generation/SKILL.md`

#### Acceptance Criteria:
- **Scenario:** The invariant survives generated input
- **Given:** a generator producing valid <domain type> across its documented range
- **and Given:** a fixed seed recorded in the run output
- **When:** `make props` runs
- **Then:** <invariant, stated as an assertion> holds for every generated case, and
  any counterexample is shrunk, printed, and committed as a regression test

#### Invariants:
| Invariant | Generator | Why it must hold |
| --- | --- | --- |
| <e.g. "fee never exceeds the cap"> | <valid invoices, 0..10^9 minor units> | <the rule it encodes> |

#### What this would catch:
- <e.g. "integer overflow at large totals", "negative chargeable days on a leap day">

#### Definition of done:
- [ ] Invariants stated in domain language before the generators were written
- [ ] Generators produce the awkward values on purpose: zero, one, max, negative,
      unicode, empty, duplicate
- [ ] Any counterexample found is committed as a named unit test, permanently
- [ ] Seed and iteration count printed in the output
```

---

## 5. Test-gap story (from a bug)

Used by `skills/bug-fix-workflow/SKILL.md`. This story exists **before** the fix,
and its output is the test that will prove the fix.

```markdown
### Story: Test gap — <bug id>: <one-line symptom>

- **Summary:** Build the test that fails on <bug id> today and passes when it is fixed

#### Use Case:
- **As a** developer fixing <bug id>
- **I want to** have a test that reproduces the defect and states the correct behaviour
- **so that** the fix is proven rather than asserted, and the defect cannot return

#### Gap classification:
- [ ] **Missing test** — no test covers <behaviour>. New test needed.
- [ ] **Insufficient test** — `<test name>` covers <behaviour> but not <the case that
      escaped: which boundary, which combination, which failure path>.

<If insufficient: state whether the existing test is being *extended with a new case*
or *replaced by a better formulation*, and why. Never edit its existing assertions.>

#### Layer: <unit | human-readable case | integration> — <why this layer and not a lower one>

#### Acceptance Criteria:
- **Scenario:** The test reproduces the reported defect
- **Given:** <the exact conditions from the bug report, as data>
- **and Given:** the code as it is today, unfixed
- **When:** the test runs
- **Then:** it fails, with a message naming the wrong value and the expected one

- **Scenario:** The test states the correct behaviour
- **Given:** <the same conditions>
- **and Given:** the specification says <the correct outcome, and its source>
- **When:** the defect is fixed
- **Then:** the test passes, and no other test changed to make that happen

#### Design review (required before the fix is implemented):
- **Reviewer:** <Sr. Developer / Tech Lead>
- [ ] The test's conditions match the reported failure, not a paraphrase of it
- [ ] The expected value comes from the specification, not from the fixed code
- [ ] The test is at the lowest layer that can prove the fix
- [ ] It would still fail if the fix were wrong in a *different* way
- [ ] It covers the class of defect, not only the one reported instance
- **Approved:** <name, date>

#### Definition of done:
- [ ] Test written and observed **failing** against the unfixed code, output pasted
- [ ] Design review approved before any fix was written
- [ ] Blocks the fix story on the board (`lpm link <fix-id> --depends-on <this-id>`)
```
