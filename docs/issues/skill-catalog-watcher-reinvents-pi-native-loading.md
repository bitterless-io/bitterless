# Skill discovery re-implements Pi's own skill loader — and never stops watching

Status: Implemented and code verified; owner application testing pending. Reported 2026-09-17 (Ral, directly, not via BotAndI — this redirects work this same
session already resolved as "done"). Scope: `src/main/maestro/skills/skillDiscovery.service.ts` and its
host stub in `src/main/agent/runtime/piRuntimeProtocol.ts`. Paired project: [micromeet-cowork's copy of
this issue](../../../micromeet-cowork/docs/issues/skill-catalog-watcher-reinvents-pi-native-loading.md).

## Owner direction (2026-09-17)

Ral: for the agent skill capability, stop building our own skill directory-watching / registry-scanning
solution — use the Pi SDK's native skill-loading capability directly. The host's job is only to
correctly configure where skills come from (the source roots). Watching a skill directory caused
performance problems before and must not happen again; properly reference how Pi imports/loads/manages/
creates/updates skills instead of inventing our own mechanism.

## What is actually there today

`describeSkillFile`, `discoverSkillFiles`, `workspaceSkillRoots` (`skillDiscovery.service.ts:1-101`)
hand-roll: a recursive directory walker with symlink dedup, a YAML-frontmatter parser + validator
(name/description required, optional `agents/openai.yaml` sidecar), and a project-root discovery rule
that walks from `cwd` to the nearest `.git` ancestor. All three duplicate documented Pi behavior verbatim
(see below).

`SkillDirectoryWatcher` (`skillDiscovery.service.ts:116-151`) arms one `fs.watch` per discovered skill
directory with a 300ms debounce (cheap, fine) **plus** a `setInterval(..., 1000)` fallback poll
(`:127-133`) that calls `sourceSignature()` (`:104-114`) — a full recursive `stat` + content hash of
*every file under every configured skill root* — once per second, for the lifetime of the process,
whether or not anything changed. The paired `micromeet-cowork` implementation
(`apps/cowork/src/main/skills/skillCatalog.service.ts: SkillCatalogWatcher`, `:115-143`) has the same
shape at a 1500ms interval, and is the one
[the main-process OOM investigation](../../../micromeet-cowork/docs/issues/main-process-oom-3.6gb-after-38-minutes.md)
already named directly: "re-walks and SHA-256s every skill package forever while nobody is using the
app… real, armed, silent, and genuinely wasteful." That investigation did not prove this watcher caused
the 3.6 GB OOM, but it independently confirmed the mechanism itself is exactly the wasteful pattern Ral
is now redirecting away from.

Meanwhile the host deliberately throws away Pi's own equivalent capability: `createPiResourceLoader`
(`piRuntimeProtocol.ts:9-21`) returns `getSkills: () => ({ skills: [], diagnostics: [] })` and
`reload: async () => undefined` — a stub, on purpose, so Pi's own skill loader never runs and the
registry is "the only source of truth" (this was itself the approved design in
[docs/features/skills-three-sources.md](../features/skills-three-sources.md) #1's implementation
appendix). That decision is what this issue reverses.

## What Pi already provides (read directly from the installed package this session)

Bitterless already depends on the real Pi coding-agent SDK — `@earendil-works/pi-coding-agent` 0.85.1 +
`@earendil-works/pi-agent-core` (same product as the global `pi` CLI, v0.80.3, `--skill <path>` /
`--no-skills`). Its skill capability is not a stub:

- `pi-agent-core/dist/harness/skills.d.ts`: `loadSkills(env, dirs, context)` — plain recursive scan,
  "missing input directories are skipped," no watcher, no polling. `loadSourcedSkills(env, inputs:
  Array<{path, source}>, mapSkill, context)` — source tags pass through untouched to every loaded skill
  and diagnostic; "the agent package does not interpret source values; applications define their own
  provenance shape." This is exactly the primitive for our `layer=global|workspace|institution` model:
  `[{path: globalRoot, source: 'global'}, {path: workspaceRoot, source: 'workspace'}, {path:
  institutionRoot, source: 'institution'}]`.
- `pi-coding-agent/dist/core/skills.d.ts`: `DefaultResourceLoader` — constructed with `{cwd, agentDir,
  skillsOverride}`; `.reload()` rescans **on demand** (an explicit call, not a background watcher);
  `.getSkills()` reads the current in-memory snapshot; `skillsOverride: (current) => {...}` filters/
  merges/injects synthetic `Skill` objects (the extension point for institution cloud packages, which
  aren't plain fs directories). `formatSkillsForPrompt(skills, fileReadTool)` renders the XML-per-
  [Agent Skills standard](https://agentskills.io/integrate-skills) system-prompt block — the design doc
  already commits to following that same standard (its #1 citation of
  [OpenAI Build skills](https://learn.chatgpt.com/docs/build-skills)), so this replaces our own
  hand-formatted block in `agentPrompt.ts: selectAgentSkillBriefs` instead of diverging from it.
- `pi-coding-agent/docs/skills.md`: the discovery rule our `workspaceSkillRoots` reimplements verbatim
  ("`.agents/skills` in `cwd` and ancestor directories up to git repo root"), and the frontmatter
  validation rule our `describeSkillFile` reimplements verbatim (required name/description, optional
  `agents/openai.yaml` sidecar, unknown fields ignored). Also: "pi can create skills. Ask it to build one
  for your use case" — skill authoring is agent-driven, not a bespoke create-flow to build.
- `pi-coding-agent/examples/sdk/04-skills.ts` — a worked example of the exact merge pattern this app
  needs: `DefaultResourceLoader` + `skillsOverride` + `reload()` + `getSkills()`.

## Fix direction

Swap only the discovery/parse/watch layer for Pi's `loadSourcedSkills` + `DefaultResourceLoader.reload()`,
called at the safe-refresh points the approved design already defines in
[skills-three-sources.md #4](../features/skills-three-sources.md#s4) (chat-turn start, `/view_context`,
explicit refresh, after institution sync completes) — not a new persistent watcher of any kind. Keep
everything the registry does that Pi has no concept of and that the approved design still requires:
stable qualified references (layer + root identity + relative path), institution auth/scope fencing,
migration/legacy-alias handling, and the "recording" skill kind's recipe storage — these sit above the
raw skill list Pi returns and are unaffected by this change. Wire `createPiResourceLoader`'s `getSkills`/
`reload` to the same registry-owned snapshot instead of the deliberate empty stub.

Out of scope for this issue: the institution layer's cloud sync/download/authorization (Pi has no
concept of it and it stays fully host-owned), the three-tab Workbench UI, and the backend `/skill/*` API
contract. None of those need to change.

Task: [skills-pi-native-loading-001](../plan/tasks/skills-pi-native-loading-001.md).

## Resolution (2026-09-17 handoff)

Delivered in [skills-pi-native-loading-001](../plan/tasks/skills-pi-native-loading-001.md): Pi per-source discovery, parsing and native prompt formatting, real registry resources and next-turn system prompt refresh. Local watchers and polling are removed. Missing institution context skips that layer and its network calls; Global/Workspace remain available. Code verification: 59 focused tests plus final 2-test runtime regression, strict types and build passed. Application testing is handed to Ral. The code and file-line references above describe the pre-fix behavior.
