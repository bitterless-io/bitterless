# Preview rejects the obsolete `vs` theme after Shiki initializes

Status: Implemented; code verification complete; owner runtime testing pending — 2026-09-14.

## Report and contract

Ral reports that selecting a Markdown file in Preview throws:
`Uncaught (in promise) ShikiError: Theme 'vs' not found, you may need to load it first`.
Ral explicitly requires GitHub highlighting and on-demand loading for the different file types;
`vs` is no longer a valid preview theme choice.

Both BL and COWORK use the same vendored OnlyPreview implementation. Keep GitHub Light as the
current light-only preview theme. Load it lazily, once, and load language grammars by file type
or Markdown fence language. Unknown languages and slow/failed grammar loads may show plain text,
but must not switch to `vs`, invoke an unloaded Shiki tokenizer, or produce an unhandled rejection.
Rapid file switching must keep the existing generation fence.

## Evidence and root cause

- `common/onlyPreviewHighlighter.service.ts` only loads `github-light`; grammar imports are lazy.
- `preview/src/onlyPreviewMonacoHighlight.service.ts` retains
  `MONACO_PLAIN_FALLBACK_THEME = 'vs'` and returns null for unknown/plaintext languages or timeout.
- `MonacoTextPreview.vue` selects this fallback in `monaco.editor.create`.
- The installed `@shikijs/monaco` 3.23.0 adapter wraps `editor.create` and `editor.setTheme`;
  it forwards the requested theme to `highlighter.setTheme`. After Shiki is installed, the old
  Monaco fallback therefore reaches Shiki, which has no `vs` theme loaded.
- A Node reproduction with the real Shiki core/adapter and a lightweight Monaco API stub confirms
  that loading only `github-light` with zero grammars is sufficient: creating an editor with
  `vs` throws the reported ShikiError, while `github-light` succeeds. The report alone does not
  identify which timeout/unsupported-language path ran when Ral selected the Markdown file.

## Repair

Separate theme readiness from grammar readiness; define/register the lazy GitHub theme before
creating a model/editor, including the plain-text path. Preserve bounded grammar waits and cache
reuse. Do not reintroduce `vs` as an extra Shiki theme. Mirror the bounded repair to COWORK.

- `prepareHighlightTheme` lazily prepares the shared GitHub theme independently of grammar imports.
- `prepareMonacoHighlighting` returns an explicit `plaintext` language when a grammar is unknown,
  unavailable or exceeds the bounded wait, retaining the ready GitHub theme. It never requests `vs`.
- If theme loading itself fails or times out, return plain text without a theme override and keep
  the currently available editor colors; do not install Shiki with a missing theme. A later open
  retries failed imports or reuses completed background loads.
- The component consumes the prepared language/theme and retains its async generation fence.

## Code verification

- BL: 26/26 focused highlighter, Markdown highlighting, Monaco folding and runtime tests passed.
- COWORK: 17/17 runtime, Monaco folding and Markdown links tests passed.
- The seven runtime cases in each repo use the actual Shiki core and Monaco adapter with a
  lightweight Monaco API stub: cold MD; code → plain/unknown → code; cold plain text without
  grammar imports; grammar timeout/provider isolation/cache retry; grammar failure/retry;
  theme failure/retry; theme timeout.
- Both changed services passed strict TypeScript checks in both repos. Both MonacoTextPreview
  SFC scripts/templates compile. No dependencies changed.
- No Electron app launch, product E2E, full build, packaging or release was performed. These checks
  exercise the adapter and component contracts; the installed application still needs a new build.

Human acceptance: in a new build, select an MD file with fenced TS/JS code, switch to ordinary
TS/JS/JSON/YAML and plain-text files, then back to MD. Preview should remain readable, supported
languages should use GitHub colors, and no `Theme 'vs' not found` should appear.
