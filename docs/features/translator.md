# Translator Mini App

Status: Accepted

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
├──────────────────────── translation rail ──────────────────────────┤
│ Auto direction                               Ready / Translating   │
├──────────────────────── input dock ─────────────────────────────────┤
│ Source text…                                                        │
│ [Login to Codex when required]                         123 / 12000 │
└────────────────────────────────────────────────────────────────────┘
```

The result region is the only place that renders model output. It renders the validated
`translation` string and never raw JSON, reasoning, Markdown fences, explanations, or provider
messages.

## Language Direction

Before calling the model, Main counts Unicode Han and Latin letters while ignoring digits,
punctuation, symbols, and whitespace:

| Input composition | Target |
|---|---|
| Latin count is greater than Han count | Simplified Chinese |
| Han count is greater than Latin count | English |
| tie, neither script, or another language | English |

The chosen target and source text are serialized as data. Source text is never treated as an
instruction.

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
- The system prompt requires exactly one JSON object with one `translation` string.
- Main parses JSON and validates it with `z.object({ translation: ... }).strict()`. Fenced JSON,
  extra keys, empty output, and oversized output fail as `invalid-output`.
- A 60-second request deadline aborts Pi session creation or `session.prompt()` even if the Pi
  promise never settles. Streamed and final output collection stop at the 64 KiB UTF-8 ceiling.
- Only the parsed string crosses back to the renderer.

## State Variants

| State | Result region | Composer |
|---|---|---|
| login required / invalidated | localized instruction | Codex Login visible; requests disabled |
| authenticating | login guidance | login progress; requests disabled |
| empty + ready | localized invitation to type or paste | focused and enabled |
| translating | previous result remains visible but subdued | enabled |
| complete | validated translation only | enabled |
| invalid output / provider error | localized actionable error, never raw provider detail | enabled for retry-by-edit |
| constrained pane | result scrolls; metadata wraps | input dock stays at bottom |

## Integration Flow

```text
Omni selects translator
  -> translator preload + renderer
  -> shared provider snapshot
     -> unavailable: shared Login action
     -> ready: 1s leading/trailing scheduler
  -> TranslatorHandler -> TranslatorService
  -> CodexRuntimeService(openai-codex, gpt-5.5, low)
  -> strict Zod output -> translation string -> renderer
```

## Entry Points

- `src/shared/translator/`
- `src/main/translator/`
- `src/main/xpc/translator.handler.ts`
- `src/preload/translator/`
- `src/renderer/translator/`
- `src/shared/omni/omni.types.ts`
- `src/main/windows/omniWindow.helper.ts`
