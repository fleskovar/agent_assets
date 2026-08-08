---
name: progressive-implementation-planning
argument-hint: "[feature, refactor, or epic to plan]"
description: Turn a feature or refactor into a layered implementation plan — baseline tests, entity model, scaffolded call graph, then leaf logic. Use when a plan needs to produce clean, parallelizable, single-responsibility code rather than a pile of tasks.
intent: >-
  Guide product managers and tech leads through planning implementation work as four ordered layers — baseline safety net, entity modeling, progressive scaffolding, and leaf implementation with calibrated TDD. Use this to produce implementation plans whose features, user stories, and sub-tasks mirror the order code should actually be written in, so that each unit of work has a typed contract, a single responsibility, and no hidden coupling. The result is a plan that is safe to refactor into, easy to review, and naturally parallelizable across a team.
type: workflow
theme: pm-artifacts
best_for:
  - "Planning a feature so the sub-tasks map to clean, single-responsibility code"
  - "Sequencing a refactor without breaking existing behaviour"
  - "Breaking an epic into work that several developers can pick up in parallel"
scenarios:
  - "We're rewriting the pricing engine — plan it so we don't regress current behaviour"
  - "Break this checkout epic into stories and sub-tasks my three devs can work on at the same time"
  - "Our plans keep producing 400-line functions — restructure this feature plan so that stops happening"
estimated_time: "30-60 min"
---


## Purpose

Guide product managers and tech leads through planning implementation work as four ordered layers — baseline safety net, entity modeling, progressive scaffolding, and leaf implementation with calibrated TDD. Use this to produce implementation plans whose features, user stories, and sub-tasks mirror the order code should actually be written in, so that each unit of work has a typed contract, a single responsibility, and no hidden coupling.

This is not a task list. It is a **descent order**. Most implementation plans fail not because they missed work, but because they enumerated work in an arbitrary sequence — leaving developers to invent structure while under delivery pressure, which is when 400-line functions get written. Planning in layers pushes the structural decisions into the plan itself, where they are cheap to change.

The payoff is threefold: refactors are provably safe, each element of the system owns a single responsibility, and the dependency graph has a narrow neck — so work parallelizes without coordination overhead.

## Input

**Works best with:** The feature, epic, or refactor you need to implement — plus whether it touches code that already exists.
**Also useful:** Acceptance criteria, the language/stack, team size (how many people need parallel work), and any existing test coverage on the affected area.

Anything supplied with the invocation itself — text after the skill name, a pasted context dump, or an appended `ARGUMENTS:` line — counts as answers already given. Use it and skip whatever it covers; don't re-ask.

**Arriving empty-handed? That works too.** The workflow opens by classifying the work (greenfield / brownfield change / pure refactor), then walks the four layers against it.

**Example invocation:** `Plan this: 'Replace our flat 10% discount with tiered discounts by customer segment, honouring existing promo-code behaviour.'`

## Key Concepts

### The Core Idea: Plan in the Order Code Should Be Written

Code written outside-in produces small functions. Code written inside-out produces large ones. A plan that lists "implement discount calculation" as a single sub-task has already lost — it hands the developer a blank page at the widest point. A plan that lists the *entities*, then the *orchestration*, then the *leaves* has made the hard structural calls up front, in a document, where a reviewer can challenge them.

### The Four Layers

| Layer | What you produce | What it buys you |
|---|---|---|
| **0. Baseline safety net** | Characterization tests pinning current behaviour | Permission to refactor. Green tests = nothing broke |
| **1. Entity model** | Interfaces, data classes, structs, enums, type aliases — no behaviour | Shared vocabulary + the contracts that let work fan out |
| **2. Progressive scaffolding** | Top-level flow as a sequence of named stubs, descending one level at a time | Concise functions, single responsibility, a visible call graph |
| **3. Leaf implementation** | The actual business logic, with TDD where it earns its keep | Correctness, at the only altitude where tests are cheap |

**Layers are ordered, not optional-in-sequence.** You may skip Layer 0 for genuinely greenfield work. You may not skip Layer 1 or 2 — skipping them is what produces the tangled code the layers exist to prevent.

---

### Layer 0: Baseline Before You Touch It

**Applies when:** you are changing or refactoring behaviour that already exists. Skip only for true greenfield.

**The rule:** before any existing code changes, write tests that pass against the code *as it is today*. These are characterization tests — they describe what the system does, not what you wish it did. They are the contract you are promising not to break.

- **Test at the seam you're about to change**, not below it. If you're replacing a pricing function, pin the pricing function's inputs and outputs — not its private helpers, which you intend to delete.
- **If you can't write the test without changing production code, that is your first sub-task.** Introducing a seam (extracting an interface, injecting a dependency, exposing a pure function) is legitimate, low-risk work — and it happens *before* the baseline, under the smallest possible diff.
- **Behaviour you intend to change gets pinned too**, and the plan states explicitly which baseline assertions are expected to change and why. A baseline test that changes silently is a regression that got a rubber stamp.
- **Exit criterion:** the baseline suite is green on unchanged code. After the refactor it is green again, or every delta is named in the plan.

> **Refactoring means behaviour does not change.** If behaviour changes, it is not a refactor — it is a change, and it needs its own acceptance criteria alongside the baseline.

---

### Layer 1: Model the Entities First

**The rule:** before writing a single line of behaviour, model what the system is made of. Interfaces, data classes, structs, enums, discriminated unions, type aliases — the nouns and the shapes of the interactions between them.

- **Names come from the domain**, and should be traceable to the vocabulary in the story or PRD. If the story says "eligible customer" and the model says `UserRecord`, one of them is wrong.
- **No behaviour at this layer.** Data shapes and interface signatures only. The temptation to "just implement this one trivial method" is how the layer collapses.
- **Make illegal states unrepresentable** where the language allows: enums over strings, non-nullable over nullable, sum types over boolean flags, value objects over primitives.
- **This layer is the parallelization gate.** Once the entities exist and compile, several people can work against the same contracts without talking to each other. Everything before it is a bottleneck; everything after it fans out.
- **Exit criterion:** it compiles or type-checks, and a reviewer can read the model top to bottom and narrate the domain back to you without seeing any implementation.

---

### Layer 2: Scaffold Downward, One Level at a Time

**The rule:** write the highest-level function first, as a short sequence of calls to functions that do not exist yet. Then descend into each stub, one level at a time. Implement the complicated business logic **last**.

```
1. Write the top-level flow — it should read like the acceptance criteria.
2. Every step it calls is a named stub: real signature, real types, empty body
   (throw NotImplemented / return a typed placeholder).
3. Pick a stub. Repeat step 1 inside it.
4. Stop descending when a function's body is business logic that fits in your head.
```

- **The top-level function is documentation.** `applyDiscounts(cart, customer)` should read as: resolve the customer's tier, select applicable rules, compute the reduction, apply promo codes, produce the priced cart. If it reads as anything else, the decomposition is wrong — and you found that out for free, before writing logic.
- **Single responsibility falls out for free.** A function whose body is five named calls cannot also be doing the work. A function you descended into three levels to reach is, by construction, narrow.
- **Concise functions fall out for free.** Nothing gets long, because "getting long" is the signal to descend another level instead.
- **The stub graph is your parallelization map.** Every leaf stub is a typed, independent unit of work. Count the leaves and you have counted your parallel sub-tasks.
- **Exit criterion:** the call graph exists end to end, it compiles, and every leaf is named, typed, and single-purpose. A walking skeleton that runs and returns placeholder data is the ideal state.

---

### Layer 3: Implement the Leaves — TDD, Calibrated

**The rule:** fill in the leaves last, test-first where a test earns its keep. Test what makes sense. Do not chase 100% coverage.

**Test-first at the leaves.** This is where TDD is cheapest and most valuable: a leaf has a narrow typed contract, no orchestration, and no mocks to speak of. Writing the test first is a two-minute act that clarifies the contract.

| Test it, first | Test it, once, at integration level | Don't test it |
|---|---|---|
| Branching business rules | Orchestration / top-level flows (happy path) | Pure delegation and pass-throughs |
| Boundary and edge conditions named in the AC | The walking skeleton wired end to end | Getters, setters, DTO construction |
| Error and failure paths that users can hit | | Framework glue and configuration |
| Regressions for reported bugs | | Third-party library behaviour |
| Public contracts other teams depend on | | Generated code |

**Signals you are over-testing:** mocks outnumber assertions; tests break on every rename of a private helper; a test asserts the *order of internal calls* rather than an outcome; you're writing a test to move a coverage number.

**Signals you are under-testing:** you cannot refactor a leaf without opening the calling code; the same bug has been fixed twice; nobody can say what "done" means for a rule.

**Coverage is a diagnostic, not a target.** A coverage report is useful for finding branches nobody thought about. It is useless as a goal, and pursuing it as one produces tests that assert nothing while making the code harder to change.

---

### How the Layers Map to Plan Artifacts

This is the part most plans get wrong. **The layers live inside a feature, not across the system.**

❌ **Wrong** — layers as features (horizontal slicing at the worst possible scale):
```
Feature 1: Model all the entities
Feature 2: Scaffold all the functions
Feature 3: Implement all the logic
```
Nothing ships until Feature 3. This is "build the API / build the UI" wearing a new hat.

✅ **Right** — features stay vertical; layers order the work *within* them:

| Layer | Where it lands in the plan |
|---|---|
| **0. Baseline** | Sub-task on the first story that touches existing code — or its own story when the harness is substantial (no seams exist, legacy area, no current coverage) |
| **1. Entity model** | First sub-task of the feature's first story — or a thin **foundation story** when several stories share the model |
| **2. Scaffolding** | One sub-task per story: "scaffold the *X* flow with typed stubs" |
| **3. Leaves** | One sub-task per leaf stub: "implement *leaf*, with tests for *these rules*" |

**The foundation story is the one acceptable horizontal slice**, and only under three conditions: it is types-only, it is small (hours, not days), and at least two downstream stories depend on it. Anything else and you are back to horizontal slicing.

---

### Anatomy of a Sub-Task

Every sub-task in a progressive plan carries four things. If it can't, it isn't decomposed yet.

- **Contract** — the signature it introduces or fills. `calculateTierDiscount(tier: CustomerTier, subtotal: Money) -> Money`
- **Depends on** — which entities and stubs must exist first. Usually just Layer 1 and its own parent stub.
- **Tests** — which tests to write, and explicitly which *not* to write and why.
- **Done when** — an observable condition, not "code is written".

---

### Why This Parallelizes

The dependency graph of a progressive plan has a deliberate shape: a narrow neck, then a wide fan.

```
Baseline  →  Entity model  →  Scaffolding  →  ┌─ leaf A ─┐
(serial)     (serial, short)   (serial, short) ├─ leaf B ─┤ → integrate
                                               ├─ leaf C ─┤
                                               └─ leaf D ─┘
                                                (parallel)
```

Layers 0–2 are short and serial — usually a single developer, often a single day. Layer 3 is the bulk of the effort and is almost entirely parallel, because every leaf has a typed contract, no shared mutable state, and a test that defines its done condition. Developers don't need to talk to each other; the types already had the conversation.

**Practical consequence for sequencing:** front-load Layers 0–2 for *all* stories in the current increment before fanning out on Layer 3. The neck is cheap; widening it early is what buys the parallelism.

---

## Application

Use `template.md` for the full fill-in structure and output format.

### Step 0: Classify the Work

**Ask:** Does this change behaviour that already exists?

**Options:**
1. **Greenfield** — new code, nothing to preserve → skip Layer 0, start at Layer 1
2. **Change to existing behaviour** — → Layer 0 required, and the plan names which baseline assertions are *expected* to change
3. **Pure refactor** — behaviour must be identical → Layer 0 required, and the baseline suite must be green before and after, unchanged
4. **Mixed** — → split it. Refactor first under a green baseline, then change behaviour as separate stories. Never do both in one sub-task.

> ⚠️ Option 4 is the most common real answer and the most common planning failure. A sub-task that both restructures and changes behaviour has no safe rollback and no meaningful test signal.

---

### Step 1: Establish the Baseline (Layer 0)

For each area of existing code the work will touch:

1. **Identify the seam** — the boundary you'll change. Function, class, module, endpoint.
2. **Check for a seam gap** — can you test at that boundary today? If not, add a sub-task to introduce the seam *before* the baseline tests.
3. **Write characterization tests** at that seam covering: the happy path, each known business rule, the edge cases in current use, and current error behaviour.
4. **Record expected deltas** — which of these assertions will legitimately change, and what they'll change to.
5. **Gate the plan:** no story that modifies this area starts until the baseline is green.

---

### Step 2: Model the Entities (Layer 1)

1. **Extract the nouns** from the story, PRD, or acceptance criteria.
2. **Give each one a shape** — data class, struct, record, or interface.
3. **Give each interaction a contract** — the interfaces between components, named for the role they play, not the class that implements them.
4. **Tighten the types** — enums over strings, value objects over primitives, sum types over flag combinations.
5. **Check traceability** — every domain term in the story appears in the model, and every model type is recognizable to whoever wrote the story.
6. **Decide placement:** shared by ≥2 stories → thin foundation story. Otherwise → first sub-task of the first story.

---

### Step 3: Scaffold the Call Graph (Layer 2)

For each story:

1. **Write the top-level signature** — the entry point that satisfies the story.
2. **Write its body as named calls only** — each one a step a non-engineer would recognize from the acceptance criteria.
3. **Stub every call** with a real signature and an empty body.
4. **Descend one level** into each stub and repeat, until a body would be business logic that fits in your head.
5. **Name every leaf** — this list *is* your Layer 3 sub-task list.
6. **Sanity check the top level:** read it aloud. If it doesn't narrate the story, redo the decomposition now — it is free to change at this stage and expensive later.

---

### Step 4: Plan the Leaves (Layer 3)

For each leaf stub:

1. **State the contract** — exact signature and types.
2. **Decide the test posture** using the calibration table: test-first, integration-only, or no test — and record the reason for "no test".
3. **Name the specific cases** to test: rules, boundaries, error paths.
4. **Write the done condition** — observable, not "implemented".
5. **Check independence** — does this leaf need any other leaf to exist? If yes, either it isn't a leaf, or the decomposition leaked state. Fix it before the plan ships.

---

### Step 5: Assemble the Plan

Compose features → stories → sub-tasks:

- **Features stay vertical.** Each delivers observable value end to end. Use `epic-breakdown-advisor` or `user-story-splitting` if a feature is too big — layer discipline does not replace vertical slicing, it operates inside it.
- **Stories stay vertical**, each in "As a / I want / so that" form with acceptance criteria (`user-story`).
- **Sub-tasks carry the layers**, in order, each with contract / depends-on / tests / done-when.
- **Mark the fan-out point** explicitly in the plan so the team knows when parallel work is safe to start.

---

### Step 6: Validate the Plan

Run the checklist before the plan leaves your hands:

- [ ] Every story touching existing code has a baseline sub-task or explicitly states none is needed, with a reason
- [ ] Refactoring and behaviour change are never in the same sub-task
- [ ] Entity modeling precedes every implementation sub-task that uses those entities
- [ ] No feature is named after a layer ("Model entities", "Implement logic")
- [ ] Every foundation story is types-only, small, and shared by ≥2 stories
- [ ] Every implementation sub-task names a contract (a signature), not just a goal
- [ ] Top-level flows are described as sequences of named steps, not as blobs
- [ ] Every sub-task states which tests to write — and where it says "none", it says why
- [ ] No sub-task's done condition is "coverage ≥ N%"
- [ ] The fan-out point is marked, and the parallel sub-tasks after it share no mutable state
- [ ] The serial neck (Layers 0–2) is short relative to the fan (Layer 3)

---

### Output: Implementation Plan

See `template.md` for the full structure. Shape:

```markdown
# Implementation Plan: [Name]

**Work classification:** [Greenfield / Change / Refactor / Mixed → split]
**Baseline required:** [Yes — areas / No — reason]
**Fan-out point:** [After which sub-task parallel work is safe]

## Layer 0 — Baseline Safety Net
[Seams, characterization tests, expected deltas, gate]

## Layer 1 — Entity Model
[Types, interfaces, traceability to story vocabulary]

## Layer 2 — Call Graph
[Top-level flow, descent, leaf inventory]

## Feature 1: [Vertical capability]
### Story 1.1: As a ... I want ... so that ...
  - Sub-task (L0): ...
  - Sub-task (L1): ...
  - Sub-task (L2): ...
  - Sub-task (L3): ...   ← parallel from here
### Story 1.2: ...

## Parallelization Map
[Which sub-tasks can run concurrently, and what gates them]

## Plan Validation Checklist
[The Step 6 checklist, completed]
```

---

## Examples

See `examples/sample.md` for a full worked plan — a tiered-discount replacement over an existing pricing engine, taken through all four layers.

Mini excerpt:

```markdown
Layer 2 — Top-level flow reads like the AC:

  priceCart(cart, customer) →
    resolveCustomerTier(customer)          [leaf]
    selectApplicableRules(tier, cart)      [descends one more level]
    computeDiscount(rules, cart.subtotal)  [descends one more level]
    applyPromoCodes(cart, discount)        [existing — baseline pinned]
    buildPricedCart(cart, discount)        [leaf]

Layer 3 leaves → 6 independent sub-tasks, all typed, all parallel.
```

---

## Common Pitfalls

### Pitfall 1: Layers Become Features
**Symptom:** "Feature 1: Data models. Feature 2: Business logic."

**Consequence:** Nothing ships until the last feature. It's horizontal slicing at the largest possible scale — the exact anti-pattern vertical slicing exists to prevent.

**Fix:** Features stay vertical and deliver value. Layers order the sub-tasks *inside* a story.

---

### Pitfall 2: Refactor and Behaviour Change in One Sub-Task
**Symptom:** "Restructure the pricing module and add tier support."

**Consequence:** When tests fail you can't tell whether the restructure broke something or the new behaviour is simply different. No safe rollback.

**Fix:** Two sub-tasks, in order. Refactor under a green baseline. Then change behaviour, and name which baseline assertions move.

---

### Pitfall 3: Skipping the Entity Layer Because "It's Obvious"
**Symptom:** Sub-tasks jump straight to "implement the discount calculator."

**Consequence:** Each developer invents their own shapes. Two weeks later you're reconciling three representations of a customer tier, and nothing was parallel because nothing had a contract.

**Fix:** Model first, even when it feels trivial. It's an hour, and it's the gate that makes everything after it concurrent.

---

### Pitfall 4: Implementing the Hard Part First
**Symptom:** The plan starts with "implement the discount rule engine" and adds wiring later.

**Consequence:** The hard logic gets written with no surrounding structure, so it absorbs responsibilities that belong elsewhere. This is how a function reaches 400 lines.

**Fix:** Scaffold top-down. The complicated business logic is the *last* thing implemented, by which point its boundaries are already fixed by the call graph.

---

### Pitfall 5: TDD Absolutism
**Symptom:** Every sub-task says "write tests first, target 100% coverage." Tests exist for DTO constructors and pass-through methods.

**Consequence:** Test suite becomes a change-amplifier — every rename breaks twenty tests — and the team learns to distrust it.

**Fix:** Use the calibration table. Test-first at leaves with real logic; one integration test for orchestration; nothing for delegation and glue. Make the plan state the reason when it says "no test".

---

### Pitfall 6: Baseline Tests Written at the Wrong Altitude
**Symptom:** Characterization tests pin private helpers you're about to delete.

**Consequence:** The baseline goes red for reasons that don't mean anything, so people delete the tests, so the safety net is gone exactly when it was needed.

**Fix:** Pin the seam you're changing *at*, not below. If the refactor is internal to a module, test the module's public surface.

---

### Pitfall 7: A Fan-Out That Doesn't Fan
**Symptom:** Six "parallel" leaf sub-tasks, but three of them need to agree on a shared mutable structure invented during implementation.

**Consequence:** Constant coordination, merge conflicts, and one developer blocking two others.

**Fix:** If leaves need to negotiate, the negotiation belongs in Layer 1 as a type. Push it up, then the fan is genuinely independent.

---

### Pitfall 8: Descending Too Far
**Symptom:** Six levels of stubs, functions that call exactly one other function, leaves that are two lines long.

**Consequence:** The call graph becomes harder to read than the logic it wraps. Over-decomposition costs the same clarity as under-decomposition.

**Fix:** Stop descending when a body is business logic that fits in your head. A leaf with a real ten-line rule in it is a good leaf.

---

## References

### Related Skills
- `skills/epic-breakdown-advisor/SKILL.md` — Split the epic vertically *before* applying layers within each story
- `skills/user-story-splitting/SKILL.md` — Further split stories that are still too large
- `skills/user-story/SKILL.md` — Format for the stories this plan produces
- `skills/prd-development/SKILL.md` — Section 7 (User Stories & Requirements) consumes this plan's output
- `skills/roadmap-planning/SKILL.md` — Sequences the features this plan decomposes

### External Frameworks
- Michael Feathers, *Working Effectively with Legacy Code* (2004) — Characterization tests and seams (Layer 0)
- Eric Evans, *Domain-Driven Design* (2003) — Ubiquitous language and entity modeling (Layer 1)
- Robert C. Martin, *Clean Code* (2008) — The Stepdown Rule: code reads as a top-down narrative of descending abstraction (Layer 2)
- Alistair Cockburn — Walking Skeleton: a thin end-to-end implementation before depth (Layer 2)
- Kent Beck, *Test-Driven Development by Example* (2002) — TDD as a design tool, not a coverage mandate (Layer 3)
- Bill Wake, *INVEST in Good Stories* (2003) — Story quality criteria the assembled plan must still satisfy

---

**Skill type:** Workflow
**Suggested filename:** `progressive-implementation-planning.md`
**Suggested placement:** `/skills/workflows/`
**Dependencies:** References `epic-breakdown-advisor`, `user-story-splitting`, `user-story`
**Applies to:** Features, refactors, and epics being turned into developer-ready implementation plans
