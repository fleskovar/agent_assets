# Implementation Plan: [Feature / Refactor Name]

##### **Document Instructions:**

> This plan describes **what to build and in what order**. Its structure is deliberate: the four layers below mirror the order code should actually be written in — baseline safety net, entity model, scaffolded call graph, leaf logic. Features and stories remain **vertical** (each delivers observable value); the layers order the **sub-tasks inside** them.
>
> Fill the layers in order. Layers 0–2 are short and serial. Layer 3 is the bulk of the effort and runs in parallel — that is the point of the exercise.

##### **Tagging Gaps:**

> - **🔶 Assumption** — filled in by inference; plausible but unvalidated.
> - **🔵 Open Question** — not known yet; needs a decision or a spike before the affected sub-task starts.

***

## Plan Summary

| Field | Value |
|---|---|
| **Work classification** | [Greenfield / Change to existing behaviour / Pure refactor / Mixed → split below] |
| **Baseline required** | [Yes — list areas / No — reason] |
| **Stack & test framework** | [e.g. TypeScript, Vitest] |
| **Team size for this increment** | [e.g. 3 developers] |
| **Fan-out point** | [The sub-task after which parallel work is safe] |
| **Related documents** | [PRD, epic, story map links] |

> ⚠️ **If classification is "Mixed", split it here before continuing.** Refactor first under a green baseline; change behaviour as separate stories. Never both in one sub-task.
>
> - Refactor portion: [what moves without changing behaviour]
> - Behaviour-change portion: [what actually changes, with its own acceptance criteria]

***

## Layer 0 — Baseline Safety Net

*Passing tests prove nothing broke. Skip this section only for true greenfield work.*

### Seams

| Area to be changed | Seam to test at | Testable today? | Seam-introduction sub-task |
|---|---|---|---|
| [Module / function / endpoint] | [Public surface to pin] | [Yes / No] | [If No: what to extract or inject first] |

### Characterization Tests

> Written against the code **as it is today**. They describe current behaviour, not desired behaviour.

- [ ] **Happy path:** [Given / When / Then]
- [ ] **Business rule:** [Rule currently enforced]
- [ ] **Edge case:** [Boundary condition in current use]
- [ ] **Error behaviour:** [What the system does today when it fails]

### Expected Deltas

> Baseline assertions that will legitimately change as a result of this work. Anything not listed here must stay green.

| Assertion | Current behaviour | Becomes | Why |
|---|---|---|---|
| [Test name] | [Today] | [After] | [Reason tied to acceptance criteria] |

### Gate

- [ ] Baseline suite is green on unchanged code before any story below starts.

***

## Layer 1 — Entity Model

*Types and contracts only. No behaviour. This is the gate that makes everything after it parallel.*

### Domain Types

| Type | Kind | Fields / Cases | Story vocabulary it maps to |
|---|---|---|---|
| [`CustomerTier`] | [enum / data class / struct / interface] | [values or fields] | [term used in the story or PRD] |

### Contracts (Interfaces)

| Interface | Responsibility | Implemented by (later) |
|---|---|---|
| [`DiscountRuleSource`] | [Named for the role, not the implementation] | [Deferred to Layer 3] |

### Type Tightening

- [ ] Enums instead of strings where the set is closed
- [ ] Value objects instead of bare primitives for domain quantities
- [ ] Sum types instead of boolean-flag combinations
- [ ] Non-nullable by default; optionality is explicit and meaningful

### Traceability Check

- [ ] Every domain term in the story appears in the model
- [ ] Every model type is recognizable to whoever wrote the story
- [ ] The model compiles / type-checks with no behaviour attached

### Placement

- [ ] Shared by ≥2 stories → **foundation story** (types-only, hours not days)
- [ ] Used by one story → first sub-task of that story

***

## Layer 2 — Call Graph (Scaffolding)

*Top-level flow first, as a sequence of named stubs. Descend one level at a time. The complicated logic is written last.*

### Top-Level Flow

```
[entryPoint](args) -> ReturnType
  ├── [step1](...)        [leaf]
  ├── [step2](...)        [descends]
  │     ├── [step2a](...) [leaf]
  │     └── [step2b](...) [leaf]
  └── [step3](...)        [leaf]
```

**Narration check:** read the top level aloud. Does it tell the story's acceptance criteria back to you?

- [ ] Yes — decomposition holds
- [ ] No — redo it now; it is free to change at this stage and expensive later

### Leaf Inventory

> This list **is** the Layer 3 sub-task list.

| # | Leaf | Signature | Owns (single responsibility) |
|---|---|---|---|
| 1 | [`resolveCustomerTier`] | [`(customer: Customer) -> CustomerTier`] | [One sentence] |
| 2 | | | |

### Scaffolding Exit Criteria

- [ ] Call graph exists end to end and compiles
- [ ] Every stub has a real signature and typed placeholder body
- [ ] Every leaf is named, typed, and single-purpose
- [ ] Walking skeleton runs end to end returning placeholder data

***

## Features, Stories & Sub-Tasks

> Features and stories are **vertical** — each delivers observable value. The layers appear as ordered sub-tasks inside them.

### Feature 1: [Vertical capability delivering user value]

**Value delivered:** [What a user can newly do or experience]

---

#### Story 1.1: [Short title]

As a [persona], I want [capability], so that [outcome].

**Acceptance Criteria:**

- [ ] [Testable criterion]
- [ ] [Testable criterion]

**Sub-tasks:**

| # | Layer | Sub-task | Contract | Depends on | Tests | Done when |
|---|---|---|---|---|---|---|
| 1.1.1 | L0 | [Pin current behaviour at *seam*] | — | — | [Characterization: cases] | [Baseline green on unchanged code] |
| 1.1.2 | L1 | [Model *X*, *Y*] | [Types introduced] | 1.1.1 | [None — types only, no behaviour to test] | [Compiles; reviewer can narrate the domain] |
| 1.1.3 | L2 | [Scaffold *flow* with typed stubs] | [`entryPoint(...) -> T`] | 1.1.2 | [One integration test: happy path through placeholders] | [Skeleton runs end to end] |
| 1.1.4 | L3 | [Implement *leaf*] | [`leafFn(...) -> T`] | 1.1.3 | [Test-first: rules, boundaries, error paths] | [Named cases pass; baseline still green] |
| 1.1.5 | L3 | [Implement *leaf*] | | 1.1.3 | | |

> **← Fan-out point:** sub-tasks [1.1.4]–[1.1.n] are independent and may run concurrently.

---

#### Story 1.2: [Short title]

[Repeat structure]

---

### Feature 2: [Vertical capability]

[Repeat structure]

***

## Test Posture

> Record the reasoning, not just the intent. "No test" is a legitimate choice that must state its reason.

| Sub-task | Posture | Cases | Reason (required when posture is "none") |
|---|---|---|---|
| [1.1.4] | Test-first | [Rule A, boundary B, error C] | — |
| [1.1.3] | Integration only | [Happy path end to end] | [Orchestration — leaves carry their own tests] |
| [1.1.2] | None | — | [Types only; no behaviour exists to assert] |

**Coverage stance:** coverage is read as a diagnostic to find unconsidered branches. It is **not** a done condition for any sub-task in this plan.

***

## Parallelization Map

```
Serial neck                                    Parallel fan
──────────────────────────────────────────     ─────────────────
[L0 baseline] → [L1 model] → [L2 scaffold] →   ┌─ [1.1.4] ─┐
                                               ├─ [1.1.5] ─┤ → [integrate]
                                               └─ [1.1.6] ─┘
```

| Sub-task | Can start after | Assignable to |
|---|---|---|
| [1.1.4] | [1.1.3] | [Any developer] |
| [1.1.5] | [1.1.3] | [Any developer] |

**Shared-state check:**

- [ ] No two parallel sub-tasks write to the same structure
- [ ] Any coordination they would need has been pushed up into a Layer 1 type

***

## Risks & Open Questions

| # | 🔶 / 🔵 | Item | Blocks | Owner | Resolution needed by |
|---|---|---|---|---|---|
| 1 | 🔵 | [Open question] | [Sub-task #] | [Name] | [Before sub-task starts] |
| 2 | 🔶 | [Assumption] | [Sub-task #] | [Name] | [Validation approach] |

***

## Plan Validation Checklist

*Complete before the plan leaves your hands.*

- [ ] Every story touching existing code has a baseline sub-task, or states why none is needed
- [ ] Refactoring and behaviour change are never in the same sub-task
- [ ] Entity modeling precedes every implementation sub-task that uses those entities
- [ ] No feature is named after a layer ("Model entities", "Implement logic")
- [ ] Every foundation story is types-only, small, and shared by ≥2 stories
- [ ] Every implementation sub-task names a contract (a signature), not just a goal
- [ ] Top-level flows are described as sequences of named steps, not as blobs
- [ ] Every sub-task states which tests to write — and where it says "none", it says why
- [ ] No sub-task's done condition is "coverage ≥ N%"
- [ ] The fan-out point is marked, and parallel sub-tasks share no mutable state
- [ ] The serial neck (Layers 0–2) is short relative to the fan (Layer 3)
- [ ] Each story still satisfies INVEST

***

*End of Implementation Plan Template*
