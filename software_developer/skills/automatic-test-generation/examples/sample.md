# Example: generated tests for the late-fee module

Same module as everywhere else in this bundle
(`skills/human-readable-tests/examples/cases/overdue-invoice-fees/`). Here is
what the generated layer adds on top of 31 unit tests and 2 case folders — five
invariants, the generators, three real counterexamples, and what mutation testing
said about the result.

Python and `hypothesis` for concreteness; the shapes translate directly to
`fast-check` and `CsCheck`.

---

## 1. The invariants, in domain language first

Written before any library was imported. A domain expert would agree with each
sentence, which is the test of whether it is a real property.

| # | Sentence | Family |
| --- | --- | --- |
| 1 | A late fee never exceeds the cap on its invoice. | invariant |
| 2 | Every invoice is either assessed or skipped — never both, never neither. | invariant / totality |
| 3 | Doubling every invoice total doubles every fee that was neither floored nor capped. | metamorphic |
| 4 | Assessing the same batch twice gives the same answer. | idempotence |
| 5 | The new implementation agrees with the spreadsheet's formula on every input the spreadsheet accepts. | oracle |

Property 3 is the one worth studying. Nobody can say what the fee *should* be for
a generated invoice without reimplementing the rule — the tautology trap. But
everyone can say how the output must *move* when the input moves, and that is
enough to catch a rounding error, a truncation and an overflow.

---

## 2. The generators

Composed, constrained by construction, biased to the values that break things.
They live beside the domain types, in `tests/generators/billing.py`, and the
whole suite shares them.

```python
from hypothesis import strategies as st

# Bias to boundaries on purpose: 0 and 1 minor unit, and a total large enough to
# overflow a 32-bit intermediate.
TOTALS = st.integers(min_value=0, max_value=2**40)

def valid_policies() -> st.SearchStrategy[LateFeePolicy]:
    return st.builds(
        LateFeePolicy,
        currency=st.sampled_from(["USD", "EUR", "JPY"]),   # JPY has no minor unit
        grace_period_days=st.integers(min_value=0, max_value=90),
        daily_rate_bps=st.integers(min_value=0, max_value=10_000),
        minimum_fee_minor_units=st.integers(min_value=0, max_value=100_000),
        max_fee_ratio_bps=st.integers(min_value=0, max_value=10_000),
    )

@st.composite
def valid_invoices(draw, as_of: date = AS_OF) -> Invoice:
    # Construct, do not filter: generate the offset rather than a pair of dates
    # and reject the ones that disagree. A .filter() here rejected 70% of
    # candidates and hypothesis started reporting "too many filtered examples".
    offset = draw(st.integers(min_value=-400, max_value=400))
    return Invoice(
        invoice_id=draw(st.from_regex(r"INV-[0-9]{4}", fullmatch=True)),
        status=draw(st.sampled_from(list(InvoiceStatus))),
        total_minor_units=draw(TOTALS),
        due_date=as_of - timedelta(days=offset),
    )
```

`max_value=2**40` and the `JPY` entry are deliberate: both found a defect, below.

---

## 3. The properties

```python
@given(invoices=st.lists(valid_invoices(), max_size=25), policy=valid_policies())
def test_fee_never_exceeds_cap(invoices: list[Invoice], policy: LateFeePolicy) -> None:
    assessment = assess_late_fees(tuple(invoices), policy, AS_OF)

    by_id = {i.invoice_id: i for i in invoices}
    for fee in assessment.assessed:
        cap = by_id[fee.invoice_id].total_minor_units * policy.max_fee_ratio_bps // BPS_DENOMINATOR
        assert fee.fee_minor_units <= cap


@given(invoices=st.lists(valid_invoices(), max_size=25, unique_by=lambda i: i.invoice_id),
       policy=valid_policies())
def test_every_invoice_is_assessed_or_skipped(invoices, policy) -> None:
    assessment = assess_late_fees(tuple(invoices), policy, AS_OF)

    seen = [f.invoice_id for f in assessment.assessed] + [s.invoice_id for s in assessment.skipped]
    assert sorted(seen) == sorted(i.invoice_id for i in invoices)


@given(invoices=st.lists(valid_invoices(), max_size=25), policy=valid_policies())
def test_doubling_totals_doubles_unbounded_fees(invoices, policy) -> None:
    """Metamorphic: no need to know the right answer, only how it must move."""
    doubled = [replace(i, total_minor_units=i.total_minor_units * 2) for i in invoices]

    before = {f.invoice_id: f for f in assess_late_fees(tuple(invoices), policy, AS_OF).assessed}
    after = {f.invoice_id: f for f in assess_late_fees(tuple(doubled), policy, AS_OF).assessed}

    for invoice_id, fee in before.items():
        if fee.rule is FeeRule.ACCRUED and after[invoice_id].rule is FeeRule.ACCRUED:
            # ±1 minor unit: half-up rounding of a doubled value can differ by one.
            assert abs(after[invoice_id].fee_minor_units - 2 * fee.fee_minor_units) <= 1
```

Note the `±1` in the last one. Stating the tolerance *and why* is the honest form;
an exact assertion here would be wrong, and deleting the property because it "was
flaky" would have thrown away the test that found counterexample 2.

---

## 4. What it found

### Counterexample 1 — the zero-total invoice

```text
Falsifying example: test_fee_never_exceeds_cap(
    invoices=[Invoice(invoice_id='INV-0000', status=OPEN, total_minor_units=0,
                      due_date=datetime.date(2025, 3, 1))],
    policy=LateFeePolicy(currency='USD', grace_period_days=0, daily_rate_bps=0,
                         minimum_fee_minor_units=1, max_fee_ratio_bps=0),
)
    assert 1 <= 0
```

Shrunk to the smallest possible instance: a zero-total invoice, a cap of zero, a
minimum of one. The minimum floor lifted the fee to 1 and the cap should have
pulled it back to 0 — but `_apply_bounds` returned early when `raw == 0`. A
customer with a fully credited invoice was being charged the minimum late fee.

**Committed as a permanent test, before the fix:**

```python
def test_zero_total_invoice_never_accrues_the_minimum_fee() -> None:
    """Regression (hypothesis, 2026-02-11): the minimum floor bypassed a zero cap."""
    invoice = Invoice("INV-0000", InvoiceStatus.OPEN, total_minor_units=0, due_date=DUE)

    assessment = assess_late_fees((invoice,), MINIMUM_ONLY_POLICY, AS_OF)

    assert assessment.assessed[0].fee_minor_units == 0
```

### Counterexample 2 — the 32-bit intermediate

`total_minor_units=1_099_511_627_776` (2⁴⁰) with a high rate produced a *negative*
fee in the C# port, where the intermediate multiplication was `int`. The property
that caught it was the metamorphic one: doubling the total halved the fee, which
is impossible. This is why `TOTALS` reaches 2⁴⁰ rather than stopping at a
plausible invoice size — plausible ranges do not find overflow.

### Counterexample 3 — JPY

`currency='JPY'` and a minimum of 500 meant a minimum late fee of ¥500 where the
policy intended ¥5 — a zero-decimal currency treated as if it had two. The
property that caught it was the **oracle** one: the finance spreadsheet's formula
used the currency's minor-unit exponent and the implementation hard-coded 100.

The fix was a domain change (a `Currency` type carrying its exponent), not a
one-line patch — and it was found by a generator entry that took ten seconds to
write.

---

## 5. Cost and configuration

```python
# tests/conftest.py — profiles, so the fast loop stays fast
settings.register_profile("dev", max_examples=50, deadline=timedelta(milliseconds=500))
settings.register_profile("thorough", max_examples=2_000, deadline=None)
settings.load_profile(os.environ.get("HYPOTHESIS_PROFILE", "dev"))
```

```bash
$ make test-unit                       # dev profile, properties included
35 passed in 1.9s

$ make props                           # HYPOTHESIS_PROFILE=thorough
4 passed in 47.3s
```

Nightly runs `thorough`; every push runs `dev`. The `.hypothesis/` example
database is cached in CI, so a counterexample found at 2 a.m. is replayed first
on the next run.

---

## 6. Mutation testing, once, on the domain core

```bash
$ mutmut run --paths-to-mutate src/billing/domain
2/2 survived out of 61 mutants
```

Two survivors, and both were useful:

1. **`days_overdue <= policy.grace_period_days` → `<`** survived. No test
   distinguished them. That is *exactly* the finding the test-design reviewer
   raised on LP-120 — the grace boundary pinned from one side only — arrived at
   mechanically. Fixed by the `INV-1007` row in the case folder.
2. **`sorted(..., key=lambda f: f.invoice_id)` → unsorted** survived, because
   every test compared sets or used inputs that were already in order. The case
   folder documents an ordering nothing enforced. Fixed with one unit test on
   reverse-ordered input.

Neither shows up in coverage: both lines were 100% covered the whole time. That
gap — covered but unasserted — is what mutation testing is for, and why it earns
a scheduled run even though it is far too slow for every push.
