# Templates: bug investigation, test-design review, and the fix note

Three documents, in the order the workflow produces them. Each one is a comment
on the issue — the issue is the conversation
(`skills/lpm-contributor/SKILL.md`). Delete every angle-bracket placeholder.

---

## §1 — Investigation report

Posted on the bug **before** any test or fix is written. It has two halves, and
the second half is the one people leave out.

```markdown
## Reproduction

**Reproduces:** yes / intermittently (1 in <n>) / not yet — <what is missing>
**Environment:** <version, config, platform — only the parts that matter>

| | Value |
| --- | --- |
| Input | <exact data, as data — this becomes the test's inputs/> |
| Expected | <what should happen, and where that comes from: spec §, story, oracle> |
| Actual | <what happens, exactly — the value, not "it breaks"> |
| First bad version | <commit / release, if known — `git bisect` if it is cheap> |

```
<the exact command and its exact output>
```

## Root cause

**Where:** `<file:line>`
**What:** <the defect, in one sentence a reviewer can check>
**Why it produces the symptom:** <the chain from that line to the observed value>

<Rejected explanations, if any were investigated and ruled out — this is what
stops the next person repeating the search.>

## Test-gap classification  ← the other half; the investigation is not done without it

**This shipped because the suite:**

- [ ] **A — had no test for this behaviour at all** (missing test)
  - The behaviour is: <state it as a rule, in domain language>
  - It was missed because: <not on the behaviour list / no case folder covered this
    layer / the feature predates the suite / …>
  - Sibling behaviours also uncovered: <list, or "none found">

- [ ] **B — had a test that covered the area and passed anyway** (insufficient test)
  - The test: `<path::test_name>`
  - **Why it passed:** <pick and expand one>
    - boundary pinned from one side only · only the happy path asserted ·
      untested combination of valid fields · assertion too weak ·
      a mock returned what the real dependency never returns · wrong layer ·
      unrepresentative test data · non-determinism hidden by a retry/sleep/skip ·
      expected value copied from the implementation
  - **Remedy:** extend it with a new case / add a separate test / replace the
    formulation — <and why that one>

**Layer the proof-of-fix belongs at:** <unit | human-readable case | integration>
because <why the layer below cannot prove it>.

**Proposed test story:** <id, once raised> — blocks the fix story <id>.
```

---

## §2 — Test-design review (the gate)

Completed by a Sr. Developer or Tech Lead **before** the fix is implemented, on
the test-gap story. Written out, not nodded through — this is
`subagents/test-design-reviewer.md` at work.

```markdown
## Test design review — <test story id> (proof of fix for <bug id>)

**Reviewer:** <name>   **Date:** <YYYY-MM-DD>

### The one question
Would this test have caught this bug, and would it catch the next one of its kind?

### Checklist

**Does it reproduce the defect?**
- [ ] The conditions are the reported failure's conditions, not a paraphrase
- [ ] It is expected to FAIL against today's unfixed code, and the story says so
- [ ] The failure message will name the wrong value and the expected one

**Is the expected value trustworthy?**
- [ ] It comes from the specification / an oracle / a hand derivation — **not**
      from running the fixed code
- [ ] Its source is cited in the story or the case README
- [ ] If nobody can state the correct behaviour, this is flagged as a product
      question and the fix is on hold

**Is it at the right layer?**
- [ ] The lowest layer that can prove the fix
- [ ] Not an end-to-end test standing in for a unit-level rule
- [ ] If the defect is in wiring or serialisation, there is an integration test

**Does it cover the class, not the instance?**
- [ ] It states the rule, not the one reported record
- [ ] Boundaries are pinned from **both** sides
- [ ] The sibling cases (other currency / adapter / field / direction) are covered
      or explicitly deferred to a named story
- [ ] Where an invariant exists, a property test is proposed
      (`skills/automatic-test-generation/SKILL.md`)

**Would a wrong fix pass it?**
- [ ] I have named at least one *plausible but wrong* fix, and this test fails it
      — <the wrong fix, and how the test catches it>
- [ ] The test does not encode the implementation's structure (no asserting on
      private calls, no mock-call-count as the assertion)

**Is it maintainable?**
- [ ] It is additive — no existing assertion or expected value is edited
- [ ] It is deterministic: no wall clock, uuid, random, ordering or network
- [ ] It will be readable in two years: the name states the behaviour, and a case
      folder README explains the walkthrough
- [ ] It runs in the fast loop, or is deliberately placed in a slower target

### Verdict

- [ ] **Approved** — implementation may start
- [ ] **Changes requested**

<For changes requested: the specific defect in the design, and what would fix it.
Be concrete — "add a row at 6 days so the grace boundary is pinned both sides",
not "consider more edge cases".>
```

---

## §3 — Fix handover note

Posted with `finish_task`. This is what the reviewer and the developer in four
months both read.

````markdown
## What changed
- `<file:line>` — <the fix, in one line>
- `<test path>` — <the test, and whether it is new or an added case>
- `<case folder>/README.md` — walkthrough row and history entry for <bug id>

## Why this way
<The cause, and why the fix addresses the cause rather than the symptom.>

Rejected: <the alternative fix> — <why not>.

## Proof

Before the fix, against the unfixed code:
```
<the pasted RED run — the proof of reproduction>
```

After the fix:
```
<the pasted GREEN run — the whole suite, not just the new test>
```

Original reproduction re-run: <no longer reproduces / output>.

## Test gap this closed
<A or B, restated in one line, so the trail survives even if the investigation
comment scrolls away.>

## Class sweep
- <sibling code checked, and what was found — or "checked X, Y, Z: clean">
- <new board items raised, with ids — or "none">

## For the reviewer
- <the judgement call you are least sure of>
````
