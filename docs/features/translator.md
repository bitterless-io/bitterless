# Translator Mini App

Status: Accepted

Cross-project design:
[`areas/agent-runtime/mini-apps/translator/design.md`](../../../../areas/agent-runtime/mini-apps/translator/design.md)

## Purpose

Translator is a first-party Omni mini app for low-friction bilingual translation while typing. It
uses the shared model-provider service and the sterile Pi coding-agent runtime; it never owns
credentials or a second model preference.

Translator has no provider selector. Its fixed provider target remains
`openai-codex / gpt-5.5 / low / fast` for availability and shared model-provider selection, while
the translation request explicitly disables model reasoning with `reasoning.effort: "none"`.
When that target is unavailable, the composer shows the shared Codex login entry. A successful
login updates Translator and Home Model Config through the same persisted XPC snapshot.

## Design Direction

Translator is a quiet reading instrument inside a potentially narrow Omni pane. Royal Blue chrome
stays restrained around a large white translation canvas. Its signature is the slim translation
rail above the composer: fixed provider/model state is visible without competing with translated
text.

| Token         | Value     | Use                                     |
| ------------- | --------- | --------------------------------------- |
| `ink`         | `#242B3A` | translated text                         |
| `royal`       | `#4E5882` | active controls and focus               |
| `royal-soft`  | `#EEF0F8` | composer surfaces                       |
| `line`        | `#D7DBEA` | structural dividers                     |
| `paper`       | `#FFFFFF` | translation canvas                      |
| `chrome`      | `#4E5882` | MenuBar surface                         |
| `chrome-line` | `#3D4666` | MenuBar bottom divider                  |
| `chrome-ink`  | `#F6F7FC` | MenuBar identity, title, and model chip |

Translation content uses the existing readable UI stack at a larger size. Provider/model metadata
uses the existing monospace utility stack.

## MenuBar

Translator's top strip is the shared mini-app MenuBar effect already used by EyesOnAgents,
Submodules, and Todo, reproduced by copy rather than by importing another mini app's private
component. It is exactly 32px tall with `0 10px` padding, the Royal Blue `chrome` surface, the
`chrome-line` bottom divider, and `chrome-ink` content: a 16px leading language icon, then the
13px/650 application title, ellipsized before it can push the trailing content.

The fixed provider/model label stays in the bar as a compact 24px chip with a 12px radius, an
8%-white surface, and an 18%-white border, still rendered in the monospace metadata stack. It
remains a label, not a control; Translator has no provider selector.

Translator runs only as an Omni mini-app cell, so the bar reproduces the embedded variant of that
effect only: no drag region, no macOS traffic-light gutter, no window controls, and no double-click
maximize.

## Layout

```text
┌──────────────────────── Translator mini app ────────────────────────┐
│ ▤ Translator                                 ( Codex · 5.5 · low ) │  32px MenuBar
├──────────────────────── translation canvas ────────────────────────┤
│                                                                    │
│  Validated translated text only. Whitespace is preserved.          │
│                                                                    │
│  empty / loading / error guidance occupies this same region        │
│                                                                    │
├──────────────── conditional result footer ─────────────────────────┤
│                                                  Copied     [copy] │
├──────────────── conditional error strip ──────────────────────────┤
│ Translation failed.  [Try again]                                   │
├──────────────────────── translation rail ──────────────────────────┤
│ Auto direction  [Translate to … after success] Ready / Translating │
├──────────────────────── input dock ─────────────────────────────────┤
│ Source text…                                                        │
│ [Login to Codex when required]                          123 / 1000 │
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

## Result Footer

The result region ends in a slim footer that carries exactly one action: copy the translation. It is
a sibling strip pinned below the scrolling canvas, not content inside it, so the action stays
reachable for a translation longer than the pane.

The footer exists only while the canvas renders a translation — the same condition that renders the
translated text. Empty, checking, login-required, authenticating, and failure-without-result states
render no footer, because there is nothing to copy. During translation of a newer revision the
previous result stays visible and subdued, and its footer stays active so the still-displayed text
remains copyable.

The copy control is icon-only and right-aligned. It writes the exact validated `translation` string
to the system clipboard through the renderer clipboard API — the same string the canvas shows, with
whitespace preserved, never the source text, the direction label, provider metadata, or any wrapper.
Copy feedback is transient: the icon becomes a check mark and a localized `Copied` / `Copy failed`
status appears to the left of the icon, then both return to idle. A new translation result, or
clearing the source, resets that feedback immediately so an old confirmation is never attached to
new text.

| Input                       | Scope         | Behavior                                                   |
| --------------------------- | ------------- | ---------------------------------------------------------- |
| click / `Enter` / `Space`   | copy control  | write the currently displayed translation to the clipboard |
| repeated activation         | copy control  | rewrite the same text and restart the transient feedback   |
| clipboard write rejected    | copy control  | show localized `Copy failed`; the translation is untouched |
| new result / source cleared | result region | reset copy feedback to idle                                |

## Language Direction

Direction inference and translation happen in the same LLM request. Main does not decide direction
from Unicode character counts, UTF-8 byte lengths, or tokenizer counts, and Renderer does not
predict a target before the response arrives. The model judges the primary semantic
natural-language content:

| Source meaning                                                 | Target             |
| -------------------------------------------------------------- | ------------------ |
| Primarily Simplified or Traditional Chinese                    | English            |
| Primarily English                                              | Simplified Chinese |
| Primarily another language                                     | Simplified Chinese |
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
7. Source input is bounded to 1,000 Unicode code points in both renderer and Main; Main also keeps
   a 2,000 UTF-16-unit hard bound (twice the code-point bound) so surrogate-pair input cannot
   bypass the contract. The bound is deliberately short: one request stays inside the 60-second
   deadline, and a long document is expected to be translated in owner-chosen slices rather than as
   one oversized request. The 24,000-character translation ceiling is unchanged, because a
   1,000-character Chinese source can legitimately expand well past its own length in English.

## Runtime And Output Contract

- Main validates each request with a strict Zod schema and bounded input.
- Pi runs without tools, skills, prompts, extensions, retries, or conversation persistence through
  the existing sterile Codex runtime.
- Provider, model, and effort are Main constants; renderer input cannot override them.
- Translator explicitly requests Fast service tier. The shared Codex runtime maps Fast to the
  provider wire value `service_tier: "priority"` and leaves other runtime consumers on Standard
  unless they opt in.
- Fast is supported by `gpt-5.5` for ChatGPT-authenticated Codex sessions and consumes more credits
  than Standard. A rejected Fast request remains a provider failure; the runtime does not silently
  downgrade the translation to Standard. See
  [Codex Fast mode](https://learn.chatgpt.com/docs/agent-configuration/speed#fast-mode).
- Translator creates its sterile Pi session with thinking disabled and explicitly overrides the
  Codex request payload to `reasoning: { effort: "none" }`. Merely omitting `reasoning` is not an
  acceptable substitute because GPT-5.5 defaults to reasoning. GPT-5.5 officially supports
  `none`; this Translator-only override must not change Coin, Maestro, or other Codex consumers.
  See [GPT-5.5 model](https://developers.openai.com/api/docs/models/gpt-5.5).
- The system prompt requires exactly one JSON object with `targetLanguage` and `translation`.
- Main parses JSON and validates it with
  `z.object({ targetLanguage: z.enum(['en', 'zh-CN']), translation: ... }).strict()`. Fenced JSON,
  extra keys, invalid targets, empty output, and oversized output fail as `invalid-output`; Main
  never falls back to a local direction guess.
- One exact 60-second (`60_000 ms`) request deadline starts immediately after Main accepts a valid
  translation request and covers provider-context lookup, Pi module loading, model-runtime
  preparation, session creation, `session.prompt()`, provider-state observation, and output
  validation. Every awaited boundary races the same abort signal, so an uncooperative promise
  cannot leave Renderer in `Translating` beyond the deadline.
- Translation creates Pi's model runtime with model-network refresh disabled and resolves the fixed
  built-in target without a second registry refresh. Provider inference remains online; only
  unrelated remote model-catalog discovery is skipped.
- Streamed and final output collection stop at the 64 KiB UTF-8 ceiling.
- Only the validated target and parsed translation string cross back to the renderer.

## Translation Diagnostics

Main writes translation execution to a dedicated, profile-isolated `translator/translator.log`
directory rather than mixing it into `main.log`. The file is UTC NDJSON and rotates at 5 MB.

Each accepted request receives a process-local numeric attempt number. The log records bounded
lifecycle stages for provider context, Pi module load, fixed-target preparation, session creation,
prompt execution, output validation, completion, cancellation, timeout, and failure. Records may
contain the fixed provider/model/effort/tier, source code-point count, elapsed milliseconds, public
error code, and a sanitized internal cause.

The dedicated log never records source text, translated text, prompts, model output, client or
request IDs, OAuth URLs/codes, tokens, credentials, headers, or raw provider objects. Shared Codex
status checks, Login, callback, credential promotion, logout, and invalidation lifecycle are not
written to the Translator log; they retain their existing application diagnostics.

| Runtime               | Translator log                                                        |
| --------------------- | --------------------------------------------------------------------- |
| packaged production   | `~/Library/Logs/Bitterless/translator/translator.log`                 |
| packaged test release | Electron OS log root under `Bitterless_DEV/translator/translator.log` |
| production debug      | `<appData>/Bitterless_DEBUG_PROD/logs/translator/translator.log`      |
| test debug            | `<appData>/Bitterless_DEBUG_DEV/logs/translator/translator.log`       |

## State Variants

| State                           | Result region                                                      | Direction rail                                                                   | Composer                                        |
| ------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| login required / invalidated    | localized instruction                                              | `Auto direction` only                                                            | Codex Login visible; requests disabled          |
| authenticating                  | login guidance                                                     | `Auto direction` only                                                            | login progress; requests disabled               |
| empty + ready                   | localized invitation to type or paste                              | `Auto direction` only                                                            | focused and enabled                             |
| translating new source revision | previous result remains visible but subdued                        | `Auto direction` only                                                            | enabled                                         |
| complete                        | validated translation only                                         | actual `Translate to …` target visible                                           | enabled                                         |
| retryable translation failure   | localized error plus inline `Try again`, never raw provider detail | target visible only when this unchanged revision already has a successful result | enabled; action force-retries current source    |
| non-retryable / auth failure    | localized actionable guidance, never raw provider detail           | no unvalidated target                                                            | no retry action; login or edit remains explicit |
| constrained pane                | result scrolls; metadata wraps                                     | metadata wraps                                                                   | input dock stays at bottom                      |

## Error Recovery Interaction

| Input                                 | Scope                     | Behavior                                                               |
| ------------------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| click / `Enter` / `Space`             | inline `Try again` button | force-submit the current non-empty source once                         |
| repeated activation while translating | inline `Try again` button | ignored by the existing translating guard                              |
| source edit                           | composer                  | clears the old error and resumes the normal throttled translation path |
| source cleared / whitespace only      | composer                  | hide retry, clear error/result, cancel active work, issue no request   |

## Integration Flow

```text
Omni selects translator
  -> translator preload + renderer
  -> shared provider snapshot
     -> unavailable: shared Login action
     -> ready: 1s leading/trailing scheduler
  -> TranslatorHandler -> TranslatorService
  -> CodexRuntimeService(openai-codex, gpt-5.5, low target, thinking off,
                         reasoning none, fast -> priority)
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
