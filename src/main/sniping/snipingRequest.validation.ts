import type {
  SnipingActivityListInput,
  SnipingActivityOutcome,
  SnipingActivityProduct,
  SnipingChain,
  SnipingConfigIdentityInput,
  SnipingConfigListInput,
  SnipingConfigSaveInput,
  SnipingExactRequestInput,
  SnipingJsonObject,
  SnipingJsonValue,
  SnipingRegion,
  SnipingReleaseConfigInput,
  SnipingRevisionInput,
  SnipingShadowRequestInput,
  SnipingSimulationEventListInput,
  SnipingSimulationListInput
} from '@shared/sniping/snipingBridge.type';

const CONFIG_ID = /^[1-9]\d{0,18}$/;
const COMPONENT_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SEMVER_IDENTIFIER = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const SEMVER = new RegExp(
  `^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)` +
    `(?:-${SEMVER_IDENTIFIER}(?:\\.${SEMVER_IDENTIFIER})*)?` +
    '(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$'
);
const HASH = /^[0-9a-f]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EVENT_KEY = /^bsc:56:0x[0-9a-f]{64}:0x[0-9a-f]{64}:(0|[1-9]\d{0,9})$/;
const ACTIVITY_ID = /^(?:monitor|exact|shadow):[0-9]{20}$/;
const CHAINS = new Set<SnipingChain>(['bsc', 'ethereum', 'base', 'arbitrum', 'solana']);
const REGIONS = new Set<SnipingRegion>(['sg', 'jp', 'local']);
const ACTIVITY_PRODUCTS = new Set<SnipingActivityProduct>(['monitor', 'exact', 'shadow']);
const ACTIVITY_OUTCOMES = new Set<SnipingActivityOutcome>([
  'hit',
  'filtered',
  'blocked',
  'failed',
  'executable',
  'unknown',
  'duplicate',
  'claimed',
  'expired',
  'retryable'
]);
const FORBIDDEN_SEMANTIC_KEY_TOKENS = new Set([
  'authorization',
  'mnemonic',
  'module',
  'import',
  'command',
  'script',
  'code',
  'calldata',
  'signer',
  'wallet',
  'credential',
  'secret',
  'expression',
  'sessionid',
  'coretoken',
  'password',
  'signature',
  'rawtransaction',
  'rawproviderpayload',
  'url',
  'uri',
  'header',
  'headers'
]);
const FORBIDDEN_PROJECTION_KEY_TOKENS = new Set([
  'authorization',
  'mnemonic',
  'module',
  'import',
  'command',
  'script',
  'calldata',
  'signer',
  'credential',
  'secret',
  'expression',
  'sessionid',
  'coretoken',
  'password',
  'signature',
  'rawtransaction',
  'rawproviderpayload',
  'url',
  'uri',
  'header',
  'headers'
]);
const FORBIDDEN_SEMANTIC_KEY_SEQUENCES = [
  ['api', 'key'],
  ['auth', 'header'],
  ['private', 'key'],
  ['seed', 'phrase'],
  ['database', 'url'],
  ['rpc', 'url'],
  ['endpoint', 'url'],
  ['module', 'path'],
  ['dynamic', 'import'],
  ['handler', 'source'],
  ['script', 'body'],
  ['wallet', 'address'],
  ['credential', 'ref'],
  ['credential', 'reference'],
  ['secret', 'reference'],
  ['secret', 'ref'],
  ['access', 'token']
] as const;
const FORBIDDEN_COMPACT_KEY_SEQUENCES = FORBIDDEN_SEMANTIC_KEY_SEQUENCES.map((parts) =>
  parts.join('')
);
const FORBIDDEN_PROJECTION_COMPACT_KEY_SEQUENCES = FORBIDDEN_SEMANTIC_KEY_SEQUENCES.filter(
  (parts) => parts.join(' ') !== 'wallet address'
).map((parts) => parts.join(''));
const BENIGN_SENSITIVE_LEXEMES = [
  'important',
  'tokenizer',
  'decode',
  'manuscript',
  'keyframe'
] as const;
const TOKEN_CREDENTIAL_CONTEXTS = [
  'auth',
  'authentication',
  'customer',
  'provider',
  'bearer',
  'api',
  'access',
  'refresh',
  'core',
  'session',
  'csrf',
  'id',
  'opaque'
] as const;
const SAFE_TOKEN_DOMAIN_KEYS = new Set([
  'tokenaddress',
  'quotetokenaddress',
  'tokensymbol',
  'tokendecimals',
  'quotetokencodeready',
  'quotetokendecimalsready',
  'declaredquotetokendecimals',
  'tokenlabel',
  'quotetokenlabel',
  'tokencount'
]);
const ALWAYS_FORBIDDEN_VALUE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\b(?:postgres|postgresql):\/\//i,
  /\bhttps?:\/\/[^\s/@:]+:[^\s/@]+@/i,
  /\b(?:sk|pk|gmgn)[_-][A-Za-z0-9_-]{12,}\b/i
];
const FORBIDDEN_SOURCE_VALUE_PATTERNS = [
  /=>/,
  /\b(?:require\s*\(|module\.exports|exports\.|eth_sendRawTransaction|sendRawTransaction|sendTransaction)\b/i,
  /\b(?:dynamic\s+)?import\s*\(/i,
  /(?:^|\s)(?:import|export)\s+(?:\{|\*|default|const|class|function)\b/i,
  /(?:^|\s)(?:const|let|var|class|function)\s+[A-Za-z_$][\w$]*/,
  /(?:^|[/\\])[A-Za-z0-9._-]+\.(?:cjs|mjs|js|ts)(?:$|[?#])/i
];
const URL_VALUE_PATTERN = /\bhttps?:\/\/[^\s]+/i;
const JWT_VALUE_PATTERN = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/;
const ANNOTATION_KEYS = new Set(['title', 'description', '$comment', 'label', 'help']);
const MNEMONIC_WORD_COUNTS = new Set([12, 15, 18, 21, 24]);

export class SnipingInputError extends Error {
  readonly code = 'SNIPING_BRIDGE_INPUT_INVALID';
}

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => character.charCodeAt(0) <= 0x1f || character === '\u007f');

const record = (
  value: unknown,
  allowed: readonly string[],
  required: readonly string[] = []
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SnipingInputError('Sniping request must be an object');
  }
  const input = value as Record<string, unknown>;
  const allowedKeys = new Set(allowed);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new SnipingInputError('Sniping request contains an unknown field');
  }
  if (required.some((key) => !Object.hasOwn(input, key))) {
    throw new SnipingInputError('Sniping request is missing a required field');
  }
  return input;
};

const string = (value: unknown, field: string, maximum: number, pattern?: RegExp): string => {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim() ||
    hasControlCharacter(value) ||
    (pattern && !pattern.test(value))
  )
    throw new SnipingInputError(`${field} is invalid`);
  return value;
};

const integer = (value: unknown, field: string, minimum: number, maximum: number): number => {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new SnipingInputError(`${field} is invalid`);
  }
  return Number(value);
};

const optionalPage = (value: unknown, field: string, fallback: number): number =>
  value === undefined ? fallback : integer(value, field, 1, 1_000_000);

const pageSize = (value: unknown, fallback: number): number =>
  value === undefined ? fallback : integer(value, 'page_size', 1, 100);

const semanticTokens = (value: string): string[] =>
  value
    .normalize('NFKC')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .split('_')
    .filter(Boolean);

const maskedSemanticCompact = (key: string): string => {
  let compact = semanticTokens(key).join('');
  for (const lexeme of BENIGN_SENSITIVE_LEXEMES) {
    compact = compact.split(lexeme).join('#'.repeat(lexeme.length));
  }
  return compact;
};

export const isForbiddenSnipingCredentialTokenKey = (key: string): boolean => {
  const tokens = semanticTokens(key);
  const compact = maskedSemanticCompact(key);
  if (SAFE_TOKEN_DOMAIN_KEYS.has(compact)) return false;
  if (compact.includes('jwt') || compact.includes('jsonwebtoken')) return true;
  if (tokens.includes('token') || compact.includes('token')) return true;
  return TOKEN_CREDENTIAL_CONTEXTS.some(
    (context) => compact.includes(`${context}token`) || compact.includes(`token${context}`)
  );
};

const isForbiddenSemanticKey = (key: string, projection = false): boolean => {
  const compact = maskedSemanticCompact(key);
  if (SAFE_TOKEN_DOMAIN_KEYS.has(compact)) return false;
  if (isForbiddenSnipingCredentialTokenKey(key)) return true;
  const forbiddenTokens = projection
    ? FORBIDDEN_PROJECTION_KEY_TOKENS
    : FORBIDDEN_SEMANTIC_KEY_TOKENS;
  const forbiddenSequences = projection
    ? FORBIDDEN_PROJECTION_COMPACT_KEY_SEQUENCES
    : FORBIDDEN_COMPACT_KEY_SEQUENCES;
  return (
    [...forbiddenTokens].some((token) => compact.includes(token)) ||
    forbiddenSequences.some((sequence) => compact.includes(sequence))
  );
};

const isMnemonicShaped = (value: string): boolean => {
  const words = value.trim().split(/\s+/);
  return (
    MNEMONIC_WORD_COUNTS.has(words.length) && words.every((word) => /^[a-z]{2,16}$/.test(word))
  );
};

const assertSafeStringValue = (value: string, containingKey?: string, projection = false): void => {
  const annotation = containingKey !== undefined && ANNOTATION_KEYS.has(containingKey);
  const schemaIdentifier =
    projection &&
    containingKey === '$schema' &&
    value === 'https://json-schema.org/draft/2020-12/schema';
  if (
    ALWAYS_FORBIDDEN_VALUE_PATTERNS.some((pattern) => pattern.test(value)) ||
    JWT_VALUE_PATTERN.test(value) ||
    (!schemaIdentifier && URL_VALUE_PATTERN.test(value)) ||
    (!annotation &&
      (FORBIDDEN_SOURCE_VALUE_PATTERNS.some((pattern) => pattern.test(value)) ||
        isMnemonicShaped(value)))
  )
    throw new SnipingInputError('config contains secret-like or executable content');
};

export const assertSafeSnipingFreeText = (value: string): void => {
  assertSafeStringValue(value);
  const normalized = value.normalize('NFKC');
  const assignmentKey = normalized.match(/^\s*([^:=]{1,64})\s*[:=]/)?.[1];
  const assignmentCompact = assignmentKey ? semanticTokens(assignmentKey).join('') : '';
  if (
    (assignmentKey &&
      (isForbiddenSemanticKey(assignmentKey) ||
        ['providerreference', 'providerref', 'providerid', 'componentpath'].some((key) =>
          assignmentCompact.includes(key)
        ))) ||
    /(?:^|\s)[a-z][a-z0-9+.-]*:\S+/i.test(normalized) ||
    /(?:^|\s)(?:[^\s/@]+@)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{1,5})?(?:\/\S*)?(?:$|\s)/i.test(
      normalized
    ) ||
    /(?:^|\s)(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:]+\])(?::\d{1,5})?(?:\/\S*)?(?:$|\s)/i.test(
      normalized
    ) ||
    /(?:^|[\s=])(?:\.{0,2}\/|[A-Za-z]:\\)\S*/.test(normalized)
  ) {
    throw new SnipingInputError('text contains credential-like metadata');
  }
};

const configId = (value: unknown): string => {
  const id = string(value, 'config_id', 19, CONFIG_ID);
  if (BigInt(id) > 9_223_372_036_854_775_807n) throw new SnipingInputError('config_id is invalid');
  return id;
};

const cloneJson = (
  value: unknown,
  path = '$config',
  depth = 0,
  containingKey?: string,
  projection = false
): SnipingJsonValue => {
  if (depth > 12) throw new SnipingInputError(`${path} is too deeply nested`);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    assertSafeStringValue(value, containingKey, projection);
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 256) throw new SnipingInputError(`${path} has too many items`);
    return value.map((item, index) =>
      cloneJson(item, `${path}/${index}`, depth + 1, containingKey, projection)
    );
  }
  if (!value || typeof value !== 'object') throw new SnipingInputError(`${path} is not JSON`);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 128) throw new SnipingInputError(`${path} has too many fields`);
  const result: SnipingJsonObject = {};
  for (const [key, item] of entries) {
    if (
      key.length < 1 ||
      key.length > 128 ||
      (!ANNOTATION_KEYS.has(key) && isForbiddenSemanticKey(key, projection))
    ) {
      throw new SnipingInputError(`${path} contains a forbidden field`);
    }
    result[key] = cloneJson(item, `${path}/${key}`, depth + 1, key, projection);
  }
  return result;
};

const jsonObject = (value: unknown): SnipingJsonObject => {
  const cloned = cloneJson(value);
  if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) {
    throw new SnipingInputError('config must be an object');
  }
  if (JSON.stringify(cloned).length > 262_144) throw new SnipingInputError('config is too large');
  return cloned;
};

export const parseSafeSnipingJsonObject = (value: unknown): SnipingJsonObject => jsonObject(value);

export const parseSafeSnipingProjectionJsonObject = (value: unknown): SnipingJsonObject => {
  const cloned = cloneJson(value, '$projection', 0, undefined, true);
  if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) {
    throw new SnipingInputError('projection must be an object');
  }
  if (JSON.stringify(cloned).length > 262_144)
    throw new SnipingInputError('projection is too large');
  return cloned;
};

const releaseConfig = (value: unknown): SnipingReleaseConfigInput => {
  const input = record(
    value,
    ['component_id', 'component_version', 'schema_hash', 'chain', 'config'],
    ['component_id', 'component_version', 'schema_hash', 'chain', 'config']
  );
  if (!CHAINS.has(input.chain as SnipingChain)) throw new SnipingInputError('chain is invalid');
  return {
    component_id: string(input.component_id, 'component_id', 64, COMPONENT_ID),
    component_version: string(input.component_version, 'component_version', 64, SEMVER),
    schema_hash: string(input.schema_hash, 'schema_hash', 64, HASH),
    chain: input.chain as SnipingChain,
    config: jsonObject(input.config)
  };
};

export const parseSnipingConfigListInput = (value: unknown = {}): SnipingConfigListInput => {
  const input = record(value, ['page', 'page_size', 'search_text']);
  const search =
    input.search_text === undefined ? undefined : string(input.search_text, 'search_text', 128);
  return {
    page: optionalPage(input.page, 'page', 1),
    page_size: pageSize(input.page_size, 20),
    ...(search === undefined ? {} : { search_text: search })
  };
};

export const parseSnipingConfigIdentityInput = (value: unknown): SnipingConfigIdentityInput => {
  const input = record(value, ['config_id'], ['config_id']);
  return { config_id: configId(input.config_id) };
};

export const parseSnipingReleaseConfigInput = (value: unknown): SnipingReleaseConfigInput =>
  releaseConfig(value);

export const parseSnipingConfigSaveInput = (value: unknown): SnipingConfigSaveInput => {
  const input = record(
    value,
    [
      'config_id',
      'name',
      'component_id',
      'component_version',
      'schema_hash',
      'chain',
      'config',
      'primary_region',
      'standby_region',
      'expected_revision'
    ],
    [
      'name',
      'component_id',
      'component_version',
      'schema_hash',
      'chain',
      'config',
      'primary_region',
      'standby_region',
      'expected_revision'
    ]
  );
  const release = releaseConfig({
    component_id: input.component_id,
    component_version: input.component_version,
    schema_hash: input.schema_hash,
    chain: input.chain,
    config: input.config
  });
  if (
    !REGIONS.has(input.primary_region as SnipingRegion) ||
    !REGIONS.has(input.standby_region as SnipingRegion)
  ) {
    throw new SnipingInputError('region is invalid');
  }
  if (input.primary_region === input.standby_region)
    throw new SnipingInputError('regions must differ');
  const expectedRevision = integer(input.expected_revision, 'expected_revision', 0, 2_147_483_647);
  const id = input.config_id === undefined ? undefined : configId(input.config_id);
  if ((!id && expectedRevision !== 0) || (id && expectedRevision < 1)) {
    throw new SnipingInputError('expected_revision does not match create/update mode');
  }
  return {
    ...release,
    ...(id ? { config_id: id } : {}),
    name: string(input.name, 'name', 128),
    primary_region: input.primary_region as SnipingRegion,
    standby_region: input.standby_region as SnipingRegion,
    expected_revision: expectedRevision
  };
};

const revision = (input: Record<string, unknown>): SnipingRevisionInput => ({
  config_id: configId(input.config_id),
  expected_revision: integer(input.expected_revision, 'expected_revision', 1, 2_147_483_647)
});

export const parseSnipingRevisionInput = (value: unknown): SnipingRevisionInput => {
  const input = record(
    value,
    ['config_id', 'expected_revision'],
    ['config_id', 'expected_revision']
  );
  return revision(input);
};

export const parseSnipingSimulationListInput = (value: unknown): SnipingSimulationListInput => {
  const input = record(value, ['config_id', 'page', 'page_size'], ['config_id']);
  return {
    config_id: configId(input.config_id),
    page: optionalPage(input.page, 'page', 1),
    page_size: pageSize(input.page_size, 20)
  };
};

export const parseSnipingSimulationEventListInput = (
  value: unknown
): SnipingSimulationEventListInput => parseSnipingSimulationListInput(value);

export const parseSnipingExactRequestInput = (value: unknown): SnipingExactRequestInput => {
  const input = record(
    value,
    ['config_id', 'expected_revision', 'request_id', 'canonical_event_key'],
    ['config_id', 'expected_revision', 'request_id', 'canonical_event_key']
  );
  return {
    ...revision(input),
    request_id: string(input.request_id, 'request_id', 128, REQUEST_ID),
    canonical_event_key: string(input.canonical_event_key, 'canonical_event_key', 256, EVENT_KEY)
  };
};

export const parseSnipingShadowRequestInput = (value: unknown): SnipingShadowRequestInput => {
  const input = record(
    value,
    ['config_id', 'expected_revision', 'request_id', 'shadow_policy'],
    ['config_id', 'expected_revision', 'request_id', 'shadow_policy']
  );
  const policy = record(
    input.shadow_policy,
    ['max_events', 'checkpoint_blocks', 'evidence_ttl_seconds'],
    ['max_events', 'checkpoint_blocks', 'evidence_ttl_seconds']
  );
  if (!Array.isArray(policy.checkpoint_blocks))
    throw new SnipingInputError('checkpoint_blocks is invalid');
  const blocks = policy.checkpoint_blocks.map((item) =>
    integer(item, 'checkpoint_blocks', 1, 100_000)
  );
  if (
    blocks.length < 1 ||
    blocks.length > 8 ||
    new Set(blocks).size !== blocks.length ||
    blocks.some((block, index) => index > 0 && block <= blocks[index - 1])
  ) {
    throw new SnipingInputError('checkpoint_blocks is invalid');
  }
  return {
    ...revision(input),
    request_id: string(input.request_id, 'request_id', 128, REQUEST_ID),
    shadow_policy: {
      max_events: integer(policy.max_events, 'max_events', 1, 500),
      checkpoint_blocks: blocks,
      evidence_ttl_seconds: integer(policy.evidence_ttl_seconds, 'evidence_ttl_seconds', 60, 86_400)
    }
  };
};

export const parseSnipingActivityListInput = (value: unknown = {}): SnipingActivityListInput => {
  const input = record(value, [
    'page_size',
    'product',
    'outcome',
    'chain',
    'search_text',
    'cursor'
  ]);
  if (
    input.product !== undefined &&
    !ACTIVITY_PRODUCTS.has(input.product as SnipingActivityProduct)
  ) {
    throw new SnipingInputError('product is invalid');
  }
  if (
    input.outcome !== undefined &&
    !ACTIVITY_OUTCOMES.has(input.outcome as SnipingActivityOutcome)
  ) {
    throw new SnipingInputError('outcome is invalid');
  }
  if (input.chain !== undefined && !CHAINS.has(input.chain as SnipingChain)) {
    throw new SnipingInputError('chain is invalid');
  }
  let search: string | undefined;
  if (input.search_text !== undefined) {
    search = string(input.search_text, 'search_text', 64);
    if ([...search].length > 64) throw new SnipingInputError('search_text is invalid');
  }
  let cursor: SnipingActivityListInput['cursor'];
  if (input.cursor !== undefined) {
    const raw = record(input.cursor, ['created_at', 'activity_id'], ['created_at', 'activity_id']);
    const createdAt = string(raw.created_at, 'cursor.created_at', 24);
    if (new Date(createdAt).toISOString() !== createdAt)
      throw new SnipingInputError('cursor is invalid');
    cursor = {
      created_at: createdAt,
      activity_id: string(raw.activity_id, 'cursor.activity_id', 28, ACTIVITY_ID)
    };
  }
  return {
    page_size: pageSize(input.page_size, 50),
    ...(input.product === undefined ? {} : { product: input.product as SnipingActivityProduct }),
    ...(input.outcome === undefined ? {} : { outcome: input.outcome as SnipingActivityOutcome }),
    ...(input.chain === undefined ? {} : { chain: input.chain as SnipingChain }),
    ...(search === undefined ? {} : { search_text: search }),
    ...(cursor === undefined ? {} : { cursor })
  };
};
