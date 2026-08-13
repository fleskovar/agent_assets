---
name: bug-fix-workflow
argument-hint: "[bug id, or the reported symptom]"
description: The defect loop this team runs — reproduce, investigate, and then tie the bug to the test that should have caught it (missing test, or existing test that does not cover the case). Raise a test story for the gap, have a Sr. Developer or Tech Lead validate the test design *before* any fix is written, implement the test and watch it fail, then fix the code and let the test prove it. Use whenever a bug is reported or found.
intent: >-
  Turn a defect into a permanent test rather than a patch, by making the test gap the first deliverable and the test design a reviewed artifact. Use this to stop the two expensive failure modes — a fix with no test, and a test written after the fix that could never have caught the bug — and to leave a trail that explains to the next reader why the code is the way it is.
type: workflow
theme: code-craft
best_for:
  - "Working a reported bug from intake to verified fix"
  - "Deciding whether a defect means a missing test or an insufficient one"
  - "Reviewing a proposed proof-of-fix test before implementation starts"
scenarios:
  - "LP-241: invoices that aren't due yet are accruing late fees"
  - "This test was supposed to cover that path — why did it pass?"
  - "Is this test design good enough to prove the fix?"
estimated_time: "one defect — hours to days"
---

## Purpose

**Every bug is a test that does not exist, or a test that is not good enough.**
That is the premise, and the workflow is built on it: before anything is fixed,
the defect is tied to a specific gap in the suite, and closing that gap is its own
piece of tracked work with its own review.

Fixing a bug without this produces a patch that nobody can evaluate and that the
next refactor quietly undoes. Writing the test *after* the fix produces the
worst artefact in testing: a test written against the fixed code, which passes
the moment it is written, was never observed failing, and would not have caught
the original defect.

The order is the whole point:

```text
 1. Reproduce ────────────────► a failing observation, in data
 2. Investigate ──────────────► root cause AND test-gap classification
 3. Raise the test story ─────► missing test | insufficient test
 4. ►► DESIGN REVIEW GATE ◄◄ ─► Sr. Dev / Tech Lead approves the test design
 5. Write the test ───────────► watch it FAIL against the unfixed code
 6. Fix the code ─────────────► the test goes green; nothing else was edited
 7. Verify and close ─────────► evidence pasted, class of defect swept
```

Step 4 is the step teams skip under pressure, and it is the one that pays: a test
design approved in an hour prevents a fix cycle spent proving the wrong thing.

## Input

**Required:** a bug report, a failing observation, or a reproduction you found
yourself.

**Also useful:** the board (`lpm`) the stories go on, the suite as it stands, and
the feature's behaviour list if one exists.

**Blocking:** a report you cannot reproduce and cannot get more information
about. Say so and stop — see *When you cannot reproduce it*.

---

## Key Concepts

### The classification is the deliverable of the investigation

An investigation is not finished when you know what the code does wrong. It is
finished when you can complete this sentence: **"This shipped because the suite
<did not have | had but did not cover> …"**. Exactly one of two answers:

**A — Missing test.** No test covers the behaviour at all. The behaviour was
never on anyone's list, or it lives at a layer nobody tested. The remedy is a new
test, and it is worth asking why the behaviour was missed — an entire category is
often missing with it.

**B — Insufficient test.** A test covers the area and passed anyway. This is the
more interesting case, and the investigation must say **why it passed**:

| Why the existing test passed | Typical remedy |
| --- | --- |
| Boundary pinned from one side only (`<=` vs `<`) | Add the row on the other side |
| Only the happy path asserted | Add the failure and edge cases |
| A combination untested — each field valid alone, invalid together | A case or property over the combination |
| Assertion too weak — "returns a list", "does not throw" | Assert the value |
| A mock returned what the real dependency never returns | Fix the fake; add an integration test at that port |
| Wrong layer — mocked away the code that broke | Move the test down to where the logic lives |
| Test data unrepresentative — always sorted, always ASCII, always positive | Widen the data; add a property test |
| Non-determinism hidden by a retry, a sleep or a skip | Remove the crutch; make the ambient input explicit |
| The expected value was copied from the implementation | Re-derive it from the specification |

That table is the actual output of the investigation. "The test didn't cover it"
is not a classification; it is a restatement of the bug.

### Improve the formulation, or add a new test?

Once you have case B, choose deliberately, and say which in the story:

- **Extend the existing test** when it is well formulated and simply lacked a
  case. This is an **addition** — a new parametrised case, a new row in a case
  folder's `inputs/`. It never touches an existing assertion or expected value.
- **Write a new, separate test** when the edge case is a different behaviour and
  would confuse the existing test's purpose.
- **Replace the formulation** when the existing test is structurally incapable of
  catching this class — mocked at the wrong layer, asserting on a smoke signal,
  written against the implementation. This is the only case where an existing
  test changes shape, it is a design decision, and it goes through the review
  gate explicitly. The old test is not deleted until the new one is green.

Never edit an existing test's assertions to make the fix pass. If an existing
test fails *because of your fix*, that is one of the two cases in
`subagents/clean-code-developer.md` — either the fix is wrong, or the requirement
changed and that is a product decision. Stop and ask.

### Why the design gate exists

The reviewer answers one question: **would this test actually have caught this
bug, and would it catch the next one of its kind?**

The failure modes it catches are all invisible once implementation starts:

- The test asserts the *symptom* rather than the *rule* — it pins "no fee for
  INV-1006" when the rule is "an invoice not yet due never accrues".
- The expected value was taken from what the fixed code produces, so it proves
  the fix agrees with itself.
- The test sits at the wrong layer — an end-to-end test for an arithmetic bug,
  slow and imprecise about which rule broke.
- It covers the one reported instance and not the class, so the sibling defect
  ships next month.
- It would pass under a *different* wrong fix.

Reviewing this costs an hour before implementation. Discovering it after the fix
costs the cycle, and discovering it in production costs the incident.

### Watching it fail is the proof of reproduction

A proof-of-fix test that has not been observed **red against the unfixed code**
proves nothing about the defect. Run it before the fix, capture the output, and
paste it into the issue. The failure message should name the wrong value and the
expected one — if it says "assertion failed", improve the message now, because
that message is what someone will read at 3 a.m. in two years.

### Sweep the class before you close

The reported instance is a sample. Before closing, spend ten minutes asking:

- Does the same defect exist in sibling code — the other three adapters, the
  other two currencies, the other date field?
- Is there an invariant here that a property test should have caught? (Frequently
  yes — see `skills/automatic-test-generation/SKILL.md`.)
- Did this defect class escape the suite before? Two of a kind is a systemic gap
  and deserves its own ticket.

Findings become new board items, referenced from the bug. They are not absorbed
silently.

---

## Application

### Step 1: Reproduce, in data

Turn the report into a reproduction you can run: exact inputs, exact
configuration, exact expected and actual values. If it reproduces only in an
environment, the difference between environments *is* a finding — record it.

Write the reproduction down as data, not prose, because it becomes the test's
inputs in step 5.

Comment on the issue as soon as it reproduces, with the reproduction. If it does
not reproduce, do not guess — see below.

### Step 2: Investigate, and classify the gap

Find the root cause: the line, and the reason it is wrong. Then do the second
half — the classification (A or B above), with the *why it passed* row if it is B.

Use `template.md` §1. Both halves go in a comment on the bug. An investigation
comment without a classification is not finished.

### Step 3: Raise the test story

Create the test-gap story from `skills/test-driven-development/template.md` §5,
parented under the same feature, and make the fix depend on it:

```bash
lpm new story -t "Test gap — LP-241: invoices not yet due accrue fees" -p LP-118
lpm link LP-243 --depends-on LP-242      # the fix waits on the test
lpm comment LP-241 -f ./investigation.md
```

The story states the gap classification, the layer, the exact Given/When/Then,
and — critically — **where the expected value comes from**. If the expected value
comes from the specification, cite it. If nobody can say what the correct
behaviour is, that is the finding: flag the issue and get a decision. A bug whose
correct behaviour is undefined is a product question wearing a defect's clothes.

### Step 4: The design review gate — before any fix

Hand the test design to a Sr. Developer or Tech Lead
(`subagents/test-design-reviewer.md`). They work `template.md` §2 and record an
explicit verdict on the story: **approved**, or **changes requested** with the
specific defect in the design.

**Do not start the fix while this is open.** If the reviewer is unavailable and
the defect is a live incident, mitigate (revert, flag off, hotfix) and treat the
proper fix as the work this gate governs — a mitigation is not a fix and the
board should not say it is.

### Step 5: Write the test, and watch it fail

Implement exactly the approved design. Run it against the **unfixed** code.
Capture the output:

```text
FAILED tests/cases/test_late_fee_cases.py::test_case[overdue-invoice-fees]
E   assessed_fees.json: extra record {"invoice_id": "INV-1006", "fee_minor_units": 800, ...}
E   skipped.json: missing {"invoice_id": "INV-1006", "reason": "not_yet_due"}
```

Paste it into the issue. That paste is the proof of reproduction, and it is the
one artefact that cannot be reconstructed later.

### Step 6: Fix the code

Smallest change that fully fixes the *cause* — not the symptom, not a guard at
the call site papering over a domain rule. The approved test goes green. No other
test changes. Run the whole suite.

If a different existing test now fails, stop: either the fix is wrong, or a
requirement changed. Do not edit that test.

### Step 7: Verify, sweep, and close

- Paste the real green run — the whole suite, not just the new test.
- Confirm the reproduction from step 1 no longer reproduces, by running it.
- Sweep the class (see above); put anything you find on the board.
- Close with the handover note (`skills/lpm-contributor/SKILL.md`): what changed,
  why, what you rejected, how you verified it, what is still open.
- Update the case folder's history table if the test lives in one, so the next
  reader sees which row exists because of which defect.

---

## When you cannot reproduce it

Do not fix code you cannot show is broken, and do not close the report either.
Both are worse than saying so.

1. Get the missing specifics: exact input, version, config, timestamp, user,
   sequence of actions. Ask precisely — "which currency was the invoice in?" not
   "can you give more detail?".
2. Add the observability you lacked, if the report is credible and the failure is
   plausible. That is real work: raise it as a story.
3. Flag the issue (`flag_issue`, reason `help`) with what you tried, what you
   ruled out, and the specific fact you need. A flag with a question somebody can
   answer in thirty seconds is worth more than a week of speculation.

An intermittent failure is not "not reproducible" — it is a reproduction with a
missing variable, and finding that variable is the investigation. Never respond
to a flaky test by adding a retry.

## When the bug is not in code you test

Some defects do not map to a unit test: a misconfiguration, an infrastructure
change, a third-party API that changed shape, a dependency upgrade. The premise
still holds, one level out — **something should have caught this**:

| Defect source | The test that was missing |
| --- | --- |
| Configuration | A validation test on the config schema; a startup check that fails loudly |
| Infrastructure / deployment | A smoke test in the deployment pipeline |
| Third-party API changed | A contract test against the real API, run on a schedule |
| Dependency upgrade | An integration test at that port; a pinned lockfile plus a scheduled upgrade run |
| Data quality | A validation adapter at the boundary, with its own tests |

Classify it that way and raise the equivalent story. "Not testable" is almost
never true; "not testable at the unit layer" usually is.

---

## Examples

`examples/sample.md` works LP-241 end to end — the report, the reproduction, the
investigation that found a **missing test** rather than the insufficient one
everybody assumed, a design review that rejected the first proposal, the red run,
the fix, and the class sweep that found a sibling defect.

---

## Common Pitfalls

### Pitfall 1: Fix first, test later
**Symptom:** the fix commit adds a test that passed the moment it was written.
**Consequence:** no evidence the test detects the defect; frequently it does not.
**Fix:** the order in this file. Watch it fail, and paste the failure.

### Pitfall 2: Skipping the classification
**Symptom:** "root cause: missing null check. Fixed."
**Consequence:** the same class of defect returns somewhere else, because nobody
asked why the suite let it through.
**Fix:** finish the sentence — "this shipped because the suite…". `template.md` §1.

### Pitfall 3: Editing the existing test until it goes green
**Symptom:** the diff changes an expected value in a test unrelated to the fix.
**Consequence:** yesterday's evidence destroyed; a real regression concealed.
**Fix:** additive only. If an existing test fails, stop and ask.

### Pitfall 4: Testing the symptom
**Symptom:** the proof-of-fix asserts on the exact reported record — the one
invoice id, the one date.
**Consequence:** the sibling case ships next month with a green suite.
**Fix:** test the *rule*. "An invoice not yet due never accrues", with the
boundary pinned both sides.

### Pitfall 5: The gate treated as a formality
**Symptom:** "approved" thirty seconds after the story appeared.
**Consequence:** the whole mechanism is theatre and the bad designs get through.
**Fix:** the reviewer answers the checklist in `template.md` §2 in writing,
including the "would a different wrong fix pass this?" question.

### Pitfall 6: A too-high-layer proof
**Symptom:** an arithmetic bug proved by an end-to-end browser test.
**Consequence:** minutes of runtime, flakiness, and a failure that names the page
rather than the rule.
**Fix:** the lowest layer that can prove it. Add the higher-layer test only if
the wiring is genuinely part of the defect.

### Pitfall 7: Closing on the one instance
**Symptom:** the reported currency is fixed; the other two still round wrongly.
**Consequence:** three tickets where one would have done.
**Fix:** the class sweep in step 7, and put what you find on the board.

---

## References

### Related skills
- `skills/test-driven-development/SKILL.md` — the suite this plugs into, and the
  test-gap story template (§5).
- `skills/human-readable-tests/SKILL.md` — usually the right home for a
  proof-of-fix test: a new row in an existing case folder, with the history table
  recording why.
- `skills/automatic-test-generation/SKILL.md` — when the defect is really a
  missing invariant.
- `skills/lpm-contributor/SKILL.md` — raising the stories, flagging, and the
  handover note.

### Related agents
- `subagents/bug-fixer.md` — runs this loop.
- `subagents/test-design-reviewer.md` — the gate at step 4.
- `subagents/test-engineer.md` — writes the test at step 5 when it is substantial.
- `subagents/clean-code-developer.md` — implements the fix at step 6.
