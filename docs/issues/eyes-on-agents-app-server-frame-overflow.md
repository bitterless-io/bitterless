# EyesOnAgents App Server Frame Overflow

Status: implemented; owner verification pending

## Symptom

EyesOnAgents reports `Codex App Server frame exceeded the size limit`, changes the managed App
Server connection to error, and appears unable to stay connected. Reconnect succeeds initially but
the next prompt-enabled tiered poll or labelled Refresh can reproduce the failure.

## Confirmed cause

Bitterless normally selects the Codex executable bundled with ChatGPT before the PATH CLI. On the
affected machine this is Codex `0.145.0-alpha.30`; the PATH CLI is `0.137.0` and does not reproduce
the same response sizes.

The opted-in latest-question recovery currently requests ten complete turns in one
`thread/turns/list(itemsView: full)` response. Read-only byte probes against the selected bundled
Codex found normal inventory frames below 110 KiB, but valid full-turn responses of approximately
6.8 MiB and 8.8 MiB. Bitterless's 4 MiB generic JSONL frame limit therefore terminates the entire
connection before the optional prompt projection can fail independently.

## Resolution contract

- Preserve the standard 4 MiB limit for ordinary responses and notifications.
- Allow a larger, separately bounded frame only for an internally issued
  `thread/turns/list(itemsView: full)` response. User input cannot select this allowance.
- Process complete newline-delimited frames before applying the residual/incomplete-frame limit, so
  multiple valid small frames delivered in one stdout chunk are not treated as one frame.
- Request one newest turn per page, follow at most ten turn pages, and stop as soon as the newest
  textual `userMessage` is found. This preserves later same-turn steer recovery without aggregating
  ten complete turns into one response.
- A malformed response, cursor loop, oversized absolute frame, or failed optional content request
  remains fail-closed and must not persist a prompt. Metadata-only polling behavior remains valid.
- Do not log or persist raw turn content while diagnosing or handling the response.

Delivery: [eyes-on-agents-app-server-frame-overflow-026](../plan/tasks/eyes-on-agents-app-server-frame-overflow-026.md)
