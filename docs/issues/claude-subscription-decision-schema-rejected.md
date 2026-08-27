# Claude subscription inference always fails: decision schema uses top-level `oneOf`

Status: fixed; owner verification pending

## Observed behavior

Every inference request through the Claude subscription route fails before the model is reached.
`buildClaudeExecutionArguments` passes `CLAUDE_DECISION_SCHEMA` to `claude -p --json-schema`, and
that schema is a top-level `oneOf` of the `final` and `tool_call` variants
(`src/main/claudeSubscription/claudeCli.executor.ts:57-78`). The API rejects it:

```
api_error_status: 400
result: API Error: 400 tools.0.custom.input_schema:
        input_schema does not support oneOf, allOf, or anyOf at the top level
```

Reproduced 2026-08-27 by running the exact argv `buildClaudeExecutionArguments` produces, with the
verbatim `CLAUDE_SYSTEM_PROMPT` file, against a logged-in account (`~/.claude2`, `claude` 2.1.220):

| Schema | Model | Result |
|---|---|---|
| `CLAUDE_DECISION_SCHEMA` (top-level `oneOf`) | `haiku` | `400 … does not support oneOf` |
| `CLAUDE_DECISION_SCHEMA` (top-level `oneOf`) | `sonnet` | `400 … does not support oneOf` |
| Flattened, no top-level `oneOf` | `haiku` | `{"action":"final","text":"READY"}` |
| Flattened, no top-level `oneOf` | `sonnet` | `{"action":"final","text":"READY"}` |

The failure is deterministic and model-independent. `--json-schema` is turned into a tool
`input_schema` on the wire, so the schema is bound by Anthropic's tool-schema restrictions rather
than by plain JSON Schema.

This is consistent with the feature never having been exercised: `claude-subscription-core-001`,
`-auth-002` and `-ui-003` are all `implemented; owner verification pending`, and the local registry
has zero accounts, so no request has ever reached the API.

### Why it surfaces as a confusing failure

`ClaudeCliExecutor` classifies a failed run by matching the diagnostic text. A 400 carrying
`oneOf` matches none of the usage-limit or auth patterns, so it becomes a generic error. With more
than one account enabled the router will not fail over (correctly — this is not a quota problem),
but the operator sees only "the account did not work" with no indication that every account will
fail identically.

## Required behavior

- The decision schema is accepted by the API: no `oneOf` / `allOf` / `anyOf` at the top level.
- Both decisions stay expressible and distinguishable: `final` carries `text`; `tool_call` carries
  `tool_name` and `arguments`.
- A malformed decision (missing the field its `action` requires) is still rejected by
  `ClaudeDecision` parsing rather than reaching the caller — the schema loses the constraint, so
  validation has to keep it.
- The 400 is classified as a request defect, not as a routing failure: it must not cool down or
  mark an account, because every account would fail the same way.

## Approach

Flatten the schema to a single object whose `action` is an enum, keeping the variant fields
optional, and re-assert the variant rule in `ClaudeDecision` parsing where it is already being
validated:

```jsonc
{ "type": "object",
  "properties": {
    "action":    { "type": "string", "enum": ["final", "tool_call"] },
    "text":      { "type": "string" },
    "tool_name": { "type": "string" },
    "arguments": { "type": "string" }
  },
  "required": ["action"],
  "additionalProperties": false }
```

Verified above: this exact shape returns `{"action":"final","text":"READY"}` on both models.

The alternative — dropping `--json-schema` and parsing free text — is rejected: the structured
decision is what lets Codex tool calls survive the bridge, and free text would have to reintroduce
a parser for the same thing with weaker guarantees.

## Acceptance

- Running the argv from `buildClaudeExecutionArguments` against a logged-in account returns a
  decision object with `api_error_status: null`, on `haiku` and on `sonnet`.
- A `final` decision and a `tool_call` decision both round-trip through `ClaudeDecision` parsing.
- A decision with `action: "tool_call"` but no `tool_name` is rejected by parsing.
- An API 400 does not place the account in cooldown and does not mark it `needsLogin`.

## Entry points

- `src/main/claudeSubscription/claudeCli.executor.ts` — `CLAUDE_DECISION_SCHEMA`, decision parsing,
  failure classification
- `src/shared/claudeSubscription/claudeSubscription.schema.ts` — `ClaudeDecision` validation

## Outcome

Fixed 2026-08-27.

- `CLAUDE_DECISION_SCHEMA` is now a single object with an enum `action` and optional variant
  fields. Re-verified against the live API with the argv `buildClaudeExecutionArguments` produces:
  `final` on `sonnet` and on `haiku`, and `tool_call` on `sonnet`, all with
  `api_error_status: null`. The tool decision came back as
  `{"action":"tool_call","tool_name":"shell","arguments":"{\"command\":\"ls -la /tmp\"}"}`.
- `validateClaudeDecision` keeps the per-variant rule and now ignores an *empty* foreign field,
  because a structured-output model may echo the unused variant's fields now that the schema
  declares all four. A populated foreign field is still rejected as ambiguous.
- The fourth acceptance item needed no change: a 400 raises `ClaudeExecutionError` /
  `ClaudeDecisionError`, and `isClaudeRoutingFailure` covers only `ClaudeUsageLimitError`,
  `ClaudeAuthenticationError` and `ClaudeSubscriptionRequiredError` — so no cooldown and no
  `needsLogin` is applied. Verified by reading `claudeSubscription.errors.ts:97-105`.
- Regression guard added in `tests/claudeSubscription/claudeCli.executor.test.ts`: the schema must
  carry no top-level combinator, and both validation directions are asserted.

Verified: `node tests/claudeSubscription/run-tests.mjs` (93/93), `yarn typecheck:node`, ESLint on
both touched files (clean; one pre-existing prettier warning at `claudeCli.executor.ts:265` left
alone), `git diff --check`. No Electron E2E was run.

Still owner-verified only through the raw CLI, not through the running app: the loopback server,
router and Workbench path have not been exercised, because the local registry still has zero
accounts.

## Related

- Prototype that established the working CLI invocation:
  `areas/agent-runtime/sub2api/demo/` in the overmind workspace (outside this repository)
- Design record: `areas/agent-runtime/sub2api/index.html` `#6`, `#7`
