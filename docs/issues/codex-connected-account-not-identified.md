# Connected Codex Account Is Not Identified

Status: Open — accepted, not implemented

Raised 2026-08-20 while triaging
[Codex browser login succeeds but Setting keeps waiting](codex-model-login-browser-success-stuck.md).

## Symptom

The owner's local `codex` CLI was signed into ChatGPT account A. In Bitterless the browser OAuth
page offered a choice and account B was selected. Nothing in the app says which account Bitterless
is now using, so the two cannot be told apart from the UI.

## Why this is not a credential conflict

The two credentials never share a file:

| Consumer | Credential file |
|---|---|
| local `codex` CLI | `~/.codex/auth.json` |
| Bitterless | `<userData>/cowork/pi/auth.json` (`src/main/codex/codexPaths.ts`) |

Login also deletes only the Bitterless persistent credential before starting
(`persistent-credential-cleared`), never the CLI's. So selecting a different account is legitimate
and works; the 2026-08-20 hang had an unrelated cause.

## Gap

`ModelProviderRecord` carries no account identity at all — only `provider`, `configuredModels`,
`defaultTarget`, `authState`, `invalidationReason` and timestamps. Consequently:

- Setting → Model Config shows `Codex connected` plus the fixed model/effort, and nothing else.
- Translator shows `Codex · GPT-5.5 · low`.
- After a re-login there is no way to notice the account changed, and no way to notice that
  Bitterless and the CLI are on different accounts when a quota or entitlement question comes up.

## Required behavior

- The provider record carries a bounded account identity captured from the verified credential at
  promotion time, and only what the UI needs to disambiguate one account from another.
- Setting → Model Config names the connected account beside `Codex connected`, and shows it changing
  after Reconnect.
- Translator's fixed-target line can surface it without competing with translated text; the
  reading canvas stays unchanged.
- Logout and invalidation clear it, so a stale account never appears next to a non-ready state.
- The account identity is treated as personal data in diagnostics: it must not enter
  `main.log`, the Translator log, or any log line. Existing sanitizer coverage applies.

## Open decisions for the owner

- Which identity to display: ChatGPT account email, plan/tier label, or an opaque account id. Email
  is the most recognizable and the most sensitive; an opaque id is safe but not actionable.
- Whether Bitterless should also *detect and warn* when `~/.codex/auth.json` is a different account,
  or stay silent because the stores are intentionally independent.

## Acceptance

- The connected account is visible in Setting without opening a log or a credential file.
- Switching accounts through Reconnect changes the displayed identity.
- Logout and credential invalidation remove it.
- No log line, in any profile, contains the account identity.
