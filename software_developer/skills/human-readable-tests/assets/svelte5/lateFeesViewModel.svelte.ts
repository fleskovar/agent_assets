/**
 * Reference system-under-test for the Svelte 5 case runner.
 *
 * The whole reason a UI can have human-readable case folders is that the logic
 * lives in a `.svelte.ts` module rather than in a component: inputs are
 * arguments, the derived state is a value, and nothing here touches the DOM,
 * the clock or a store singleton. The component becomes a thin renderer, and
 * the case pins the view-model — which is where the bugs actually are.
 *
 * See skills/clean-code-svelte5/SKILL.md for the rules this follows.
 */
import type { AssessedFee, Invoice, LateFeePolicy, SkippedInvoice } from "./types";
import { assessLateFees } from "./lateFees";

export interface LateFeeRow {
  readonly invoiceId: string;
  readonly daysOverdue: number;
  readonly feeDisplay: string;
  readonly rule: AssessedFee["rule"];
  readonly severity: "normal" | "attention";
}

export interface LateFeeSummary {
  readonly rows: readonly LateFeeRow[];
  readonly skipped: readonly SkippedInvoice[];
  readonly totalDisplay: string;
  readonly headline: string;
}

const ATTENTION_DAYS = 21;
const MINOR_UNITS_PER_UNIT = 100;

const money = (minorUnits: number, currency: string): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minorUnits / MINOR_UNITS_PER_UNIT);

/** Pure projection: the same inputs always give the same summary. */
export function buildLateFeeSummary(
  invoices: readonly Invoice[],
  policy: LateFeePolicy,
  asOf: string,
): LateFeeSummary {
  const { assessed, skipped } = assessLateFees(invoices, policy, asOf);

  const rows = assessed.map((fee) => ({
    invoiceId: fee.invoice_id,
    daysOverdue: fee.days_overdue,
    feeDisplay: money(fee.fee_minor_units, policy.currency),
    rule: fee.rule,
    severity: fee.days_overdue >= ATTENTION_DAYS ? ("attention" as const) : ("normal" as const),
  }));

  const total = assessed.reduce((sum, fee) => sum + fee.fee_minor_units, 0);

  return {
    rows,
    skipped,
    totalDisplay: money(total, policy.currency),
    headline: `${rows.length} of ${invoices.length} invoices accrued late fees`,
  };
}

/**
 * The rune wrapper. It holds reactive state and delegates every decision to the
 * pure function above, so the case folder can test the projection without a DOM
 * and the component test only has to prove the wiring.
 */
export function createLateFeeStore(initial: {
  invoices: readonly Invoice[];
  policy: LateFeePolicy;
  asOf: string;
}) {
  let invoices = $state(initial.invoices);
  let asOf = $state(initial.asOf);
  const summary = $derived(buildLateFeeSummary(invoices, initial.policy, asOf));

  return {
    get summary() {
      return summary;
    },
    setAsOf(next: string) {
      asOf = next;
    },
    setInvoices(next: readonly Invoice[]) {
      invoices = next;
    },
  };
}
