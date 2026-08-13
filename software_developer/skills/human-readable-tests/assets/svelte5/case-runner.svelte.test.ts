/**
 * Human-readable case folders for a Svelte 5 feature.
 *
 *   npm run test:cases
 *   npm run test:cases -- -t overdue-invoice-fees
 *   npm run debug:case -- overdue-invoice-fees
 *
 * A UI case folder holds three kinds of baseline, in increasing brittleness —
 * add the later ones only when they earn it:
 *
 *   outputs/view_model.json  the pure projection. Always. This is the real test.
 *   outputs/rendered.txt     normalised visible text. When copy and ordering matter.
 *   outputs/a11y_tree.txt    roles and accessible names. When the semantics matter.
 *
 * No pixel snapshots here: they fail on a font update and teach nobody anything.
 * If a visual regression matters, use Playwright's screenshot comparison in the
 * e2e suite, not in a case folder.
 *
 * The file is named *.svelte.test.ts so the Svelte compiler processes the runes
 * used by the store under test.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { flushSync } from "svelte";
import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import LateFeeTable from "$lib/billing/LateFeeTable.svelte";
import { buildLateFeeSummary, createLateFeeStore } from "$lib/billing/lateFeesViewModel.svelte";

const CASES_ROOT = join(__dirname, "cases");

const caseNames = (): string[] =>
  readdirSync(CASES_ROOT)
    .filter((name) => statSync(join(CASES_ROOT, name, "inputs")).isDirectory())
    .sort();

const readJson = <T>(caseDir: string, ...parts: string[]): T =>
  JSON.parse(readFileSync(join(caseDir, ...parts), "utf8")) as T;

const readText = (caseDir: string, ...parts: string[]): string =>
  readFileSync(join(caseDir, ...parts), "utf8").trimEnd();

/** Collapse whitespace so a formatting change in the template is not a failure. */
const normaliseText = (element: HTMLElement): string =>
  (element.textContent ?? "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

describe.each(caseNames())("case %s", (caseName) => {
  const caseDir = join(CASES_ROOT, caseName);
  const invoices = readJson<never[]>(caseDir, "inputs", "invoices.json");
  const policy = readJson<never>(caseDir, "inputs", "policy.json");
  const { as_of_date: asOf } = readJson<{ as_of_date: string }>(caseDir, "inputs", "as_of.json");

  it("projects the documented view model", () => {
    const summary = buildLateFeeSummary(invoices, policy, asOf);

    expect(summary).toEqual(readJson(caseDir, "outputs", "view_model.json"));
  });

  it("renders the documented text", () => {
    const { container } = render(LateFeeTable, { props: { invoices, policy, asOf } });

    expect(normaliseText(container as HTMLElement)).toBe(readText(caseDir, "outputs", "rendered.txt"));
  });

  it("is documented", () => {
    expect(statSync(join(caseDir, "README.md")).isFile()).toBe(true);
  });
});

/**
 * Runes need a reactive root and an explicit flush. This is the one Svelte-5
 * specific trap in the pattern: without flushSync the $derived has not
 * recomputed and you assert on the previous value.
 */
describe("late fee store reacts to a new as-of date", () => {
  it("recomputes the summary when the date moves", () => {
    const caseDir = join(CASES_ROOT, "overdue-invoice-fees");
    const invoices = readJson<never[]>(caseDir, "inputs", "invoices.json");
    const policy = readJson<never>(caseDir, "inputs", "policy.json");

    const cleanup = $effect.root(() => {
      const store = createLateFeeStore({ invoices, policy, asOf: "2026-03-31" });
      expect(store.summary.rows).toHaveLength(4);

      store.setAsOf("2026-03-01");
      flushSync();

      expect(store.summary.rows).toHaveLength(0);
    });

    cleanup();
  });
});
