"""Reference system-under-test for the `overdue-invoice-fees` case folder.

This module exists so the example runner in this directory is runnable end to
end. In a real project it lives in `src/<package>/domain/`, not in the tests.

Note what makes it case-testable, all of it from `clean-code-developer.md`:
`as_of` is a parameter rather than a `date.today()` call, the policy arrives as
an immutable value object rather than from the environment, and the function
returns its result instead of writing it somewhere.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum
from typing import Final

BPS_DENOMINATOR: Final = 10_000


class InvoiceStatus(StrEnum):
    OPEN = "OPEN"
    SETTLED = "SETTLED"
    VOID = "VOID"


class SkipReason(StrEnum):
    NOT_OPEN = "not_open"
    NOT_YET_DUE = "not_yet_due"
    WITHIN_GRACE_PERIOD = "within_grace_period"


class FeeRule(StrEnum):
    ACCRUED = "accrued"
    MINIMUM = "minimum"
    CAPPED = "capped"


@dataclass(frozen=True, slots=True)
class Invoice:
    invoice_id: str
    status: InvoiceStatus
    total_minor_units: int
    due_date: date


@dataclass(frozen=True, slots=True)
class LateFeePolicy:
    currency: str
    grace_period_days: int
    daily_rate_bps: int
    minimum_fee_minor_units: int
    max_fee_ratio_bps: int


@dataclass(frozen=True, slots=True)
class AssessedFee:
    invoice_id: str
    days_overdue: int
    chargeable_days: int
    fee_minor_units: int
    rule: FeeRule


@dataclass(frozen=True, slots=True)
class SkippedInvoice:
    invoice_id: str
    reason: SkipReason


@dataclass(frozen=True, slots=True)
class LateFeeAssessment:
    assessed: tuple[AssessedFee, ...]
    skipped: tuple[SkippedInvoice, ...]


def assess_late_fees(
    invoices: tuple[Invoice, ...],
    policy: LateFeePolicy,
    as_of: date,
) -> LateFeeAssessment:
    """Assess one late fee per overdue open invoice, and a reason for the rest."""
    outcomes = [(invoice, _assess_one(invoice, policy, as_of)) for invoice in invoices]

    assessed = sorted(
        (o for _, o in outcomes if isinstance(o, AssessedFee)),
        key=lambda fee: fee.invoice_id,
    )
    skipped = sorted(
        (o for _, o in outcomes if isinstance(o, SkippedInvoice)),
        key=lambda skip: skip.invoice_id,
    )
    return LateFeeAssessment(assessed=tuple(assessed), skipped=tuple(skipped))


def _assess_one(
    invoice: Invoice,
    policy: LateFeePolicy,
    as_of: date,
) -> AssessedFee | SkippedInvoice:
    if invoice.status is not InvoiceStatus.OPEN:
        return SkippedInvoice(invoice.invoice_id, SkipReason.NOT_OPEN)

    days_overdue = (as_of - invoice.due_date).days
    if days_overdue < 0:
        return SkippedInvoice(invoice.invoice_id, SkipReason.NOT_YET_DUE)
    if days_overdue <= policy.grace_period_days:
        return SkippedInvoice(invoice.invoice_id, SkipReason.WITHIN_GRACE_PERIOD)

    chargeable_days = days_overdue - policy.grace_period_days
    raw = _accrued_fee(invoice.total_minor_units, policy.daily_rate_bps, chargeable_days)
    cap = invoice.total_minor_units * policy.max_fee_ratio_bps // BPS_DENOMINATOR
    fee, rule = _apply_bounds(raw, policy.minimum_fee_minor_units, cap)

    return AssessedFee(
        invoice_id=invoice.invoice_id,
        days_overdue=days_overdue,
        chargeable_days=chargeable_days,
        fee_minor_units=fee,
        rule=rule,
    )


def _accrued_fee(total_minor_units: int, daily_rate_bps: int, chargeable_days: int) -> int:
    """Accrual rounded half-up — banker's rounding is wrong for money here."""
    exact = (
        Decimal(total_minor_units) * Decimal(daily_rate_bps) * Decimal(chargeable_days)
    ) / Decimal(BPS_DENOMINATOR)
    return int(exact.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _apply_bounds(raw: int, minimum: int, cap: int) -> tuple[int, FeeRule]:
    """The minimum applies first, then the cap — so the cap wins when they disagree."""
    floored = max(raw, minimum)
    if floored > cap:
        return cap, FeeRule.CAPPED
    if floored > raw:
        return floored, FeeRule.MINIMUM
    return raw, FeeRule.ACCRUED
