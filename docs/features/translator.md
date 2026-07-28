# Translator Mini App

Status: Accepted

Cross-project design:
[`areas/agent-runtime/mini-apps/translator/design.md`](../../../../areas/agent-runtime/mini-apps/translator/design.md)

## Purpose

Translator is a first-party Omni mini app for low-friction bilingual translation while typing. It
uses the shared model-provider service and the sterile Pi coding-agent runtime; it never owns
credentials or a second model preference.

Translator has no provider selector. Its fixed target is
`openai-codex / gpt-5.5 / low` (the requested “Codex 5.5 light”). When that target is unavailable,
the composer shows the shared Codex login entry. A successful login updates Translator and Home
Model Config through the same persisted XPC snapshot.

## Design Direction

Translator is a quiet reading instrument inside a potentially narrow Omni pane. Royal Blue chrome
stays restrained around a large white translation canvas. Its signature is the slim translation
rail above the composer: fixed provider/model state is visible without competing with translated
text.

| Token | Value | Use |
|---|---|---|
| `ink` | `#242B3A` | translated text |
| `royal` | `#4E5882` | active controls and focus |
| `royal-soft` | `#EEF0F8` | header and composer surfaces |
| `line` | `#D7DBEA` | structural dividers |
| `paper` | `#FFFFFF` | translation canvas |

Translation content uses the existing readable UI stack at a larger size. Provider/model metadata
uses the existing monospace utility stack.

## Layout

```text
┌──────────────────────── Translator mini app ────────────────────────┐
│ Translator                                      Codex · 5.5 · low  │
├──────────────────────── translation canvas ────────────────────────┤
│                                                                    │
│  Validated translated text only. Whitespace is preserved.          │
│                                                                    │
│  empty / loading / error guidance occupies this same region        │
│                                                                    │
├──────────────── conditional error strip ──────────────────────────┤
│ Translation failed.  [Try again]                                   │
├──────────────────────── translation rail ──────────────────────────┤
│ Auto direction  [Translate to … after success] Ready / Translating │
├──────────────────────── input dock ─────────────────────────────────┤
│ Source text…                                                        │
│ [Login to Codex when required]                         123 / 12000 │
└────────────────────────────────────────────────────────────────────┘
```

The result region is the only place that renders model output. It renders the validated
`translation` string and never raw JSON, reasoning, Markdown fences, explanations, or provider
messages.

The conditional error strip keeps recovery beside the failure message. For retryable translation
failures it renders the localized sentence followed immediately by a compact `Try again` text
button. Activating it resubmits the current unchanged source with duplicate suppression bypassed;
the action is guarded against a second activation, then the error strip clears as the normal
Translating state takes over. Login-required and non-retryable errors keep their existing guidance
without this action. Empty or whitespace-only source never exposes retry; clearing the source
clears the error and previous translation, cancels active work, and returns to the empty state.

## Language Direction

Direction inference and translation happen in the same LLM request. Main does not decide direction
from Unicode character counts, UTF-8 byte lengths, or tokenizer counts, and Renderer does not
predict a target before the response arrives. The model judges the primary semantic
natural-language content:

| Source meaning | Target |
|---|---|
| Primarily Simplified or Traditional Chinese | English |
| Primarily English | Simplified Chinese |
| Primarily another language | Simplified Chinese |
| Ambiguous or materially mixed without a clear primary language | Simplified Chinese |

Product names, abbreviations, code identifiers, URLs, email addresses, numbers, and punctuation do
not dominate direction merely because they contain more characters or tokens. The strict model
response returns `targetLanguage` as exactly `en` or `zh-CN` together with `translation`; Main
validates both and returns the same target to Renderer.

When the target is Simplified Chinese and the source is an English abbreviation or acronym, the
translation string lists its common Chinese interpretations rather than echoing only the short
form. Each established meaning includes its English expansion when useful, the most common general
meaning comes first, and multiple meanings appear only when they are genuinely common. The model
must not invent an expansion. This list remains translation content inside the single validated
`translation` field, not additional commentary.

The request carries `direction: "auto"` and source text as serialized data. Source text is never
treated as an instruction.

The rail renders only `Auto direction` before the current source revision has a successful result.
After success it adds the localized actual target, `Translate to English` or
`Translate to Simplified Chinese`. Editing or clearing the source immediately hides that target so
an older result direction is never presented as a prediction for new text.

## Realtime Request Contract

1. Every normal input event, IME completion, and paste updates the latest source revision.
2. Translation is throttled to a `1_000 ms` interval with both leading and trailing execution.
3. The trailing call always reads the newest complete input, so the final edit is translated even
   when typing stops inside the throttle window.
4. Empty input clears the result and cancels active work.
5. A newer request aborts the older request from the same Translator cell. Renderer revision
   fencing also ignores late responses. Different cells keep independent client IDs.
6. Identical source text is not submitted twice.
7. Source input is bounded to 12,000 Unicode code points in both renderer and Main; Main also keeps
   a 24,000 UTF-16-unit hard bound so surrogate-pair input cannot bypass the contract.

## Runtime And Output Contract

- Main validates each request with a strict Zod schema and bounded input.
- Pi runs without tools, skills, prompts, extensions, retries, or conversation persistence through
  the existing sterile Codex runtime.
- Provider, model, and effort are Main constants; renderer input cannot override them.
- The system prompt requires exactly one JSON object with `targetLanguage` and `translation`.
- Main parses JSON and validates it with
  `z.object({ targetLanguage: z.enum(['en', 'zh-CN']), translation: ... }).strict()`. Fenced JSON,
  extra keys, invalid targets, empty output, and oversized output fail as `invalid-output`; Main
  never falls back to a local direction guess.
- A 60-second request deadline aborts Pi session creation or `session.prompt()` even if the Pi
  promise never settles. Streamed and final output collection stop at the 64 KiB UTF-8 ceiling.
- Only the validated target and parsed translation string cross back to the renderer.

## State Variants

| State | Result region | Direction rail | Composer |
|---|---|---|---|
| login required / invalidated | localized instruction | `Auto direction` only | Codex Login visible; requests disabled |
| authenticating | login guidance | `Auto direction` only | login progress; requests disabled |
| empty + ready | localized invitation to type or paste | `Auto direction` only | focused and enabled |
| translating new source revision | previous result remains visible but subdued | `Auto direction` only | enabled |
| complete | validated translation only | actual `Translate to …` target visible | enabled |
| retryable translation failure | localized error plus inline `Try again`, never raw provider detail | target visible only when this unchanged revision already has a successful result | enabled; action force-retries current source |
| non-retryable / auth failure | localized actionable guidance, never raw provider detail | no unvalidated target | no retry action; login or edit remains explicit |
| constrained pane | result scrolls; metadata wraps | metadata wraps | input dock stays at bottom |

## Error Recovery Interaction

| Input | Scope | Behavior |
|---|---|---|
| click / `Enter` / `Space` | inline `Try again` button | force-submit the current non-empty source once |
| repeated activation while translating | inline `Try again` button | ignored by the existing translating guard |
| source edit | composer | clears the old error and resumes the normal throttled translation path |
| source cleared / whitespace only | composer | hide retry, clear error/result, cancel active work, issue no request |

## Integration Flow

```text
Omni selects translator
  -> translator preload + renderer
  -> shared provider snapshot
     -> unavailable: shared Login action
     -> ready: 1s leading/trailing scheduler
  -> TranslatorHandler -> TranslatorService
  -> CodexRuntimeService(openai-codex, gpt-5.5, low)
  -> strict Zod output(targetLanguage + translation) -> renderer
```

## Entry Points

- `src/shared/translator/`
- `src/main/translator/`
- `src/main/xpc/translator.handler.ts`
- `src/preload/translator/`
- `src/renderer/translator/`
- `src/shared/omni/omni.types.ts`
- `src/main/windows/omniWindow.helper.ts`
