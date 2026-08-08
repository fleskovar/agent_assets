---
name: clean-code-csharp
description: Idiomatic C# for the clean-code-developer standard, tuned for game development — records and readonly structs instead of dictionaries, a hard LINQ allocation policy for hot paths, assembly-definition boundaries, MonoBehaviour-free domain logic, injected dependencies without singleton sprawl, Burst/Jobs vectorization, NUnit. Use before writing or refactoring any C#, Unity or otherwise.
type: reference
theme: code-craft
best_for:
  - "Writing Unity game code that does not allocate per frame"
  - "Deciding whether LINQ is acceptable in a given piece of C#"
  - "Structuring a Unity project so the logic is testable without the engine"
---

## Purpose

The language-specific form of `subagents/clean-code-developer.md` for C#.
That file states the rules; this one states what they look like in C#, where the
game-development constraints override them, and which tools enforce them.

Assumes C# 10+ / .NET 6+, or Unity 2022 LTS and newer.

**Read the LINQ section before writing any C#.** It is the one place where the
agent's "prefer expressions over loops" default is actively wrong, and getting it
wrong in a game costs frames.

---

## The LINQ policy

LINQ is expressive, readable, and — in a per-frame code path — one of the most
reliable ways to drop frames on a console or a phone. Both halves of that sentence
are true, so the rule is a zoning rule, not a ban.

### Why it costs

Every LINQ call site can allocate on the managed heap, and in a game the cost is
not the allocation, it is the **garbage collection spike** that follows it a few
hundred frames later:

- **Iterator objects.** Each operator (`Where`, `Select`, `OrderBy`, …) allocates a
  state machine object per call. A three-operator chain is three allocations, every
  time the line runs.
- **Boxed enumerators.** `List<T>` has a *struct* enumerator, so `foreach` over a
  `List<T>` allocates nothing. The moment the collection is typed as
  `IEnumerable<T>` — which is exactly what LINQ returns — the enumerator is boxed
  and you allocate. This is why `IEnumerable<T>` in a hot-path signature is itself
  the bug.
- **Delegates and closures.** A lambda that captures a local or `this` allocates a
  closure object plus a delegate, per call.
- **Materialisation.** `ToList()` / `ToArray()` allocate an array — often two, if
  it grows.
- **Deferred execution surprises.** A LINQ query is re-run on every enumeration.
  Enumerating a chain twice silently doubles the work, and if the source mutates in
  between the two results disagree.

Unity's IL2CPP/mono GC is not generational the way server .NET is; a steady drip of
small per-frame garbage produces periodic collection pauses that show up as
stutter, and on mobile that is the difference between shipping and not.

### The zones

**Green — use LINQ freely, it is the clearer code:**

- Editor tooling, build scripts, asset post-processors, custom inspectors.
- Load-time and initialisation: parsing config, building lookup tables, wiring the
  composition root, level setup before the first frame renders.
- Non-realtime application code — CLI tools, backend services, ASP.NET request
  handlers, anything where an allocation is not a frame budget.
- Tests. Readability is the whole point there.

**Red — no LINQ, no exceptions:**

- `Update`, `FixedUpdate`, `LateUpdate`, `OnGUI`, animation and physics callbacks.
- Anything called per entity per frame, per particle, per tile, per projectile.
- Coroutine bodies that run every frame, and anything inside a job or Burst-compiled
  code (LINQ is not even available there).
- Any method a red-zone caller reaches, however deep. **The zone is a property of
  the call graph, not of the file.** A helper that looks harmless is red if
  `Update` can reach it.

**Amber — measure, then decide:** loading screens with a frame budget, scene
transitions, per-frame code that runs on a small fixed collection you can prove is
tiny. When in doubt, treat it as red; the loop version is rarely worse to read.

Mark the boundary in code so the next reader does not have to re-derive it:

```csharp
// HOT PATH: runs per enemy per frame. No LINQ, no lambdas, no allocations.
public void Tick(float deltaTime) { ... }
```

### What to write in the red zone

```csharp
// No — three iterator allocations, a closure, and a boxed enumerator, every frame
var nearest = _enemies
    .Where(e => e.IsAlive && Vector3.Distance(e.Position, playerPos) < AggroRadius)
    .OrderBy(e => Vector3.Distance(e.Position, playerPos))
    .FirstOrDefault();

// Yes — zero allocations, one pass, and it reads fine
Enemy nearest = null;
float nearestSqr = AggroRadiusSqr;
for (int i = 0; i < _enemies.Count; i++)
{
    Enemy enemy = _enemies[i];
    if (!enemy.IsAlive) continue;

    float sqr = (enemy.Position - playerPos).sqrMagnitude;
    if (sqr < nearestSqr)
    {
        nearestSqr = sqr;
        nearest = enemy;
    }
}
```

Note the second win: the loop compares **squared** distances and calls no `Sqrt` at
all, which the LINQ version made easy to miss. Hot-path loops routinely expose an
algorithmic improvement the query hid.

Red-zone toolkit:

- **Index over a concrete `List<T>` or array**, not `foreach` over `IEnumerable<T>`.
  If you must `foreach`, type the variable as the concrete collection so the struct
  enumerator is used.
- **`Count > 0` instead of `.Any()`**, `list[0]` instead of `.First()`,
  `list.Contains(x)` on a concrete list, `Dictionary.TryGetValue` instead of
  `.FirstOrDefault(kv => …)`.
- **Cache the delegate** when you genuinely need one:
  `static readonly Comparison<Enemy> ByDepth = (a, b) => …;` then
  `list.Sort(ByDepth)`. Passing a lambda literal to `Sort` allocates one per call.
- **`static` lambdas** (`static e => e.Id`) so the compiler rejects an accidental
  capture of `this`.
- **Pool the buffers**: `UnityEngine.Pool.ListPool<T>`, `ArrayPool<T>.Shared`, or a
  preallocated field-level `List<T>` you `Clear()` and refill.
- **Non-allocating engine APIs**: `Physics.RaycastNonAlloc`,
  `OverlapSphereNonAlloc`, `GetComponents(List<T> results)`,
  `Mesh.GetVertices(List<Vector3>)`.
- **No string work per frame**: interpolation, `ToString()`, `Enum.ToString()` and
  concatenation all allocate. Cache the string, use a `StringBuilder`, or update
  the label only when the value changes.
- **Cache `Camera.main`, `Time.deltaTime` reads, component lookups, and
  `Animator.StringToHash` / `Shader.PropertyToID` results** in fields.

### The honest trade

Writing the loop costs you six lines and buys a fixed frame cost. Do not pay that
tax in the green zone: a build script that runs once is *better* as a LINQ chain,
and rewriting it as a loop is the same mistake in the other direction. The rule is
"LINQ where clarity is the scarce resource, loops where frame time is".

---

## Typed containers, not dictionaries

| Need | Use |
| --- | --- |
| Immutable reference value object | `sealed record` |
| Small immutable value, hot path, no GC | `readonly record struct` / `readonly struct` |
| Entity with identity and mutable state | `sealed class` with private setters |
| Designer-authored config data (Unity) | `ScriptableObject` |
| Genuine key→value collection, unknown keys | `Dictionary<TKey, TValue>` — legitimate |

```csharp
// No — the caller guesses the keys; nothing can rename or check them
public float PriceOrder(Dictionary<string, object> order, Dictionary<string, object> opts);

// Yes
public readonly record struct OrderLine(Sku Sku, int Quantity, decimal UnitPrice);

public sealed record PricingOptions(Currency Currency = Currency.Usd, bool IncludeTax = true);

public Money PriceOrder(IReadOnlyList<OrderLine> lines, PricingOptions options);
```

- `readonly record struct` is the game-dev workhorse: value semantics, equality,
  deconstruction, and **no heap allocation**. Use it for ids, coordinates, damage
  events, anything small and copied often.
- `record` gives `with` expressions for non-destructive updates — excellent in the
  green zone, allocating in the red zone.
- Wrap primitive ids: `readonly record struct EntityId(int Value)` makes
  `Damage(EntityId, int)` impossible to call with the arguments swapped.
- `IReadOnlyList<T>` / `IReadOnlyDictionary<>` in signatures says "I will not
  mutate this" — but see the LINQ section: in the red zone take the concrete type
  so the struct enumerator survives.
- Do not return tuples from public methods. `(bool, string, int)` is a dictionary
  with worse names.

---

## Constants and enums

```csharp
// No
if (other.CompareTag("Player") && _hits > 3)
    _animator.SetTrigger("Die");

// Yes
private const string PlayerTag = "Player";
private const int HitsBeforeDeath = 3;
private static readonly int DieTrigger = Animator.StringToHash("Die");

if (other.CompareTag(PlayerTag) && _hits > HitsBeforeDeath)
    _animator.SetTrigger(DieTrigger);
```

- `const` for compile-time values, `static readonly` for everything else
  (including anything computed, like hashed animator/shader ids).
- `enum` for closed sets; never a `string` state code.
- **Animator parameters, shader properties, tags, layers, scene names, input
  actions and PlayerPrefs keys are all magic strings.** Hash them once into
  `static readonly` fields; a typo then fails at one place instead of silently
  doing nothing at runtime.
- Tunable game values belong in a `ScriptableObject` config asset, not as literals
  in a MonoBehaviour — designers change them without a recompile, and the values
  stop being scattered.

---

## Keep the engine out of the logic

The single highest-value structural decision in a Unity project: **the game rules
are plain C# with no `using UnityEngine`, and MonoBehaviours are thin adapters.**

```
Assets/Scripts/
  Game.Domain/          Game.Domain.asmdef            # no UnityEngine reference
    Combat/             DamageResolver.cs  Health.cs
    Economy/            Inventory.cs  Recipe.cs
  Game.Application/     Game.Application.asmdef       # use cases, orchestration
  Game.Unity/           Game.Unity.asmdef             # MonoBehaviours, adapters
    Combat/             EnemyView.cs  HealthBarView.cs
    Bootstrap/          GameInstaller.cs              # composition root
  Game.Domain.Tests/    Game.Domain.Tests.asmdef      # EditMode, milliseconds
```

**Assembly definitions make the dependency arrows compile-enforced** — this is
C#'s best feature for this standard. `Game.Domain.asmdef` referencing nothing
means a `using UnityEngine;` in domain code is a build error, not a review comment.
It also cuts iteration time: only the changed assembly recompiles.

```csharp
// Domain: pure, testable in EditMode in microseconds, no engine, no statics
public static class DamageResolver
{
    public static DamageResult Resolve(Health health, DamageEvent damage, ArmorProfile armor)
    { ... }
}

// Unity: the adapter. Reads engine state, calls the rule, writes engine state.
public sealed class EnemyView : MonoBehaviour
{
    [SerializeField] private ArmorProfileAsset _armor;
    private Health _health;

    public void ApplyDamage(DamageEvent damage)
    {
        DamageResult result = DamageResolver.Resolve(_health, damage, _armor.ToProfile());
        _health = result.Health;
        if (result.IsDead) _animator.SetTrigger(DieTrigger);
    }
}
```

Rules of the split:

- Domain takes `float deltaTime` as a **parameter**; it never reads `Time.deltaTime`.
- Domain never reads `Input`, `Random`, `Time`, `Camera`, or a `Physics` call —
  those are adapter concerns, passed in as data or behind an interface.
- `Vector3`/`Quaternion` are a grey area: they are structs in `UnityEngine.dll`, so
  using them pulls the engine reference into your domain assembly. For a gameplay
  codebase that is usually an acceptable trade — decide once, write it down in the
  project's CLAUDE.md, and be consistent.

---

## Explicit dependencies without singleton sprawl

**Plain C# classes**: constructor injection, `readonly` fields, `sealed` by default.

```csharp
public sealed class ChargeInvoice
{
    private readonly IPaymentGateway _gateway;
    private readonly IClock _clock;

    public ChargeInvoice(IPaymentGateway gateway, IClock clock)
    {
        _gateway = gateway;
        _clock = clock;
    }

    public ChargeResult Execute(ChargeRequest request) { ... }
}
```

**MonoBehaviours cannot have constructors.** Use an explicit init method called by
the composition root, and treat an uninitialised component as a bug:

```csharp
public sealed class EnemySpawner : MonoBehaviour
{
    private IEnemyFactory _factory;
    private IClock _clock;

    public void Construct(IEnemyFactory factory, IClock clock)
    {
        _factory = factory;
        _clock = clock;
    }
}
```

- **`[SerializeField]` is for data and scene references** — prefabs, config assets,
  transforms. It is not a substitute for injecting logical collaborators.
- **Never `FindObjectOfType`, `GameObject.Find` or `Camera.main` in a hot path**,
  and preferably not at all outside bootstrap. Resolve once, cache in a field.
- **One composition root**: a bootstrap scene with a `GameInstaller` that builds the
  concrete services and hands them to the objects that need them. If the project
  already uses VContainer, Zenject or Reflex, use it; do not add one otherwise.
- **Statics and singletons get exactly one reference each.** If a global manager is
  unavoidable, wrap it behind an interface, resolve it in the installer, and inject
  the interface — so `GameManager.Instance` appears once in the codebase instead of
  in forty files.
- **`static` mutable state does not survive domain reload settings and breaks
  tests.** Prefer an instance owned by the installer.

---

## Functional C#

- `static` methods with no captured state for anything that is a calculation.
- `readonly record struct` and `readonly struct` for immutable values — immutability
  without GC.
- `switch` expressions and pattern matching over `if` ladders and type-code
  switches; the compiler warns on a non-exhaustive enum switch.
- Expression-bodied members for one-liners.
- `with` expressions for non-destructive update — green zone only.
- `TryX(out T)` or a `Result<T>` type for failure; never `null` as "not found"
  without nullable annotations, and never a magic `-1`.

**Where to stop.** No custom `Pipe`/`Bind` extension methods, no functional-library
dependency, no `Func<>` chains — every `Func<>` you store is a delegate allocation
and an indirection the JIT cannot inline. `Enumerable`-heavy "functional" C# and
game performance are in direct conflict; when they meet, performance wins in the
red zone and clarity wins in the green zone.

---

## Vectorization

C#'s "free vectorisation" is not LINQ; it is data layout plus the job system.

- **Unity Burst + Jobs**: `IJobParallelFor` over `NativeArray<T>` with
  `Unity.Mathematics` (`float3`, `math.*`) compiles to SIMD. Burst also *enforces*
  this file's style — no managed allocation, no LINQ, no reference types — so a
  jobified system is the good version by construction.
- **Struct-of-arrays over array-of-structs** for anything you process in bulk. It
  is what makes both SIMD and the cache work; DOTS/ECS is this idea taken all the
  way.
- **`Span<T>` / `ReadOnlySpan<T>`** for slicing without copying, and
  `stackalloc` for small scratch buffers with no GC at all.
- **`System.Numerics.Vector<T>`** and `System.Runtime.Intrinsics` outside Unity.
- **Batch at the engine level too**: `Graphics.DrawMeshInstanced`,
  `MaterialPropertyBlock` instead of per-renderer material access (which
  instantiates a material and leaks it), one combined mesh instead of N draw calls.

Do not jobify twelve objects, and do not restructure to SoA before profiling says
the loop matters. Free means free.

---

## Tests

NUnit (Unity Test Framework) or xUnit. **Additive only** — never edit an existing
test to make your change pass.

```csharp
[Test]
public void Refund_Over_Original_Amount_Is_Rejected()
{
    var invoice = new Invoice(new InvoiceId("inv_1"), new Money(100m, Currency.Usd));

    RefundResult result = RefundPolicy.Issue(invoice, new Money(150m, Currency.Usd));

    Assert.That(result.Error, Is.EqualTo(RefundError.ExceedsTotal));
}
```

- **EditMode tests over the domain assembly** are the ones that pay: no scene, no
  play loop, thousands in a second. That is the return on keeping logic out of
  MonoBehaviours.
- **PlayMode tests** for genuine engine integration only — spawning, physics,
  scene loading. They are slow; keep them few and meaningful.
- `[TestCase(...)]` for the same behaviour over multiple inputs.
- Fake implementations of your interfaces beat mocking frameworks — they compile,
  they refactor, and they read.
- Determinism: inject the clock and the RNG seed. A test that depends on
  `UnityEngine.Random` or wall-clock time is a future flake.
- Allocation is testable: `Assert.That(() => system.Tick(dt), Is.Not.AllocatingGCMemory())`
  (Unity Test Framework) pins a hot path so a future LINQ chain fails CI instead of
  the frame budget.

---

## Tooling

```bash
dotnet format
dotnet build -warnaserror
dotnet test
```

- **`<Nullable>enable</Nullable>`** and **`<TreatWarningsAsErrors>true</TreatWarningsAsErrors>`**.
  Nullable reference types are what make "no null sentinels" checkable.
- `.editorconfig` with the Roslyn analyzer rules turned on; Unity supports Roslyn
  analyzers per assembly definition — that is where you can make "no LINQ in this
  assembly" an actual build error for a hot-path assembly.
- Rider / ReSharper inspections catch the allocation patterns (closure allocation,
  boxed enumerator, delegate allocation) that no compiler warning covers. The
  "Heap Allocations Viewer" is the fastest way to see this file's LINQ section in
  practice.
- **Unity Profiler, `GC Alloc` column**, on a build, on the target device. A
  per-frame allocation of 0 B is the goal for red-zone systems. `Profiler.BeginSample`
  around a suspect system; BenchmarkDotNet outside Unity.
- Suppress narrowly and with a reason: `#pragma warning disable CS0649 // set by Unity serialization`,
  re-enabled immediately after.

---

## C#-specific traps

- **`IEnumerable<T>` in a hot-path signature** boxes the enumerator at every call
  site. Take `List<T>` or `T[]`.
- **`struct` that is not `readonly`** gets defensively copied on every member access
  through a `readonly` field or an interface. Mark value types `readonly`.
- **Boxing**: a struct assigned to `object` or an interface, an enum used as a
  `Dictionary` key without a custom comparer (fixed in modern .NET, still a trap in
  older IL2CPP), `string.Format` with value-type arguments.
- **`async void`** — uncatchable exceptions. Only for event handlers, never
  otherwise. In Unity prefer UniTask or coroutines over `Task` in gameplay code.
- **Unity `==` is overloaded**: a destroyed object compares equal to `null` but is
  not null. `?.` and `??` bypass that overload and lie. Use an explicit `== null`
  check on Unity objects.
- **`new Material(...)` / touching `renderer.material`** instantiates and leaks;
  use `sharedMaterial` or a `MaterialPropertyBlock`.
- **Coroutines capturing `this`** keep destroyed objects alive; `StopCoroutine` on
  disable.
- **`OnValidate`, field initialisers and static constructors** run in the editor at
  surprising times — no I/O, no allocation-heavy work there.
- **`float` equality and accumulated `deltaTime` drift** — compare with an epsilon
  constant, and prefer a fixed timestep for anything that must be deterministic.
