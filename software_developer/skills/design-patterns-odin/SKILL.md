---
name: design-patterns-odin
description: The design patterns from the clean-code-developer standard in idiomatic Odin — dispatch by union, procedure-pointer struct or `$T` instead of interfaces, plus the game-programming patterns (generational handles, object pool, component, state, command, dirty flag, spatial partition, double buffer) and the hot-reload layout for raylib games. Use when choosing how to structure Odin code, not just how to write a line of it.
type: reference
theme: code-craft
best_for:
  - "Doing dependency inversion in a language with no interfaces"
  - "Choosing entity storage that survives a growing dynamic array"
  - "Structuring an Odin + raylib game without an engine, and keeping it hot-reloadable"
---

## Purpose

`subagents/clean-code-developer.md` says to use the well-known patterns and name
them out loud. This file says what each looks like in Odin, and adds the
game-programming patterns for raylib work.

**Read `clean-code-odin/SKILL.md` first**, especially the memory-lifetime section.
Three Odin facts collapse or reshape most of the GoF catalogue:

1. **No interfaces and no inheritance.** Every pattern built on a class hierarchy
   is rebuilt on one of three dispatch mechanisms — pick deliberately, see below.
2. **No closures.** A procedure literal cannot capture a local variable. So the
   "a Strategy is just a lambda" collapse that holds in TypeScript and C# does
   *not* hold here: a behaviour that needs state is a `proc` **plus** a data
   pointer, which is exactly why Odin's own ports look the way they do.
3. **No GC.** Every pattern that hands out references has to answer "who frees
   this, and what happens if it dies first?" — which is why the handle table below
   is a pattern here and merely an optimisation elsewhere.

### The three ways to dispatch

| Mechanism | Shape | Cost | Use when |
| --- | --- | --- | --- |
| **Union + `switch v in`** | `Shape :: union {Circle, Rect}` | zero indirection, exhaustive-checked | the set of implementations is **closed and known** — the default |
| **Struct of proc pointers** | `{data: rawptr, do: proc(rawptr, ...)}` | one indirect call, `rawptr` unsafety | the set is **open** — a caller supplies an implementation you never see |
| **Parametric `$T`** | `proc(store: $T) where ...` | zero, monomorphised | the choice is **fixed at compile time** and you want no indirection at all |

Reach for them in that order. The union is checked, printable and debuggable; the
proc-pointer struct is what `mem.Allocator`, `io.Stream` and `log.Logger` are, and
is the right answer for a genuine plugin boundary; `$T` is for zero-cost
compile-time swaps like a test double chosen by build flag.

| Pattern | Odin form | Note |
| --- | --- | --- |
| Strategy | `proc` value field, or enum + `switch` | no closures — pair the proc with its data |
| Factory | `make_thing() -> (Thing, Error)` | allocator parameter, `@(require_results)` |
| Singleton | `context`, or a field on `^Game` | package-level `var` is the anti-pattern |
| Adapter | a package that converts at its edge | the pattern that never collapses |
| Port | union > proc-pointer struct > `$T` | see the table above |
| Facade | the package itself | Odin's package *is* a facade |
| Decorator | a struct wrapping the same port | `mem.Tracking_Allocator` is exactly this |
| Template Method | an orchestrator proc calling step procs | no `abstract`; pass the steps in |
| Command | `struct` + `union` of commands | plain data, so it serialises and replays |
| Observer | a queue drained per frame | not callbacks — see below |
| State | enum + `switch`, or union of state structs | enum form allocates nothing |
| Visitor | `switch v in union` | exhaustive-checked for free |
| Builder | struct initialiser + defaults | Odin has designated initialisers; no builder needed |
| Repository | proc-pointer struct, or just a package | |
| Object Pool | free-list over a fixed array | |
| **Handle map** | generational index into a slice | **the Odin-specific one** |

---

## Port and Adapter — the pattern that does not collapse

The domain declares the capability; one package implements it. In Odin the
"declares" half is a type, not an interface.

**Closed set — use a union.** Two save backends, both known at compile time:

```odin
// game/ports.odin
Save_Store :: union {
	File_Store,
	Memory_Store,      // the test double is a variant, not a mock
}

save :: proc(store: ^Save_Store, slot: int, data: []byte) -> Save_Error {
	switch &s in store {
	case File_Store:   return file_store_save(&s, slot, data)
	case Memory_Store: return memory_store_save(&s, slot, data)
	}
	return .None
}
```

Adding a third backend produces a compile error at every `switch` that must
change. No `rawptr`, no indirect call, and the value prints in a debugger.

**Open set — use the `core:` shape.** A struct holding the data pointer and the
procedures:

```odin
Input_Source :: struct {
	data:        rawptr,
	read_intent: proc(data: rawptr) -> Move_Intent,
}

// platform/raylib_input.odin — the only file that knows raylib exists
raylib_input_source :: proc(state: ^Raylib_Input) -> Input_Source {
	return {
		data = state,
		read_intent = proc(data: rawptr) -> Move_Intent {
			state := cast(^Raylib_Input)data
			return {
				move = {
					f32(int(rl.IsKeyDown(.RIGHT)) - int(rl.IsKeyDown(.LEFT))),
					f32(int(rl.IsKeyDown(.DOWN))  - int(rl.IsKeyDown(.UP))),
				},
				jump = rl.IsKeyPressed(.SPACE),
			}
		},
	}
}
```

The `cast(^Raylib_Input)data` first line is the price of an open set, and it is
the only place `rawptr` is allowed to appear. Note that the proc literal takes
`data` as a parameter rather than capturing `state` — **it cannot capture**, and
that constraint is why the `data` field exists at all.

**The YAGNI veto applies hardest here.** A `Renderer` port over raylib, with
raylib as the only implementation and no second platform planned, is a hop for
every reader and buys nothing. The boundary worth abstracting is the one you
actually cross: input, save files, the clock, audio, networking — the things a
headless test needs to fake. Rendering usually is not one of them, because the
test asserts on the world, not on the pixels.

---

## Strategy

```odin
// Enum + switch — the default. Allocates nothing, serialises into a save file,
// and the compiler tells you every site to update when a rule is added.
Damage_Rule :: enum u8 { Physical, Elemental, True }

apply_damage :: proc(rule: Damage_Rule, dmg: Damage, armor: Armor) -> Health {
	switch rule {
	case .Physical:  return dmg.amount - armor.physical
	case .Elemental: return dmg.amount - armor.elemental
	case .True:      return dmg.amount
	}
	return 0
}
```

```odin
// Procedure value — when the set is open, or supplied by data.
Damage_Rule_Proc :: #type proc(dmg: Damage, armor: Armor) -> Health

Weapon :: struct {
	name:     string,
	damage:   Damage,
	apply:    Damage_Rule_Proc,     // a bare proc pointer: no captured state
}
```

- **A bare `proc` value is fine when the behaviour is pure** — it takes everything
  it needs as arguments. That is the common case for rules and comparators.
- **The moment it needs configuration, it needs a data pointer too**, and you are
  building the port struct above. There is no closure to hide it in. This is a
  feature: the state a strategy depends on is visible in the type.
- **A proc pointer is an indirect call the optimiser cannot inline.** In a
  per-frame path over thousands of entities, the enum + `switch` form is both
  faster and easier to debug. Save the proc-pointer form for setup-time choices.

---

## Factory

A procedure, named for what it makes, returning the value and its error:

```odin
@(require_results)
make_enemy :: proc(
	kind: Enemy_Kind,
	position: [2]f32,
	tuning: ^Tuning,
	allocator := context.allocator,
) -> (Enemy, Spawn_Error) {
	archetype := tuning.archetypes[kind]        // Flyweight: shared, not copied
	...
}
```

- **`make_*` allocates and the caller owns the result; `*_init` initialises
  something the caller already owns.** Both conventions exist in `core:`; pick one
  per project and never mix them in a package.
- The allocator parameter with a default is the Odin part of the pattern — it is
  what lets a caller build the whole thing into a level arena.
- The factory is where the archetype/tuning lookup lives, so nothing else in the
  codebase indexes the tuning table.
- In a game, the factory is also the **pool acquisition point** (below). Once
  spawning goes through one procedure, converting it to pooled is a one-file
  change.

---

## Handle map — the Odin-specific pattern

The one to learn first, because it prevents the worst bug available in the
language: **a `^Entity` stored anywhere becomes a dangling pointer the moment the
`[dynamic]Entity` grows.**

```odin
Entity_Handle :: struct {
	index:      u32,
	generation: u32,
}

Entity_Slot :: struct {
	entity:     Entity,
	generation: u32,
	occupied:   bool,
}

Entity_Store :: struct {
	slots:      [dynamic]Entity_Slot,
	free_list:  [dynamic]u32,
}

get :: proc(store: ^Entity_Store, handle: Entity_Handle) -> (^Entity, bool) {
	if int(handle.index) >= len(store.slots) {
		return nil, false
	}
	slot := &store.slots[handle.index]
	if !slot.occupied || slot.generation != handle.generation {
		return nil, false        // the entity this handle referred to is gone
	}
	return &slot.entity, true
}
```

- **The generation counter is the whole point.** Bump it on despawn, and every
  stale handle to that slot starts returning `false` instead of silently reading
  a different enemy that reused the slot. An index alone does not give you that.
- Store handles in save files, in AI targets, in projectiles, in UI selections —
  anywhere a reference outlives the frame it was taken in.
- Take the `^Entity` from `get`, use it, and **drop it before anything can spawn**.
  A pointer that lives across an `append` is the bug this pattern exists to stop.
- Karl Zylinski's `odin-handle-map` package implements this if you would rather
  not; the version above is ~60 lines and worth writing once to understand it.

---

## Object Pool and free list

With no GC, pooling is not about collection pressure — it is about **stable
addresses and a bounded worst case.**

```odin
Projectile_Pool :: struct {
	items: [MAX_PROJECTILES]Projectile,
	alive: bit_set[0..<MAX_PROJECTILES],
}
```

- **A fixed array plus a `bit_set` of live slots** is the whole pattern for
  bounded things — projectiles, particles, damage numbers. It allocates once, at
  startup, and iterating the set is cheap.
- **Reset on release, not on acquire.** A pooled object carrying stale state is
  the classic pooling bug, and resetting at the point of release puts the crash at
  the point of blame.
- Prewarm to the realistic peak. A pool that grows mid-fight has not helped, and
  in Odin "grows" may mean a reallocation that invalidates pointers.
- The free-list variant (`free_list: [dynamic]u32` of released indices) is the
  same pattern when the maximum is not known — combine it with the generation
  counter above and you have the handle map.

---

## State machine

```odin
Enemy_State :: enum u8 { Idle, Chasing, Attacking, Fleeing }

@(require_results)
next_state :: proc(state: Enemy_State, p: Perception) -> Enemy_State {
	switch state {
	case .Idle:      return p.sees_player ? .Chasing : .Idle
	case .Chasing:   return p.in_range    ? .Attacking : .Chasing
	case .Attacking: return p.in_range    ? .Attacking : .Chasing
	case .Fleeing:   return p.safe        ? .Idle : .Fleeing
	}
	return state
}
```

- **The enum form is a pure function over a `u8`.** It allocates nothing,
  serialises into a save file as one byte, table-tests exhaustively, and the
  compiler flags every unhandled case. Default to it.
- **The union form** — `union {Idle_State, Chasing_State{target: Entity_Handle}}` —
  earns its keep when states carry their own data. Still no allocation: the union
  is a value, stored inline in the entity.
- Keep the transition (`next_state`) separate from the effects (`on_enter`). A
  transition function that also plays a sound is not testable and not replayable.
- Hierarchical machines and behaviour trees are the next step up. Do not reach for
  one until a flat machine has genuinely become unreadable.

---

## Command

```odin
Command :: union {
	Move_Command,
	Attack_Command,
	Spawn_Command,
}

Move_Command :: struct {
	entity: Entity_Handle,
	delta:  [2]f32,
}
```

- **Commands are plain data**, so a `[dynamic]Command` is an input queue, an undo
  stack and a replay buffer at once, and it serialises with no work.
- Command + inverse = undo, which is why this is the level-editor pattern.
- Command + a fixed timestep = deterministic replay and lockstep multiplayer:
  record the input stream, not the world state. This only works if the simulation
  reads no globals and no unseeded randomness — see the `clean-code-odin`
  dependencies section.
- **Keep the handler separate from the command.** A command that executes itself
  has fused Command with Strategy and can no longer be logged, queued or replayed.

---

## Observer — prefer a queue to callbacks

Odin's lack of closures makes the callback form clumsy on purpose, and in a game
the clumsiness is pointing at something true.

```odin
// The idiomatic form: systems write events, systems read them, one drain per frame.
Game_Event :: union {
	Entity_Died,
	Damage_Dealt,
	Level_Completed,
}

World :: struct {
	events: [dynamic]Game_Event,     // cleared at end of frame
	...
}
```

- **An event queue drained at a known point in the frame** is deterministic,
  debuggable (print the queue), replayable, and free of reentrancy — an observer
  that spawns an entity mid-iteration is the reentrancy bug callbacks invite.
- Order is explicit: audio reads the queue, then UI, then analytics. With
  callbacks the order is registration order, which is invisible.
- If you do need callbacks — a C library calling you back is the honest case — it
  is the proc-pointer + `data` port struct again, and the subscriber list is a
  `[dynamic]Listener` you must explicitly unsubscribe from. There is no weak
  reference to save you.
- **Clear the queue exactly once per frame, in the main loop**, next to
  `free_all(context.temp_allocator)`. Two clear sites is a dropped-event bug.

---

## Component and composition

Odin gives you no `GameObject`, and for most games you should not build one.

- **Start with one `Entity` struct with all the fields**, plus a
  `bit_set[Component]` saying which are live. For a few thousand entities this is
  faster, simpler and more debuggable than anything else, and the wasted bytes
  cost nothing you will notice.
- **Then split hot systems into their own arrays** when the profile says so —
  `positions: #soa[dynamic]Transform` iterated by the physics pass.
- **A full ECS is a last resort, not a starting point.** It adds real friction to
  the creative part of making a game, and almost no game needs it. If you reach
  for one, reach because a profile told you to.
- Behaviour that does not need raylib does not belong near raylib. The simulation
  is a package that imports `core:` only; that is what makes it testable headless
  at ten thousand frames a second.

---

## Data locality, dirty flag, double buffer, spatial partition

The four performance patterns worth knowing by name, all of which Odin expresses
directly:

- **Data locality** — `#soa[dynamic]Entity` turns array-of-structs into
  struct-of-arrays without changing the code that reads `entities[i].position`.
  The one restructuring that reliably pays, and the one you should still not do
  before profiling.
- **Dirty flag** — recompute only when the input changed. Cached world transforms,
  pathfinding grids, the text you rebuild into a `cstring` every frame. Cheapest
  first thing to try when a per-frame cost shows up in a profile.
- **Double buffer** — `current, next: World`, simulate into `next`, swap. Removes
  order dependence between systems and is what makes a simulation deterministic.
  In Odin the swap is one assignment of a struct.
- **Spatial partition** — a uniform grid is usually enough:
  `cells: [GRID_H][GRID_W][dynamic]Entity_Handle`. The moment "all enemies within
  X" appears in a per-frame loop over a growing list, this is the fix, not a
  faster inner loop. Note the cells store **handles**, not pointers.

---

## Facade and Decorator

**Facade is the package.** A package that exports `update`, `draw` and
`handle_input`, with everything else `@(private)`, is a facade with compiler
enforcement. You do not need a type for it.

**Decorator wraps a port with the same port.** Odin's own tracking allocator is
the canonical example — it implements `mem.Allocator`, holds another
`mem.Allocator`, and adds bookkeeping:

```odin
mem.tracking_allocator_init(&track, context.allocator)
context.allocator = mem.tracking_allocator(&track)   // same type in, same type out
```

That shape works for anything behind a proc-pointer port: a logging save store, a
latency-injecting network adapter, a deterministic clock over the real one. It
does not work over a union port — adding a `Logging_Store` variant to the union
means every `switch` must handle it, which is exhaustiveness working as intended
and telling you the set was not as closed as you thought.

---

## Composition root, and the hot-reload layout

```odin
// main.odin — the only file that knows the whole graph
main :: proc() {
	when ODIN_DEBUG {
		track: mem.Tracking_Allocator
		mem.tracking_allocator_init(&track, context.allocator)
		context.allocator = mem.tracking_allocator(&track)
		defer report_leaks(&track)
	}

	context.logger = log.create_console_logger()
	defer log.destroy_console_logger(context.logger)

	rl.InitWindow(WINDOW_WIDTH, WINDOW_HEIGHT, "game")
	defer rl.CloseWindow()
	rl.SetTargetFPS(TARGET_FPS)

	game: Game
	game_init(&game)                 // allocates the level arena, loads tuning
	defer game_shutdown(&game)

	for !rl.WindowShouldClose() {
		input := platform.poll_input()
		game_update(&game, input, rl.GetFrameTime())

		rl.BeginDrawing()
		render_frame(&game)
		rl.EndDrawing()

		free_all(context.temp_allocator)
	}
}
```

If you want **hot reload** — and for a game you probably do, it is the largest
iteration-speed win available — the layout is forced, and it is worth adopting
from day one because retrofitting it is painful:

- **All mutable game state lives in one struct**, reachable from one pointer, and
  is allocated by the host executable, not the reloadable code.
- **The game compiles to a shared library** exporting a small C-ABI surface:
  `game_init`, `game_update`, `game_memory`, `game_hot_reloaded`, `game_shutdown`.
- **`main.odin` is the host**: it owns the window, the memory and the reload loop,
  and it never holds a pointer *into* the game library across a reload.
- **No package-level mutable state in the game library** — it is exactly what a
  reload resets, and the resulting "why did my score reset" hunt is long. This is
  the same rule as `clean-code-odin`'s "pass `^Game` down"; hot reload is what
  makes violating it immediately painful instead of quietly untestable.
- Karl Zylinski's `odin-raylib-hot-reload-game-template` is the reference
  implementation; start from it rather than deriving it.

---

## Anti-patterns

- **A `^Entity` stored in a struct, a list, or across a frame.** The dynamic array
  grows, the pointer dangles, and the crash lands somewhere unrelated. Handles.
- **Package-level mutable state** (`g_world`, `g_renderer`). Untestable,
  order-dependent, invisible in every signature, and wiped by hot reload.
- **`context.user_ptr` as the way gameplay code finds the world.** Service Locator
  with a `rawptr` cast and no type checking.
- **A port with one implementation and no boundary** — `Renderer` over raylib
  only. If a headless test would not fake it, it is not a port.
- **Simulating an interface with a proc-pointer struct when the set is closed.**
  You paid `rawptr` unsafety and an indirect call to lose exhaustiveness checking.
  Use a union.
- **Building an ECS before the game.** The friction lands on the creative work,
  which is the part that decides whether the game is any good.
- **Allocating in the frame path** — `make`, growing `append`, `strings.clone`,
  `fmt.aprintf`. Preallocate, pool, or use the temp allocator.
- **`using` as inheritance.** `using entity: Entity` inside every actor type is a
  base class drawn in a language that deliberately does not have them, and the
  name collisions arrive silently.
- **Commands that execute themselves**, so they cannot be logged, queued or
  replayed.
- **Callbacks fired mid-iteration** that spawn or despawn — the reentrancy bug the
  event queue exists to prevent.
- **A god `update` procedure.** 400 lines of frame logic in one proc is the Odin
  form of the god `MonoBehaviour`; the fix is the same — named phase procedures
  and an orchestrator that reads as the frame's summary.
