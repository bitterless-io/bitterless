// A Claude thread is discovered, stored, and then excluded from every board unless it carries a
// trusted Desktop identity (`eyesOnAgents.service.ts` getSnapshot). That silent exclusion is
// the failure the owner hit twice, so it now leaves a trace — bounded two ways because getSnapshot
// runs on every renderer read and every notify (task 095):
//   1. at most CLAUDE_VISIBILITY_GATE_LOG_ID_LIMIT session keys are named, with the full count kept
//      in `held=` so a large inventory cannot turn one poll into a thousand-id line;
//   2. the caller compares the built line with the last one it emitted and only logs on change, so
//      a steady-state hold is logged once instead of once per snapshot read.
// Session keys (`claude:<uuid>`) are content-free identifiers; no path is ever logged.
export const CLAUDE_VISIBILITY_GATE_LOG_ID_LIMIT = 5;

export const buildClaudeVisibilityGateLogLine = (
  heldSessionKeys: readonly string[]
): string | null => {
  if (heldSessionKeys.length === 0) return null;
  const named = heldSessionKeys.slice(0, CLAUDE_VISIBILITY_GATE_LOG_ID_LIMIT);
  return '[claude-visibility] gate=desktop_identity_missing '
    + `held=${heldSessionKeys.length} named=${named.length} ids=${named.join(',')}`;
};
