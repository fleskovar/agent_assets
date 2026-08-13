/**
 * Vitest runner for human-readable case folders.
 *
 *   npm run test:cases
 *   npm run test:cases -- -t overdue-invoice-fees
 *   npm run debug:case -- overdue-invoice-fees      (see run-case.ts)
 *
 * One `describe` per case folder, discovered from disk, so adding a case is
 * adding a folder — never editing this file.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCase, CASES_ROOT, JSON_INDENT } from "./run-case";

const UPDATE_BASELINES = process.env.UPDATE_BASELINES === "1";

const caseNames = (): string[] =>
  readdirSync(CASES_ROOT)
    .filter((name) => statSync(join(CASES_ROOT, name, "inputs")).isDirectory())
    .sort();

const readBaselines = (caseDir: string): Record<string, unknown> =>
  Object.fromEntries(
    readdirSync(join(caseDir, "outputs"))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => [name, JSON.parse(readFileSync(join(caseDir, "outputs", name), "utf8"))]),
  );

const writeBaselines = (caseDir: string, actual: Record<string, unknown>): void => {
  mkdirSync(join(caseDir, "outputs"), { recursive: true });
  for (const [name, document] of Object.entries(actual)) {
    writeFileSync(join(caseDir, "outputs", name), `${JSON.stringify(document, null, JSON_INDENT)}\n`);
  }
};

describe.each(caseNames())("case %s", (caseName) => {
  const caseDir = join(CASES_ROOT, caseName);

  it("matches its baseline outputs", () => {
    const actual = runCase(caseDir);

    if (UPDATE_BASELINES) {
      writeBaselines(caseDir, actual);
      return; // read the diff before committing it
    }

    const expected = readBaselines(caseDir);
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    // One assertion per output file, so the failure names the file that broke.
    for (const name of Object.keys(expected).sort()) {
      expect(actual[name], `${caseName} :: ${name}`).toEqual(expected[name]);
    }
  });

  it("is documented", () => {
    // A case folder without a README is a golden file, not a readable test.
    expect(statSync(join(caseDir, "README.md")).isFile()).toBe(true);
  });
});
