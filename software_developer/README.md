# ts-review-kit

A sample bundle showing every resource kind `hcm` understands.

| Resource | File | Becomes |
| --- | --- | --- |
| agent | `agents/code-reviewer.md` | `.claude/agents/`, `.github/agents/`, `.reasonix/agents/` |
| skill | `skills/dependency-audit/` | `.claude/skills/`, `.github/skills/`, `.reasonix/skills/` |
| command | `commands/review-pr.md` | `.claude/commands/`, `.github/prompts/`, `.reasonix/commands/` |
| rule | `rules/typescript.md` | `.claude/rules/`, `.github/instructions/`, `.reasonix/rules/` |
| context | `context/conventions.md` | `CLAUDE.md`, `.github/copilot-instructions.md`, `REASONIX.md` |
| mcp | `mcp/filesystem.json` | `.mcp.json`, `.vscode/mcp.json`, `reasonix.toml` |
| settings | `settings/settings.json` | `.claude/settings.json`, `.github/copilot/settings.json`, `reasonix.toml` |

## Testing and bug-fixing resources

Test-driven development, the human-readable test-case format, and the defect loop.

| Kind | Item | What it is for |
| --- | --- | --- |
| agent | `subagents/test-engineer.md` | Designs and writes a feature's suite across all five layers |
| agent | `subagents/test-design-reviewer.md` | Sr. Dev / Tech Lead gate: validates a test design **before** implementation |
| agent | `subagents/bug-fixer.md` | Runs the defect loop: reproduce → classify the test gap → gate → test → fix |
| skill | `skills/test-driven-development/` | The loop, the five layers, the test user stories every feature carries, the run/debug entry points |
| skill | `skills/human-readable-tests/` | `inputs/` + `outputs/` + `README.md` case folders a developer can solve by hand — with a worked example and runners for all five languages |
| skill | `skills/automatic-test-generation/` | Property-based, metamorphic, differential, stateful, fuzzing, and mutation testing |
| skill | `skills/bug-fix-workflow/` | Bug → investigation → test-gap classification → design review → proof-of-fix → fix |
| skill | `skills/testing-python\|typescript\|csharp\|odin\|svelte5/` | Frameworks, layout, Makefile targets and debugger entry points per language |

Start with `skills/human-readable-tests/examples/cases/overdue-invoice-fees/` — a
complete case folder whose walkthrough you can check with a calculator. Every
other example in the bundle uses the same module.

## Try it

```bash
hcm registry add ./bundles/ts-review-kit
hcm info ts-review-kit                 # see where every item would land
hcm install ts-review-kit --dry-run    # confirm without writing
hcm install ts-review-kit -t claude-code
hcm uninstall ts-review-kit -t claude-code
```
