# Assets: case runners per language

Working runners for the folder layout in `../SKILL.md`. Each one discovers case
folders from disk, calls the system under test, and compares against `outputs/`
with a diff-friendly assertion — so **adding a case is adding a folder**, never
editing a test file.

Every language also ships the two entry points the bundle insists on: a one-word
way to run the suite, and a one-gesture way to debug a single case.

| Language | Files | Framework |
| --- | --- | --- |
| Python | `python/late_fees.py` (reference SUT), `python/case_runner.py`, `python/test_late_fee_cases.py`, `python/Makefile`, `python/launch.json` | pytest, parametrised over case dirs |
| TypeScript | `typescript/run-case.ts`, `typescript/case-runner.test.ts`, `typescript/package.scripts.json`, `typescript/launch.json` | Vitest, `describe.each` |
| C# | `csharp/CaseRunner.cs`, `csharp/CaseRunnerTests.cs`, `csharp/CaseDebugProgram.cs`, `csharp/Makefile` | xUnit `[Theory]` + `MemberData` |
| Odin | `odin/case_runner.odin`, `odin/case_debug.odin`, `odin/Makefile` | `core:testing` |
| Svelte 5 | `svelte5/lateFeesViewModel.svelte.ts` (reference SUT), `svelte5/case-runner.svelte.test.ts` | Vitest + Testing Library |

All five run the same worked example: `../examples/cases/overdue-invoice-fees/`.
Read that folder's `README.md` first — the runners only make sense once you have
seen what they are comparing.

## The shape they share

1. **Discover** case folders from disk, sorted, and derive the test name from the
   folder name so a CI failure names the case.
2. **Load** every file in `inputs/` — including the ones that would otherwise be
   ambient, like `as_of.json`.
3. **Call** the system under test with those values as arguments.
4. **Canonicalise** the result: documented sort order, stable formatting, no
   timestamps or paths.
5. **Compare** one output file at a time, so the failure names the file.
6. **Assert a README exists.** A case folder without one is a golden file, not a
   readable test.
7. **Offer `UPDATE_BASELINES=1`**, and treat its diff as something a human reads
   line by line — never as a way to make a red build green.

## The debug entry point is not optional

Each language has a file whose only job is to run **one** case with no test
framework on the stack — `case_runner.py --main`, `run-case.ts`,
`CaseDebugProgram.cs`, `case_debug.odin`. Being able to breakpoint into a known
input and step through is the most effective way anyone learns a codebase, so
this stays working and stays documented in every case README.

For the rest of each language's stack — mocking, property testing, integration
harnesses, coverage — see `../../testing-<language>/SKILL.md`.
