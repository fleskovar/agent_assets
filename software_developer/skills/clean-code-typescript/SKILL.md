---
name: clean-code-typescript
description: Idiomatic TypeScript for the clean-code-developer standard — discriminated unions and readonly types instead of loose objects, branded ids, `as const` constant maps, interfaces as ports, factory-function DI, parsing at the boundary with zod, Result types over thrown strings, vitest, ESLint and strict tsconfig. Use before writing or refactoring any TypeScript or JavaScript.
type: reference
theme: code-craft
best_for:
  - "Writing new TypeScript modules to the house craft standard"
  - "Replacing `any`, loose object literals and stringly-typed state with checked types"
  - "Structuring a TS project so the domain does not import the framework"
---

## Purpose

The language-specific form of `subagents/clean-code-developer.md` for TypeScript.
That file states the rules; this one states what they look like in TS, which TS
idioms fight them, and which tools enforce them.

Assumes TypeScript 5.x with `strict: true`. If you are writing Svelte components,
read `skills/clean-code-svelte5/SKILL.md` as well — this file governs the `.ts` modules
those components call.

---

## The type system is the linter

Most of the agent's rules are free in TypeScript if the compiler is configured to
care. Start here — a lax `tsconfig.json` makes every other rule in this file
advisory.

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,      // arr[i] is T | undefined, which is the truth
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true
  }
}
```

`noUncheckedIndexedAccess` is the one people disable and should not: array and
record access genuinely can be `undefined`, and every bug it surfaces is real.

---

## Typed containers, not loose objects

| Need | Use |
| --- | --- |
| Immutable value object | `type X = { readonly a: A; readonly b: B }` |
| A closed set of shapes | Discriminated union on a literal `kind` field |
| A distinguishable primitive (ids, units) | Branded type |
| Contract a class implements | `interface` |
| Genuine key→value collection, unknown keys | `Record<K, V>` / `Map` — legitimate |

```ts
// No — an unnamed, uncheckable contract in both directions
function priceOrder(order: any, opts?: Record<string, unknown>): number;

// Yes
type Sku = string & { readonly __brand: 'Sku' };

interface OrderLine {
  readonly sku: Sku;
  readonly quantity: number;
  readonly unitPrice: Money;
}

interface PricingOptions {
  readonly currency: Currency;
  readonly includeTax: boolean;
}

function priceOrder(lines: readonly OrderLine[], options: PricingOptions): Money;
```

- **`readonly` on every field and array** you do not intend to mutate. It is the
  cheapest correctness win in the language.
- **Brand your ids.** `UserId` and `OrderId` as bare `string` are the same type, so
  `transfer(orderId, userId)` compiles. Branded, it does not.
- **Discriminated unions instead of optional-field soup.** Not
  `{ status: string; error?: string; data?: T }` — three impossible states — but:

```ts
type FetchState<T> =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly data: T }
  | { readonly kind: 'failed'; readonly error: FetchError };
```

  A `switch` on `kind` is then exhaustive-checked, which is the Strategy pattern
  with compiler support.

- **`unknown`, never `any`.** `unknown` forces a narrowing step; `any` deletes the
  type system from that point outward, silently and transitively.
- **Parse at the boundary.** External JSON becomes a domain type in the adapter and
  nothing downstream sees the raw payload:

```ts
const InvoiceDto = z.object({ id: z.string(), total_cents: z.number().int() });

export async function fetchInvoice(id: InvoiceId): Promise<Invoice> {
  const raw = await http.get(`${INVOICES_PATH}/${id}`);
  return toInvoice(InvoiceDto.parse(raw));   // the only place the wire shape exists
}
```

  Without a runtime parse, an interface over `await res.json()` is a *claim*, not a
  check — the most common source of `undefined is not a function` in typed code.

---

## Constants and closed sets

```ts
// No
if (user.role === 'admin' && attempts > 3) lockFor(30_000);

// Yes
export const ROLE = { admin: 'admin', viewer: 'viewer' } as const;
export type Role = (typeof ROLE)[keyof typeof ROLE];

const MAX_LOGIN_ATTEMPTS = 3;
const LOCKOUT_MS = 30_000;

if (user.role === ROLE.admin && attempts > MAX_LOGIN_ATTEMPTS) lockFor(LOCKOUT_MS);
```

- **`as const` object + derived union** rather than `enum`. It erases to plain
  values, works with `isolatedModules`, has no runtime object surprises, and the
  union type is assignable from string literals.
- Only `const enum` is worse — it breaks under `isolatedModules` and bundlers.
- Constants live in the module that owns them. A project-wide `constants.ts` that
  everything imports becomes a god module and a bundling hazard.

---

## Ports, and the domain that does not import the framework

Interfaces are the ports. Keep them narrow and defined by the *consumer*, not the
implementation.

```ts
// application/ports.ts — declared where it is used
export interface Clock { now(): Date }
export interface InvoiceRepository {
  get(id: InvoiceId): Promise<Invoice | undefined>;
  save(invoice: Invoice): Promise<void>;
}
```

`domain/` and `application/` import no framework, no `fetch`, no `node:fs`, no ORM
client. Enforce it rather than hoping:

```jsonc
// eslint.config.js — import/no-restricted-paths
{ "target": "./src/domain", "from": "./src/adapters" }
```

---

## Explicit dependencies

**Factory functions with closures are the idiomatic DI in TypeScript** — no
container, no decorators, no `reflect-metadata`:

```ts
// No — the module reaches for two globals; untestable without stubbing the world
export async function chargeInvoice(id: InvoiceId): Promise<ChargeResult> {
  const invoice = await db.invoices.find(id);
  return stripe.charge(invoice.total, { at: new Date() });
}

// Yes — collaborators injected once, data passed per call
export function createChargeInvoice(deps: {
  readonly repository: InvoiceRepository;
  readonly gateway: PaymentGateway;
  readonly clock: Clock;
}) {
  return async function chargeInvoice(request: ChargeRequest): Promise<ChargeResult> {
    const invoice = await deps.repository.get(request.invoiceId);
    if (!invoice) return { kind: 'failed', error: CHARGE_ERROR.notFound };
    return deps.gateway.charge(invoice.total, deps.clock.now());
  };
}
```

Prefer this to classes unless the object genuinely has identity and lifecycle.

- **Ambient globals get one reference each.** `Date.now()`, `Math.random()`,
  `crypto.randomUUID()`, `process.env`, `localStorage`, `window`, `fetch` — each
  behind a port, injected. A pure function takes `now: Date` as a parameter.
- **`process.env` is read once**, validated (zod) into a frozen config object, and
  passed down. Not `process.env.X ?? 'default'` scattered across twelve modules.
- **Composition root**: `src/main.ts` / `createApp.ts` builds the concrete adapters
  and wires them. It is the only module that imports both an adapter and a use case.
- **No module-level side effects.** A module that opens a connection or reads
  config at import time makes every consumer untestable and every import order
  significant. Export a factory; call it from the root.

---

## Functional TypeScript

```ts
// No
const open: Summary[] = [];
for (const row of rows) {
  if (row.status === STATUS.open) open.push(toSummary(row));
}

// Yes
const open = rows.filter((row) => row.status === STATUS.open).map(toSummary);
```

- `map` / `filter` / `flatMap` / `reduce` (sparingly) over accumulator loops.
- Return new objects: `{ ...invoice, status: STATUS.paid }`, never `invoice.status =`.
- `readonly T[]` in parameters; return the concrete array.
- **Failure in the type**: `T | undefined` for "not found", a `Result` union for
  "failed". A rejected promise carries `unknown`, so an exception is the *least*
  typed control flow in the language — use it for genuinely exceptional cases and
  a discriminated union for expected ones.
- Exhaustive switches with an `assertNever(x: never)` default — the compiler then
  tells you every place to update when a variant is added.
- `satisfies` to check a literal against a type without widening it away.

**Where to stop.** No fp-ts unless it is already in the project, no point-free
`pipe(...)` towers, no `Either` monad for a function that could return `T |
undefined`. Async/await over promise chains, always. A local mutable accumulator
inside an otherwise pure function is fine.

---

## Vectorization, TypeScript edition

There is no numpy here, so "vectorize when it's free" mostly means **batch the I/O**:

- One query with `WHERE id IN (...)` instead of a query per id; one `Promise.all`
  over a batched request instead of an awaited loop (the N+1 in both DB and HTTP
  form is the real cost in TS, not CPU).
- `Promise.all` / `Promise.allSettled` for independent async work; a sequential
  `for await` loop only when the work genuinely depends on the previous result.
- Build a `Map` once and look up in the loop, rather than `find()` inside a loop —
  that is the O(n²) that shows up in profiles.
- `TypedArray`s (`Float32Array`, `Uint8Array`) for genuinely numeric bulk data,
  canvas/WebGL buffers, and anything crossing into WASM.

Do not micro-optimise array methods into `for` loops without a profile; in
application-shaped TypeScript the allocation is essentially never the bottleneck.

---

## Layout

```
src/billing/
  domain/         invoice.ts  money.ts  pricing-policy.ts   # types + pure functions
  ports/          payment-gateway.ts  invoice-repository.ts  clock.ts
  adapters/       stripe-gateway.ts  sql-invoice-repository.ts  system-clock.ts
  application/    charge-invoice.ts  issue-refund.ts
  constants.ts
```

- One concept per file; kebab-case filenames; named exports only. `export default`
  breaks rename-refactoring and makes the import name a per-file opinion.
- **Barrel files (`index.ts`) sparingly** — at most one per package boundary. Deep
  barrels create import cycles and defeat tree-shaking.
- No `utils.ts`, `helpers.ts`, `common.ts`, `types.ts` as a dumping ground. Types
  live next to the code that owns them.
- `import type { … }` for type-only imports (`verbatimModuleSyntax` enforces it).

---

## Tests

vitest (or jest). **Additive only** — never edit an existing test to make your
change pass.

```ts
it('rejects a refund larger than the original amount', () => {
  const invoice = makeInvoice({ total: money(100, CURRENCY.usd) });

  const result = issueRefund(invoice, money(150, CURRENCY.usd));

  expect(result).toEqual({ kind: 'rejected', error: REFUND_ERROR.exceedsTotal });
});
```

- Name the behaviour in the `it`, arrange / act / assert with blank lines.
- `it.each` for the same behaviour across inputs.
- **Fakes over mocks**: an object literal satisfying the port interface type-checks
  and refactors; `vi.mock` of a module path does neither. Never mock a library you
  do not own — put an adapter in front of it and fake the adapter.
- Never fake timers or patch `Date` when you could inject a `Clock`.
- Test the exported contract, not internals. If something is hard to reach, it
  wants to be its own module.
- Type-level tests (`expectTypeOf`) for a non-obvious generic are cheap and prevent
  silent inference regressions.

---

## Tooling

```bash
tsc --noEmit
eslint . --fix
prettier --write .
vitest run
```

- `typescript-eslint` with `strictTypeChecked`. Non-negotiable rules for this
  standard: `no-explicit-any`, `no-unsafe-*`, `explicit-module-boundary-types`,
  `no-floating-promises`, `no-misused-promises`, `consistent-type-imports`,
  `switch-exhaustiveness-check`, `import/no-cycle`, `import/no-restricted-paths`.
- `no-floating-promises` alone catches a whole class of silently swallowed async
  failures.
- Suppress narrowly and with a reason:
  `// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- <why>`.
  Never a file-level disable, never `@ts-ignore` (use `@ts-expect-error`, which
  fails when the error goes away).

---

## TypeScript-specific traps

- **`any` from untyped libraries and `JSON.parse`.** Both return `any`. Parse into
  a type at the boundary.
- **Type assertions (`as`) are a lie the compiler accepts.** Prefer a type guard,
  a schema parse, or a discriminated union. `as unknown as T` is always a bug or a
  test hack.
- **Structural typing means excess properties pass** once through a variable. An
  interface is not a validator.
- **`interface` declarations merge** across files, silently. Prefer `type` for
  unions and object shapes; use `interface` for contracts meant to be implemented.
- **`readonly` is compile-time only** — it does not freeze anything at runtime.
- **`??` vs `||`**: `||` treats `0` and `''` as missing. Almost always `??`.
- **Floating promises and `forEach` with an async callback** — `forEach` ignores
  the returned promise entirely. Use `for...of` with `await`, or `Promise.all(map())`.
- **`this` in extracted methods.** Prefer standalone functions and closures; if you
  pass a method as a callback, it needs binding.
- **Enum reverse mappings and `const enum`** — use the `as const` map instead.
