export type PiCompactionBudget = number | { readonly ratio: number };

export interface PiCompactionBudgetConfig {
  readonly reserveTokens?: PiCompactionBudget;
  readonly keepRecentTokens?: PiCompactionBudget;
}

export interface PiCompactionConfig extends PiCompactionBudgetConfig {
  readonly modelOverrides?: Readonly<Record<string, PiCompactionBudgetConfig>>;
}

// Pi consumes absolute token counts. Ratios are a host configuration convenience.
const DEFAULT_RESERVE_TOKENS = 16384;
const DEFAULT_KEEP_RECENT_TOKENS = 20000;

export const PI_COMPACTION_CONFIG: PiCompactionConfig = {
  reserveTokens: DEFAULT_RESERVE_TOKENS,
  keepRecentTokens: DEFAULT_KEEP_RECENT_TOKENS,
  modelOverrides: {
    'openai-codex/gpt-6-astra': { reserveTokens: { ratio: 0.2 }, keepRecentTokens: { ratio: 0.1 } },
    'openai-codex/gpt-5.6-sol': { reserveTokens: { ratio: 0.2 }, keepRecentTokens: { ratio: 0.1 } },
    'openai-codex/gpt-5.6-terra': { reserveTokens: { ratio: 0.2 }, keepRecentTokens: { ratio: 0.1 } },
    'openai-codex/gpt-5.6-luna': { reserveTokens: { ratio: 0.2 }, keepRecentTokens: { ratio: 0.1 } },
  },
};

type CompactionModel = { provider: string; id: string; contextWindow: number };

const validateWindow = (model: CompactionModel): void => {
  if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0) {
    throw new RangeError(`Invalid context window for ${model.provider}/${model.id}: expected a positive safe integer`);
  }
};

const resolveBudget = (value: PiCompactionBudget, field: string, model: CompactionModel): number => {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= 0) return value;
    throw new RangeError(`Invalid ${field}: expected a non-negative safe integer`);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 1 && Object.hasOwn(value, 'ratio')) {
    const { ratio } = value;
    if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0 || ratio >= 1) {
      throw new RangeError(`Invalid ${field}.ratio: expected a number in [0, 1)`);
    }
    validateWindow(model);
    return Math.floor(model.contextWindow * ratio);
  }
  throw new TypeError(`Invalid ${field}: expected an absolute token count or { ratio: number }`);
};

/**
 * Resolve each exact provider/model override independently, then ordinary
 * configuration, then Pi defaults. Pass only numbers to SettingsManager at
 * session creation/model switches; Pi still owns scheduling.
 */
export const resolvePiCompactionSettings = (
  model: CompactionModel,
  enabled = true,
  config: PiCompactionConfig = PI_COMPACTION_CONFIG,
): { enabled: boolean; reserveTokens: number; keepRecentTokens: number } => {
  // Validate ordinary values even when a model override replaces them.
  const ordinaryReserve = config.reserveTokens === undefined ? DEFAULT_RESERVE_TOKENS : config.reserveTokens;
  const ordinaryRecent = config.keepRecentTokens === undefined ? DEFAULT_KEEP_RECENT_TOKENS : config.keepRecentTokens;
  let reserveTokens = resolveBudget(ordinaryReserve, 'reserveTokens', model);
  let keepRecentTokens = resolveBudget(ordinaryRecent, 'keepRecentTokens', model);
  const modelKey = `${model.provider}/${model.id}`;
  const override = config.modelOverrides && Object.hasOwn(config.modelOverrides, modelKey)
    ? config.modelOverrides[modelKey] : undefined;
  if (override !== undefined) {
    if (!override || typeof override !== 'object' || Array.isArray(override)) {
      throw new TypeError(`Invalid modelOverrides[${modelKey}]: expected a budget configuration`);
    }
    validateWindow(model);
    if (override.reserveTokens !== undefined) {
      reserveTokens = resolveBudget(override.reserveTokens, `${modelKey}.reserveTokens`, model);
    }
    if (override.keepRecentTokens !== undefined) {
      keepRecentTokens = resolveBudget(override.keepRecentTokens, `${modelKey}.keepRecentTokens`, model);
    }
  }

  // Keep the explicit model/ratio policy usable without silently clamping it.
  // Untouched absolute Pi defaults retain Pi's behavior for unlisted models.
  if ((override !== undefined || typeof ordinaryReserve !== 'number' || typeof ordinaryRecent !== 'number')
    && model.contextWindow - reserveTokens <= keepRecentTokens) {
    throw new RangeError(`Context window for ${modelKey} is too small for reserveTokens=${reserveTokens} and keepRecentTokens=${keepRecentTokens}`);
  }
  return { enabled, reserveTokens, keepRecentTokens };
};
