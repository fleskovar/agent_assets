---
name: design-patterns-csharp
description: The design patterns from the clean-code-developer standard in idiomatic C#, plus the game-programming patterns (Object Pool, Component, State, Command, Flyweight, Type Object, Dirty Flag, Spatial Partition) with their allocation costs. Use when choosing how to structure C# or Unity code, not just how to write a line of it.
type: reference
theme: code-craft
best_for:
  - "Implementing Strategy, Factory, Adapter, Facade or Repository in C#"
  - "Picking a game-programming pattern that does not allocate per frame"
  - "Replacing singleton sprawl in a Unity project with injected services"
---

## Purpose

`subagents/clean-code-developer.md` says to use the well-known patterns and name
them out loud. This file says what each looks like in C#, and adds the
game-programming patterns the GoF book does not cover.

**Read `clean-code-csharp/SKILL.md` first**, especially the LINQ policy. Every
pattern here has a red-zone form and a green-zone form: in a per-frame path, a
pattern that allocates per call is a frame-time bug wearing a good name.

Two C# forces collapse some GoF patterns: **delegates** (a one-method interface is
often a `Func<>`/`Action<>`) and **records + switch expressions** (a closed
hierarchy is often a union with exhaustive dispatch). Two forces push back in
games: **delegates allocate** and **`switch` on a type is a virtual call you can
predict**. Choose per zone.

| Pattern | C# form | Red-zone note |
| --- | --- | --- |
| Strategy | Interface, or `Func<>` in green zone | Interface — a stored `Func<>` is an allocation + a non-inlinable call |
| Factory | A method; `IFactory` when injected | Pool instead of constructing per frame |
| Singleton | Injected instance from the installer | Never `Instance` in a hot loop |
| Adapter | Class implementing a port interface | Adapters are boundary code; keep them out of `Update` |
| Facade | A `sealed class` over a subsystem | Fine — it forwards |
| Decorator | Wrapper implementing the same interface | One extra indirection per call; measure |
| Template Method | `abstract` skeleton + `protected abstract` step | Prefer composition; virtual calls cost |
| Command | `readonly record struct` + handler | Struct, not class, when queued per frame |
| Observer | `event` / `Action<T>`, or `IListener` list | Cache delegates; never subscribe in `Update` |
| State | Cached state objects, or an enum + `switch` | Enum + switch allocates nothing |
| Visitor | `switch` expression over a closed record hierarchy | Fine |
| Builder | Object initialiser or `with` | `with` allocates |
| Repository | Interface + adapter | Not hot-path code |
| Object Pool | `ObjectPool<T>` / `ListPool<T>` | **This is the red-zone pattern** |

---

## Strategy

```csharp
public interface IDamageRule
{
    DamageResult Apply(in DamageEvent damage, in ArmorProfile armor);
}

public sealed class PhysicalDamageRule : IDamageRule { ... }
public sealed class ElementalDamageRule : IDamageRule { ... }
```

- **Green zone**: `Func<DamageEvent, DamageResult>` is fine and shorter.
- **Red zone**: use the interface. A stored `Func<>` is a heap-allocated delegate,
  it cannot be inlined, and if it captures anything it allocates a closure on every
  assignment. An interface call on a cached, sealed implementation devirtualises far
  better.
- Prefer `in` parameters for large structs to avoid the copy, and `readonly struct`
  so the compiler does not defensively copy them anyway.

**Enum + switch expression** is the allocation-free Strategy for a closed set:

```csharp
public static Money Price(PricingRule rule, IReadOnlyList<OrderLine> lines) => rule switch
{
    FlatRate flat     => flat.Amount,
    PerUnit perUnit   => perUnit.UnitPrice * TotalUnits(lines),
    Tiered tiered     => PriceTiered(lines, tiered.Tiers),
    _ => throw new ArgumentOutOfRangeException(nameof(rule)),
};
```

With a sealed record hierarchy the compiler warns on unhandled cases — the
exhaustiveness benefit of a Visitor, in one readable method.

---

## Factory

A method, not a class, unless the factory is itself injected:

```csharp
public interface IEnemyFactory
{
    Enemy Create(EnemyArchetype archetype, Vector3 position);
}
```

In Unity, the factory is where prefab instantiation and pooling live, so nothing
else in the codebase calls `Object.Instantiate`:

```csharp
public sealed class PooledEnemyFactory : IEnemyFactory
{
    private readonly IObjectPool<Enemy> _pool;
    public Enemy Create(EnemyArchetype archetype, Vector3 position)
    {
        Enemy enemy = _pool.Get();
        enemy.Initialize(archetype, position);
        return enemy;
    }
}
```

**Never `Instantiate` or `Destroy` inside gameplay code.** Both allocate, both
churn the GC, and `Destroy` defers to end of frame. Go through the factory, and
have the factory pool.

---

## Adapter and Port

The pattern that does not collapse, and the one that makes a Unity project
testable: the port lives in the domain assembly, the adapter in the Unity
assembly.

```csharp
// Game.Domain — no UnityEngine reference
public interface IInputSource
{
    MoveIntent ReadIntent();
}

// Game.Unity — the only place the Input System exists
public sealed class UnityInputAdapter : IInputSource
{
    public MoveIntent ReadIntent() => new(_actions.Move.ReadValue<Vector2>(), _actions.Jump.WasPressed());
}
```

Same shape for saving (`ISaveStore` → `PlayerPrefs`/file), audio, analytics,
platform services, networking and the clock. The domain then runs in an EditMode
test with fakes, in milliseconds, with no scene.

Assembly definitions make this a compile error rather than a convention — see the
layout section of `clean-code-csharp`.

---

## Observer / events

```csharp
public sealed class Health
{
    public event Action<int> Damaged;                 // green: idiomatic C#
    private void Raise(int amount) => Damaged?.Invoke(amount);
}
```

Rules that matter in a game:

- **Subscribe in `OnEnable`, unsubscribe in `OnDisable`.** Every leaked
  subscription keeps a destroyed object alive and eventually throws through a
  `MissingReferenceException` at an unrelated call site.
- **Never subscribe or unsubscribe in `Update`** — both allocate a delegate.
- Cache the handler in a field if you subscribe repeatedly:
  `private Action<int> _onDamaged;`
- A capturing lambda cannot be unsubscribed (it is a new delegate each time). Use a
  method group.
- For very high-frequency events, an explicit `List<IDamageListener>` iterated by
  index beats a multicast delegate, and is easier to profile.
- **ScriptableObject event channels** are the Unity-idiomatic decoupled Observer:
  an asset both sides reference, so a designer can rewire the graph without code.
  They are also invisible in stack traces — use them for cross-system,
  low-frequency events, not for per-frame data flow.

---

## Object Pool — the red-zone pattern

The most valuable pattern in game code, because it converts a per-frame allocation
into a per-level one.

```csharp
private readonly IObjectPool<Projectile> _pool = new ObjectPool<Projectile>(
    createFunc: () => Instantiate(_prefab),
    actionOnGet: p => p.gameObject.SetActive(true),
    actionOnRelease: p => p.gameObject.SetActive(false),
    defaultCapacity: InitialProjectiles,
    maxSize: MaxProjectiles);
```

- Unity ships `UnityEngine.Pool.ObjectPool<T>`, `ListPool<T>`, `DictionaryPool<T>`;
  .NET ships `ArrayPool<T>.Shared`. Use them rather than writing one.
- **Reset state on release, not on get** — a pooled object carrying stale state is
  the classic pooling bug, and resetting on release makes it visible at the point
  of blame.
- Prewarm to the realistic peak; a pool that grows mid-fight has not helped.
- Pool the *managed* allocations too: the `List<T>` you refill each frame, the
  string builder, the results buffer for `OverlapSphereNonAlloc`.

---

## State machine

```csharp
public enum EnemyState { Idle, Chasing, Attacking, Fleeing }

public EnemyState Tick(EnemyState state, in Perception perception, float deltaTime) => state switch
{
    EnemyState.Idle      when perception.SeesPlayer => EnemyState.Chasing,
    EnemyState.Chasing   when perception.InRange    => EnemyState.Attacking,
    ...
};
```

- The **enum + switch** form allocates nothing, is trivially serialisable for save
  games, and is a pure function you can exhaustively test. Default to it.
- The **state-object** form (`IEnemyState` with `Enter`/`Tick`/`Exit`) earns its
  keep when states carry their own data and behaviour. **Instantiate the states
  once at construction and reuse them** — `new ChasingState()` on every transition
  is a per-transition allocation.
- Hierarchical state machines and behaviour trees are the next step up; do not
  reach for one until a flat machine has genuinely become unreadable.

---

## Command

```csharp
public readonly record struct MoveCommand(EntityId Entity, Vector3 Delta) : IGameCommand;
```

- Commands as **`readonly record struct`** means an input queue or a replay buffer
  costs no GC.
- Command + inverse = undo, which is why this is the level-editor pattern.
- Command + serialisation = deterministic replays and lockstep multiplayer: record
  the input stream, not the world state.
- Keep the *handler* separate from the command data. The command is data; a command
  that executes itself has fused Command with Strategy and cannot be serialised.

---

## Component / composition over inheritance

Unity's `GameObject` + `MonoBehaviour` **is** the Component pattern; using it well
means not fighting it:

- No deep `MonoBehaviour` inheritance chains. `Enemy : Character : Entity :
  MonoBehaviour` is the hierarchy this pattern exists to avoid.
- Small single-purpose components — `Health`, `Movement`, `AggroSensor` — composed
  on a prefab, over one 600-line `EnemyController`.
- Components communicate through injected interfaces or events, not by
  `GetComponent<T>()` in `Update`. Resolve once in `Awake`, cache the field.
- Behaviour that does not need the engine does not belong in a component at all —
  it belongs in the domain assembly, called by a thin component.

---

## Flyweight and Type Object

Shared immutable data referenced by many instances — in Unity, this is what
`ScriptableObject` is for:

```csharp
[CreateAssetMenu(menuName = "Game/Enemy Archetype")]
public sealed class EnemyArchetypeAsset : ScriptableObject
{
    [SerializeField] private int _maxHealth;
    [SerializeField] private float _moveSpeed;

    public EnemyArchetype ToArchetype() => new(_maxHealth, _moveSpeed);
}
```

- **Type Object**: one asset per enemy *kind*, thousands of instances referencing
  it. Designers add a kind without a programmer and without a recompile.
- **Flyweight**: the mesh, material and stat block are shared; only position and
  current state are per-instance.
- Convert to an immutable domain struct at the boundary (`ToArchetype()`) so the
  domain does not depend on `ScriptableObject` — and so nothing mutates a shared
  asset at runtime, which persists in the editor and is a nasty class of bug.

---

## Dirty Flag, Double Buffer, Spatial Partition, Data Locality

The four performance patterns worth knowing by name:

- **Dirty Flag** — recompute only when the input changed. Cached world transforms,
  pathfinding grids, UI text. Cheap and the first thing to try when a per-frame
  computation shows up in the profiler.
- **Double Buffer** — write the next state into a second buffer, swap at end of
  frame. Removes order-dependence between systems and is what makes a simulation
  deterministic.
- **Spatial Partition** — a grid, quadtree or BVH so proximity queries stop being
  O(n²). The moment "find all enemies within X" appears in a per-frame path over a
  growing list, this is the fix, not a faster inner loop.
- **Data Locality** — struct-of-arrays over array-of-structs; contiguous data over
  pointer chasing. This is what Unity DOTS/ECS institutionalises, and what makes
  Burst vectorisation possible at all.

---

## Service Locator: use sparingly, and wrap it once

```csharp
// Tolerable — one static reference in the whole codebase, resolved at bootstrap
public static class Services
{
    public static IAudioService Audio { get; internal set; }
}
```

Service Locator hides dependencies — a class using it has a signature that lies —
so **prefer injection**. When a `MonoBehaviour` really cannot be reached by the
installer, the locator is the fallback, under two conditions:

1. It is populated in exactly one place (the composition root / bootstrap scene).
2. It is read in `Awake`/`Start` into a field, never in `Update`, and never deep
   inside domain logic.

`GameManager.Instance` sprinkled through forty files is the failure mode this rule
exists to prevent — and the agent's "statics get exactly one reference" rule is
what it looks like when followed.

---

## Composition root in Unity

```csharp
public sealed class GameInstaller : MonoBehaviour
{
    [SerializeField] private GameConfigAsset _config;
    [SerializeField] private EnemySpawner _spawner;

    private void Awake()
    {
        IClock clock = new UnityClock();
        var pool = new ObjectPool<Enemy>(...);
        IEnemyFactory factory = new PooledEnemyFactory(pool, _config.ToSettings());

        _spawner.Construct(factory, clock);
    }
}
```

One bootstrap scene, one installer per feature area, everything else receives what
it needs. If the project already uses VContainer, Zenject or Reflex, use it; do not
introduce one otherwise.

---

## Anti-patterns

- **Singleton sprawl** — `Manager.Instance` referenced from everywhere. Untestable,
  order-dependent, and it makes every scene load a lottery.
- **God `MonoBehaviour`** — a 600-line controller doing input, movement, combat,
  audio and UI.
- **Deep MonoBehaviour inheritance** instead of composition.
- **`new`ing per frame** — states, commands, comparers, lists, strings, closures.
  All of it pools or caches.
- **`GetComponent`, `FindObjectOfType`, `Camera.main` in `Update`.** Resolve once.
- **A `Func<>` field in a hot path** — an allocation and a call the JIT will not
  inline.
- **`IManager`/`IHelper`/`IService` interfaces with one implementation** that
  exists only because "interfaces are good". If it is not a boundary, it is noise.
- **Commands that execute themselves**, so they cannot be logged or replayed.
- **Event subscriptions without unsubscription** — the most common source of
  `MissingReferenceException` in a shipped Unity build.
- **Mutating a `ScriptableObject` at runtime** — the change persists in the editor
  and silently rewrites your designers' data.
