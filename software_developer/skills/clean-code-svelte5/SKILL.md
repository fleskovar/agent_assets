---
name: clean-code-svelte5
description: Idiomatic Svelte 5 for the clean-code-developer standard — runes over stores, logic in `.svelte.ts` modules instead of components, typed `$props` interfaces, snippets over slots, `$derived` before `$effect`, context as dependency injection, and testing the logic outside the component. Use before writing or refactoring any Svelte 5 component or rune module.
type: reference
theme: code-craft
best_for:
  - "Writing Svelte 5 components that stay small and testable"
  - "Deciding between $derived, $effect and a plain function"
  - "Moving state and logic out of components into .svelte.ts modules"
---

## Purpose

The language-specific form of `subagents/clean-code-developer.md` for Svelte 5.
**Read `skills/clean-code-typescript/SKILL.md` first** — it governs every `.ts` and
`.svelte.ts` module here; this file covers only what is Svelte-specific.

Svelte 5 with runes. If the codebase still uses `export let`, `$:` and
`on:click`, it is Svelte 4 — match it, and say once that a migration would help.

---

## The architecture: three layers, and the component is the thinnest

This is MVVM, and Svelte 5 gives you a clean file extension for each layer:

| Layer | File | Contains | Tested |
| --- | --- | --- | --- |
| **Model / domain** | `.ts` | Pure functions, types, rules. No Svelte import at all. | Directly, no DOM |
| **View model / state** | `.svelte.ts` | `$state` / `$derived`, the state machine of a feature | Directly, with `$effect.root` |
| **View** | `.svelte` | Markup, styles, event wiring, `{@render}` | Sparingly, at the seam |

```
src/lib/checkout/
  domain/          pricing.ts  cart-rules.ts          # pure, no Svelte
  state/           cart.svelte.ts                     # runes, the view model
  ports/           payment-gateway.ts                 # interfaces
  adapters/        http-payment-gateway.ts
  components/      CartPanel.svelte  CartLine.svelte  # markup only
```

**A component that contains a rule is a rule you cannot unit-test.** Anything
past "render this, call that" belongs one layer down. A `.svelte` file past ~150
lines, or with a function longer than a few lines in its `<script>`, is a
refactor waiting to happen — extract to `.svelte.ts`, not to another component.

---

## Runes

### `$state`

```svelte
<script lang="ts">
  let count = $state(0);
  let filters = $state<Filters>({ status: STATUS.open, query: '' });
</script>
```

- Deeply reactive by default (it is a Proxy), so `filters.query = 'x'` works.
- **`$state.raw` when the value is replaced wholesale, not mutated** — large
  arrays, fetched payloads, anything you always reassign. It skips the proxy and
  is materially faster.
- **`$state.snapshot(value)` before handing state to anything outside Svelte** —
  `structuredClone`, `JSON.stringify`, a charting library, an IndexedDB write.
  Passing the proxy out is the most common Svelte 5 bug in this list.

### `$derived` — reach for this before `$effect`

```svelte
<script lang="ts">
  let { lines }: Props = $props();

  const subtotal = $derived(sumLines(lines));                 // one expression
  const totals = $derived.by(() => computeTotals(lines, tax)); // multi-statement
</script>
```

`$derived` must be **pure**: no assignment to other state, no I/O, no `fetch`. If
your derivation needs a loop or a branch, that is `$derived.by` wrapping a *pure
function imported from a `.ts` file* — which is then testable on its own.

### `$effect` — the last resort

`$effect` exists to synchronise with something outside Svelte: a canvas, a
third-party widget, a subscription, `document.title`, an analytics call.

**Not for deriving state.** An effect that assigns to state is a `$derived` you
have not written yet, and it costs you a second render pass plus a class of
infinite loops.

```svelte
<!-- No -->
$effect(() => { total = price * quantity; });

<!-- Yes -->
const total = $derived(price * quantity);
```

Rules when you do need one:

- Return a cleanup function. Always, for subscriptions, timers and listeners.
- Read only what should re-trigger it; wrap the rest in `untrack`.
- Keep the body to a single call into a plain function. `$effect(() => syncCanvas(ctx, model))`
  is testable; ten lines of canvas code inside the effect is not.
- `$effect.pre` only when you genuinely need to run before DOM update.
- Effects do not run during SSR — never put logic there that the server needs.

### `$props`

```svelte
<script lang="ts">
  interface Props {
    readonly line: OrderLine;
    readonly compact?: boolean;
    readonly onRemove: (sku: Sku) => void;
    readonly children?: Snippet;
  }

  let { line, compact = false, onRemove, children }: Props = $props();
</script>
```

- **Always a named `Props` interface**, never inline `$props<{...}>()` soup, and
  never `[key: string]: any`. This is the "no untyped bag across a boundary" rule
  at the component boundary.
- Props are read-only. To send something up, take a callback prop (`onRemove`) —
  callbacks are the Svelte 5 idiom; `createEventDispatcher` is deprecated.
- `$bindable()` only where two-way binding is genuinely the simplest thing (form
  inputs, a controlled dialog). Everywhere else, one-way down + callback up.
- Rest props (`...rest`) only on a genuine wrapper component that forwards to an
  element.

### Snippets, not slots

```svelte
{#snippet row(line: OrderLine)}
  <CartLine {line} onRemove={handleRemove} />
{/snippet}

{#each lines as line (line.sku)}{@render row(line)}{/each}
```

Snippets are typed (`import type { Snippet } from 'svelte'`), can take arguments,
and can be passed as props — a typed, composable replacement for slots. They are
also the right tool for removing repetition *inside* one component before you
reach for a whole new file.

**Always key your `{#each}`** with a stable id. An unkeyed each block reuses DOM
nodes across reorders and produces state that belongs to the wrong row.

---

## Shared state: `.svelte.ts` modules

Runes work outside components in any `.svelte.ts` file. This is where feature
state lives — not in a component, and not in a legacy store.

```ts
// checkout/state/cart.svelte.ts
import { computeTotals } from '../domain/pricing';

export function createCart(gateway: PaymentGateway, clock: Clock) {
  let lines = $state<OrderLine[]>([]);
  let status = $state<CheckoutStatus>({ kind: 'idle' });

  const totals = $derived(computeTotals(lines));

  async function checkout(): Promise<void> {
    status = { kind: 'submitting' };
    status = await gateway.charge(totals.grandTotal, clock.now());
  }

  return {
    get lines() { return lines; },
    get totals() { return totals; },
    get status() { return status; },
    add(line: OrderLine) { lines = [...lines, line]; },
    checkout,
  };
}
```

Two things this gets right that the obvious version gets wrong:

1. **Export a factory, not module-level state.** Module-level `$state` in
   SvelteKit is shared across every user on the server — a genuine data-leak bug,
   not a style preference. A factory plus context gives you per-session state.
2. **Expose reactivity through getters.** A plain `return { lines }` copies the
   value and the reactivity is lost. Getters (or returning the `$state` object
   itself and mutating it) preserve it.

The same rule applies to arguments: **passing `count` into a function passes a
number, not a reactive binding.** Pass a getter (`() => count`) when the callee
must track it.

Legacy stores (`writable`, `$store`) still work and are still right for a few
things — RxJS interop, `$app/stores`, anything wanting the store contract. Do not
mix both for the same piece of state.

---

## Dependency injection: context, typed

Context is Svelte's DI container. Type the key so `getContext` is not a
stringly-typed cast:

```ts
// checkout/state/cart-context.ts
import { getContext, setContext } from 'svelte';

const CART_KEY = Symbol('cart');
type Cart = ReturnType<typeof createCart>;

export const setCart = (cart: Cart) => setContext(CART_KEY, cart);
export const getCart = (): Cart => getContext(CART_KEY);
```

- **The composition root is the root layout** (`+layout.svelte`) or the app entry:
  it constructs the concrete adapters and calls `setCart(createCart(gateway, clock))`.
  Everything below just calls `getCart()`.
- `setContext` / `getContext` must run during component initialisation, not in a
  handler or an effect.
- **Components never construct their own dependencies** and never import an
  adapter directly. A component that calls `fetch` has hard-wired itself to one
  backend and made itself untestable.
- In SvelteKit, server data comes from `load` in `+page.ts` / `+page.server.ts` —
  those functions *are* the adapters. Parse the payload into a domain type there
  (zod), so no component holds a raw response.

---

## Constants and magic strings

Route paths, query keys, `localStorage` keys, CSS class names, event names and
status codes are all magic strings.

```ts
export const ROUTE = { cart: '/cart', checkout: '/checkout' } as const;
export const STORAGE_KEY = { cart: 'cart.v1' } as const;
```

Prefer a `class:` directive or a `$derived` class string over string concatenation
in the markup, and keep component-scoped `<style>` for anything not from the
design system — Svelte scopes it, so a local class needs no BEM ceremony.

---

## Tests

vitest, with `vitest-browser-svelte` (or `@testing-library/svelte`) for the few
component tests. **Additive only** — never edit an existing test to make your
change pass.

**The point of the three-layer split is that most tests need no component:**

```ts
// domain — plain vitest, no Svelte at all
it('applies the bulk discount above the threshold', () => {
  expect(computeTotals(linesOf(12))).toEqual({ grandTotal: money(96), discount: money(24) });
});

// .svelte.ts — runes outside a component need an effect root
it('moves to submitting while the gateway is in flight', async () => {
  const cleanup = $effect.root(() => {
    const cart = createCart(fakeGateway, fixedClock);
    cart.add(line);
    void cart.checkout();
    expect(cart.status.kind).toBe('submitting');
  });
  cleanup();
});
```

- Rune tests must live in a `.svelte.test.ts` file so the compiler processes the
  runes.
- `flushSync()` when you need to observe an effect synchronously.
- **Component tests assert rendering and wiring only** — "the remove button calls
  `onRemove` with the sku", "the empty state renders when there are no lines".
  Business assertions belong one layer down.
- Fake the port objects you inject through context; never mock `fetch` or a module
  path.

---

## Tooling

```bash
svelte-check --tsconfig ./tsconfig.json
eslint . --fix
prettier --write .
vitest run
```

- `lang="ts"` on every `<script>`, and `svelte-check` in CI — it type-checks the
  markup, which `tsc` alone does not.
- `eslint-plugin-svelte` with `svelte/valid-compile`, plus the a11y warnings left
  **on**: Svelte's accessibility warnings are free review comments and should not
  be suppressed casually.
- Suppress narrowly, in place, with a reason:
  `<!-- svelte-ignore a11y_click_events_have_key_events -- <why> -->`.

---

## Svelte-5-specific traps

- **Destructuring `$state` loses reactivity.** `const { query } = filters` gives
  you a snapshot value. Read `filters.query` at the point of use.
- **Passing state to a function passes the value.** Pass `() => count` if the
  callee must react to it.
- **Exporting a reassigned `let` from a `.svelte.ts` module does not work** — the
  binding is not live to importers. Export a getter or an object.
- **Module-level `$state` in SvelteKit is shared across server requests.** Use a
  factory + context. This is a security bug, not a style issue.
- **`$effect` that writes state it also reads** loops. If you meant a derivation,
  write `$derived`.
- **Proxies escaping into non-Svelte code** — `$state.snapshot` first, or use
  `$state.raw`.
- **`$effect` does not run on the server**, and neither does anything in
  `onMount`. Nothing the initial render depends on may live there.
- **`window` / `document` at module top level breaks SSR.** Guard with
  `browser` from `$app/environment`, or move it into an effect.
- **Unkeyed `{#each}`** reusing DOM across reorders.
- **`on:click` is Svelte 4.** Svelte 5 uses the plain attribute `onclick`.
- **`createEventDispatcher` is deprecated** — use callback props.
- **`bind:` overuse** turns a one-way data flow into a graph nobody can trace.
  One-way down, callback up, `$bindable` only where it truly reads better.
