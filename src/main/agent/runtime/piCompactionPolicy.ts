const CODEX_COMPACTION_MODELS = new Set([
  'gpt-6-astra',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
]);

// Pi 0.85.1 defaults remain the fallback for every unlisted provider/model.
const DEFAULT_RESERVE_TOKENS = 16384;
const KEEP_RECENT_TOKENS = 20000;

/**
 * Host override for the current Codex presets: reserve 20% of the resolved
 * model's real window, retaining Pi's fixed 20k recent tail. Pi still owns
 * scheduling; pass these settings at session creation and model switches.
 */
export const resolvePiCompactionSettings = (
  model: { provider: string; id: string; contextWindow: number },
  enabled = true,
): { enabled: boolean; reserveTokens: number; keepRecentTokens: number } => {
  if (model.provider !== 'openai-codex' || !CODEX_COMPACTION_MODELS.has(model.id)) {
    return { enabled, reserveTokens: DEFAULT_RESERVE_TOKENS, keepRecentTokens: KEEP_RECENT_TOKENS };
  }

  if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0) {
    throw new RangeError(`Invalid context window for ${model.provider}/${model.id}: expected a positive safe integer`);
  }

  const reserveTokens = Math.floor(model.contextWindow / 5);
  if (model.contextWindow - reserveTokens <= KEEP_RECENT_TOKENS) {
    throw new RangeError(`Context window for ${model.provider}/${model.id} is too small for the 20% reserve and 20000-token recent tail`);
  }

  return { enabled, reserveTokens, keepRecentTokens: KEEP_RECENT_TOKENS };
};
