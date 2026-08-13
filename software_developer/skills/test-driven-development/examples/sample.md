# Example: one feature, from acceptance criteria to a shaped suite

The feature is **late-fee accrual** — the same one the case folder in
`skills/human-readable-tests/examples/cases/overdue-invoice-fees/` documents.
This walks the whole path: acceptance criteria → behaviour list → test stories on
the board → the finished suite and what it costs to run.

---

## 1. The feature story (given to us)

```markdown
### Story LP-118: Assess late fees on overdue invoices

- **As a** billing operator
- **I want to** have late fees assessed automatically on overdue invoices
- **so that** I stop reconciling them by hand at month end

#### Acceptance Criteria:
- **Given:** an open invoice past its due date by more than the grace period
- **When:** the monthly assessment runs
- **Then:** a late fee is recorded at the policy's daily rate, floored by the
  minimum fee and capped at a percentage of the invoice total
```

Good enough to start, and — as always — silent on four things the code cannot be
written without. That is what the behaviour list is for.

---

## 2. The behaviour list, with layers

Written **before any test**, in the domain's language, one line per behaviour,
with the layer that should own it. The questions in the right-hand column are the
gaps in the requirement; they went back to the product owner the same morning.

| # | Behaviour | Layer | Question raised |
| --- | --- | --- | --- |
| 1 | A non-open invoice never accrues a fee | unit + case | Does VOID differ from SETTLED? *(No)* |
| 2 | Status is evaluated before any date arithmetic | case | — |
| 3 | An invoice not yet due is skipped, with its own reason | unit + case | — |
| 4 | Grace is inclusive: exactly N days overdue is not charged | unit + case | **Inclusive or exclusive?** *(Inclusive)* |
| 5 | Chargeable days = days overdue − grace | unit | — |
| 6 | Fee accrues at the daily rate on the invoice total | unit + case | — |
| 7 | Accrual rounds half-up to whole minor units | unit + case | **Which rounding?** *(Half-up — finance's spreadsheet)* |
| 8 | The minimum fee floors a small accrual | unit + case | — |
| 9 | The cap is applied after the minimum, so the cap wins | unit + case | **Which wins?** *(The cap)* |
| 10 | Output is sorted by invoice id | unit | — |
| 11 | A fee never exceeds the cap, for any valid input | property | — |
| 12 | Assessed + skipped always equals the input count | property | — |
| 13 | Fees persist to the ledger with the right currency scale | integration | — |
| 14 | The assessment reads invoices from the repository as of a given date | integration | — |

Four requirement questions, found in twenty minutes, before a line of code. That
is the loop paying for itself; each of those, discovered during implementation,
would have cost a rewrite, and discovered in production would have cost money
back.

---

## 3. The stories that went on the board

Sequenced so the test design is approved before the implementation starts.

```text
LP-118  Assess late fees on overdue invoices          (feature)
├── LP-119  Unit tests for late fee accrual           S   ← blocks LP-123
├── LP-120  Human-readable cases for late fee accrual M   ← blocks LP-123
├── LP-121  Property tests for fee bounds             S
├── LP-122  Integration tests for fee persistence     M
└── LP-123  Implement late fee accrual                M   blockedBy: LP-119, LP-120
```

### LP-120, in full — the story most teams skip

```markdown
### Story LP-120: Human-readable cases for late fee accrual

- **Summary:** Give late-fee accrual case folders a developer can solve by hand

#### Use Case:
- **As a** developer meeting billing for the first time
- **I want to** read explicit inputs, expected outputs and a step-by-step walkthrough
- **so that** I can understand and verify fee assessment without reading the implementation

#### Layer: human-readable cases — 2 folders

#### Acceptance Criteria:
- **Scenario:** A developer verifies the expected behaviour by hand
- **Given:** `tests/cases/overdue-invoice-fees/inputs/` holds the invoices, the policy
  and `as_of.json` — the clock is a file, not a call
- **and Given:** `outputs/` holds `assessed_fees.json` and `skipped.json`, sorted by
  invoice id, money in integer minor units
- **and Given:** `README.md` states the eight rules once, then walks each row through
  them with real arithmetic
- **When:** a developer who has not seen the code follows the walkthrough
- **Then:** they arrive at the baseline without running anything, in under five minutes

#### Cases to build:
| Case folder | Behaviour it pins | Baseline source |
| --- | --- | --- |
| `overdue-invoice-fees` | Behaviours 1–4, 7–9: skip reasons, the grace boundary from both sides, half-up rounding, cap-beats-minimum | hand-computed, cross-checked against finance's spreadsheet |
| `policy-change-mid-cycle` | Which policy version applies when it changed after the due date | hand-computed from PRD §4.3 |

#### What this would catch:
- Grace compared with `<` instead of `<=` (INV-1003 vs INV-1007 disagree)
- A switch to banker's rounding (INV-1005 becomes 562)
- Cap and minimum reordered (INV-1002 becomes 500)
- Status checked after the date rules (INV-1004 accrues)
- An unsigned day count (INV-1006 accrues)

#### Definition of done:
- [ ] Both folders complete, per skills/human-readable-tests/template.md
- [ ] Runner discovers cases from disk
- [ ] `make test-case CASE=…` and `make debug-case CASE=…` work and are in the README
- [ ] Implementation broken deliberately once, cases observed red, output pasted
```

Estimated at **M — one day**, and it took most of one. That is the honest number,
and it is why this work needs its own story: hidden inside LP-123 it would have
been the thing that got cut on Thursday afternoon.

---

## 4. The design review, before implementation

LP-119 and LP-120 went to a Tech Lead before LP-123 started
(`subagents/test-design-reviewer.md`). Two findings, both cheap to fix then and
expensive later:

> **1. The grace boundary is pinned from one side only.** `INV-1003` sits at
> exactly 5 days and is skipped, but nothing sits at 6. `days_overdue < grace`
> and `days_overdue <= grace` both pass this case. Add a 6-day row.
>
> **2. `INV-1002` is the only row where minimum and cap disagree — good — but the
> walkthrough does not say which wins or why.** Someone reading it in a year
> cannot tell whether 400 is the rule or a typo. State the ordering as a numbered
> rule.

`INV-1007` exists because of finding 1. Rule 7 in the case README exists because
of finding 2. Both took ten minutes. Finding 1 discovered later would have been a
production incident with a fix that all the tests still passed for.

---

## 5. The finished suite

```text
tests/
  unit/billing/
    test_late_fees.py                 31 tests   0.4 s
  properties/billing/
    test_late_fee_properties.py        4 tests   6.1 s   (hypothesis, 200 examples each)
  cases/
    overdue-invoice-fees/{inputs,outputs,README.md}
    policy-change-mid-cycle/{inputs,outputs,README.md}
    case_runner.py                     (also the debug entry point)
    test_late_fee_cases.py             2 tests   0.1 s
  integration/billing/
    test_fee_ledger_repo.py            7 tests  11.3 s   (Testcontainers: Postgres 16)
```

```bash
$ make test-unit
31 passed in 0.42s

$ make test-cases
2 passed in 0.11s

$ make test
... 44 passed in 18.2s
```

Proportions worth noting: 31 unit tests carry the branch coverage, 4 property
tests carry the input space, **2 case folders carry the documentation**, and 7
integration tests carry the wiring. The two case folders are 4% of the tests and
they are the ones a new developer reads first.

---

## 6. What it bought, three months later

LP-241: *"Invoices not yet due are accruing fees."* The bug-fix workflow
(`skills/bug-fix-workflow/SKILL.md`) classified it as a **missing test** — the
behaviour list had line 3, and the unit test existed, but no *case* covered a
future due date, so the day-count sign was never pinned in the readable layer.

The fix: one new row, `INV-1006`, added to the existing case folder — an
*addition*, so no existing assertion was touched — plus one line in the
walkthrough and one row in the history table. The proof of the fix is a diff a
reviewer reads in ninety seconds, and the case README now explains the defect to
whoever meets it next.

That is the whole return on this practice, and it does not show up in a coverage
percentage.
