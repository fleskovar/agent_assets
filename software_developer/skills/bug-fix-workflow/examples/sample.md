# Example: LP-241, end to end

*"Invoices that aren't due yet are getting late fees."* One defect, worked through
the whole loop — including a design review that rejected the first proposal, and
a class sweep that found a second bug nobody had reported.

Same module as the rest of the bundle:
`skills/human-readable-tests/examples/cases/overdue-invoice-fees/`.

---

## 0. The report

```markdown
### Bug LP-241: Late fees on invoices that aren't due yet

Reported by: billing ops
Two customers were charged late fees this month on invoices dated for April.
Ops noticed because a customer called. Roughly 30 invoices affected.
```

Vague, as reports are. The first job is to turn it into data.

---

## 1. Reproduction

Fifteen minutes, mostly spent getting the real policy row out of staging.

```markdown
## Reproduction

**Reproduces:** yes, deterministically
**Environment:** any — the defect is in pure domain code

| | Value |
| --- | --- |
| Input | Invoice INV-1006, status OPEN, total 8000, due 2026-04-10; policy grace 5 / 25 bps / min 500 / cap 1000 bps; as_of 2026-03-31 |
| Expected | skipped, reason `not_yet_due` — PRD §4.2: "a fee accrues only once an invoice is past due" |
| Actual | assessed, fee 500 (`rule: minimum`) |
| First bad version | v2.4.0 — the original late-fee release. Never worked. |

$ python -c "from billing.domain.late_fees import *; print(assess_late_fees((INV_1006,), POLICY, date(2026,3,31)))"
LateFeeAssessment(assessed=(AssessedFee('INV-1006', days_overdue=-10, chargeable_days=-15, fee_minor_units=500, rule=minimum),), skipped=())
```

`days_overdue=-10` and `chargeable_days=-15` in the output are the tell: the
negative accrual (−300) was lifted to the 500 minimum by the floor, which turned
a nonsense number into a plausible-looking charge. **That** is why nobody noticed
for four months — the bug produced a legal-looking fee, not a crash.

---

## 2. Investigation

```markdown
## Root cause

**Where:** `src/billing/domain/late_fees.py:112`
**What:** `_assess_one` compares `days_overdue <= policy.grace_period_days` to detect
the grace period, but never checks for a *negative* days_overdue. A future due date
produces days_overdue = -10, which is <= 5, so... it should have been skipped.
It is not, because the grace check runs on `abs(days_overdue)` — added in a
"fix timezone drift" commit (a1b2c3d, v2.4.0) that misread the symptom it was chasing.

**Why it produces the symptom:** abs(-10) = 10 > 5, so the invoice is treated as
10 days overdue; chargeable_days = -15; the raw accrual is negative; the minimum
floor lifts it to 500. The nonsense is laundered into a plausible fee.

Ruled out: the repository query (it correctly returns all open invoices — filtering
future invoices there would hide the domain bug, not fix it).

## Test-gap classification

**This shipped because the suite:**

- [x] **A — had no test for this behaviour at all** (missing test)
  - The behaviour is: *an invoice whose due date is in the future never accrues a
    fee, regardless of policy.*
  - It was missed because: the behaviour list for LP-118 has it as line 3, and
    `test_late_fees.py` has `test_invoice_not_yet_due_is_skipped` — **but** it
    passes because it uses a policy with `minimum_fee_minor_units=0`, so the
    defect produces a fee of 0 and the test's assertion (`fee == 0`) holds.
  - Sibling behaviours also uncovered: the same abs() is used in the dunning-level
    calculation at `dunning.py:44`. Not yet verified — see class sweep.
```

Worth pausing on that: the first instinct was **B, insufficient test**, since a
test with the right *name* existed. The honest classification is that the
existing test asserts a fee of zero under a zero minimum, so it can never
distinguish "skipped" from "assessed at zero" — it is a test of the wrong thing
that happens to be named correctly. Recorded as A, with the explanation, because
what is missing is a test that asserts the invoice appears in `skipped` **with its
reason**.

Wrong classification here would have led to "add a case to the existing test",
which the existing test's shape cannot carry.

---

## 3. The test story

```bash
$ lpm new story -t "Test gap — LP-241: invoices not yet due accrue fees" -p LP-118
Created LP-242
$ lpm new story -t "Fix LP-241: guard negative days_overdue" -p LP-118
Created LP-243
$ lpm link LP-243 --depends-on LP-242
$ lpm comment LP-241 -f ./investigation.md
```

LP-242, abbreviated:

```markdown
#### Gap classification: A — missing test
#### Layer: human-readable case — the rule is domain arithmetic, and the existing
case folder already carries the other skip reasons, so this row belongs beside them.
A unit test alone would prove the fix, but would not document why the row exists.

#### Acceptance Criteria:
- **Scenario:** The case reproduces the defect
- **Given:** a row in `tests/cases/overdue-invoice-fees/inputs/invoices.json` with a
  due date after `as_of.json`, and a policy whose minimum fee is non-zero
- **and Given:** the code as it is today, unfixed
- **When:** `make test-case CASE=overdue-invoice-fees` runs
- **Then:** it fails, showing an unexpected record in assessed_fees.json and a
  missing record in skipped.json

- **Scenario:** The case states the correct behaviour
- **Given:** the same row
- **and Given:** PRD §4.2 — "a fee accrues only once an invoice is past due"
- **When:** the defect is fixed
- **Then:** the row appears in `skipped.json` with reason `not_yet_due`, and no
  existing row's expected values changed
```

---

## 4. The design review — first submission rejected

The first draft of LP-242 proposed a unit test:

```python
def test_invoice_due_in_future_is_not_assessed() -> None:
    assessment = assess_late_fees((INV_1006,), POLICY, AS_OF)
    assert assessment.assessed == ()
```

The Tech Lead's review:

```markdown
### Verdict: Changes requested

**Would a wrong fix pass it?** Yes, and this is the blocker. A plausible wrong fix
is to clamp `chargeable_days` at zero — `max(0, days_overdue - grace)`. That makes
`assessed` empty, so this test goes green, but the invoice then disappears from
BOTH outputs: it is neither assessed nor skipped, and the monthly reconciliation
that counts input rows against output rows breaks silently next quarter.

Assert the positive outcome, not the absence: the invoice must appear in `skipped`
with reason `not_yet_due`.

**Does it cover the class?** Not yet. The boundary between "not yet due" and "due
today" is untested. days_overdue = 0 must be skipped as within_grace_period, not
not_yet_due — those are different reasons and the reconciliation report groups by
them. Pin both sides.

**Right layer?** Agreed on the case folder, and note the existing unit test
`test_invoice_not_yet_due_is_skipped` is misleadingly named for what it asserts.
Raise a separate ticket to strengthen it — do not edit it as part of this fix.

Approve once: (1) the assertion is on `skipped` and its reason, (2) a due-today row
is added, (3) the follow-up ticket for the unit test exists.
```

All three points cost the reviewer twenty minutes. Point 1 alone would have been a
silent reconciliation failure a quarter later, found by an accountant.

Resubmitted with the changes, approved the same day. LP-244 raised for the
misnamed unit test.

---

## 5. The test, red against the unfixed code

Two rows added to `inputs/invoices.json` — an **addition**, so no existing
expected value was touched — plus their walkthrough entries:

```json
{ "invoice_id": "INV-1006", "status": "OPEN", "total_minor_units": 8000,  "due_date": "2026-04-10" },
{ "invoice_id": "INV-1008", "status": "OPEN", "total_minor_units": 60000, "due_date": "2026-03-31" }
```

and in `outputs/skipped.json`:

```json
{ "invoice_id": "INV-1006", "reason": "not_yet_due" },
{ "invoice_id": "INV-1008", "reason": "within_grace_period" }
```

```text
$ make test-case CASE=overdue-invoice-fees
FAILED tests/cases/test_late_fee_cases.py::test_case[overdue-invoice-fees]
E   AssertionError: overdue-invoice-fees :: assessed_fees.json
E   + {'invoice_id': 'INV-1006', 'days_overdue': -10, 'chargeable_days': -15,
E   +  'fee_minor_units': 500, 'rule': 'minimum'}
E   AssertionError: overdue-invoice-fees :: skipped.json
E   - {'invoice_id': 'INV-1006', 'reason': 'not_yet_due'}
1 failed in 0.13s
```

Pasted onto LP-242. That output is the proof of reproduction; it cannot be
reconstructed after the fix.

---

## 6. The fix

```diff
-    days_overdue = abs((as_of - invoice.due_date).days)
+    days_overdue = (as_of - invoice.due_date).days
+    if days_overdue < 0:
+        return SkippedInvoice(invoice.invoice_id, SkipReason.NOT_YET_DUE)
     if days_overdue <= policy.grace_period_days:
         return SkippedInvoice(invoice.invoice_id, SkipReason.WITHIN_GRACE_PERIOD)
```

The `abs()` came from commit a1b2c3d, *"fix timezone drift producing negative day
counts"* — a real symptom with an entirely wrong fix. The actual drift was a naive
datetime compared against an aware one, fixed properly in v2.5 when dates became
`date` rather than `datetime`. The `abs()` outlived its own excuse by eight
months. Removing it is safe now, and the case folder says so.

```text
$ make test
44 passed in 18.4s
```

---

## 7. Class sweep, and what it found

- **`dunning.py:44`** — same `abs()`, same origin commit. **A second live defect**:
  invoices not yet due were being counted toward the dunning level, so a customer
  with future invoices could receive a level-2 reminder. Nobody had reported it.
  Raised as **LP-245** with its own test-gap story, not absorbed into this fix.
- **Property test gap** — no invariant asserted "assessed + skipped == input
  count", which would have caught both this bug and the reviewer's hypothetical
  wrong fix mechanically. Raised as **LP-246**.
- **Grep for `abs(` across the domain** — three more, all legitimate (distances
  and absolute variances). Checked, clean.

## 8. The trail left behind

The case folder's history table now reads:

```markdown
| 2026-03-09 | Added `INV-1006`, `INV-1008` | LP-241 — invoices not yet due were accruing a fee; these rows are the proof of fix |
```

and the walkthrough's skip table explains, in one line, that a naive `abs()` on
the day count turns `INV-1006` into a fee — which is the sentence that stops
someone reintroducing it.

**Total cost:** two hours of investigation and review, one hour of implementation.
**What it bought:** a fix that is proven rather than asserted, a second defect
found before a customer found it, two follow-up gaps on the board, and a case
folder that now teaches the rule to whoever meets it next.
