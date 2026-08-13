/**
 * inputs/ on disk -> the output documents a case expects, keyed by filename.
 *
 * Deliberately free of Vitest: the same function backs the test, the debug
 * entry point at the bottom, and the baseline regenerator. Run one case with a
 * clean call stack and no test-framework frames:
 *
 *   npx tsx tests/run-case.ts overdue-invoice-fees
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assessLateFees, type Invoice, type LateFeePolicy } from "../src/billing/domain/lateFees";

export const CASES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "cases");
export const JSON_INDENT = 2;

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

export function runCase(caseDir: string): Record<string, unknown> {
  const inputs = join(caseDir, "inputs");
  const invoices = readJson<Invoice[]>(join(inputs, "invoices.json"));
  const policy = readJson<LateFeePolicy>(join(inputs, "policy.json"));
  const { as_of_date: asOf } = readJson<{ as_of_date: string }>(join(inputs, "as_of.json"));

  const assessment = assessLateFees(invoices, policy, asOf);

  return {
    "assessed_fees.json": assessment.assessed,
    "skipped.json": assessment.skipped,
  };
}

// Debug entry point: `npx tsx tests/run-case.ts <case-name>`, or the
// "Debug: one human-readable case" launch configuration.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const name = process.argv[2] ?? "overdue-invoice-fees";
  console.log(JSON.stringify(runCase(join(CASES_ROOT, name)), null, JSON_INDENT));
}
