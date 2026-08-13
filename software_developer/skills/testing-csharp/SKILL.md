---
name: testing-csharp
description: The C# testing stack for this bundle — xUnit layout and Theory data, fakes over Moq, CsCheck/FsCheck for the input space, Verify for approvals, Testcontainers and WebApplicationFactory for integration, the case-folder runner, coverlet and Stryker.NET, plus the dotnet test filters, VSTEST_HOST_DEBUG and launch configurations for debugging one test or one case. Includes the Unity Test Framework variant for game code. Use before writing or reviewing any C# test.
type: reference
theme: code-craft
best_for:
  - "Choosing between a Theory, a fake and an integration test for a behaviour"
  - "Wiring the human-readable case runner and its debug entry point in .NET"
  - "Testing Unity edit-mode and play-mode code without an engine dependency in the domain"
---

## Purpose

The C# form of `skills/test-driven-development/SKILL.md`. Read
`skills/clean-code-csharp/SKILL.md` first — this file assumes its craft rules,
including the LINQ-in-hot-path rule that also governs test helpers in game code.

Assumes .NET 8/9. The Unity section at the end covers what differs there.

---

## The stack

| Job | Use | Notes |
| --- | --- | --- |
| Runner | **xUnit** (v2 or v3) | The default. NUnit if the repo already uses it — required for Unity |
| Parametrisation | `[Theory]` + `[InlineData]` / `[MemberData]` / `TheoryData<T>` | `TheoryData<T>` is typed; `object[][]` is not |
| Assertions | `Assert` (xUnit), or **Shouldly** / **AwesomeAssertions** | FluentAssertions changed to a paid licence at v8 — check before adding it to a commercial project |
| Fakes | a hand-written class implementing the interface | Compiler-checked; a mock is not |
| Mocking | **NSubstitute** (cleanest syntax) or **Moq** | At your own ports only. Never `Mock<HttpClient>` |
| Property-based | **CsCheck** (fast, excellent shrinking) or **FsCheck.Xunit** | CsCheck also does concurrency testing |
| Approvals | **Verify** (`Verify.Xunit`) | For large text/JSON outputs; prefer a case folder when a human could read it |
| HTTP fakes | a `DelegatingHandler` stub, or **WireMock.Net** | Keeps `HttpClient` real |
| Real dependencies | **Testcontainers** (`Testcontainers.PostgreSql`) | Container per collection, transaction per test |
| Web integration | `WebApplicationFactory<TProgram>` | The real pipeline, in-process, no ports |
| Coverage | **coverlet** (`--collect:"XPlat Code Coverage"`) + ReportGenerator | Diagnostic, not target |
| Mutation | **Stryker.NET** | Scheduled, on the domain core |
| Benchmarks | **BenchmarkDotNet** | Never inside the test suite |
| Time | **`TimeProvider`** (.NET 8+), injected | `FakeTimeProvider` in `Microsoft.Extensions.TimeProvider.Testing` |

---

## Layout

```
src/Billing/…
tests/
  Billing.UnitTests/          LateFeeTests.cs
  Billing.PropertyTests/      LateFeeProperties.cs
  Billing.Cases/              CaseRunner.cs  CaseRunnerTests.cs
                              cases/overdue-invoice-fees/{inputs,outputs,README.md}
  Billing.IntegrationTests/   FeeLedgerRepositoryTests.cs
  CaseDebug/                  Program.cs        # the single-case debug executable
```

Traits make the Makefile targets possible:

```csharp
[Trait("Category", "Integration")]
```

Case data must reach the output directory:

```xml
<ItemGroup>
  <Content Include="cases/**" CopyToOutputDirectory="PreserveNewest" />
</ItemGroup>
```

---

## Constructs, by what you are proving

### One behaviour, several inputs

```csharp
public static TheoryData<int, SkipReason> NotChargeableDays => new()
{
    { -1, SkipReason.NotYetDue },
    {  0, SkipReason.WithinGracePeriod },
    {  5, SkipReason.WithinGracePeriod },   // boundary, inclusive
};

[Theory]
[MemberData(nameof(NotChargeableDays))]
public void Invoice_not_past_grace_is_skipped(int daysOverdue, SkipReason expected)
{
    var invoice = AnInvoice(dueDate: AsOf.AddDays(-daysOverdue));

    var assessment = LateFees.Assess([invoice], Policy, AsOf);

    Assert.Equal(expected, assessment.Skipped.Single().Reason);
}
```

`TheoryData<T>` over `object[][]`: it type-checks, and a renamed enum breaks the
build instead of the run. Add the `6` row — `5` alone cannot distinguish `<=`
from `<`.

### Failures

```csharp
var error = Assert.Throws<InvalidPolicyException>(() => new LateFeePolicy(dailyRateBps: -1));
Assert.Contains("dailyRateBps", error.Message);
```

Assert the type **and** something about the message. `Assert.ThrowsAny<Exception>`
passes when the test itself is broken.

### Fakes over mocks

```csharp
internal sealed class InMemoryInvoiceRepository : IInvoiceRepository
{
    private readonly Dictionary<string, Invoice> _byId;
    public InMemoryInvoiceRepository(params Invoice[] invoices) =>
        _byId = invoices.ToDictionary(i => i.InvoiceId);

    public Invoice? Get(string invoiceId) => _byId.GetValueOrDefault(invoiceId);
    public void Save(Invoice invoice) => _byId[invoice.InvoiceId] = invoice;
}
```

`: IInvoiceRepository` is the point — the compiler keeps the fake honest.

### Async and lifecycle

- `IAsyncLifetime` (`InitializeAsync`/`DisposeAsync`) for per-test setup;
  `IClassFixture<T>` for per-class; `ICollectionFixture<T>` for a shared container.
- `await Assert.ThrowsAsync<T>(...)` — a forgotten `await` makes the test pass
  regardless. Enable `CS4014` as an error in test projects.

---

## Human-readable case folders

Pattern: `skills/human-readable-tests/SKILL.md`. Working code:
`skills/human-readable-tests/assets/csharp/` — `CaseRunner.cs`,
`CaseRunnerTests.cs` (a `[Theory]` whose `MemberData` is the case list, so the
case name is the test's display name), `CaseDebugProgram.cs`, and the `Makefile`.

.NET-specific notes:

- **Canonical JSON**: one `JsonSerializerOptions` with `WriteIndented`, an
  explicit naming policy and `JsonStringEnumConverter`. Compare **strings**, not
  object graphs — the diff then shows the changed line.
- **Normalise line endings** (`ReplaceLineEndings("\n")`) or every case fails on
  Windows the first time someone checks out with `core.autocrlf`.
- `Assert.Skip` (xUnit v3) or `Skip.If` (Xunit.SkippableFact) for the
  `UPDATE_BASELINES` path.
- `MemberData` is enumerated at discovery time, so a missing `cases/` directory
  shows as a discovery error rather than a failure — worth an explicit assertion.

---

## Generated tests

```csharp
[Fact]
[Trait("Category", "Property")]
public void Fee_never_exceeds_the_cap() =>
    Gen.Select(GenInvoices, GenPolicy)
       .Sample((invoices, policy) =>
       {
           var assessment = LateFees.Assess(invoices, policy, AsOf);
           return assessment.Assessed.All(fee => fee.FeeMinorUnits <= CapFor(invoices, fee, policy));
       }, iter: Iterations);
```

- **CsCheck** shrinks well and is fast; its `Sample.Concurrent` finds race
  conditions, which nothing else here does.
- **FsCheck.Xunit** gives `[Property]` attributes if you prefer the classic API.
- Read the iteration count from an environment variable — small on push, large
  nightly. Commit every shrunk counterexample as a named `[Fact]`.

`skills/automatic-test-generation/SKILL.md` has the invariant catalogue.

---

## Integration tests

```csharp
public sealed class PostgresFixture : IAsyncLifetime
{
    public PostgreSqlContainer Container { get; } =
        new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();

    public async Task InitializeAsync()
    {
        await Container.StartAsync();
        await Migrations.RunAsync(Container.GetConnectionString());
    }

    public Task DisposeAsync() => Container.DisposeAsync().AsTask();
}
```

- One container per collection, one transaction per test, rolled back.
- `WebApplicationFactory<Program>` runs the real middleware pipeline in-process:
  model binding, filters, auth, serialisation — the things unit tests cannot see.
- Assert what only the real dependency reveals: `decimal` scale, `timestamptz`
  behaviour, collation, constraint violations.

---

## Running the suite

`skills/human-readable-tests/assets/csharp/Makefile` is the copyable version.

```bash
make test              # format check + build -warnaserror + all layers
make test-unit         # --filter "Category!=Integration&Category!=Case"
make test-cases        # --filter "FullyQualifiedName~CaseRunnerTests"
make test-case CASE=overdue-invoice-fees      # --filter "DisplayName~…"
make props
make cov
make bless
```

The filter syntax is the thing everyone looks up: `FullyQualifiedName~`,
`DisplayName~`, `Category=`, combined with `&` and `|`, quoted. Encode it in the
Makefile once.

---

## Debugging a test — the part that matters

```bash
make debug-case CASE=overdue-invoice-fees     # dotnet run --project tests/CaseDebug
make debug-test K=Refund                      # VSTEST_HOST_DEBUG=1 dotnet test --filter …
```

- **`VSTEST_HOST_DEBUG=1`** makes the test host print its PID and wait for a
  debugger — the reliable way to debug a `dotnet test` run from any editor.
- **The `CaseDebug` console project** is the better entry point for a case: F5,
  one case, no test host on the stack. `skills/human-readable-tests/assets/csharp/CaseDebugProgram.cs`
  has it, with the `launch.json` snippet in its header comment.
- **Visual Studio / Rider**: Debug Test from the gutter; set CaseDebug as the
  startup project with the case name as a launch-profile argument.
- **VS Code**: the C# Dev Kit gives *Debug Test* code lenses; add a `coreclr`
  launch entry pointing at `CaseDebug.dll` for the case flow.
- `System.Diagnostics.Debugger.Launch()` in code when nothing else attaches
  (Windows), and `--blame-hang-timeout 60s` to find which test hung in CI.

---

## Unity and game code

- **Unity Test Framework** wraps NUnit. **Edit mode** tests run without entering
  play mode and are where all domain logic belongs — pure C# with no
  `UnityEngine` types, so they run in milliseconds. **Play mode** tests exercise
  MonoBehaviour lifecycle, physics and coroutines; use `[UnityTest]` returning
  `IEnumerator` with `yield return null` to advance frames.
- **Keep the domain in a plain assembly** with no `UnityEngine` reference. Then it
  is testable with xUnit, in CI, without a licence or a headless editor — and it
  is the reason the case-folder pattern works for game code at all.
- Asmdef references decide what your test assembly can see; a test assembly that
  references the engine cannot be run outside it.
- `Time.deltaTime`, `Random`, `Input` and singletons are the usual untestability
  sources: inject them (see `skills/clean-code-csharp/SKILL.md`).
- Determinism: fix the seed, fix the timestep, and never assert on frame-rate
  dependent values.

---

## C#-specific test traps

- **`Assert.Equal` on collections is order-sensitive**; sort, or use a set
  comparison, and say which you meant.
- **Floating point** — `Assert.Equal(expected, actual, precision)` for doubles;
  `decimal` for money, and beware that `decimal` equality is scale-sensitive in
  some comparisons (`0.5m != 0.50m` for `ToString`, equal for `==`).
- **`DateTime.Now` in a test** is the same defect as in production code: inject
  `TimeProvider`.
- **Culture-dependent formatting** — set `CultureInfo.InvariantCulture` in the
  test project, or a comma decimal separator breaks every baseline in Europe.
- **xUnit runs test classes in parallel** but methods within a class serially.
  Shared static state is the classic flake; `[Collection]` serialises when you
  genuinely need it.
- **`IDisposable` on a test class runs per test method**, not per class — an
  expensive setup there is a slow suite.
- **A forgotten `await`** turns a failing async assertion into a pass.
- **Mocking a concrete class** requires `virtual` members and quietly succeeds
  with default behaviour when they are not — one of the main reasons to prefer
  hand-written fakes.

---

## References

- `skills/clean-code-csharp/SKILL.md`, `skills/design-patterns-csharp/SKILL.md`.
- `skills/test-driven-development/SKILL.md`, `skills/human-readable-tests/SKILL.md`
  (+ `assets/csharp/`), `skills/automatic-test-generation/SKILL.md`,
  `skills/bug-fix-workflow/SKILL.md`.
