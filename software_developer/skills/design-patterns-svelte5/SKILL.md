---
name: design-patterns-svelte5
description: The design patterns from the clean-code-developer standard applied to Svelte 5 — view-model factories in `.svelte.ts`, context as the provider/DI pattern, snippets as render props, actions as DOM adapters, reducers over discriminated unions, and SvelteKit load functions as the boundary adapter. Use when structuring a Svelte 5 feature, not just writing a component.
type: reference
theme: code-craft
best_for:
  - "Deciding what belongs in a component, a .svelte.ts module and a plain .ts file"
  - "Building headless/compound components with snippets and context"
  - "Injecting services into a Svelte 5 app without prop drilling"
---

## Purpose

`subagents/clean-code-developer.md` says to use the well-known patterns and name
them out loud. This file says what each looks like in Svelte 5.

**Read `clean-code-svelte5/SKILL.md` first** for the runes themselves, and
`design-patterns-typescript/SKILL.md` for everything that lives in a plain `.ts`
file — the patterns there are unchanged here.

Svelte 5 gives each architectural layer its own file extension, which is why the
patterns land cleanly:

| Pattern | Svelte 5 form |
| --- | --- |
| MVVM | `.ts` domain → `.svelte.ts` view model → `.svelte` view |
| Dependency injection | `setContext` / `getContext` with a typed key |
| Provider | A component that calls `setContext` in its script and renders `children` |
| Strategy (markup) | A `Snippet` prop |
| Adapter (DOM) | A `use:` action |
| Adapter (server) | A SvelteKit `load` function / form action |
| Facade | A feature module exporting `createX()` and its components |
| Command / reducer | Discriminated-union action + pure `reduce` |
| State machine | Union state + `$derived` transitions |
| Observer | `$effect` with a cleanup return |
| Decorator | Wrapping a port before putting it in context |

---

## MVVM: the view-model factory

The core pattern. Everything else is a variation.

```ts
// checkout/state/cart.svelte.ts — the view model
import { computeTotals, canCheckout } from '../domain/pricing';   // pure, testable

export function createCart(deps: { gateway: PaymentGateway; clock: Clock }) {
  let lines = $state<OrderLine[]>([]);
  let status = $state<CheckoutStatus>({ kind: 'idle' });

  const totals = $derived(computeTotals(lines));
  const isSubmittable = $derived(canCheckout(lines, status));

  return {
    get lines()         { return lines; },
    get totals()        { return totals; },
    get status()        { return status; },
    get isSubmittable() { return isSubmittable; },
    add(line: OrderLine) { lines = [...lines, line]; },
    remove(sku: Sku)     { lines = lines.filter((l) => l.sku !== sku); },
    async checkout() {
      status = { kind: 'submitting' };
      status = await deps.gateway.charge(totals.grandTotal, deps.clock.now());
    },
  };
}

export type Cart = ReturnType<typeof createCart>;
```

```svelte
<!-- CartPanel.svelte — the view. No rules, no fetch, no math. -->
<script lang="ts">
  const cart = getCart();
</script>

<ul>
  {#each cart.lines as line (line.sku)}
    <CartLine {line} onRemove={cart.remove} />
  {/each}
</ul>
<p>{formatMoney(cart.totals.grandTotal)}</p>
<button disabled={!cart.isSubmittable} onclick={cart.checkout}>Checkout</button>
```

Three rules make this work:

1. **Factory, never module-level `$state`.** Module-scope state in SvelteKit is
   shared across server requests — a cross-user data leak, not a style choice.
2. **Getters, not values.** `return { lines }` returns a snapshot and reactivity
   dies at the boundary.
3. **The rules live in `.ts`.** `computeTotals` has no runes in it, so it is a
   plain vitest unit test with no Svelte involved.

---

## Dependency injection: context + provider

```ts
// checkout/state/cart-context.ts
const CART_KEY = Symbol('cart');

export const setCart = (cart: Cart): Cart => setContext(CART_KEY, cart);
export const getCart = (): Cart => getContext(CART_KEY);
```

The typed helper pair is the pattern — `getContext<Cart>('cart')` scattered through
components is a stringly-typed cast repeated N times.

**Provider component** when the scope is a subtree rather than the whole app:

```svelte
<!-- CartProvider.svelte -->
<script lang="ts">
  interface Props { readonly deps: CartDeps; readonly children: Snippet }
  let { deps, children }: Props = $props();
  setCart(createCart(deps));
</script>

{@render children()}
```

- The **composition root** is the root `+layout.svelte`: it builds the concrete
  adapters (from `load` data and config) and calls the `setX` functions.
- `setContext`/`getContext` only run during component initialisation — not in a
  handler, not in an effect.
- Context is scoped to the component subtree, which is what makes per-instance
  state (a modal, a wizard, a data table) work without globals.

---

## Compound components

Context also carries state *between* related components, which is how you build a
`<Tabs>` / `<Tab>` pair without prop drilling or a parent that knows its children:

```svelte
<!-- Tabs.svelte -->
<script lang="ts">
  let { children }: { children: Snippet } = $props();
  let active = $state<TabId | undefined>(undefined);
  setTabs({ get active() { return active; }, select: (id: TabId) => (active = id) });
</script>
{@render children()}
```

`<Tab>` calls `getTabs()` and registers itself. The public API is markup, the
coupling is one typed context, and neither component imports the other.

---

## Snippets as render props (Strategy in markup)

```svelte
<script lang="ts">
  interface Props<T> {
    readonly items: readonly T[];
    readonly row: Snippet<[T]>;
    readonly empty?: Snippet;
  }
  let { items, row, empty }: Props<Item> = $props();
</script>

{#if items.length === 0}
  {@render empty?.()}
{:else}
  {#each items as item (item.id)}{@render row(item)}{/each}
{/if}
```

This is Strategy where the varying part is markup: the list component owns
iteration, keying and the empty state; the caller owns appearance. Typed
(`Snippet<[Item]>`), which slots never were.

**Headless component**: take this one step further — a `.svelte.ts` factory owns
all the behaviour (selection, keyboard nav, filtering) and the component renders
nothing but snippets the caller supplies. That is the most reusable form in Svelte
5, and the logic stays unit-testable because it never entered a `.svelte` file.

---

## Actions: the DOM adapter

```ts
export function clickOutside(node: HTMLElement, onOutside: () => void) {
  const handle = (event: MouseEvent) => {
    if (!node.contains(event.target as Node)) onOutside();
  };
  document.addEventListener('click', handle, true);
  return {
    destroy: () => document.removeEventListener('click', handle, true),
  };
}
```

`use:clickOutside={close}` — a `use:` action is an Adapter over an imperative DOM
or third-party API (a chart library, a map, a drag-and-drop engine, an
`IntersectionObserver`). It has an explicit lifecycle with a `destroy`, which makes
it the right home for anything that would otherwise be an `$effect` full of
`addEventListener`.

---

## Command / reducer

For state with more than a handful of transitions, a pure reducer beats scattered
mutations — it is Command plus a pure function, and it tests without Svelte:

```ts
// domain/cart-reducer.ts — no runes, no Svelte
export type CartAction =
  | { readonly kind: 'add'; readonly line: OrderLine }
  | { readonly kind: 'remove'; readonly sku: Sku }
  | { readonly kind: 'applyCoupon'; readonly code: CouponCode };

export function reduce(state: CartState, action: CartAction): CartState { ... }
```

```ts
// state/cart.svelte.ts — the rune layer is now three lines
let state = $state(initialCart);
export const dispatch = (action: CartAction) => { state = reduce(state, action); };
```

Every transition becomes a table-driven unit test, and the `.svelte.ts` file stops
containing anything worth testing — which is the goal.

---

## State machines

A discriminated union plus `$derived` gives you an impossible-state-free UI:

```ts
type LoadState<T> =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly data: T }
  | { readonly kind: 'failed'; readonly error: LoadError };
```

```svelte
{#if state.kind === 'loading'}<Spinner />
{:else if state.kind === 'failed'}<ErrorPanel error={state.error} />
{:else if state.kind === 'loaded'}<Table rows={state.data} />
{/if}
```

Not three booleans (`isLoading`, `hasError`, `data`) — that is eight states, five
of which are nonsense, and every one of them eventually renders.

---

## Server boundary: `load` and form actions are the adapters

In SvelteKit, the framework hands you the adapter layer; use it as one.

```ts
// +page.server.ts — the adapter. Parses, maps to domain types, returns nothing raw.
export const load: PageServerLoad = async ({ params, locals }) => {
  const raw = await locals.api.getInvoice(params.id);
  return { invoice: toInvoice(InvoiceDto.parse(raw)) };
};

// form action — the controller: parse → use case → result
export const actions: Actions = {
  refund: async ({ request, locals }) => {
    const parsed = RefundForm.safeParse(Object.fromEntries(await request.formData()));
    if (!parsed.success) return fail(HTTP_BAD_REQUEST, { errors: parsed.error.flatten() });
    return locals.billing.issueRefund(parsed.data);
  },
};
```

- **Components never call `fetch`.** Data arrives as props from `load`; mutations go
  through a form action or an injected port.
- Validate on the server with the same schema module the client uses. One schema,
  two call sites.
- `use:enhance` for progressive enhancement rather than a hand-written submit
  handler.
- `locals` is the request-scoped composition root — `hooks.server.ts` builds the
  services, everything downstream receives them.

---

## Decorator

Wrap a port before it goes into context, exactly as in TypeScript:

```ts
setGateway(withRetry(withTelemetry(createHttpGateway(config)), RETRY_ATTEMPTS));
```

Caching, retry, logging and optimistic behaviour compose at the composition root,
and no component or view model knows any of it happened.

---

## Observer

`$effect` **is** the Observer subscription, and its return value is the
unsubscribe:

```svelte
<script lang="ts">
  $effect(() => {
    const unsubscribe = socket.subscribe(TOPIC.prices, onPrice);
    return unsubscribe;
  });
</script>
```

Outside a component, `$effect.root(() => { ... })` creates an effect scope you own
and dispose — which is also how you test a `.svelte.ts` module.

Never subscribe without returning cleanup, and never put the handler body inline —
call a named function so the behaviour is testable on its own.

---

## Anti-patterns

- **Logic in `.svelte`.** Any rule, any calculation, any branch worth a test
  belongs one layer down. A component past ~150 lines has usually swallowed a view
  model.
- **`$effect` used to derive state.** It is a `$derived` you have not written, and
  it buys you an extra render pass plus a possible infinite loop.
- **Module-level `$state` in a `.svelte.ts`** — shared across users on the server.
- **`fetch` in a component.** Now it is fused to one backend and needs a network
  stub to test.
- **Prop drilling through four layers** instead of a typed context — and its
  mirror image, context for something two components deep that should be a prop.
- **`bind:` chains** across several levels. One-way down, callback up; `$bindable`
  only at a genuine input boundary.
- **Untyped context keys** — `getContext('cart')` is an unchecked cast repeated at
  every call site.
- **Unkeyed `{#each}`** — DOM reuse across reorders puts row state on the wrong row.
- **Mixing stores and runes for the same state.** Pick one per piece of state.
- **Passing a `$state` proxy to a non-Svelte library** without `$state.snapshot`.
