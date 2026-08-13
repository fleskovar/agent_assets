# Test case: overdue-invoice-fees

## What this proves

Assessing late fees on a batch of invoices produces exactly one fee per overdue
open invoice, at the amount the late-fee policy dictates, and records an explicit
reason for every invoice it skips.

**Unit under test:** `src/billing/domain/late_fees.py::assess_late_fees`
**Layer:** pure domain rule — no I/O, no clock, no repository
**Requirement:** PRD §4.2 "Late fee accrual", story LP-118

## Inputs

| File | What it is | Rows / shape |
| --- | --- | --- |
| `inputs/invoices.json` | The batch being assessed | 7 invoices |
| `inputs/policy.json` | The late-fee policy in force | 5 fields |
| `inputs/as_of.json` | The date the assessment runs on | 1 field |

`as_of.json` is the injected clock. The unit never calls `date.today()`, which is
why this case gives the same answer in March as it does in December.

Money is in **minor units** (integer cents) everywhere — inputs, outputs and the
arithmetic below. Rates are in **basis points**: 25 bps = 0.25%, 1000 bps = 10%.

### Why each row exists

| Row | Demonstrates |
| --- | --- |
| `INV-1001` | The normal accrual path, with clean arithmetic |
| `INV-1002` | The cap beats the minimum when the two disagree |
| `INV-1003` | The grace boundary is inclusive — exactly 5 days overdue is not charged |
| `INV-1004` | Status is checked before any date maths; a settled invoice never accrues |
| `INV-1005` | Rounding is half-up, at a value that lands on exactly `.5` |
| `INV-1006` | An invoice not yet due is skipped with its own distinct reason |
| `INV-1007` | The minimum fee floors a small accrual |

## Expected outputs

| File | What it is | Ordering |
| --- | --- | --- |
| `outputs/assessed_fees.json` | One record per invoice that accrued a fee | `invoice_id` ascending |
| `outputs/skipped.json` | One record per invoice that did not, with the reason | `invoice_id` ascending |

**Canonical form:** pretty-printed JSON, 2-space indent, keys in the order the
domain type declares them, all money as integers.
**Normalised away:** nothing — the unit is pure, so its output has no timestamps,
ids or paths to strip.

The split into two files is deliberate: a regression in the skip rules produces a
failure in `skipped.json` alone, and the diff names it.

## Baseline provenance

- [x] **Computed by hand** from the requirement — the walkthrough below is the
      derivation. Cross-checked against the finance team's spreadsheet
      `late-fees-2026Q1.xlsx`, tab "worked examples".

## Walkthrough

### The rules, stated once

1. **Only `OPEN` invoices accrue.** Any other status is skipped as `not_open`,
   and this is checked **first** — before any date arithmetic.
2. **`days_overdue` = `as_of_date` − `due_date`**, in whole calendar days. A
   negative value means the invoice is not yet due: skipped as `not_yet_due`.
3. **The grace period is 5 days, inclusive.** `days_overdue <= 5` is skipped as
   `within_grace_period`. Exactly 5 is *not* charged.
4. **`chargeable_days` = `days_overdue` − `grace_period_days`**, so the first
   chargeable day is day 6.
5. **Raw fee = `total` × 25 bps × `chargeable_days`**, i.e.
   `total × chargeable_days ÷ 400`, **rounded half-up** to whole minor units.
6. **The minimum fee is 500** minor units, applied *after* the raw accrual.
7. **The cap is 10% of the invoice total**, applied *after* the minimum — so the
   cap wins when the two disagree. Final fee = `min(max(raw, 500), cap)`.
8. **`rule`** records which of the three produced the final number: `accrued`,
   `minimum` or `capped`.

Rules 6 and 7 are the reason this case exists. Their ordering is a decision no
function signature can express, and reversing it changes only one row in the
output — `INV-1002` — which is exactly the kind of regression that ships.

### `INV-1001` — the normal accrual path

1. Status is `OPEN` → assessed.
2. `2026-03-01` → `2026-03-31` is **30 days** overdue. 30 > 5, so it is past grace.
3. Chargeable days = 30 − 5 = **25**.
4. Raw fee = 120000 × 25 ÷ 400 = **7500**.
5. 7500 ≥ 500, so the minimum does not bind.
6. Cap = 10% of 120000 = 12000. 7500 ≤ 12000, so the cap does not bind.
7. → `assessed_fees.json`: `{"invoice_id": "INV-1001", "days_overdue": 30, "chargeable_days": 25, "fee_minor_units": 7500, "rule": "accrued"}`

### `INV-1002` — the cap beats the minimum

1. Status is `OPEN` → assessed.
2. `2026-03-20` → `2026-03-31` is **11 days** overdue. Past grace.
3. Chargeable days = 11 − 5 = **6**.
4. Raw fee = 4000 × 6 ÷ 400 = **60**.
5. 60 < 500, so the minimum lifts it to **500**.
6. Cap = 10% of 4000 = **400**. The cap is applied after the minimum, so it pulls
   the fee back down.
7. Fee = min(500, 400) = **400**, and `rule` is `capped` because the cap produced
   the final number.
8. → `assessed_fees.json`: `{"invoice_id": "INV-1002", "days_overdue": 11, "chargeable_days": 6, "fee_minor_units": 400, "rule": "capped"}`

### `INV-1005` — half-up rounding

1. Status is `OPEN` → assessed.
2. `2026-03-17` → `2026-03-31` is **14 days** overdue. Past grace.
3. Chargeable days = 14 − 5 = **9**.
4. Raw fee = 25000 × 9 ÷ 400 = 225000 ÷ 400 = **562.5** exactly.
5. Half-up → **563**. (Banker's rounding would give 562, and that one-cent
   difference is the whole point of choosing these numbers.)
6. 563 ≥ 500 and the cap is 2500, so neither binds.
7. → `assessed_fees.json`: `{"invoice_id": "INV-1005", "days_overdue": 14, "chargeable_days": 9, "fee_minor_units": 563, "rule": "accrued"}`

### `INV-1007` — the minimum floors a small accrual

1. Status is `OPEN` → assessed.
2. `2026-03-25` → `2026-03-31` is **6 days** overdue — one day past the grace
   boundary, the smallest input that still charges.
3. Chargeable days = 6 − 5 = **1**.
4. Raw fee = 50000 × 1 ÷ 400 = **125**.
5. 125 < 500 → the minimum lifts it to **500**.
6. Cap = 5000, which does not bind. `rule` is `minimum`.
7. → `assessed_fees.json`: `{"invoice_id": "INV-1007", "days_overdue": 6, "chargeable_days": 1, "fee_minor_units": 500, "rule": "minimum"}`

### Rows that produce no fee

| Row | Why it is absent from `assessed_fees.json` |
| --- | --- |
| `INV-1003` | Due `2026-03-26` → exactly **5 days** overdue. Grace is inclusive, so nothing is charged: `within_grace_period`. Pair it with `INV-1007` at 6 days — together they pin the boundary from both sides. |
| `INV-1004` | Status `SETTLED`. Rejected by rule 1 before any date maths, even though it is 45 days past due: `not_open`. If status were checked *after* the date rules, this row would produce a fee. |
| `INV-1006` | Due `2026-04-10`, ten days in the future → `days_overdue` is −10: `not_yet_due`. A naïve `abs()` or an unsigned subtraction turns this into a fee, which is precisely the bug this row catches. |

## Why this proves the code is correct

- **It pins** the four decisions that are invisible in the signature: the grace
  boundary is inclusive, status is evaluated before dates, rounding is half-up,
  and the cap is applied after the minimum.
- **It would catch** an off-by-one on grace (`INV-1003`/`INV-1007` disagree), a
  switch to banker's rounding (`INV-1005` becomes 562), a reordering of cap and
  minimum (`INV-1002` becomes 500), a check-order swap (`INV-1004` accrues), and
  an unsigned day count (`INV-1006` accrues).
- **It does not cover** the input space — negative totals, absurd rates, leap-day
  arithmetic and policy fields out of range belong to the property tests in
  `tests/properties/test_late_fees_properties.py`. It also says nothing about
  where invoices come from or where fees are written; that is the integration
  test over `ChargeLateFees`.

## How to run and debug

```bash
make test-case CASE=overdue-invoice-fees      # run only this case
make debug-case CASE=overdue-invoice-fees     # the same case, under the debugger
```

In VS Code: run configuration **"Debug one test case"**, which prompts for the
case name.

**Start here:** breakpoint on the `assess_late_fees(...)` call in
`tests/cases/conftest.py` (the runner), then step into
`src/billing/domain/late_fees.py`. Each iteration of the loop is one row of the
walkthrough above, in order, so you can single-step your way through this document.

## When to change this case

- A red run here is a regression until proven otherwise. Do not regenerate.
- If the policy genuinely changes — say the cap moves before the minimum — that
  is a product decision. Add a case for the new behaviour and retire this one
  explicitly, in a commit that says so.
- `UPDATE_BASELINES=1 make test-case CASE=overdue-invoice-fees` exists, and every
  line of its diff gets read by a human before it is committed.

## History

| Date | Change | Why |
| --- | --- | --- |
| 2026-02-03 | Created | LP-118 — late fee accrual |
| 2026-03-09 | Added `INV-1006` | LP-241 — invoices not yet due were accruing a fee; this row is the proof of fix |
