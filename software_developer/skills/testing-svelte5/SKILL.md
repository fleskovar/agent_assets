---
name: testing-svelte5
description: The Svelte 5 testing stack for this bundle — testing runes in `.svelte.ts` modules with $effect.root and flushSync, Vitest browser mode vs jsdom, @testing-library/svelte and vitest-browser-svelte, what to assert about a component (roles and text, not markup), case folders over the view-model, Playwright for journeys, and the debugging entry points. Use before writing or reviewing any Svelte 5 test.
type: reference
theme: code-craft
best_for:
  - "Testing $state/$derived/$effect without a component, and knowing when flushSync is needed"
  - "Deciding what belongs in a component test, a view-model test and a Playwright journey"
  - "Giving a UI feature human-readable case folders that are not pixel snapshots"
---

## Purpose

The Svelte 5 form of `skills/test-driven-development/SKILL.md`. Read
`skills/clean-code-typescript/SKILL.md` and `skills/testing-typescript/SKILL.md`
first — everything there applies; this file covers only what runes and components
change. `skills/clean-code-svelte5/SKILL.md` is the craft standard.

Svelte 5 with runes. If the codebase still uses `export let` and stores, it is
Svelte 4 — match it, and note once that migrating would simplify the tests.

---

## The one architectural decision that decides everything

**Logic lives in `.svelte.ts` modules; components render.** That single rule
decides whether this feature is pleasant or miserable to test:

- A view-model is a plain function or a rune factory — testable with no DOM, in
  microseconds, with case folders and property tests over it.
- A component test then only has to prove the **wiring**: the right values reach
  the right roles, and the right events fire.

If a component holds business logic, the only way to test the logic is to render
and query the DOM, which is fifty times slower, an order of magnitude more
brittle, and impossible to give a readable case folder. Move the logic first; the
test difficulty is the design telling you so.

---

## The stack

| Job | Use | Notes |
| --- | --- | --- |
| Runner | **Vitest** | With `@sveltejs/vite-plugin-svelte`; two projects (client/server) in one config |
| Rune modules | Vitest + `$effect.root` + `flushSync` | File must be named `*.svelte.test.ts` so runes compile |
| Component tests (DOM) | **vitest-browser-svelte** (browser mode, Playwright provider) — the SvelteKit default since 2025 | Real browser, real layout, no jsdom gaps |
| Component tests (fast) | **@testing-library/svelte** + jsdom | Lighter; jsdom lacks layout, `IntersectionObserver`, dialogs, animations |
| Queries | `getByRole`, `getByLabelText`, `getByText` | Never query by class or `data-testid` unless nothing else identifies the element |
| Interaction | `userEvent` (or browser-mode locators) | Not `fireEvent` — `userEvent` produces the real event sequence |
| Property-based | **fast-check** over the view-model | Not over the DOM |
| E2E | **Playwright** | Journeys, SSR, hydration, routing — and the only place screenshots belong |
| HTTP | **MSW** | Same handlers in unit and browser-mode tests |
| Coverage | `vitest --coverage` | On the `.svelte.ts` modules, mainly |

Server-side (`+page.server.ts`, `load`, actions, hooks) are plain TypeScript —
test them as such, with no rendering.

---

## Runes: the two rules that cause every mistake

**1. Runes need a reactive root.** Outside a component, `$derived` and `$effect`
need `$effect.root`, and the returned cleanup must be called:

```ts
// lateFees.svelte.test.ts  ← the .svelte. in the name is required
it("recomputes when the as-of date moves", () => {
  const cleanup = $effect.root(() => {
    const store = createLateFeeStore({ invoices, policy, asOf: "2026-03-31" });
    expect(store.summary.rows).toHaveLength(4);

    store.setAsOf("2026-03-01");
    flushSync();                       // ← rule 2

    expect(store.summary.rows).toHaveLength(0);
  });

  cleanup();
});
```

**2. Effects are batched; `flushSync()` makes them run now.** Without it you
assert on the previous value and the test either fails confusingly or — worse —
passes for the wrong reason. `$derived` is lazy and recomputes on read, so it
often works without a flush; `$effect` never does.

**Prefer the pure function to the rune wrapper.** `buildLateFeeSummary(invoices,
policy, asOf)` needs no root, no flush and no cleanup. Test the projection there,
and use the rune test only to prove reactivity is wired — usually one test, as
above. See `skills/human-readable-tests/assets/svelte5/lateFeesViewModel.svelte.ts`.

---

## Component tests: assert what a user perceives

```ts
it("shows the fee and flags the overdue ones", async () => {
  render(LateFeeTable, { props: { invoices, policy, asOf: AS_OF } });

  expect(page.getByRole("row", { name: /INV-1001/ })).toBeInTheDocument();
  expect(page.getByRole("cell", { name: "$75.00" })).toBeInTheDocument();
  await page.getByRole("button", { name: "Recalculate" }).click();
  expect(page.getByRole("status")).toHaveText("4 of 7 invoices accrued late fees");
});
```

- **Query by role and accessible name.** It survives refactors, and it fails when
  the component becomes inaccessible — a free extra assertion.
- **Assert on rendered text and state, never on markup structure or class names.**
  A test that breaks when a `div` becomes a `section` is a maintenance cost with
  no coverage attached.
- **Props in Svelte 5**: `render(Component, { props: { … } })`. To change them,
  use the `rerender` helper — reassigning a local does nothing.
- **Snippets** replace slots: pass them as props like any other value; test them
  by asserting what they render.
- **Two-way `$bindable`**: assert on the callback or the parent's state, not on
  internals.

**What not to component-test:** business rules, formatting, sorting, filtering —
all of that belongs to the view-model, where it is faster and readable.

---

## Human-readable case folders for a UI

Pattern: `skills/human-readable-tests/SKILL.md`. Working code:
`skills/human-readable-tests/assets/svelte5/case-runner.svelte.test.ts`.

A UI case folder holds up to three baselines, in increasing brittleness:

| Baseline | When | Why |
| --- | --- | --- |
| `outputs/view_model.json` | **Always** | The real test: the pure projection, hand-checkable, framework-free |
| `outputs/rendered.txt` | When copy and ordering matter | Normalised visible text; whitespace collapsed so a template reflow is not a failure |
| `outputs/a11y_tree.txt` | When semantics matter | Roles and accessible names — catches a heading that became a `div` |

**No pixel snapshots in case folders.** They fail on a font update, they cannot be
solved by hand, and their diff teaches nobody anything. If a visual regression
genuinely matters, use Playwright's screenshot comparison in the e2e suite, where
the failure is expected to need a human.

The README's walkthrough covers the *projection* — "seven invoices in, four rows
out, INV-1002 shows $4.00 because the cap beat the minimum" — which is the part a
developer needs and the part the markup cannot state.

---

## Browser mode vs jsdom

**Browser mode** (`vitest-browser-svelte` + Playwright provider) is the default
for new SvelteKit projects and the right choice when the component depends on
anything jsdom fakes badly: layout and measurement, `<dialog>`, focus management,
scrolling, `IntersectionObserver`/`ResizeObserver`, CSS-driven behaviour,
animations, drag and drop.

**jsdom** is faster to start and fine for simple render-and-assert components. Its
gaps are silent — a test passes because jsdom does not implement the thing you are
testing — which is why anything interactive belongs in browser mode.

A common split: two Vitest projects, `client` (browser or jsdom, `*.svelte.test.ts`)
and `server` (node, everything else), configured in one `vite.config.ts` and run
by one command.

---

## Running the suite

```bash
npm test                       # lint + svelte-check + vitest run — what CI runs
npm run test:unit              # view-models and server code
npm run test:components
npm run test:cases
npm run test:e2e               # Playwright, separate config, not in the fast loop
npm run bless
```

`svelte-check` is part of the gate, not an optional extra: it is the only thing
that type-checks template expressions.

---

## Debugging a test — the part that matters

```bash
npm run debug:case -- overdue-invoice-fees    # the view-model, no framework frames
npm run debug:test                            # vitest --inspect-brk --no-file-parallelism
```

- **View-model first.** Ninety percent of UI defects are projection defects, and
  the view-model debugs like any other TypeScript — which is the strongest
  practical argument for keeping logic out of components.
- **Browser mode**: `--browser.headless=false` shows the real browser, and
  `await page.pause()` (Playwright provider) stops with the inspector open so you
  can query the live DOM.
- **jsdom**: `screen.debug()` / `container.innerHTML` prints the tree at the point
  of failure — usually enough to see that the element is there under a different
  accessible name.
- **Vitest UI** (`vitest --ui`) is genuinely useful here: per-test DOM snapshots
  and module graphs.
- **Playwright**: `--debug` for the inspector, `--ui` for the trace viewer, and
  the trace on CI failure is the difference between a fix and a re-run.
- `launch.json` entries: `skills/human-readable-tests/assets/typescript/launch.json`
  works unchanged for Svelte projects.

---

## Svelte-5-specific test traps

- **File not named `*.svelte.test.ts`** → runes are not compiled and the test
  fails with a confusing "$state is not defined". This is the single most common
  Svelte 5 testing mistake.
- **Missing `$effect.root`** → "effect_orphan" at runtime.
- **Missing `flushSync()`** after a state change → asserting on the old value.
- **Mutating a `$state` object's property vs reassigning it** — deep reactivity
  works via proxies, but a `class` field without `$state` is not reactive, and a
  plain object passed in from outside is not proxied.
- **`$derived` is lazy** — nothing recomputes until it is read. A test that
  asserts an effect ran without reading the derived value asserts nothing.
- **`onMount` does not run in SSR**, and in tests it only runs when the component
  is actually mounted — a jsdom render does mount, `render` from a server-side
  project does not.
- **`await tick()` vs `flushSync()`** — `tick()` awaits the microtask, `flushSync`
  runs effects synchronously; in tests the latter is usually what you want.
- **Testing a store singleton** created at module scope leaks state between tests.
  Export a factory (`createLateFeeStore`) instead — the same dependency-injection
  rule as everywhere else in this bundle.
- **SvelteKit `load` functions** are plain functions: call them with a fake
  `event`, do not render a route to test them.

---

## References

- `skills/clean-code-svelte5/SKILL.md`, `skills/design-patterns-svelte5/SKILL.md`.
- `skills/testing-typescript/SKILL.md` — the base stack, Vitest flags, traps.
- `skills/test-driven-development/SKILL.md`, `skills/human-readable-tests/SKILL.md`
  (+ `assets/svelte5/`), `skills/automatic-test-generation/SKILL.md`,
  `skills/bug-fix-workflow/SKILL.md`.
