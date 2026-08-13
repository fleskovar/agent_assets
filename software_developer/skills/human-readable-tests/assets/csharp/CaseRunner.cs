// inputs/ on disk -> the output documents a case expects, keyed by filename.
//
// Deliberately free of xUnit: the same class backs the [Theory], the baseline
// regenerator, and the console debug entry point in CaseDebug/Program.cs. That
// entry point is what a developer learning this module attaches a debugger to —
// one case, one call stack, no test-host frames.

using System.Text.Json;
using System.Text.Json.Serialization;
using Billing.Domain;

namespace Billing.Tests.Cases;

public sealed record CaseOutputs(IReadOnlyDictionary<string, string> DocumentsByFileName);

public static class CaseRunner
{
    public const string InputsDir = "inputs";
    public const string OutputsDir = "outputs";

    private static readonly JsonSerializerOptions CanonicalJson = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower) },
    };

    public static string CasesRoot { get; } =
        Path.Combine(AppContext.BaseDirectory, "cases");

    /// <summary>Every case folder, sorted. Adding a case is adding a folder.</summary>
    public static IEnumerable<string> CaseNames() =>
        Directory.EnumerateDirectories(CasesRoot)
            .Where(dir => Directory.Exists(Path.Combine(dir, InputsDir)))
            .Select(Path.GetFileName)
            .OrderBy(name => name, StringComparer.Ordinal)!;

    public static CaseOutputs Run(string caseDir)
    {
        var inputs = Path.Combine(caseDir, InputsDir);
        var invoices = ReadJson<IReadOnlyList<Invoice>>(Path.Combine(inputs, "invoices.json"));
        var policy = ReadJson<LateFeePolicy>(Path.Combine(inputs, "policy.json"));
        var asOf = ReadJson<AsOf>(Path.Combine(inputs, "as_of.json")).AsOfDate;

        var assessment = LateFees.Assess(invoices, policy, asOf);

        return new CaseOutputs(new Dictionary<string, string>
        {
            ["assessed_fees.json"] = Canonicalise(assessment.Assessed),
            ["skipped.json"] = Canonicalise(assessment.Skipped),
        });
    }

    public static IReadOnlyDictionary<string, string> ReadBaselines(string caseDir) =>
        Directory.EnumerateFiles(Path.Combine(caseDir, OutputsDir), "*.json")
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToDictionary(Path.GetFileName!, path => File.ReadAllText(path).ReplaceLineEndings("\n").TrimEnd() + "\n");

    /// <summary>Only ever called behind UPDATE_BASELINES=1, and its diff gets read by a human.</summary>
    public static void WriteBaselines(string caseDir, CaseOutputs actual)
    {
        var outputs = Path.Combine(caseDir, OutputsDir);
        Directory.CreateDirectory(outputs);
        foreach (var (name, document) in actual.DocumentsByFileName)
        {
            File.WriteAllText(Path.Combine(outputs, name), document);
        }
    }

    private static string Canonicalise<T>(T value) =>
        JsonSerializer.Serialize(value, CanonicalJson).ReplaceLineEndings("\n") + "\n";

    private static T ReadJson<T>(string path) =>
        JsonSerializer.Deserialize<T>(File.ReadAllText(path), CanonicalJson)
        ?? throw new InvalidDataException($"{path} deserialised to null");

    private sealed record AsOf(DateOnly AsOfDate);
}
