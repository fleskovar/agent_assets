// tests/CaseDebug/Program.cs — the debug entry point.
//
// A tiny console project referencing the test project. It exists so a developer
// can press F5 on one case folder and land in the domain code with nothing from
// the test host on the stack — which is the fastest way to learn this module.
//
//   dotnet run --project tests/CaseDebug -- overdue-invoice-fees
//   make debug-case CASE=overdue-invoice-fees
//
// In VS Code, .vscode/launch.json:
//   {
//     "name": "Debug: one human-readable case",
//     "type": "coreclr", "request": "launch",
//     "program": "${workspaceFolder}/tests/CaseDebug/bin/Debug/net9.0/CaseDebug.dll",
//     "args": ["${input:caseName}"], "console": "internalConsole"
//   }
// In Visual Studio / Rider: set CaseDebug as the startup project and put the
// case name in the launch profile's arguments.

using Billing.Tests.Cases;

var caseName = args.Length > 0 ? args[0] : CaseRunner.CaseNames().First();
var caseDir = Path.Combine(CaseRunner.CasesRoot, caseName);

Console.WriteLine($"--- {caseName} ---");

// Breakpoint here, then step into LateFees.Assess. Each iteration of its loop is
// one row of the case README's walkthrough, in the same order.
var outputs = CaseRunner.Run(caseDir);

foreach (var (name, document) in outputs.DocumentsByFileName)
{
    Console.WriteLine($"== {name} ==");
    Console.WriteLine(document);
}
