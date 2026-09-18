# A 3s context-window timeout silently downgraded every preset to 256K

Status: fixed in both apps; owner verification pending. Mirrored in
`micromeet-cowork` (`docs/issues/llm-context-window-timeout-downgrades-presets.md`).

Reported by Ral 2026-09-17:
```text
17:32:24.651 › [llm] 解析上下文窗口超时(3000ms),整批退 256K
```
「原因是?按理现在程序里都应该硬编码配置好上下文窗口,你将你不知道的配成 256k 就行,不应该出现这个
报错感觉」, and after the tradeoff was put to him:「你配置好就行,压缩后面再处理」.

## Symptom

That warning appears on boot — twice at 17:25:09 and again at 17:32:24 in the same session — and
reads as harmless ("we could not resolve the windows, so we use the default").

## The fallback defect was not harmless

`applyResolvedContextWindows` resolved each preset as
`resolved[key] || DEFAULT_CONTEXT_WINDOW_TOKENS`, i.e. it **ignored the value configured on the
preset entirely**. So on the timeout path, where `resolved` is `{}`, all presets became 256K —
including the four Codex presets that are configured at **266K, which is the measured truth**
(`llmModels.ts` above `LLM_PRESETS`: pi reports `contextWindow = 272000` for all four; the earlier
hand-written 372K / 256K / 1M "全部是错的").

Measured on both repos with the pre-fix source from `HEAD`:

```text
bitterless:       configured=266,266,266,266   HEAD=256,256,256,256   fixed=266,266,266,266
micromeet-cowork: configured=266,266,266,266   HEAD=256,256,256,256   fixed=266,266,266,266
```

The compression trigger, the reserve budget and the summary cap are all multiplied by that number,
so a genuine timeout or failed lookup could quietly re-point all three — in the same direction the
`applyResolvedContextWindows` mechanism was introduced to prevent. On that fallback path, correct
configuration was discarded. The warning by itself does not prove that the fallback path ran.

## Attribution correction — 2026-09-17

The warning is not proof of a slow cold start. The losing timeout arm logs even after a successful
lookup because its timer was never cleared; see [the follow-up issue](context-window-timeout-false-warning.md).
The possible slow phases below explain a genuine deadline, not the supplied warning on their own.
The fallback-value repair remains valid independently.

## Why the resolve can exceed 3s at all

`withResolvedContextWindows` races `PiRuntimeAdapter.describeContextWindows` against
`CONTEXT_WINDOW_TIMEOUT_MS = 3000`, and that call does, in order:

1. `await import('@earendil-works/pi-coding-agent')` — a cold dynamic import of a large package,
   charged to the 3s because it is inside the raced promise;
2. `pi.ModelRuntime.create({ authPath, modelsPath, refreshOnCreate: false })` — the
   `refreshOnCreate: false` is load-bearing and must stay (it skips a per-provider `models.checkAuth()`
   network walk that has no signal and no timeout; without it this call once ran 333,784ms);
3. `new pi.ModelRegistry(...)` plus pure `find()` table lookups, which are fast.

So the 3s bound is protecting a boot-critical phase (`renderer-config`, 15s budget) from steps 1–2.
A genuine deadline can be caused by a slow cold start; the unconditional timer log did not establish
that this happened. Collapsing the configuration on an actual deadline was still wrong.

## Repair

- **An unresolved target keeps its own configured window.** `applyResolvedContextWindows` now reads
  `resolved[key] || preset.contextLengthK * 1024 || DEFAULT_CONTEXT_WINDOW_TOKENS`. pi still wins
  whenever it answers in time, so the drift protection is intact; `DEFAULT_CONTEXT_WINDOW_TOKENS`
  becomes the last resort for a preset that configures nothing. Cowork's `ai-crms` models can
  resolve from its custom `models.json` catalog; when unresolved they keep their configured 256K.
- **The two log lines no longer lie.** "整批退 256K" → "沿用预设里配置的窗口".
- The label is still derived from the same token count, so the number and the label cannot disagree.

Deliberately unchanged: `CONTEXT_WINDOW_TIMEOUT_MS`, the `refreshOnCreate: false` argument, and the
pi resolution itself. Owner direction was to make the configuration authoritative, not to remove the
resolution — and the resolution is what catches a model whose real window changes.

## Verification

```text
bitterless:       node --test tests/maestro/maestroContextWindowFallback.test.mjs   3/3
micromeet-cowork: node --test tests/unit/contextWindowFallback.test.mjs             3/3
```
Each asserts: an empty resolve keeps every configured window (and Codex specifically stays 266K); a
resolved value still overrides; a preset configuring nothing falls to 256K. Red-before-green was
proven by loading each repo's `HEAD` copy of `llmModels.ts` beside the fixed one — the table above is
that run's output. `yarn typecheck:node` adds no diagnostic in either repo for the touched files.
`scripts/maestro/check-agent-runtime.mjs` (bl) still passes; its two context-window assertions pin
the presence of `applyResolvedContextWindows` and the `DEFAULT_CONTEXT_WINDOW_TOKENS` declaration,
both of which survive this change.

## Out of scope

Whether the compression trigger / reserve / summary math should change now that the windows are
stable — Ral 2026-09-17:「压缩后面再处理」. Also not addressed: moving the resolve off the boot path
entirely (persist the resolved windows and refresh in the background), which would remove the
warning on a genuine slow lookup. The later timer-lifecycle investigation above established that
the warning could also be emitted after a successful fast lookup.
