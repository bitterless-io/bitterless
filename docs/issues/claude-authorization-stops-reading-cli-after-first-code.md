# Claude authorization goes deaf after the first code submission

Status: fixed; owner verification pending

Reported 2026-08-31: the Claude login prompts for the authorization code **twice**, and after
submitting a wrong code the Sub2API panel shows no reaction at all.

> Not yet registered in `docs/INDEX.md`: another session is mid-edit on that file.

## Symptom

The flow sits at *Claude authorization · Waiting for the authorization code* indefinitely. No error
appears, and the code Input and Submit button are gone, so nothing can be retried from the UI.

## Root cause

`ClaudeAuthorizationCoordinator.submitCode` sets `flow.codeSubmitted = true`
(`claudeAuth.coordinator.ts:242`), and `#consume` short-circuits on that flag:

```ts
if (flow.codeSubmitted) {
  flow.parserOutput = '';
  flow.pendingAuthorizationTail = '';
  return;               // ← every later byte from the CLI is discarded
}
```

**`codeSubmitted` is never reset.** Its only other appearances are the initializer (`:207`) and two
reads (`:236`, `:317`). So the flag is not the transient "ignore the echo of the code we just wrote"
guard it reads as — it is a permanent blindfold. From the first submission onward the coordinator
parses nothing, which costs it both of the things it needs to see:

| Lost | Consequence |
|---|---|
| the CLI's **second** `paste code:` prompt | `#publish(flow, 'awaiting_code', true)` (`:317`) never fires again, so `canSubmitCode` stays `false` and the view's `v-if="flow.canSubmitCode"` removes the Input and Submit button |
| the CLI's **rejection** of a wrong code | nothing publishes a failure, so the UI keeps saying *Waiting for the authorization code* |

The only remaining terminal paths are process exit (`#handleExit`) and the flow timeout, which is
`DEFAULT_TIMEOUT_MS = 10 * 60_000`. When the CLI keeps the PTY open and re-prompts — which is exactly
what it does for both a second factor and a rejected code — neither fires promptly, so the panel is
silent for ten minutes and then reports `auth_timeout`, a message that describes nothing the owner
did wrong.

Suppressing the parser after a write is not wrong in itself: the PTY echoes the submitted code back,
and the stale `paste code:` prompt is still sitting in `parserOutput`, so re-parsing immediately
would both re-detect the old prompt and admit the secret into the buffer. The defect is that the
suppression has no exit.

## Fix

Make the flag mean "waiting for the CLI's response to the code we just wrote" rather than "stop
parsing forever":

- Keep clearing `parserOutput` / `pendingAuthorizationTail` on submit, so the stale prompt and the
  echoed code cannot be re-matched.
- Keep parsing afterwards. When a **new** manual-code prompt appears in the freshly accumulated
  buffer, clear `codeSubmitted`, publish `awaiting_code` with `canSubmitCode: true`, and accept
  another submission.
- Fail the flow with a typed error when the CLI reports the code was rejected, instead of waiting out
  the ten-minute timeout.

## Fixed

`#consume` no longer returns early on `codeSubmitted`. The flag now means "waiting for the CLI's
answer to the code we just wrote": the buffers are still cleared on submit so the answered prompt
cannot re-match, parsing continues, and a **new** prompt clears the flag and reopens the field.

A terminal redraws its prompt line, so the same ask can match repeatedly. An attempt is therefore
counted only on a transition — the first ask, or one that follows a submission — otherwise a redraw
would read as *Claude asked again*.

`ClaudeSubscriptionAuthFlowView` gained `codeAttempt`, because the status text for a repeat ask is
identical to the first one: without it the owner cannot tell "Claude wants a second code" from
"Claude refused the one I just typed", and both look like nothing happened. Above 1 the panel says
so explicitly.

Rejection is **not** matched by text. The CLI's wording for a refused code is not something this
repository can verify, and inventing a matcher would mean guessing. The re-prompt is the signal, and
it is the same signal the CLI itself gives the user.

## Acceptance

- After one code submission, a second `paste code:` prompt from the CLI restores `canSubmitCode` and
  a second code is accepted.
- A rejected code surfaces a typed error promptly rather than at `auth_timeout`.
- The submitted code is never re-admitted to `parserOutput`, and a stale prompt from before the
  submission cannot be re-detected as a new one.

## Entry points

- `src/main/claudeSubscription/claudeAuth.coordinator.ts` — `submitCode`, `#consume`
- `src/main/claudeSubscription/claudeAuthLogin.parser.ts` — `hasClaudeManualCodePrompt`
- `src/renderer/maestro/workbench/src/views/WorkbenchSub2ApiView.vue` — `flow.canSubmitCode` gating

## Related

- `docs/features/sub2api.md` — the panel this flow lives in
