---
name: clean-code-odin
description: Idiomatic Odin for the clean-code-developer standard — Ada_Case/snake_case naming enforced by `-vet -strict-style`, distinct types and unions instead of loose maps, errors as enum return values with `or_return`, explicit allocators and the `context` system, arena and temp-allocator lifetimes, array programming and `#soa`, `core:testing`, and the raylib/cstring boundary. Use before writing or refactoring any Odin.
type: reference
theme: code-craft
best_for:
  - "Writing new Odin packages to the house craft standard"
  - "Deciding who owns a piece of memory, and which allocator it comes from"
  - "Keeping vendor:raylib types and cstrings out of gameplay logic"
---

## Purpose

The language-specific form of `subagents/clean-code-developer.md` for Odin. That
file states the rules; this one states what they look like in Odin, which Odin
idioms fight them, and which flags enforce them.

Odin has **no classes, no inheritance, no interfaces, no exceptions, no garbage
collector and no operator overloading.** Four of the agent file's rules therefore
have no direct translation and need one:

| Agent rule | Odin has no… | What replaces it |
| --- | --- | --- |
| "Port / interface" | interfaces | a struct of procedure pointers, a union, or `$T` — see `design-patterns-odin` |
| "Total functions, no sentinel returns" | exceptions | multiple return values `(T, Error)` and `or_return` |
| "Composition over inheritance" | inheritance | it is already the only option; `using` is not a substitute |
| "Return, don't mutate" | a GC to make that free | explicit allocators — mutation in place is often the *correct* answer |

That last row is the Odin equivalent of the C# guide's LINQ rule: **the "prefer
expressions, return new values" default does not survive contact with a 60 Hz
frame budget and a manual allocator.** The section *Functional Odin, and where it
stops* draws the line.

Read `skills/design-patterns-odin/SKILL.md` when you are choosing structure. If you are
writing a game against raylib, read both, and the raylib section below is not
optional — it is where the type discipline actually gets tested.

---

## Naming, and the flags that enforce it

Odin has a real convention, used throughout `core:` and `vendor:`. Follow it;
the compiler enforces half of it and reviewers notice the other half.

| Element | Case | Example |
| --- | --- | --- |
| Package / import name | `snake_case`, one word preferred | `package world`, `import vmem "core:mem/virtual"` |
| Types | `Ada_Case` | `Entity`, `Spatial_Grid`, `Load_Error` |
| Enum values | `Ada_Case` | `.Idle`, `.Not_Found` |
| Procedures | `snake_case` | `spawn_entity`, `parse_level` |
| Variables, struct fields | `snake_case` | `move_speed`, `position` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_ENTITIES`, `GRAVITY` |

```bash
odin build . -vet -strict-style -vet-tabs -disallow-do -warnings-as-errors
```

That line is the project's baseline, not a nice-to-have. `-vet` alone turns on
`-vet-unused`, `-vet-unused-variables`, `-vet-unused-imports`, `-vet-shadowing`
and `-vet-using-stmt` — which means **the agent file's "no unused code" and "no
shadowed variable" rules are compile errors rather than review comments.** Add
`-vet-cast`, `-vet-semicolon` and `-vet-style` per project; `-vet-using-param`
is worth turning on permanently (see the `using` trap below).

Declaration style, from the same convention:

```odin
sound := load_sound(filename)          // yes — infer
sound: Sound = load_sound(filename)    // no — the annotation says nothing

cam := Camera {                        // yes — initialiser
	position = {50, 50, 10},
	fov      = DEFAULT_FOV,
}
```

Tabs for indentation, spaces for alignment. Opening brace at end of line.
Trailing comma on every multi-line literal — `-vet-style` errs without it.

---

## Typed containers, not loose maps

| Need | Use |
| --- | --- |
| Value object | `struct` — copied by value, which is the default and usually right |
| A closed set of shapes | `union` + `switch v in x` |
| A distinguishable primitive | `distinct` type |
| A closed set of names | `enum` |
| A set of flags | `bit_set[Enum]` — never an `int` of OR'd bits |
| Optional value | `Maybe(T)`, or `(T, bool)` with optional-ok |
| Genuine key→value, unknown keys | `map[K]V` — legitimate |

```odin
// No — three uncheckable contracts and a stringly-typed state
spawn :: proc(kind: string, props: map[string]f32) -> rawptr

// Yes
Entity_Id   :: distinct u32
Health      :: distinct i32
Entity_Kind :: enum u8 { Grunt, Archer, Boss }

Entity :: struct {
	id:       Entity_Id,
	kind:     Entity_Kind,
	position: [2]f32,
	velocity: [2]f32,
	health:   Health,
	flags:    bit_set[Entity_Flag],
}

spawn :: proc(world: ^World, kind: Entity_Kind, position: [2]f32) -> Entity_Id
```

- **`distinct` is the branded type.** `Entity_Id` and `Frame_Count` as bare `u32`
  are the same type, so `despawn(frame, id)` compiles. Distinct, it does not.
  Costs nothing at runtime.
- **`bit_set[Flag]` over an integer bitmask.** `.Stunned in entity.flags` is
  checked, printable and exhaustively knowable; `flags & 0x04` is not.
- **Enumerated arrays** are the typed lookup table: `[Direction][2]int` cannot be
  indexed with a wrong-typed value and cannot be missing an entry.
- **`rawptr` is Odin's `any`.** It appears legitimately in exactly one place — the
  `data` field of a procedure-pointer port (see the patterns guide) — and is a
  defect anywhere else.
- **`any` and `auto_cast`** are for printf-style debugging and prototypes. Not in
  a signature you intend to keep.

**Unions instead of optional-field soup.** Not a struct with four `Maybe` fields
and an "only valid when" comment:

```odin
Load_Result :: union {
	Level,
	Load_Error,
}

#partial switch v in result {
case Level:      start(v)
case Load_Error: report(v)
}
```

A `switch v in x` over a union with no `case:` default is checked for
exhaustiveness — that is the Visitor pattern for free. Reach for `#partial
switch` only when you genuinely mean "ignore the rest", because it turns the
compiler's exhaustiveness check off.

---

## Constants and magic values

```odin
// No
if entity.health < 25 && attempts > 3 {
	stun_for(0.5)
}

// Yes
LOW_HEALTH_THRESHOLD :: Health(25)
MAX_ATTEMPTS         :: 3
STUN_DURATION        :: f32(0.5)

if entity.health < LOW_HEALTH_THRESHOLD && attempts > MAX_ATTEMPTS {
	stun_for(STUN_DURATION)
}
```

- `::` constants are compile-time, typed by inference, and free. There is no
  reason to leave a meaningful literal inline.
- Constants live in the package that owns them. A project-wide `constants.odin`
  imported by everything is a god module; a package-level `TUNING` struct
  constant per system is not.
- Untyped constants (`GRAVITY :: 9.81`) adapt to the context they are used in.
  Give them a type (`GRAVITY :: f32(9.81)`) when the implicit conversion would
  hide a precision decision.

---

## Errors are values

Odin has no exceptions. A fallible procedure returns its error, and the caller
cannot ignore it without saying so.

```odin
Load_Error :: enum {
	None = 0,
	File_Not_Found,
	Bad_Magic,
	Truncated,
}

@(require_results)
load_level :: proc(path: string, allocator := context.allocator) -> (level: Level, err: Load_Error) {
	data, ok := os.read_entire_file(path, allocator)
	if !ok {
		return {}, .File_Not_Found
	}
	defer delete(data, allocator)

	header := parse_header(data) or_return
	tiles  := parse_tiles(data[HEADER_SIZE:], allocator) or_return

	return Level{header = header, tiles = tiles}, .None
}
```

- **`or_return` is the whole idiom.** It pops the trailing error off a multi-value
  expression and returns early if it is non-`nil`/non-zero. Named return values
  are what make the bare `return` inside it legal — so name them.
- **`.None = 0` as the first enum member** means the zero value of the error type
  is "no error", which is what `or_return` and `if err != nil` both assume.
- **`@(require_results)`** on anything returning a value that must not be dropped.
  It is the cheapest correctness attribute in the language and nobody uses it.
- **`or_else` for defaults**: `hp := table[id] or_else DEFAULT_HEALTH`. Use it for
  a genuine default, never to paper over a lookup that should have succeeded.
- **`or_continue` / `or_break`** in loops, when one bad element should not abort
  the batch.
- **No sentinel returns.** `-1` for "not found" and `""` for "missing" are the
  thing multiple return values exist to delete.
- **`assert` / `ensure` / `panic` are for programmer errors only** — a violated
  invariant, not a missing file. `assert` compiles out under `-o:speed` without
  `-debug`; `ensure` does not. If a player's machine can trigger it, it is an
  `Error` value, not an assert.

---

## Explicit dependencies: `context`, and everything else you pass

Odin has one ambient thing, and it is deliberate: **`context`**, an implicit
parameter carrying `allocator`, `temp_allocator`, `logger`, `assertion_failure_proc`
and `user_ptr`. Treat it as the language's single sanctioned global — and treat
everything you might be tempted to add to it as a parameter.

**Allowed in `context`:** allocator, temp allocator, logger. That is the list.

```odin
main :: proc() {
	context.logger = log.create_console_logger()
	defer log.destroy_console_logger(context.logger)

	game := game_init()          // one composition root
	defer game_shutdown(&game)

	run(&game)
}
```

- **`context.user_ptr` is a global by another name.** It exists for C callbacks
  that give you no other channel. Using it to reach your game state from
  gameplay code is the Service Locator anti-pattern with extra steps.
- **Package-level `var` state is the real hazard.** Odin makes it easy —
  `@(private) g_world: World` at file scope compiles and works. It is also
  untestable, order-dependent, and invisible in every signature that touches it.
  **Pass `^Game` down instead.** One pointer parameter, threaded through the call
  tree, is the whole discipline.
- **Clock, input and randomness are parameters.** `update(world, dt)` not
  `update(world)` reading `rl.GetFrameTime()` inside. `rand` seeded and carried in
  the world struct, not `rand.float32()` from a global — a deterministic replay is
  impossible otherwise, and determinism is what makes a bug reproducible.
- **`context` is copied into each procedure**, so a change is scoped to the callee
  and everything below it. That makes the scoped-override idiom safe and precise:

```odin
{
	context.allocator = level_arena_allocator
	level = load_level(path) or_return       // everything inside allocates from the arena
}
```

**Have a composition root.** `main.odin` sets up the logger, the allocators, the
window, and builds the one `Game` struct. Everything else receives what it needs.
That file is allowed to be boring.

---

## Memory is part of the design

The question the agent file never has to ask in Python or TypeScript, and the
first one to ask in Odin: **who owns this, and when does it die?** Answer it in
the signature.

```odin
// The convention core: uses, and the one to copy:
// allocations the caller owns take an allocator parameter, defaulted.
make_tile_grid :: proc(w, h: int, allocator := context.allocator) -> []Tile {
	return make([]Tile, w * h, allocator)
}
```

Four lifetimes cover almost everything in a game:

| Lifetime | Tool | Freed by |
| --- | --- | --- |
| Whole program | `context.allocator` (heap) | `delete` / `defer` at shutdown |
| One level / scene | `vmem.Arena` | one `vmem.arena_free_all` on unload |
| One frame | `context.temp_allocator` | `free_all(context.temp_allocator)` at frame end |
| One scope | a fixed `[N]T` on the stack | scope exit, for free |

```odin
import vmem "core:mem/virtual"

level_arena: vmem.Arena
arena_err := vmem.arena_init_growing(&level_arena)
ensure(arena_err == nil, "level arena")
level_allocator := vmem.arena_allocator(&level_arena)
```

- **An arena per level deletes the entire class of level-teardown leaks.** Nothing
  loaded into it needs an individual `delete`; unloading is one call. This is the
  single highest-leverage memory decision in an Odin game.
- **The temp allocator is per-frame scratch.** One `free_all(context.temp_allocator)`
  at the bottom of the game loop. Anything that must outlive the frame must not be
  in it — that includes anything you stored in a struct field, which is the most
  common temp-allocator bug.
- **`defer delete(x)` on the line after the allocation**, always, for heap
  allocations with scope lifetime. Not at the end of the procedure; next to the
  thing it frees, where a reviewer can see the pair.
- **Run the tracking allocator in debug builds.** It costs one `when` block and
  it turns "we leak somewhere" into a file and line:

```odin
when ODIN_DEBUG {
	track: mem.Tracking_Allocator
	mem.tracking_allocator_init(&track, context.allocator)
	context.allocator = mem.tracking_allocator(&track)

	defer {
		for _, entry in track.allocation_map {
			fmt.eprintfln("leak: %v bytes @ %v", entry.size, entry.location)
		}
		for entry in track.bad_free_array {
			fmt.eprintfln("bad free: %p @ %v", entry.memory, entry.location)
		}
		mem.tracking_allocator_destroy(&track)
	}
}
```

- **No allocation in the per-frame path.** Not `make`, not `append` that grows,
  not `fmt.aprintf`, not `strings.clone`. Preallocate to the realistic peak at
  load, or use the temp allocator, or use a pool (see the patterns guide).
- **Never store a `^T` into a `[dynamic]T`.** Growing the array reallocates and
  every stored pointer becomes a use-after-free that will not crash until three
  levels later. Store an index, or a generational handle. This is the most
  expensive mistake available in Odin gameplay code.

---

## Ports in a language with no interfaces

Dependency inversion still applies; the mechanism is different. Odin's own
`mem.Allocator`, `io.Stream` and `log.Logger` are the pattern to copy: **a struct
holding a procedure pointer and a `rawptr` to the implementation's data.**

```odin
// ports.odin — declared by the consumer
Save_Store :: struct {
	data:  rawptr,
	write: proc(data: rawptr, slot: int, bytes: []byte) -> Save_Error,
	read:  proc(data: rawptr, slot: int, allocator: mem.Allocator) -> ([]byte, Save_Error),
}
```

Three forms, in the order you should reach for them — the patterns guide has the
full treatment, including when each stops being worth it:

1. **A union of the concrete implementations**, dispatched with `switch v in`.
   Exhaustive, no `rawptr`, no indirection. Correct whenever the set is closed.
2. **A struct of procedure pointers** (above). The open set: the caller can supply
   an implementation you have never seen. This is what `core:` uses.
3. **Compile-time polymorphism** — `proc(store: $T)` with a `where` clause. Zero
   cost, monomorphised, but the choice is baked at compile time, so it cannot swap
   an implementation at runtime.

And the YAGNI veto still applies hardest here: **a port with one implementation
and no boundary behind it is noise.** Wrapping raylib in `Renderer` when there
will only ever be raylib buys you nothing and costs every reader a hop.

---

## Functional Odin, and where it stops

The agent file's functional defaults hold in Odin's pure core, and the language
supports them well:

```odin
// Yes — pure, total, testable without constructing anything
@(require_results)
next_state :: proc(state: Enemy_State, p: Perception, dt: f32) -> Enemy_State {
	switch state {
	case .Idle:      return p.sees_player ? .Chasing : .Idle
	case .Chasing:   return p.in_range ? .Attacking : .Chasing
	case .Attacking: return p.in_range ? .Attacking : .Chasing
	case .Fleeing:   return p.safe ? .Idle : .Fleeing
	}
	return state
}
```

- Small procedures that take their inputs and return their outputs. A pure
  simulation step needs no fakes to test.
- Structs are **copied by value** on assignment and on pass — so "return a new
  value" is the default, not an allocation. Take `^T` when you mean to mutate or
  when the struct is large; take `T` otherwise.
- Exhaustive `switch` over enums and unions with no `case:` default, so adding a
  variant produces compile errors at every site that must change.

**Where it stops — and this is a real stop, not a hedge:**

- **There is no lazy iterator pipeline in Odin, and you must not build one.** No
  `Iterator` interface, no `map`/`filter` combinator tower, no generic `pipe`. The
  idiomatic transformation is a `for` loop that writes into a preallocated slice,
  and it is *both* faster and more readable here. The allocating helpers in
  `core:slice` are for setup code, never for a frame.
- **A loop that fills a buffer it owns is not the smell it is in Python.** The
  agent file's "an accumulator loop is usually an expression" default is
  suspended in Odin. The rule that survives is *the loop does one thing and is
  named* — extract `count_neighbours`, do not inline it into `step_world`.
- **In-place mutation through `^T` is correct in the hot path.** `update_physics(^entity, dt)`
  mutating the entity beats returning a fresh one. Keep the writes in one visible
  block inside that procedure (the agent file's rule 3 still applies to *where*
  the writes happen), but do not copy a 200-byte struct per frame to be pure.
- **No `defer` inside a loop body** expecting per-iteration cleanup — `defer` runs
  at scope exit, so N iterations means N deferred calls all firing at the end.
  Open a block scope `{ ... }` if you want per-iteration semantics.

The test is unchanged: *does this read more easily than the imperative version?*
In Odin the answer flips to "no" far more often than in TypeScript, and you
should let it.

---

## Array programming: vectorize when it's free

Odin's fixed-length arrays are arithmetic types. This is where "vectorize when
it's free" is genuinely free, and it is the reason you do not want a `Vector2`
struct with an `add` method.

```odin
a := [3]f32{1, 4, 9}
b := [3]f32{2, 4, 8}
c := a + b                         // {3, 8, 17} — componentwise, no library
d := a * 2                         // scalar broadcast
speed := linalg.length(velocity)   // core:math/linalg for the rest
```

- Use `[2]f32` / `[3]f32` as your vector types. They swizzle (`.x`, `.y`, `.xy`),
  they do arithmetic, and they are layout-compatible with raylib's `Vector2`,
  which *is* `[2]f32`. Defining your own `Vec2 :: struct {x, y: f32}` throws all
  of that away.
- `core:math/linalg` for normalise, dot, cross, matrices, quaternions.
  `linalg.normalize0` returns zero instead of NaN for a zero vector — which is
  what you want for an input direction that may be `{0, 0}`.
- **`#soa` when you iterate one field over many entities.** `#soa[dynamic]Entity`
  keeps each field in its own contiguous array while still letting you write
  `entities[i].position`. A per-frame pass over 10k positions gets the cache
  behaviour and lets the optimiser vectorise; the source barely changes.
- `#no_bounds_check` only on a loop you have profiled and whose bounds you have
  proved, with a comment saying which. Never on a whole procedure, never
  project-wide.

Do not restructure to `#soa` before it is a measured problem — array-of-structs
is easier to reason about and correct until the profile says otherwise.

---

## Layout: the directory is the package

Odin has no per-file namespace: **every file in a directory is one package**, and
`@(private)` means package-private. Two consequences that shape the layout:

1. **Splitting a long file is free.** `entity.odin`, `entity_spawn.odin`,
   `entity_render.odin` in one package share everything. The agent file's
   ~300-line file limit costs you nothing to obey.
2. **The package is the real unit of encapsulation**, and **Odin forbids cyclic
   imports** — so the dependency arrows in the agent file are enforced by the
   compiler rather than by a lint rule.

```
src/
	main.odin              # composition root: allocators, window, wiring
	game/                  # package game — simulation. imports nothing platform.
		world.odin
		entity.odin
		combat.odin
		tuning.odin        # constants owned here
	render/                # package render — the only importer of vendor:raylib
		draw.odin
		textures.odin
	platform/              # package platform — input, files, audio, clock
		input.odin
		save.odin
```

- `game/` imports `core:` only. If `game` imports `vendor:raylib`, the design is
  wrong and the simulation is no longer testable headless.
- Import aliases follow the convention: `import rl "vendor:raylib"`,
  `import vmem "core:mem/virtual"`, `import la "core:math/linalg"`.
- `@(private)` on everything the package does not export. The default is exported,
  which means an unmarked helper is public API by accident.
- `@(private="file")` for a genuine file-local helper.
- No `utils.odin`. In a language where the directory is the package, a `utils`
  package is a dependency cycle waiting to be discovered.

---

## raylib at the boundary

raylib is a C API, and it leaks two things into any code that touches it:
**`cstring`** and **resource handles**. Keep both in `render/` and `platform/`.

```odin
// No — the simulation now depends on a C string and a GPU handle
Entity :: struct {
	position: rl.Vector2,
	texture:  rl.Texture2D,
	name:     cstring,
}

// Yes — the simulation holds data; the renderer owns the resources
Entity :: struct {
	position: [2]f32,
	sprite:   Sprite_Id,     // an index into the renderer's table
	name:     string,
}
```

- **`rl.Vector2` is `[2]f32` and `rl.Vector3` is `[3]f32`** — plain aliases, not
  opaque types. Passing your `[2]f32` straight to `rl.DrawTextureV` is exact, not
  a conversion. So the vector types are the one part of raylib you may use freely
  everywhere; nothing else is.
- **`rl.Texture2D`, `rl.Sound`, `rl.Font`, `rl.Shader` are GPU/driver handles.**
  They belong in one table in `render/`, keyed by an id the simulation holds. A
  `Texture2D` in a save file or a domain struct is a bug in waiting.
- **Every raylib text parameter is `cstring`, not `string`.** Odin `string` is a
  pointer+length with no NUL, so the conversion allocates. In a draw call, use the
  temp allocator and let the frame-end `free_all` clean up:

```odin
rl.DrawText(fmt.ctprintf("score %d", state.score), 10, 10, FONT_SIZE, rl.WHITE)
```

  `fmt.ctprintf` allocates in `context.temp_allocator`. `strings.clone_to_cstring`
  with `context.allocator` in a draw call is a leak per frame. Literal C strings
  (`"pause"` passed where a `cstring` is expected) are compile-time and free.
- **Colors and enums stay in the renderer.** `rl.WHITE`, `rl.KeyboardKey` — the
  simulation should take an `Input_State` struct that `platform/` filled in from
  `rl.IsKeyDown(.SPACE)`, not query raylib itself.
- The main loop is the shell, and it is allowed to be procedural:

```odin
for !rl.WindowShouldClose() {
	input := platform.poll_input()
	game.update(&world, input, rl.GetFrameTime())

	rl.BeginDrawing()
	rl.ClearBackground(rl.BLACK)
	render.draw_world(&renderer, world)
	rl.EndDrawing()

	free_all(context.temp_allocator)
}
```

  Three lines, three phases, and `game.update` is a pure-ish function of
  `(world, input, dt)` that a test can call ten thousand times with no window.

---

## Tests

`core:testing`, run with `odin test`. **Additive only** — never edit an existing
test to make your change pass (see the agent file for the two cases when one
fails).

```odin
package game_tests

import "core:testing"
import "../game"

@(test)
refund_over_original_amount_is_rejected :: proc(t: ^testing.T) {
	world := game.make_test_world()
	defer game.destroy_world(&world)

	result := game.apply_damage(&world, TEST_ENTITY, game.Health(9999))

	testing.expect_value(t, result, game.Damage_Result.Fatal)
}
```

```bash
odin test tests/ -all-packages
odin test . -define:ODIN_TEST_NAMES=game_tests.refund_over_original_amount_is_rejected
```

- `testing.expect_value(t, actual, expected)` prints both sides on failure;
  prefer it to `testing.expect(t, a == b)`, which prints neither.
- `testing.expectf` when the message needs the values. `testing.fail_now` when
  continuing would crash.
- **The test runner tracks allocations by default** and reports leaks, bad frees
  and peak usage per test. That makes "does this procedure leak?" a test result
  rather than an audit — do not disable it with
  `-define:ODIN_TEST_TRACK_MEMORY=false` to make a red suite green.
- Name the behaviour, arrange / act / assert separated by blank lines.
- Test the pure simulation, which needs no window: `game.update(&world, input, dt)`
  called in a loop with a fixed `dt` is a deterministic, headless integration
  test, and it is the highest-value test you can write in a game.
- `testing.set_fail_timeout(t, 5 * time.Second)` on anything that could hang —
  the runner will otherwise wait forever on a loop that never converges.

---

## Tooling

Run before reporting done, and fix rather than suppress:

```bash
odin check . -vet -strict-style -vet-tabs -disallow-do -warnings-as-errors
odin test tests/ -all-packages
odin build . -o:speed                     # release
odin build . -debug -sanitize:address     # when chasing a memory bug
```

- **`odin check`** is the fast path — full type check, no codegen. Put it in the
  pre-commit hook.
- **`-vet-cast`** catches casting a value to its own type and `transmute` used
  where `cast` was meant. **`-vet-unused-procedures`** finds dead code that
  accumulates fast in a game.
- **`ols`** (the language server) plus **`odinfmt`** for editor formatting; commit
  an `odinfmt.json` so the project agrees.
- **`-debug` for development builds** — it defines `ODIN_DEBUG`, which is what the
  tracking-allocator block above keys off.
- **`-sanitize:address`** when a crash is memory-shaped. It is far faster than
  reading the code.
- Suppress narrowly and with a reason. `#no_bounds_check` and `-vet` exceptions on
  a specific package (`-vet-packages:game,render`) are the only granular escapes
  available, so a blanket removal of `-vet` is the whole project's loss.

---

## Odin-specific traps

- **Pointers into `[dynamic]T` and `map` values are invalidated by growth.** The
  single biggest source of memory corruption in Odin gameplay code. Store an
  index or a generational handle; take the pointer, use it, drop it inside one
  scope that cannot append.
- **Everything is zero-initialised, and the zero value is often valid-looking.**
  A zeroed `Entity` has `kind = .Grunt` (member 0) and full-zero health. Order
  enums so member 0 is the sentinel (`.None`, `.Invalid`) when zero should not be
  a real value.
- **`x: [N]T = ---` skips initialisation.** Only for a buffer you are about to
  fill completely, and never for anything a bug could read first.
- **`defer` fires at scope exit, not loop-iteration exit.** N deferred `delete`s
  all running at the end is a leak for the duration of the loop.
- **`context` is copied per call**, so assigning `context.allocator` inside a
  procedure affects that procedure and its callees only — intended, and a
  surprise the first time it does *not* propagate back up to the caller.
- **Temp-allocator memory stored in a struct field** survives exactly until the
  next `free_all`. If a value outlives the frame, it must not come from the temp
  allocator.
- **`using` for pseudo-inheritance.** `using entity: Entity` inside `Frog` looks
  like a base class and creates a name-collision surface that grows silently.
  `-vet-using-stmt` and `-vet-using-param` exist because the community regards it
  as a refactoring tool, not a design tool. Compose with a named field.
- **`string` vs `cstring`.** Converting allocates in one direction and assumes NUL
  in the other. Convert once, at the raylib call.
- **Map iteration order is unspecified** — iterating a map to produce gameplay
  results makes the game non-deterministic and the bug unreproducible. Iterate a
  slice; use the map only for lookup.
- **Shadowing across a scope** compiles silently without `-vet-shadowing`. Turn
  it on, and it never happens again.
- **Integer division and `f32` precision** in gameplay maths — `speed / 2` on an
  `int` truncates. Type your tuning constants.
- **`or_return` needs the enclosing procedure's results named**, or the bare
  `return` inside it will not compile — the error message points at the return,
  not at the missing names.
