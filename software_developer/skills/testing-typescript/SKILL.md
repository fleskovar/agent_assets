---
name: testing-typescript
description: The TypeScript/JavaScript testing stack for this bundle — Vitest layout, fakes over vi.mock, fast-check for the input space, MSW for HTTP, Testcontainers and Playwright for the outer layers, the case-folder runner, coverage and Stryker, plus the npm scripts and --inspect-brk/launch.json entry points for debugging one test or one case. Use before writing or reviewing any TypeScript test.
type: reference
theme: code-craft
best_for:
  - "Choosing between Vitest, Playwright and a contract test for a given behaviour"
  - "Wiring the human-readable case runner and its debug entry point in Node"
  - "Getting a debugger to stop inside a Vitest test without printf"
---

## Purpose

The TypeScript form of `skills/test-driven-development/SKILL.md`. Read
`skills/clean-code-typescript/SKILL.md` first — this file assumes its craft rules
and covers only the testing stack. For components, continue into
`skills/testing-svelte5/SKILL.md`.

Assumes Node 20+, TypeScript 5.4+, ESM.

---

## The stack

| Job | Use | Notes |
| --- | --- | --- |
| Runner + assertions | **Vitest** | Native ESM and TS, Jest-compatible API, fast watch. Jest only if the repo already has it |
| Parametrisation | `it.each` / `describe.each` | Tagged-template form gives readable names |
| Fakes | a hand-written object implementing the interface | Type-checked; `vi.fn()` is not |
| Mocking | `vi.mock`, `vi.spyOn` | Last resort, at your own ports. Never mock a library you do not own |
| Property-based | **fast-check** (`@fast-check/vitest`) | `test.prop` integrates with Vitest |
| Snapshots | `toMatchFileSnapshot` | External `.snap` files review better than inline. Prefer a case folder |
| HTTP fakes | **MSW** (`msw/node`) | Intercepts at the network layer, so the real client code runs |
| Real dependencies | **testcontainers** (`@testcontainers/postgresql`) | Session-scoped container, per-test transaction |
| API contract | **Pact**, or **schemathesis** against the running service | For cross-team contracts |
| E2E | **Playwright** | A handful of journeys; also the only place screenshots belong |
| Coverage | `vitest --coverage` (v8 provider) | Diagnostic, not target |
| Mutation | **Stryker** | Scheduled, on the domain core |
| Time | **pass the date in**; `vi.useFakeTimers()` only for timer-driven code | Needing fake timers for business logic means the clock was not injected |

Avoid: Chai/Sinon in a new Vitest project (`expect` and `vi` cover it), `jest`
alongside `vitest`, and `ts-jest` — it is the slowest option available.

---

## Layout

```
tests/
  unit/billing/          lateFees.test.ts
  properties/billing/    lateFees.properties.test.ts
  cases/                 run-case.ts                 # loader + debug entry point
                         case-runner.test.ts         # one describe per folder
                         overdue-invoice-fees/{inputs,outputs,README.md}
  integration/billing/   feeLedgerRepo.test.ts
  e2e/                   billing.spec.ts             # Playwright, separate config
  setup.ts                                          # MSW server, global hooks
```

Co-locating `*.test.ts` beside the source is also fine and common — pick one and
be consistent. Keep Playwright in its own config with its own command; it must
never run in the fast loop.

---

## Constructs, by what you are proving

### One behaviour, several inputs

```ts
describe.each`
  daysOverdue | expectedReason
  ${-1}       | ${"not_yet_due"}
  ${0}        | ${"within_grace_period"}
  ${5}        | ${"within_grace_period"}
  ${6}        | ${"accrued"}
`("an invoice $daysOverdue days overdue", ({ daysOverdue, expectedReason }) => {
  it(`is ${expectedReason}`, () => {
    const invoice = anInvoice({ dueDate: minusDays(AS_OF, daysOverdue) });

    const assessment = assessLateFees([invoice], POLICY, AS_OF);

    expect(outcomeOf(assessment, invoice.invoiceId)).toBe(expectedReason);
  });
});
```

The `5`/`6` pair is the point — one row alone cannot distinguish `<=` from `<`.

### Failures

```ts
it("rejects a negative rate", () => {
  expect(() => makePolicy({ dailyRateBps: -1 })).toThrowError(/dailyRateBps must be >= 0/);
});
```

A bare `toThrow()` passes when the test itself has a typo. Always constrain it.
For rejected promises: `await expect(p).rejects.toThrowError(/…/)`.

### Fakes over `vi.mock`

```ts
class InMemoryInvoiceRepository implements InvoiceRepository {
  constructor(private readonly byId = new Map<string, Invoice>()) {}
  get(id: string): Invoice | undefined { return this.byId.get(id); }
  save(invoice: Invoice): void { this.byId.set(invoice.invoiceId, invoice); }
}
```

`implements` means `tsc` fails when the port changes. `vi.mock` of a module keeps
compiling forever and answers methods that no longer exist.

### Builders

```ts
const anInvoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  invoiceId: "INV-0001", status: "OPEN", totalMinorUnits: 10_000, dueDate: "2026-03-01",
  ...overrides,
});
```

### Assertions worth knowing

`toEqual` (structural), `toStrictEqual` (also checks classes and `undefined`
keys), `toBe` (identity), `toMatchObject` (partial — good for large results),
`expect.arrayContaining`, and the second argument to `expect(actual, "message")`
which names the case in the failure output.

---

## Human-readable case folders

Pattern: `skills/human-readable-tests/SKILL.md`. Working code:
`skills/human-readable-tests/assets/typescript/` — `run-case.ts` (loader plus a
standalone `tsx` entry point), `case-runner.test.ts` (`describe.each` over case
folders), `package.scripts.json` and `launch.json`.

TypeScript-specific notes:

- **Read the folders at module scope**, so `describe.each` can build the suites —
  Vitest collects synchronously, and an `await readdir` inside `describe` produces
  zero tests silently.
- **`JSON.stringify(value, null, 2)` plus a trailing newline** is the canonical
  form. `Map` and `Set` serialise to `{}` — convert at the boundary.
- **Keep `run-case.ts` free of any Vitest import**, or the debug entry point drags
  the whole framework in.
- Use `expect(actual, `${caseName} :: ${file}`)` so the failure names the file.

---

## Generated tests

```ts
import { fc, test } from "@fast-check/vitest";

test.prop([fc.array(arbInvoice(), { maxLength: 25 }), arbPolicy()])(
  "a fee never exceeds the cap",
  (invoices, policy) => {
    const { assessed } = assessLateFees(invoices, policy, AS_OF);
    return assessed.every((fee) => fee.feeMinorUnits <= capFor(invoices, fee, policy));
  },
);
```

- Build **domain arbitraries** (`arbInvoice`, `arbPolicy`) and share them; use
  `fc.record`, `fc.constantFrom`, `fc.integer({ min, max })`, and `.chain` to
  construct dependent values rather than `.filter` them.
- `fc.configureGlobal({ numRuns })` from an env var — small on push, large nightly.
- On failure fast-check prints a shrunk counterexample **and a seed/path**; commit
  the counterexample as a named `it(...)` before fixing the code.
- Model-based: `fc.commands` for anything with a lifecycle.

See `skills/automatic-test-generation/SKILL.md`.

---

## Integration and E2E

- **MSW** for the adapter's own tests: the real `fetch`/client code runs, only the
  network is intercepted. `onUnhandledRequest: "error"` so a forgotten handler is
  a failure, not a silent passthrough.
- **Testcontainers** for a real database; migrations run in the container, each
  test in a transaction that is rolled back.
- **Playwright** for a handful of journeys. `--ui` for the trace viewer,
  `--debug` for the inspector, `page.pause()` as a breakpoint. Screenshot
  comparison belongs here and nowhere else.

---

## Running the suite

`skills/human-readable-tests/assets/typescript/package.scripts.json` is the
copyable version.

```bash
npm test                       # lint + tsc --noEmit + vitest run — what CI runs
npm run test:unit
npm run test:cases
npm run test:cases -- -t overdue-invoice-fees
npm run test:props
npm run test:cov
npm run bless                  # regenerate case baselines — read the diff
```

`vitest` alone is watch mode with the fastest feedback in this ecosystem — leave
it running. `--reporter=verbose` for CI, `--bail=1` for the first failure.

---

## Debugging a test — the part that matters

```bash
npm run debug:test             # vitest --inspect-brk --no-file-parallelism --test-timeout=0
npm run debug:case -- overdue-invoice-fees
```

Three flags matter and all three are forgettable, which is why they live in a
script:

- **`--inspect-brk`** — stops before the first line so you can attach.
- **`--no-file-parallelism`** — worker threads make breakpoints unreliable; this
  forces a single process. (`--pool=forks --poolOptions.forks.singleFork` on older
  Vitest.)
- **`--test-timeout=0`** — otherwise the test fails while you are sitting at a
  breakpoint.

Then attach with `chrome://inspect`, or use
`skills/human-readable-tests/assets/typescript/launch.json`: *current test file*,
*test at cursor*, and *one human-readable case*. The last one runs `run-case.ts`
under `tsx` with no framework on the stack — three frames from the domain code,
and the fastest way to learn the module.

Also worth knowing: `it.only` and `describe.only` to isolate, `test.fails` to
assert a test currently fails (useful for a proof-of-fix before the fix), and
`--inspect` plus `debugger;` when you only need one stop.

---

## TypeScript-specific test traps

- **`toEqual` ignores `undefined` properties.** `{a: 1, b: undefined}` equals
  `{a: 1}`. Use `toStrictEqual` when the difference matters.
- **`toBe` on objects** compares identity and will fail on structurally equal
  values. `toEqual` is what you usually mean.
- **Floating point** — `toBeCloseTo`, and integer minor units for money.
- **Unawaited promises in tests** pass silently. Enable
  `@typescript-eslint/no-floating-promises`; always `await expect(...).rejects`.
- **`vi.mock` is hoisted** above imports, so it cannot reference outer variables —
  use `vi.hoisted` or, better, stop mocking modules.
- **`vi.restoreAllMocks()` in `afterEach`**, or a spy leaks into the next file.
- **Date and timezone** — `new Date("2026-03-01")` is UTC midnight but
  `new Date(2026, 2, 1)` is local; a suite that passes in UTC fails in CET. Set
  `TZ=UTC` in the test script, and pass dates in as strings.
- **`structuredClone` and `JSON.parse(JSON.stringify(x))` drop `Date` and `Map`** —
  a common source of "the baseline changed and nothing changed".
- **ESM mocking of your own module's internal calls does not work** the way it did
  in CJS. That is a design signal: inject the collaborator.

---

## References

- `skills/clean-code-typescript/SKILL.md` — the craft rules.
- `skills/testing-svelte5/SKILL.md` — components and runes.
- `skills/test-driven-development/SKILL.md`, `skills/human-readable-tests/SKILL.md`,
  `skills/automatic-test-generation/SKILL.md`, `skills/bug-fix-workflow/SKILL.md`.
