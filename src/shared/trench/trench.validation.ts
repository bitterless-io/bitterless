import {
  TRENCH_CA_ANALYSIS_SCHEMA,
  TRENCH_CHAINS,
  TRENCH_NEGATIVE_WALLET_HOLDINGS_SCHEMA,
  TRENCH_NEGATIVE_WALLET_SCHEMA,
  type TrenchAnalysisSourceV1,
  type TrenchCaAnalysisV1,
  type TrenchCaChainAnalysisV1,
  type TrenchChain,
  type TrenchJsonObject,
  type TrenchNegativeWalletHoldingsV1,
  type TrenchNegativeWalletV1,
  type TrenchTokenIdentity,
  type TrenchTopProfitWallet,
  type TrenchWalletExposure,
  type TrenchWalletHolding
} from '@shared/trench/trench.type';

export const TRENCH_MAX_RECORD_BYTES = 2 * 1024 * 1024;
export const TRENCH_MAX_JSON_DEPTH = 32;
export const TRENCH_MAX_STRING_LENGTH = 64 * 1024;
export const TRENCH_MAX_ARRAY_LENGTH = 1_000;
export const TRENCH_MAX_OBJECT_KEYS = 200;
export const TRENCH_MAX_EXPLANATION_LENGTH = 2_000;
export const TRENCH_MAX_ANALYSIS_ID_LENGTH = 128;
export const TRENCH_MAX_LIST_LIMIT = 100;
export const TRENCH_MAX_FUTURE_MS = 5 * 60 * 1_000;

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

interface NormalizeTimestampOptions {
  now?: number;
  enforceFutureLimit?: boolean;
}

const compareText = (left: string, right: string): number => {
  return left < right ? -1 : left > right ? 1 : 0;
};

const hasForbiddenExplanationControl = (value: string): boolean => {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 0 || (code < 32 && code !== 10) || code === 127;
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const assertRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(`${label} must be a plain JSON object`);
  return value;
};

const assertExactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string
): void => {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`${label} contains unknown field: ${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new Error(`${label}.${key} is required`);
  }
};

const assertSingleLineString = (
  value: unknown,
  label: string,
  minLength = 1,
  maxLength = TRENCH_MAX_STRING_LENGTH
): string => {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  if (value.length < minLength || value.length > maxLength) {
    throw new Error(`${label} must contain ${minLength} to ${maxLength} characters`);
  }
  if (/[\0\r\n]/.test(value)) throw new Error(`${label} must be a single-line string`);
  return value;
};

const assertOptionalText = (
  value: unknown,
  label: string,
  maxLength = TRENCH_MAX_STRING_LENGTH
): string => {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  if (value.length > maxLength)
    throw new Error(`${label} can contain at most ${maxLength} characters`);
  if (value.includes('\0')) throw new Error(`${label} cannot contain null bytes`);
  return value;
};

const normalizeExplanation = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('negativeWallet.explanation must be a string');
  const explanation = value.replace(/\r\n?/g, '\n').trim();
  if (!explanation) throw new Error('negativeWallet.explanation must not be blank');
  if (Array.from(explanation).length > TRENCH_MAX_EXPLANATION_LENGTH) {
    throw new Error(
      `negativeWallet.explanation can contain at most ${TRENCH_MAX_EXPLANATION_LENGTH} code points`
    );
  }
  if (hasForbiddenExplanationControl(explanation)) {
    throw new Error('negativeWallet.explanation contains a forbidden control character');
  }
  return explanation;
};

export const assertTrenchChain = (value: unknown, label = 'chain'): TrenchChain => {
  if (typeof value !== 'string' || !TRENCH_CHAINS.includes(value as TrenchChain)) {
    throw new Error(`${label} must be one of: ${TRENCH_CHAINS.join(', ')}`);
  }
  return value as TrenchChain;
};

const getSolanaDecodedLength = (value: string): number => {
  let numericValue = 0n;
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) return -1;
    numericValue = numericValue * 58n + BigInt(digit);
  }
  let payloadBytes = 0;
  while (numericValue > 0n) {
    payloadBytes += 1;
    numericValue >>= 8n;
  }
  let leadingZeroBytes = 0;
  while (leadingZeroBytes < value.length && value[leadingZeroBytes] === '1') {
    leadingZeroBytes += 1;
  }
  return leadingZeroBytes + payloadBytes;
};

export const canonicalizeTrenchAddress = (
  value: unknown,
  chain?: TrenchChain,
  label = 'address'
): string => {
  const address = assertSingleLineString(value, label, 1, 64);
  if (chain === 'solana') {
    if (!SOLANA_ADDRESS_PATTERN.test(address) || getSolanaDecodedLength(address) !== 32) {
      throw new Error(`${label} must be a valid Solana address`);
    }
    return address;
  }
  if (chain === 'bsc' || chain === 'robinhood') {
    if (!EVM_ADDRESS_PATTERN.test(address)) {
      throw new Error(`${label} must be a valid EVM address for ${chain}`);
    }
    return address.toLowerCase();
  }
  if (EVM_ADDRESS_PATTERN.test(address)) return address.toLowerCase();
  if (SOLANA_ADDRESS_PATTERN.test(address) && getSolanaDecodedLength(address) === 32)
    return address;
  throw new Error(`${label} must be a valid EVM or Solana address`);
};

export const assertTrenchRequestId = (value: unknown, label = 'requestId'): string => {
  const id = assertSingleLineString(value, label, 1, TRENCH_MAX_ANALYSIS_ID_LENGTH);
  if (id.includes('..') || id.includes('/') || id.includes('\\')) {
    throw new Error(`${label} contains a forbidden path sequence`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return id;
};

export const normalizeTrenchIsoDate = (
  value: unknown,
  label: string,
  options: NormalizeTimestampOptions = {}
): string => {
  const date = assertSingleLineString(value, label, 1, 64);
  const timestamp = Date.parse(date);
  if (!ISO_DATE_PATTERN.test(date) || !Number.isFinite(timestamp)) {
    throw new Error(`${label} must be a valid ISO-8601 timestamp`);
  }
  if (
    options.enforceFutureLimit !== false &&
    timestamp > (options.now ?? Date.now()) + TRENCH_MAX_FUTURE_MS
  ) {
    throw new Error(`${label} cannot be more than five minutes in the future`);
  }
  return new Date(timestamp).toISOString();
};

const assertBoundedJsonInner = (
  value: unknown,
  label: string,
  depth: number,
  ancestors: Set<object>
): void => {
  if (depth > TRENCH_MAX_JSON_DEPTH) {
    throw new Error(`${label} exceeds the maximum JSON depth of ${TRENCH_MAX_JSON_DEPTH}`);
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (value.length > TRENCH_MAX_STRING_LENGTH) {
      throw new Error(
        `${label} contains a string longer than ${TRENCH_MAX_STRING_LENGTH} characters`
      );
    }
    if (value.includes('\0')) throw new Error(`${label} contains a null byte`);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number`);
    return;
  }
  if (typeof value !== 'object' || value === undefined) {
    throw new Error(`${label} contains a non-JSON value`);
  }
  if (ancestors.has(value)) throw new Error(`${label} contains a circular reference`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > TRENCH_MAX_ARRAY_LENGTH) {
        throw new Error(`${label} contains an array longer than ${TRENCH_MAX_ARRAY_LENGTH} items`);
      }
      for (let index = 0; index < value.length; index += 1) {
        assertBoundedJsonInner(value[index], `${label}[${index}]`, depth + 1, ancestors);
      }
      return;
    }
    const record = assertRecord(value, label);
    const keys = Object.keys(record);
    if (keys.length > TRENCH_MAX_OBJECT_KEYS) {
      throw new Error(`${label} contains more than ${TRENCH_MAX_OBJECT_KEYS} object fields`);
    }
    for (const key of keys) {
      if (key.length > 200 || key.includes('\0'))
        throw new Error(`${label} contains an invalid object key`);
      assertBoundedJsonInner(record[key], `${label}.${key}`, depth + 1, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
};

const prettyCanonicalJson = (value: unknown, depth = 0): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const indentation = '  '.repeat(depth);
  const childIndentation = '  '.repeat(depth + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => `${childIndentation}${prettyCanonicalJson(item, depth + 1)}`);
    return `[\n${items.join(',\n')}\n${indentation}]`;
  }
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort(compareText);
  if (keys.length === 0) return '{}';
  const fields = keys.map(
    (key) =>
      `${childIndentation}${JSON.stringify(key)}: ${prettyCanonicalJson(object[key], depth + 1)}`
  );
  return `{\n${fields.join(',\n')}\n${indentation}}`;
};

export const serializeTrenchDocument = (value: unknown, label = 'record'): string => {
  assertBoundedJsonInner(value, label, 0, new Set());
  const document = `${prettyCanonicalJson(value)}\n`;
  if (new TextEncoder().encode(document).byteLength > TRENCH_MAX_RECORD_BYTES) {
    throw new Error(`${label} exceeds the maximum size of ${TRENCH_MAX_RECORD_BYTES} bytes`);
  }
  return document;
};

export const assertBoundedTrenchJson = (value: unknown, label: string): void => {
  serializeTrenchDocument(value, label);
};

const cloneJsonObject = (value: unknown, label: string): TrenchJsonObject => {
  assertBoundedJsonInner(value, label, 0, new Set());
  assertRecord(value, label);
  return JSON.parse(JSON.stringify(value)) as TrenchJsonObject;
};

const normalizeToken = (value: unknown, label: string): TrenchTokenIdentity => {
  const token = assertRecord(value, label);
  assertExactKeys(token, ['name', 'symbol'], [], label);
  const normalized: TrenchTokenIdentity = {};
  if (token.name !== undefined)
    normalized.name = assertOptionalText(token.name, `${label}.name`, 200);
  if (token.symbol !== undefined)
    normalized.symbol = assertOptionalText(token.symbol, `${label}.symbol`, 64);
  return normalized;
};

const normalizeSource = (value: unknown): TrenchAnalysisSourceV1 => {
  const source = assertRecord(value, 'analysis.source');
  assertExactKeys(
    source,
    ['kind', 'agent', 'skill', 'providers'],
    ['kind', 'providers'],
    'analysis.source'
  );
  if (source.kind !== 'agent' && source.kind !== 'legacy-coin-state') {
    throw new Error('analysis.source.kind must be agent or legacy-coin-state');
  }
  const normalized: TrenchAnalysisSourceV1 = { kind: source.kind, providers: [] };
  if (source.agent !== undefined) {
    normalized.agent = assertSingleLineString(source.agent, 'analysis.source.agent', 1, 200).trim();
  }
  if (source.skill !== undefined) {
    normalized.skill = assertSingleLineString(source.skill, 'analysis.source.skill', 1, 200).trim();
  }
  if (!Array.isArray(source.providers) || source.providers.length > 32) {
    throw new Error('analysis.source.providers must be an array with at most 32 items');
  }
  const providers = source.providers.map((provider, index) =>
    assertSingleLineString(provider, `analysis.source.providers[${index}]`, 1, 200).trim()
  );
  if (providers.some((provider) => !provider)) {
    throw new Error('analysis.source.providers cannot contain blank names');
  }
  if (new Set(providers).size !== providers.length) {
    throw new Error('analysis.source.providers cannot contain duplicates');
  }
  normalized.providers = providers.sort(compareText);
  if (normalized.kind === 'agent') {
    if (!normalized.agent || !normalized.skill) {
      throw new Error(
        'analysis.source.agent and analysis.source.skill are required for agent sources'
      );
    }
  } else if (normalized.agent !== undefined || normalized.skill !== undefined) {
    throw new Error('legacy-coin-state sources cannot contain agent or skill');
  }
  return normalized;
};

const normalizeTopProfitWallet = (
  value: unknown,
  chain: TrenchChain,
  index: number
): TrenchTopProfitWallet => {
  const label = `analysis.chains.${chain}.topProfitWallets[${index}]`;
  const wallet = assertRecord(value, label);
  assertExactKeys(
    wallet,
    ['address', 'rank', 'profitUsd', 'winRate', 'evidence'],
    ['address', 'rank'],
    label
  );
  if (
    !Number.isInteger(wallet.rank) ||
    (wallet.rank as number) < 1 ||
    (wallet.rank as number) > 100
  ) {
    throw new Error(`${label}.rank must be an integer from 1 to 100`);
  }
  const normalized: TrenchTopProfitWallet = {
    address: canonicalizeTrenchAddress(wallet.address, chain, `${label}.address`),
    rank: wallet.rank as number
  };
  for (const numericField of ['profitUsd', 'winRate'] as const) {
    const numericValue = wallet[numericField];
    if (numericValue !== undefined) {
      if (typeof numericValue !== 'number' || !Number.isFinite(numericValue)) {
        throw new Error(`${label}.${numericField} must be a finite number`);
      }
      normalized[numericField] = numericValue;
    }
  }
  if (normalized.winRate !== undefined && (normalized.winRate < 0 || normalized.winRate > 1)) {
    throw new Error(`${label}.winRate must be a finite number from 0 to 1`);
  }
  if (wallet.evidence !== undefined) {
    normalized.evidence = cloneJsonObject(wallet.evidence, `${label}.evidence`);
  }
  return normalized;
};

const normalizeExposure = (
  value: unknown,
  chain: TrenchChain,
  label: string
): TrenchWalletExposure => {
  const exposure = assertRecord(value, label);
  assertExactKeys(
    exposure,
    ['address', 'holding', 'balance', 'sharePercent', 'valueUsd', 'evidence'],
    ['address', 'holding'],
    label
  );
  if (exposure.holding !== null && typeof exposure.holding !== 'boolean') {
    throw new Error(`${label}.holding must be boolean or null`);
  }
  const normalized: TrenchWalletExposure = {
    address: canonicalizeTrenchAddress(exposure.address, chain, `${label}.address`),
    holding: exposure.holding
  };
  if (exposure.balance !== undefined) {
    normalized.balance = assertSingleLineString(
      exposure.balance,
      `${label}.balance`,
      1,
      256
    ).trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized.balance)) {
      throw new Error(`${label}.balance must be a non-negative fixed-point decimal string`);
    }
  }
  if (exposure.sharePercent !== undefined) {
    if (
      typeof exposure.sharePercent !== 'number' ||
      !Number.isFinite(exposure.sharePercent) ||
      exposure.sharePercent < 0 ||
      exposure.sharePercent > 100
    ) {
      throw new Error(`${label}.sharePercent must be a finite number from 0 to 100`);
    }
    normalized.sharePercent = exposure.sharePercent;
  }
  if (exposure.valueUsd !== undefined) {
    if (
      typeof exposure.valueUsd !== 'number' ||
      !Number.isFinite(exposure.valueUsd) ||
      exposure.valueUsd < 0
    ) {
      throw new Error(`${label}.valueUsd must be a non-negative finite number`);
    }
    normalized.valueUsd = exposure.valueUsd;
  }
  if (exposure.evidence !== undefined) {
    normalized.evidence = cloneJsonObject(exposure.evidence, `${label}.evidence`);
  }
  if (
    exposure.holding !== true &&
    (normalized.balance !== undefined ||
      normalized.sharePercent !== undefined ||
      normalized.valueUsd !== undefined)
  ) {
    throw new Error(`${label} cannot contain measurements when holding is false or null`);
  }
  return normalized;
};

const normalizeExposureList = (
  value: unknown,
  chain: TrenchChain,
  field: 'indexWalletExposure' | 'negativeWalletExposure'
): TrenchWalletExposure[] => {
  if (!Array.isArray(value) || value.length > TRENCH_MAX_ARRAY_LENGTH) {
    throw new Error(
      `analysis.chains.${chain}.${field} must contain at most ${TRENCH_MAX_ARRAY_LENGTH} items`
    );
  }
  const normalized = value
    .map((item, index) =>
      normalizeExposure(item, chain, `analysis.chains.${chain}.${field}[${index}]`)
    )
    .sort((left, right) => compareText(left.address, right.address));
  if (new Set(normalized.map((item) => item.address)).size !== normalized.length) {
    throw new Error(`analysis.chains.${chain}.${field} contains a duplicate wallet`);
  }
  return normalized;
};

const normalizeChainAnalysis = (value: unknown, index: number): TrenchCaChainAnalysisV1 => {
  const label = `analysis.chains[${index}]`;
  const chainResult = assertRecord(value, label);
  assertExactKeys(
    chainResult,
    [
      'chain',
      'token',
      'topProfitWallets',
      'indexWalletExposure',
      'negativeWalletExposure',
      'result'
    ],
    ['chain', 'topProfitWallets', 'result'],
    label
  );
  const chain = assertTrenchChain(chainResult.chain, `${label}.chain`);
  if (!Array.isArray(chainResult.topProfitWallets) || chainResult.topProfitWallets.length > 100) {
    throw new Error(`${label}.topProfitWallets must contain at most 100 wallets`);
  }
  const topProfitWallets = chainResult.topProfitWallets
    .map((wallet, walletIndex) => normalizeTopProfitWallet(wallet, chain, walletIndex))
    .sort((left, right) => left.rank - right.rank);
  if (new Set(topProfitWallets.map((wallet) => wallet.address)).size !== topProfitWallets.length) {
    throw new Error(`${label}.topProfitWallets contains a duplicate wallet`);
  }
  for (let rankIndex = 0; rankIndex < topProfitWallets.length; rankIndex += 1) {
    if (topProfitWallets[rankIndex].rank !== rankIndex + 1) {
      throw new Error(`${label}.topProfitWallets ranks must be contiguous from 1 to N`);
    }
  }
  const normalized: TrenchCaChainAnalysisV1 = {
    chain,
    topProfitWallets,
    result: cloneJsonObject(chainResult.result, `${label}.result`)
  };
  if (chainResult.token !== undefined)
    normalized.token = normalizeToken(chainResult.token, `${label}.token`);
  if (chainResult.indexWalletExposure !== undefined) {
    normalized.indexWalletExposure = normalizeExposureList(
      chainResult.indexWalletExposure,
      chain,
      'indexWalletExposure'
    );
  }
  if (chainResult.negativeWalletExposure !== undefined) {
    normalized.negativeWalletExposure = normalizeExposureList(
      chainResult.negativeWalletExposure,
      chain,
      'negativeWalletExposure'
    );
  }
  return normalized;
};

export const normalizeTrenchCaAnalysis = (
  value: unknown,
  options: NormalizeTimestampOptions = {}
): TrenchCaAnalysisV1 => {
  const analysis = assertRecord(value, 'analysis');
  assertExactKeys(
    analysis,
    ['schema', 'analysisId', 'contractAddress', 'generatedAt', 'source', 'chains'],
    ['schema', 'analysisId', 'contractAddress', 'generatedAt', 'source', 'chains'],
    'analysis'
  );
  if (analysis.schema !== TRENCH_CA_ANALYSIS_SCHEMA) {
    throw new Error(`analysis.schema must equal ${TRENCH_CA_ANALYSIS_SCHEMA}`);
  }
  if (
    !Array.isArray(analysis.chains) ||
    analysis.chains.length === 0 ||
    analysis.chains.length > 2
  ) {
    throw new Error('analysis.chains must contain one or two compatible chain results');
  }
  const chains = analysis.chains.map(normalizeChainAnalysis);
  if (new Set(chains.map((item) => item.chain)).size !== chains.length) {
    throw new Error('analysis.chains cannot contain duplicate chains');
  }
  const hasSolana = chains.some((item) => item.chain === 'solana');
  if (hasSolana && chains.length !== 1) {
    throw new Error('A base58 Solana CA cannot share an address identity with an EVM chain');
  }
  const chainOrder = new Map(TRENCH_CHAINS.map((chain, index) => [chain, index]));
  chains.sort(
    (left, right) => (chainOrder.get(left.chain) ?? 0) - (chainOrder.get(right.chain) ?? 0)
  );
  const normalized: TrenchCaAnalysisV1 = {
    schema: TRENCH_CA_ANALYSIS_SCHEMA,
    analysisId: assertTrenchRequestId(analysis.analysisId, 'analysis.analysisId'),
    contractAddress: canonicalizeTrenchAddress(
      analysis.contractAddress,
      hasSolana ? 'solana' : chains[0].chain,
      'analysis.contractAddress'
    ),
    generatedAt: normalizeTrenchIsoDate(analysis.generatedAt, 'analysis.generatedAt', options),
    source: normalizeSource(analysis.source),
    chains
  };
  serializeTrenchDocument(normalized, 'analysis');
  return normalized;
};

export const normalizeTrenchNegativeWallet = (
  value: unknown,
  options: NormalizeTimestampOptions = {}
): TrenchNegativeWalletV1 => {
  const wallet = assertRecord(value, 'negativeWallet');
  assertExactKeys(
    wallet,
    ['schema', 'tagId', 'chain', 'address', 'explanation', 'source', 'createdAt', 'updatedAt'],
    ['schema', 'tagId', 'chain', 'address', 'explanation', 'source', 'createdAt', 'updatedAt'],
    'negativeWallet'
  );
  if (wallet.schema !== TRENCH_NEGATIVE_WALLET_SCHEMA) {
    throw new Error(`negativeWallet.schema must equal ${TRENCH_NEGATIVE_WALLET_SCHEMA}`);
  }
  if (wallet.source !== 'human-via-agent') {
    throw new Error('negativeWallet.source must equal human-via-agent');
  }
  const chain = assertTrenchChain(wallet.chain, 'negativeWallet.chain');
  const explanation = normalizeExplanation(wallet.explanation);
  const normalized: TrenchNegativeWalletV1 = {
    schema: TRENCH_NEGATIVE_WALLET_SCHEMA,
    tagId: assertTrenchRequestId(wallet.tagId, 'negativeWallet.tagId'),
    chain,
    address: canonicalizeTrenchAddress(wallet.address, chain, 'negativeWallet.address'),
    explanation,
    source: 'human-via-agent',
    createdAt: normalizeTrenchIsoDate(wallet.createdAt, 'negativeWallet.createdAt', options),
    updatedAt: normalizeTrenchIsoDate(wallet.updatedAt, 'negativeWallet.updatedAt', options)
  };
  if (Date.parse(normalized.updatedAt) < Date.parse(normalized.createdAt)) {
    throw new Error('negativeWallet.updatedAt cannot be older than createdAt');
  }
  serializeTrenchDocument(normalized, 'negativeWallet');
  return normalized;
};

export const normalizeTrenchNegativeWalletHoldings = (
  value: unknown,
  options: NormalizeTimestampOptions = {}
): TrenchNegativeWalletHoldingsV1 => {
  const holdings = assertRecord(value, 'holdings');
  assertExactKeys(
    holdings,
    ['schema', 'analysisId', 'chain', 'address', 'generatedAt', 'holdings', 'result'],
    ['schema', 'analysisId', 'chain', 'address', 'generatedAt', 'holdings', 'result'],
    'holdings'
  );
  if (holdings.schema !== TRENCH_NEGATIVE_WALLET_HOLDINGS_SCHEMA) {
    throw new Error(`holdings.schema must equal ${TRENCH_NEGATIVE_WALLET_HOLDINGS_SCHEMA}`);
  }
  if (!Array.isArray(holdings.holdings) || holdings.holdings.length > TRENCH_MAX_ARRAY_LENGTH) {
    throw new Error(`holdings.holdings must contain at most ${TRENCH_MAX_ARRAY_LENGTH} items`);
  }
  const chain = assertTrenchChain(holdings.chain, 'holdings.chain');
  const normalized: TrenchNegativeWalletHoldingsV1 = {
    schema: TRENCH_NEGATIVE_WALLET_HOLDINGS_SCHEMA,
    analysisId: assertTrenchRequestId(holdings.analysisId, 'holdings.analysisId'),
    chain,
    address: canonicalizeTrenchAddress(holdings.address, chain, 'holdings.address'),
    generatedAt: normalizeTrenchIsoDate(holdings.generatedAt, 'holdings.generatedAt', options),
    holdings: holdings.holdings.map((item, index) =>
      normalizeHolding(item, chain, `holdings.holdings[${index}]`)
    ),
    result: cloneJsonObject(holdings.result, 'holdings.result')
  };
  const assetKeys = normalized.holdings.map((holding) => holding.contractAddress ?? 'native');
  if (new Set(assetKeys).size !== assetKeys.length) {
    throw new Error('holdings.holdings contains a duplicate asset identity');
  }
  normalized.holdings.sort((left, right) => {
    const leftKey = left.contractAddress ?? '';
    const rightKey = right.contractAddress ?? '';
    return compareText(leftKey, rightKey);
  });
  serializeTrenchDocument(normalized, 'holdings');
  return normalized;
};

const normalizeHolding = (
  value: unknown,
  chain: TrenchChain,
  label: string
): TrenchWalletHolding => {
  const holding = assertRecord(value, label);
  assertExactKeys(
    holding,
    ['contractAddress', 'symbol', 'balance', 'valueUsd', 'portfolioPercent', 'evidence'],
    [],
    label
  );
  const normalized: TrenchWalletHolding = {};
  if (holding.contractAddress !== undefined) {
    normalized.contractAddress = canonicalizeTrenchAddress(
      holding.contractAddress,
      chain,
      `${label}.contractAddress`
    );
  }
  if (holding.symbol !== undefined) {
    normalized.symbol = assertSingleLineString(holding.symbol, `${label}.symbol`, 1, 200).trim();
  }
  if (holding.balance !== undefined) {
    normalized.balance = assertSingleLineString(holding.balance, `${label}.balance`, 1, 256).trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized.balance)) {
      throw new Error(`${label}.balance must be a non-negative fixed-point decimal string`);
    }
  }
  if (holding.valueUsd !== undefined) {
    if (
      typeof holding.valueUsd !== 'number' ||
      !Number.isFinite(holding.valueUsd) ||
      holding.valueUsd < 0
    ) {
      throw new Error(`${label}.valueUsd must be a non-negative finite number`);
    }
    normalized.valueUsd = holding.valueUsd;
  }
  if (holding.portfolioPercent !== undefined) {
    if (
      typeof holding.portfolioPercent !== 'number' ||
      !Number.isFinite(holding.portfolioPercent) ||
      holding.portfolioPercent < 0 ||
      holding.portfolioPercent > 100
    ) {
      throw new Error(`${label}.portfolioPercent must be a finite number from 0 to 100`);
    }
    normalized.portfolioPercent = holding.portfolioPercent;
  }
  if (holding.evidence !== undefined) {
    normalized.evidence = cloneJsonObject(holding.evidence, `${label}.evidence`);
  }
  return normalized;
};

export const createTrenchNegativeWallet = (params: {
  requestId: unknown;
  chain: unknown;
  address: unknown;
  explanation: unknown;
  createdAt: string;
  updatedAt: string;
  now?: number;
}): TrenchNegativeWalletV1 => {
  return normalizeTrenchNegativeWallet(
    {
      schema: TRENCH_NEGATIVE_WALLET_SCHEMA,
      tagId: params.requestId,
      chain: params.chain,
      address: params.address,
      explanation: params.explanation,
      source: 'human-via-agent',
      createdAt: params.createdAt,
      updatedAt: params.updatedAt
    },
    { now: params.now }
  );
};
