# Progressive Implementation Planning — Examples

---

## Example 1: A Full Worked Plan (Brownfield Change)

**The ask:** *"Replace our flat 10% discount with tiered discounts by customer segment, honouring existing promo-code behaviour."*

---

### Plan Summary

| Field | Value |
|---|---|
| **Work classification** | Mixed → split (see below) |
| **Baseline required** | Yes — `PricingService.priceCart`, promo-code application |
| **Stack & test framework** | TypeScript, Vitest |
| **Team size for this increment** | 3 developers |
| **Fan-out point** | After sub-task 1.1.4 (scaffold) |

**Mixed → split:**

- **Refactor portion:** extract the flat-discount calculation out of `priceCart` into a seam we can swap. Behaviour identical.
- **Behaviour-change portion:** introduce tiers and tier-specific rates. New acceptance criteria.

> This split is the single most valuable decision in the plan. Done together, a failing test after the change tells you nothing — restructure or new rule? Done separately, every failure has one possible cause.

---

### Layer 0 — Baseline Safety Net

**Seams:**

| Area to be changed | Seam to test at | Testable today? | Seam-introduction sub-task |
|---|---|---|---|
| Flat discount calculation | `PricingService.priceCart(cart, customer)` | Yes — public method | — |
| Promo-code application | `PricingService.priceCart` (same seam) | Yes | — |
| Discount rate lookup | *inside* `priceCart`, inlined | **No** | Extract `calculateDiscount()` as a private method first — pure move, no logic change |

**Characterization tests** (written against today's code, all currently green):

- [x] Happy path: cart of £100, no promo → total £90 (flat 10%)
- [x] Business rule: promo code `SAVE20` stacks additively with the flat discount → £70
- [x] Business rule: discount never exceeds cart subtotal → floor at £0
- [x] Edge case: empty cart → £0, no error
- [x] Edge case: promo code expired → flat discount only, £90
- [x] Error behaviour: unknown promo code → `InvalidPromoError`, no partial pricing applied

**Expected deltas:**

| Assertion | Current behaviour | Becomes | Why |
|---|---|---|---|
| Happy path £100 → £90 | Flat 10% for everyone | Bronze 5% → £95; Silver 10% → £90; Gold 15% → £85 | AC-2: rate varies by tier |
| `SAVE20` stacking → £70 | Additive with flat 10% | Additive with **tier** rate | AC-3: stacking behaviour itself is unchanged |

Everything not in this table must stay green through the whole increment.

> **Note the discipline:** two assertions are expected to move, and both are named with the AC that justifies them. If a third one goes red, that's a regression — not a surprise to be argued about in review.

---

### Layer 1 — Entity Model

**Domain types:**

| Type | Kind | Fields / Cases | Story vocabulary |
|---|---|---|---|
| `CustomerTier` | enum | `Bronze \| Silver \| Gold` | "customer segment" |
| `DiscountRate` | value object | `percentage: 0–100` | "discount rate" |
| `DiscountRule` | data class | `tier, rate, effectiveFrom, effectiveTo` | "tiered discount" |
| `Money` | value object | `amountMinor: int, currency` | "price", "total" |
| `PricedCart` | data class | `subtotal, discount, promoReduction, total` | "priced cart" |

**Contracts:**

| Interface | Responsibility | Implemented by (later) |
|---|---|---|
| `DiscountRuleSource` | Supplies the active rule set for a point in time | `ConfigDiscountRuleSource` (Layer 3) |
| `TierResolver` | Maps a customer to their tier | `SpendBasedTierResolver` (Layer 3) |

**Type tightening applied:**

- `CustomerTier` is an enum, not the string it is in the current config file — an unknown tier now fails at parse time rather than silently pricing at 0%
- `Money` replaces the `number` used today, killing the float-rounding bug class outright
- `DiscountRate` validates its range on construction, so no leaf has to defend against 150%

**Traceability:** every term the story uses — segment, tier, rate, promo, total — has a type. No type in the model would puzzle the PM who wrote the story.

**Placement:** shared by all three stories in this feature → **thin foundation story (0.1), types only, half a day.**

> This is the one horizontal slice the method permits, and it earns it: three stories depend on it, it contains no behaviour, and it is done in hours.

---

### Layer 2 — Call Graph

**Top-level flow:**

```
priceCart(cart: Cart, customer: Customer) -> PricedCart
  ├── resolveCustomerTier(customer)                    [leaf]
  ├── selectApplicableRules(tier, at)                  [descends]
  │     ├── loadActiveRules(at)                        [leaf]
  │     └── filterRulesForTier(rules, tier)            [leaf]
  ├── computeDiscount(rule, cart.subtotal)             [leaf]
  ├── applyPromoCodes(cart, discount)                  [existing — baseline pinned]
  └── buildPricedCart(cart, discount, promoReduction)  [leaf]
```

**Narration check** — reading the top level aloud:

> *"Resolve the customer's tier, select the rules that apply to that tier right now, compute the discount, apply promo codes, build the priced cart."*

That is the acceptance criteria, in order. ✅ Decomposition holds.

**Leaf inventory** — this list *is* the Layer 3 sub-task list:

| # | Leaf | Signature | Owns |
|---|---|---|---|
| 1 | `resolveCustomerTier` | `(customer: Customer) -> CustomerTier` | Spend-history → tier mapping |
| 2 | `loadActiveRules` | `(at: Instant) -> DiscountRule[]` | Reading rules valid at a moment |
| 3 | `filterRulesForTier` | `(rules: DiscountRule[], tier: CustomerTier) -> DiscountRule` | Picking the one rule that applies |
| 4 | `computeDiscount` | `(rule: DiscountRule, subtotal: Money) -> Money` | Applying a rate to an amount |
| 5 | `buildPricedCart` | `(cart, discount, promo) -> PricedCart` | Assembling the result |

Five leaves, five typed contracts, no shared mutable state. Three developers, five parallel tasks.

> **Where the complicated logic went:** `computeDiscount` and `resolveCustomerTier` carry the real business rules, and they are written **last** — by which point their boundaries are fixed by the call graph above. Neither can absorb responsibilities that belong elsewhere, because there is nowhere else for them to reach.

---

### Feature 1: Tiered Discounts at Checkout

**Value delivered:** customers see a discount that reflects their spend tier instead of a flat rate.

#### Story 1.1: As a returning customer, I want my discount to reflect my spend tier, so that loyalty is rewarded at checkout.

**Acceptance Criteria:**
- [ ] Bronze customers receive 5%, Silver 10%, Gold 15%
- [ ] Promo codes stack with the tier rate exactly as they stack with the flat rate today
- [ ] A customer with no spend history is treated as Bronze

**Sub-tasks:**

| # | Layer | Sub-task | Contract | Depends on | Tests | Done when |
|---|---|---|---|---|---|---|
| 1.1.1 | L0 | Extract `calculateDiscount()` from `priceCart` — pure move | — | — | None new — existing suite must stay green | No behaviour change; suite green |
| 1.1.2 | L0 | Pin `priceCart` behaviour | — | 1.1.1 | 6 characterization tests (above) | Baseline green on unchanged code |
| 1.1.3 | L1 | Model `CustomerTier`, `DiscountRate`, `DiscountRule`, `Money`, `PricedCart`, `DiscountRuleSource`, `TierResolver` | Types + 2 interfaces | 1.1.2 | **None** — types only, no behaviour to assert | Compiles; PM can narrate the model back |
| 1.1.4 | L2 | Scaffold `priceCart` flow with typed stubs | `priceCart(cart, customer) -> PricedCart` | 1.1.3 | One integration test: happy path through placeholders | Skeleton runs end to end |
| 1.1.5 | L3 | Implement `resolveCustomerTier` | `(customer) -> CustomerTier` | 1.1.4 | **Test-first:** each threshold, both boundaries, no-history → Bronze | Named cases pass |
| 1.1.6 | L3 | Implement `loadActiveRules` | `(at) -> DiscountRule[]` | 1.1.4 | **Test-first:** rule active, expired, not-yet-effective | Named cases pass |
| 1.1.7 | L3 | Implement `filterRulesForTier` | `(rules, tier) -> DiscountRule` | 1.1.4 | **Test-first:** match, no match → default, duplicate rules → most recent | Named cases pass |
| 1.1.8 | L3 | Implement `computeDiscount` | `(rule, subtotal) -> Money` | 1.1.4 | **Test-first:** each tier rate, £0 subtotal, rounding at half-penny | Named cases pass |
| 1.1.9 | L3 | Implement `buildPricedCart` | `(cart, discount, promo) -> PricedCart` | 1.1.4 | **None** — pure assembly, covered by 1.1.4's integration test | Integration test green |
| 1.1.10 | — | Re-run baseline; confirm only the two expected deltas moved | — | 1.1.5–1.1.9 | Baseline suite | Only expected deltas changed |

> **← Fan-out point:** sub-tasks 1.1.5–1.1.9 are independent. Three developers, five tasks, zero coordination — the types had the conversation already.

**Test posture — note what is deliberately not tested:**

| Sub-task | Posture | Reason |
|---|---|---|
| 1.1.3 (model) | None | Types only; no behaviour exists to assert |
| 1.1.4 (scaffold) | Integration only | Orchestration — the leaves carry their own tests |
| 1.1.9 (`buildPricedCart`) | None | Pure field assembly; a test here would restate the constructor |
| 1.1.5–1.1.8 | Test-first | Real branching rules with boundaries named in the AC |

Four of ten sub-tasks carry unit tests. Coverage will land somewhere in the seventies, and that is the correct number — the untested code is delegation, assembly, and type declarations. Pushing it to 100% would add tests that assert nothing and break on every rename.

---

### Why This Plan Parallelizes

```
Serial neck (≈1.5 days, 1 dev)                        Parallel fan (≈4 days, 3 devs)
──────────────────────────────────────────────────    ────────────────────────────────
[1.1.1 seam] → [1.1.2 baseline] → [1.1.3 model] →     ┌─ 1.1.5 resolveCustomerTier ─┐
                                  [1.1.4 scaffold] →  ├─ 1.1.6 loadActiveRules ─────┤
                                                      ├─ 1.1.7 filterRulesForTier ──┤ → 1.1.10
                                                      ├─ 1.1.8 computeDiscount ─────┤
                                                      └─ 1.1.9 buildPricedCart ─────┘
```

The neck is 1.5 days. The fan is the rest. Had the plan been written as "implement tiered discounts" the whole thing would have been serial, in one head, in one very large function.

---

## Example 2: Same Feature, Planned Badly

The same ask, planned the way most plans are written:

```markdown
Feature 1: Data layer for discounts
  - Create discount tables and models
Feature 2: Discount business logic
  - Implement tiered discount calculation
  - Handle promo code interaction
Feature 3: Wire up checkout
  - Update checkout to use new discount logic
  - Fix any broken tests
```

**What goes wrong:**

| Problem | Consequence |
|---|---|
| Features are layers, not vertical slices | Nothing works until Feature 3. No incremental value, no early feedback |
| No baseline | "Fix any broken tests" is the plan admitting it cannot tell a regression from an intended change |
| "Implement tiered discount calculation" is one sub-task | A blank page at the widest point. This becomes one long function |
| No contracts anywhere | Nothing can start in parallel — every developer would be inventing the same types |
| "Handle promo code interaction" | Vague. Nobody knows what done means, so nobody knows what to test |
| Refactor and behaviour change are fused | When a test goes red, no way to tell which cause |

**Same scope. Roughly three times the calendar time, and a function nobody wants to open six months later.**

---

## Example 3: Greenfield — Layer 0 Legitimately Skipped

**The ask:** *"New service: export a workspace's audit log to CSV on demand."*

**Classification:** Greenfield — no existing behaviour to preserve. **Layer 0 skipped, reason recorded in the plan.**

**Layer 1 — model first, even though it "feels obvious":**

```
AuditEvent      { id, actor, action, target, occurredAt }
ExportRequest   { workspaceId, dateRange, requestedBy }
ExportFormat    = Csv                     // enum with one case, on purpose
ExportResult    = Ready(url) | Failed(reason)   // sum type, not (url?, error?)
AuditEventSource  interface
```

> `ExportFormat` having a single case looks like over-engineering, and it isn't: it costs nothing now and makes the JSON variant a two-line change instead of a signature change across four functions. `ExportResult` as a sum type means no leaf ever has to handle "url is null but error is also null".

**Layer 2 — scaffold:**

```
exportAuditLog(request: ExportRequest) -> ExportResult
  ├── validateRequest(request)                [leaf]
  ├── fetchEvents(workspaceId, dateRange)     [leaf]
  ├── serializeToCsv(events)                  [descends]
  │     ├── buildHeaderRow()                  [leaf]
  │     └── buildEventRow(event)              [leaf]
  └── storeAndSign(bytes)                     [leaf]
```

**Narration:** *"Validate the request, fetch the events in range, serialize them to CSV, store the file and return a signed URL."* ✅

**Layer 3 — calibrated tests:**

| Leaf | Posture | Reason |
|---|---|---|
| `validateRequest` | Test-first | Real branching: range ordering, max span, permission check |
| `fetchEvents` | Test-first | Boundary conditions on the date range (inclusive/exclusive ends) |
| `buildEventRow` | Test-first | Escaping rules — commas, quotes, newlines in actor names |
| `buildHeaderRow` | **None** | Returns a constant array |
| `serializeToCsv` | Integration only | Orchestration over two tested leaves |
| `storeAndSign` | **None** | Thin wrapper over the storage SDK — testing this tests the SDK |

Three of six leaves carry unit tests. The three that don't each have a stated reason, and every reason is defensible in review.

---

## Example 4: Pure Refactor — Baseline Is the Whole Point

**The ask:** *"`OrderProcessor` is 800 lines. Break it up. Don't change anything users can observe."*

**Classification:** Pure refactor. Behaviour must be identical.

**Layer 0 is not a formality here — it is the entire safety argument:**

1. **Find the seam.** `OrderProcessor.process(order)` is public. Test there. Do **not** pin the private helpers — most of them are about to stop existing.
2. **Characterize exhaustively.** Every order type, every payment state, every failure mode currently reachable. Read the production logs to find the input shapes that actually occur, not the ones the code suggests.
3. **Expected deltas: none.** The table is empty, on purpose. Any red test after the refactor is a regression, full stop. There is no room for "well, that behaviour was wrong anyway" — if it was wrong, that's a separate story with its own AC.
4. **Layers 1–2 do the restructuring:** extract the entities `process()` has been passing around as loose parameters, then rewrite `process()` as a sequence of named calls into the pieces.
5. **Layer 3 is mostly moving code, not writing it.** Each extracted leaf gets tests only where it now has a public contract someone could call independently.

**The whole method in one line:** the baseline is what turns "break up an 800-line function" from a gamble into a mechanical exercise.

> **If someone says "we don't have time to write the baseline tests"** — the honest translation is "we don't have time to know whether this refactor worked." That is a scheduling decision the plan should surface explicitly, not a corner to cut quietly.
