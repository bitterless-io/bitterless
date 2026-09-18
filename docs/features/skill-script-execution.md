# Running a skill's own script

Status: implemented 2026-09-18. Paired with micromeet-cowork's
[`agent-local-exec.md`](../../micromeet-cowork/docs/features/agent-local-exec.md) 「Skill script
interpreters」 section, which carries the same interpreter contract.

Ral, 2026-09-18:「参考 cowork 和 pi 的实现对齐，run skill 不仅是 bun 也要有 bash 或是 pi 的方式兜底」.

## The gap this closes

Bitterless already staged `bun` (`build/maestro-tools/bun`, surfaced by
`agent/runtime/skillAuthoring.ts`) and `skill_creator` already scaffolded a `scripts/run.mjs` — but
**nothing on this side could execute it**. The identical skill package ran under micromeet-cowork and
was dead weight here, so a skill authored in one app was not portable to the other. Bitterless was also
missing `write_skill_file`, so the agent could scaffold a package and then not fill in its script.

| tool | bitterless before | bitterless now | micromeet-cowork |
|---|---|---|---|
| `skill_creator` | ✅ | ✅ | ✅ |
| `skill_install` | ✅ | ✅ | ✅ |
| `skill_diagnose` | ✅ | ✅ | ✅ |
| `write_skill_file` | ❌ | ✅ | ✅ |
| `run_skill_file` | ❌ | ✅ | ✅ |

## Interpreter choice

| script | interpreter | why |
|---|---|---|
| `.mjs` `.js` `.ts` | **bundled Bun** | First, always. Bun ships with the app, so a user with no developer environment still gets a working skill — that is the reason it is staged at all. |
| `.sh` `.bash` | Pi's `getShellConfig()` | Git Bash lookup on Windows, `/bin/bash` elsewhere. The Agent Skills convention writes helpers as `./scripts/process.sh <input>` (Pi's own documented example), so these must run. |
| `.ps1` | Pi's `getPowerShellConfig()` | Windows only; Pi refuses elsewhere and that refusal is surfaced verbatim. |
| anything else | refused **by name** | Naming the unsupported extension beats handing a Python file to Bun and returning a syntax error the user has to decode. |

Pi's own resolution is reached through the existing narrow build-time bridge
(`piSkillSdk.ts` → `virtual:bitterless-pi-skills`), which is where `loadSkillsFromDir` and
`formatSkillsForPrompt` already come from — no new runtime dependency on Pi's CLI.

**Pi's `args` are deliberately not reused.** They are `-c`, for running a command *string*, and under
`-c` the first operand becomes `$0` — so a script's own `$1` silently comes up empty. We run a *file*,
so the file is the argument. Only the shell *discovery* is borrowed, which is the hard part.

## Boundaries

`skillScriptRunner.service.ts` mirrors micromeet-cowork's envelope, and every interpreter gets the same
one — the fallback widened what can run, not where it can run from:

- **Confined to the package.** Script and package root are both resolved through `realpath`, so a
  symlink under the package cannot smuggle an out-of-tree script past a string prefix check.
- **Availability is the catalog's answer, not the filesystem's.** `run_skill_file` only runs a script
  belonging to a skill that is `ready`, assigned and enabled **in this Chat** — so a disabled or
  unassigned package cannot execute. Institution packages are authorized before the run and the
  context is re-asserted after it, so one revoked mid-call is not the one whose script completed.
- **Clean environment.** The child never inherits this process's environment; input arrives on stdin
  only, never argv or env, so it cannot leak through a process listing.
- **Bounded.** 60 s timeout with a hard kill of the whole process group, 4 MiB output cap, and
  JWT-shaped strings redacted before anything reaches the model.
- **Operator approval.** `run_skill_file` is registered `risk: 'write'` in `hostToolCatalog`, so it
  goes through the existing per-channel confirm gate. This is trusted local code with normal user
  permissions, not a sandbox, and the tool description says so.

`write_skill_file` writes only inside the authoring root — the selected Chat workspace's
`.agents/skills`, otherwise profile Shared, the same rule `skill_creator` has always used and now
shares with it (`authoringScope`). Institution and cloud-managed packages stay read-only, and a
symlink anywhere on the path out is refused rather than followed.

## Verification

`yarn test:skill-script` (`tests/maestro/skillScriptInterpreter.test.mjs`), 7 cases: a real `bash`
execution receiving its arguments, the same script succeeding with **no Bun staged at all**, a real Bun
execution receiving argv and stdin, a JavaScript script without Bun failing by naming the missing
runtime, refusal by name for an unsupported extension, confinement holding for a script outside its
package, and a non-zero exit reported as a failure with its code rather than looking successful.

Not run: Electron/E2E. The tools are verified at the runner and type level; driving them from a live
chat is owner acceptance.
