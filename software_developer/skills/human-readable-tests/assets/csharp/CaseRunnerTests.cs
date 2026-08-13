// xUnit runner for human-readable case folders.
//
//   make test-cases
//   dotnet test --filter "DisplayName~overdue-invoice-fees"
//   dotnet test --filter "DisplayName~overdue-invoice-fees" -- --debug   (or attach to CaseDebug)
//
// One [Theory] datum per case folder, discovered from disk, so adding a case is
// adding a folder — never editing this file. The case name is the test's display
// name, so a failure in CI names the case.
//
// Copy the `cases/` tree into the output directory so AppContext.BaseDirectory
// finds it:
//   <ItemGroup>
//     <Content Include="cases/**" CopyToOutputDirectory="PreserveNewest" />
//   </ItemGroup>

using Xunit;

namespace Billing.Tests.Cases;

public sealed class CaseRunnerTests
{
    private static bool UpdateBaselines =>
        Environment.GetEnvironmentVariable("UPDATE_BASELINES") == "1";

    public static TheoryData<string> Cases()
    {
        var data = new TheoryData<string>();
        foreach (var name in CaseRunner.CaseNames())
        {
            data.Add(name);
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void Case_matches_its_baseline_outputs(string caseName)
    {
        var caseDir = Path.Combine(CaseRunner.CasesRoot, caseName);

        var actual = CaseRunner.Run(caseDir);

        if (UpdateBaselines)
        {
            CaseRunner.WriteBaselines(caseDir, actual);
            Assert.Skip($"baselines regenerated for {caseName} — read the diff before committing");
        }

        var expected = CaseRunner.ReadBaselines(caseDir);
        Assert.Equal(expected.Keys.Order(), actual.DocumentsByFileName.Keys.Order());

        // One assertion per output file, so the failure names the file that broke.
        foreach (var (name, document) in expected)
        {
            Assert.Equal(document, actual.DocumentsByFileName[name]);
        }
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void Case_is_documented(string caseName)
    {
        // A case folder without a README is a golden file, not a readable test.
        var readme = Path.Combine(CaseRunner.CasesRoot, caseName, "README.md");

        Assert.True(File.Exists(readme), $"{caseName} has no README.md");
    }
}
