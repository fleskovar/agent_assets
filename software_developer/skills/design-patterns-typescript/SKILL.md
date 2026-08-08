---
name: design-patterns-typescript
description: The design patterns from the clean-code-developer standard in idiomatic TypeScript — closures and factory functions instead of class hierarchies, discriminated unions instead of Visitor and State, Result types instead of thrown errors, and where a class is still the right answer. Use when choosing how to structure TypeScript code, not just how to write a line of it.
type: reference
theme: code-craft
best_for:
  - "Implementing Strategy, Factory, Adapter, Facade or Repository in TypeScript"
  - "Replacing an inheritance hierarchy with a discriminated union"
  - "Wiring dependencies in a TS app without a DI container"
---

## Purpose

`subagents/clean-code-developer.md` says to use the well-known patterns and name
them out loud. This file says what each one looks like in TypeScript.

**Two forces collapse most GoF patterns here.** Functions are values and closures
capture state, so anything that was a one-method object is a function. And the
type system has *closed unions with exhaustiveness checking*, which replaces the
whole family of patterns invented to dispatch on type without a `switch`.

Use the collapsed form and **keep the name** in the symbol.

| Pattern | TypeScript form | Class form when… |
| --- | --- | --- |
| Strategy | A function, or a `Record` of functions | The strategy holds state or has several methods |
| Factory | A `createX()` function | Never — factory *classes* have no purpose here |
| Singleton | A module-level `const` from the composition root | Never in app code |
| Adapter | An object satisfying a port interface | Either form; class if it holds a connection |
| Facade | A module, or an object returned by a factory | It owns a lifecycle |
| Decorator (GoF) | A function wrapping an object of the same interface | — |
| Template Method | A higher-order function | — |
| Command | A closure, or a discriminated-union action object | It is queued, logged or undone |
| Observer | A typed emitter with an unsubscribe return | — |
| State / Visitor | Discriminated union + exhaustive `switch` | — |
| Builder | An options object; a fluent chain only for query DSLs | — |
| Iterator | A generator function | Never hand-write one |
| Repository | An object satisfying a port interface | — |
| DI container | Factory functions + a composition root | The framework imposes one (Nest, Angular) |

---

## Discriminated unions replace the type-dispatch patterns

Before reaching for State, Visitor, or a class hierarchy, ask whether the thing is
a closed set of shapes. Usually it is, and then this is the whole pattern:

```ts
type PricingRule =
  | { readonly kind: 'flat'; readonly amount: Money }
  | { readonly kind: 'perUnit'; readonly unitPrice: Money }
  | { readonly kind: 'tiered'; readonly tiers: readonly Tier[] };

export function price(rule: PricingRule, lines: readonly OrderLine[]): Money {
  switch (rule.kind) {
    case 'flat':    return rule.amount;
    case 'perUnit': return multiply(rule.unitPrice, totalUnits(lines));
    case 'tiered':  return priceTiered(lines, rule.tiers);
    default:        return assertNever(rule);
  }
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}
```

`assertNever` in the default branch is the point: add a variant and **every**
switch that handles the union fails to compile until you update it. No class
hierarchy gives you that. Use this for state machines, AST nodes, events, API
results and UI states.

The class form is right only when each variant carries substantial behaviour *and*
new variants come from other modules — which, in application code, is rare.

---

## Strategy

```ts
// The collapsed form — a named type alias is what makes it a pattern
export type RetryDelay = (attempt: number) => Milliseconds;

export const exponentialBackoff: RetryDelay = (attempt) => BASE_DELAY_MS * BACKOFF ** attempt;
export const fixedDelay: RetryDelay = () => BASE_DELAY_MS;

export async function callWithRetry<T>(
  action: () => Promise<T>,
  delay: RetryDelay,
  attempts: number,
): Promise<T> { ... }
```

**A `Record` of strategies** when the choice comes from data — it is a lookup table
with compile-time completeness:

```ts
const FORMATTERS = {
  csv: formatCsv,
  json: formatJson,
  parquet: formatParquet,
} as const satisfies Record<ExportFormat, Formatter>;

const format = FORMATTERS[request.format];   // no switch, no default case to forget
```

`satisfies Record<ExportFormat, Formatter>` makes a missing format a compile error.

---

## Factory

Factory functions, not factory classes. A `class XFactory { create() }` in
TypeScript is a function that made you type the word `new`.

```ts
export function createPaymentGateway(config: GatewayConfig): PaymentGateway {
  switch (config.kind) {
    case 'stripe':  return createStripeGateway(config.apiKey);
    case 'sandbox': return createSandboxGateway();
    default:        return assertNever(config);
  }
}
```

The factory is also where **partial application** happens — it is the DI seam:

```ts
export function createChargeInvoice(deps: ChargeDeps) {
  return async (request: ChargeRequest): Promise<ChargeResult> => { ... };
}
export type ChargeInvoice = ReturnType<typeof createChargeInvoice>;
```

Exporting the `ReturnType` alias gives consumers a name to depend on without
depending on the implementation.

---

## Adapter and Port

The pattern that does not collapse. The port is an interface declared **where it
is consumed**; the adapter is an object satisfying it, and the only place the
vendor exists.

```ts
// application/ports/payment-gateway.ts
export interface PaymentGateway {
  charge(amount: Money, at: Date): Promise<ChargeResult>;
}

// adapters/stripe-gateway.ts — the only module importing 'stripe'
export function createStripeGateway(apiKey: ApiKey): PaymentGateway {
  const client = new Stripe(apiKey);
  return {
    async charge(amount, at) {
      const intent = await client.paymentIntents.create(toStripeAmount(amount));
      return toChargeResult(intent);
    },
  };
}
```

- `toStripeAmount` / `toChargeResult` are pure, exported for tests, and are the
  boundary where the wire shape dies.
- Parse untrusted responses with a schema here (zod). An `interface` over
  `await res.json()` is an assertion, not a check.
- The same shape wraps `fetch`, `localStorage`, `Date`, `crypto`, the filesystem —
  each behind a one-method port so the domain stays pure.

---

## Facade

A module of a few exported functions, or an object returned by one factory:

```ts
// billing/index.ts — the package's public surface
export type { Invoice, ChargeResult } from './domain/invoice';
export { createBilling } from './create-billing';
```

`createBilling(deps)` returns `{ chargeInvoice, issueRefund, listOverdue }`, hiding
six collaborators behind three verbs. Keep the facade's surface small — a facade
that re-exports everything is a barrel file with ambitions, and it defeats
tree-shaking.

---

## Decorator

A function taking an object of an interface and returning another of the same
interface. Cross-cutting behaviour without touching the implementation:

```ts
export function withCache(
  inner: InvoiceRepository,
  cache: Map<InvoiceId, Invoice>,
): InvoiceRepository {
  return {
    async get(id) {
      const hit = cache.get(id);
      if (hit) return hit;
      const found = await inner.get(id);
      if (found) cache.set(id, found);
      return found;
    },
    save: inner.save,
  };
}
```

Compose them in the composition root: `withRetry(withLogging(withCache(repo, cache)))`.
Caching, retry, logging, metrics and tracing all belong here rather than inside
the adapter, which is how the adapter stays about one thing.

**Do not use TS `@decorator` syntax** for this unless the project is
Nest/Angular/TypeORM and already committed to it. Legacy decorators need
`reflect-metadata`, complicate the build, and hide control flow.

---

## Command

A closure for the simple case; a discriminated union when it is data:

```ts
export type CartAction =
  | { readonly kind: 'addLine'; readonly line: OrderLine }
  | { readonly kind: 'removeLine'; readonly sku: Sku }
  | { readonly kind: 'applyCoupon'; readonly code: CouponCode };

export function reduce(state: CartState, action: CartAction): CartState { ... }
```

That is Command plus a pure reducer — serialisable, loggable, undoable, and
testable as a plain function. Redux, Zustand and every event-sourced system are
this pattern with a runtime attached.

---

## Observer

```ts
export type Unsubscribe = () => void;

export function createEmitter<E extends Record<string, unknown>>() {
  const listeners = new Map<keyof E, Set<(payload: never) => void>>();

  return {
    on<K extends keyof E>(event: K, listener: (payload: E[K]) => void): Unsubscribe {
      const set = listeners.get(event) ?? new Set();
      set.add(listener as (payload: never) => void);
      listeners.set(event, set);
      return () => set.delete(listener as (payload: never) => void);
    },
    emit<K extends keyof E>(event: K, payload: E[K]): void { ... },
  };
}
```

- The event map generic is what makes it typed: `createEmitter<{ charged: ChargeResult }>()`
  rejects `emit('chargd', …)` at compile time.
- **Always return the unsubscribe function** — a subscription without one is a
  memory leak with a schedule.
- Prefer the platform (`EventTarget`, `AbortController`/`AbortSignal` for
  cancellation) over a bespoke emitter when you are in the browser.

---

## Repository

```ts
export interface InvoiceRepository {
  get(id: InvoiceId): Promise<Invoice | undefined>;
  save(invoice: Invoice): Promise<void>;
  findOverdue(asOf: Date): Promise<readonly Invoice[]>;
}
```

- Domain-shaped, not table-shaped. `findOverdue(asOf)`, never
  `query(sql, params)`.
- Returns domain types, never ORM entities or driver rows.
- `undefined` for "not found" — not `null`, not a thrown error, and never both in
  the same codebase.
- An in-memory implementation backed by a `Map` is the test double. It type-checks
  and refactors, which `vi.mock` does not.

---

## Dependency injection and the composition root

No container. Factory functions taking a `deps` object, assembled once:

```ts
// src/main.ts — the only module importing both adapters and use cases
const config = parseConfig(process.env);
const clock: Clock = { now: () => new Date() };
const repository = withCache(createSqlInvoiceRepository(pool), new Map());
const gateway = createStripeGateway(config.stripeKey);

const chargeInvoice = createChargeInvoice({ repository, gateway, clock });

startServer(createRouter({ chargeInvoice }));
```

- Everything below `main.ts` receives what it needs and constructs nothing global.
- If the framework imposes a container (Nest, Angular), use it — but keep the
  domain free of its decorators, so the rules stay portable and unit-testable.

---

## MVVM / MVC in the frontend

- **Model** — plain `.ts`: types and pure functions. No framework import.
- **View model** — a factory returning state plus actions (a hook in React, a
  `.svelte.ts` module in Svelte, a composable in Vue). Holds no markup.
- **View** — the component. Renders and wires events. No rules, no `fetch`.

A component calling `fetch` directly has fused all three layers and can only be
tested with a network stub. Put the call behind a port, inject it, and the view
model becomes a plain unit test.

---

## Error handling as a pattern

A rejected promise carries `unknown`, so exceptions are the least typed control
flow available. Split the two cases:

```ts
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
```

- **Expected failure** (validation, not-found, declined payment) → `Result` or
  `T | undefined`. It appears in the signature and the caller cannot forget it.
- **Unexpected failure** (a bug, an unreachable service) → throw. Catch it at one
  boundary and log it.
- Do not build a full `Either` monad with `map`/`chain` unless the project already
  has fp-ts. A tagged union and a `switch` is the whole benefit at a tenth of the
  cost.

---

## Anti-patterns

- A class hierarchy where a discriminated union would be exhaustive-checked.
- `class XFactory`, `class XManager`, `class XHelper` with no state — those are
  modules.
- A singleton exported from a module that constructs itself on import — it runs at
  import time, cannot be configured, and cannot be replaced in a test.
- `abstract class` with one implementation.
- A barrel `index.ts` at every folder level: import cycles, slow builds, no
  tree-shaking.
- `@decorator` syntax for cross-cutting concerns in a project that is not already
  a decorator framework.
- An emitter without `unsubscribe`, or a `useEffect`-shaped subscription without
  cleanup.
- `any` at a boundary "for now". It propagates further than you think.
