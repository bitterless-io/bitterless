import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseSafeSnipingJsonObject,
  parseSafeSnipingProjectionJsonObject,
  parseSnipingConfigSaveInput,
  parseSnipingShadowRequestInput,
} from '../../../src/main/sniping/snipingRequest.validation';

const RELEASE = {
  component_id: 'flap-quote-token-snipe',
  component_version: '1.0.0',
  schema_hash: 'a'.repeat(64),
  chain: 'bsc' as const,
};

const TOKEN_ALIAS_KEYS = [
  'token', 'TOKEN', 'ｔｏｋｅｎ', 'jwt', 'JWT', 'ｊｗｔ', 'jsonWebToken',
  'customerJwt', 'customer_jwt', 'customer-jwt', 'customerjwt', 'prefixCustomerJwtSuffix',
  'authToken', 'tokenAuth', 'authentication_token', 'customer-token', 'providerAccessToken',
  'bearerToken', 'api_token', 'access-token', 'refreshToken', 'core_token', 'sessionToken',
  'csrf-token', 'idToken', 'opaqueToken', 'prefixAuthTokenSuffix', 'someTokenValue',
  'auth_token_address',
] as const;

const SAFE_TOKEN_DOMAIN_PROJECTION = {
  token_address: `0x${'1'.repeat(40)}`,
  quote_token_address: `0x${'2'.repeat(40)}`,
  token_symbol: 'SPCX',
  token_decimals: 18,
  quote_token_code_ready: true,
  quote_token_decimals_ready: true,
  declared_quote_token_decimals: 18,
  token_label: 'Target token',
  quote_token_label: 'SPCX',
  token_count: 3,
  provider_reference_ids: ['bsc-read-sg', 'bsc-read-jp'],
};

test('request and response projection scanners reject normalized token and JWT alias keys recursively', () => {
  for (const parse of [parseSafeSnipingJsonObject, parseSafeSnipingProjectionJsonObject]) {
    for (const key of TOKEN_ALIAS_KEYS) {
      assert.throws(
        () => parse({ outer: [{ evidence: { [key]: 'opaque-secret-value' } }] }),
        /forbidden field/,
        `${parse.name}: ${key}`,
      );
    }
  }
});

test('request and response scanners preserve exact token-domain evidence and benign lexical boundaries', () => {
  const value = {
    ...SAFE_TOKEN_DOMAIN_PROJECTION,
    important: 'high',
    tokenizer: 'domain parser',
    keyframe: 12,
    nested: [{ manuscript: 'evidence', decode: 'disabled' }],
  };
  assert.deepEqual(parseSafeSnipingJsonObject(value), value);
  assert.deepEqual(parseSafeSnipingProjectionJsonObject(value), value);
});

test('JWT-shaped values fail closed under benign keys while non-JWT opaque values remain valid', () => {
  const jwt = `${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}`;
  for (const parse of [parseSafeSnipingJsonObject, parseSafeSnipingProjectionJsonObject]) {
    assert.throws(() => parse({ harmless: jwt }), /secret-like/, parse.name);
    assert.deepEqual(parse({ harmless: 'opaque-domain-evidence-0123456789' }), {
      harmless: 'opaque-domain-evidence-0123456789',
    });
  }
});

test('config input recursively rejects credential, endpoint, execution, and source aliases', () => {
  for (const key of [
    'providerApiKey',
    'credentialRef',
    'customerPrivateKey',
    'rpcUrl',
    'wallet-address',
    'raw_transaction',
    'ｒｐｃＵｒｌ',
  ]) {
    assert.throws(
      () => parseSafeSnipingJsonObject({ [key]: 'redacted' }),
      /forbidden field/,
      key,
    );
  }
  assert.throws(
    () => parseSafeSnipingJsonObject({ nested: { harmless: 'Bearer secret-value' } }),
    /secret-like or executable content/,
  );
  assert.throws(
    () => parseSafeSnipingJsonObject({ nested: { harmless: 'eth_sendRawTransaction(value)' } }),
    /secret-like or executable content/,
  );
});

test('compiled provider profile identifiers remain allowed without accepting credential references', () => {
  assert.deepEqual(
    parseSafeSnipingJsonObject({
      provider_reference_ids: ['bsc-read-sg', 'bsc-read-jp'],
      quote_token_address: `0x${'1'.repeat(40)}`,
      minimum_output_bps: 9_500,
    }),
    {
      provider_reference_ids: ['bsc-read-sg', 'bsc-read-jp'],
      quote_token_address: `0x${'1'.repeat(40)}`,
      minimum_output_bps: 9_500,
    },
  );
});

test('config scanner rejects every renderer-supplied URL and header including annotations', () => {
  for (const value of [
    { url: 'value' },
    { requestUrl: 'value' },
    { uri: 'value' },
    { headers: { x: 'value' } },
    { requestHeader: 'value' },
    { url_latency_ms: 3 },
    { nested: { endpoint: 'https://evil.test/path' } },
    { title: 'https://evil.test/title' },
    { description: 'Documentation: https://evil.test/description' },
    { $comment: 'https://evil.test/comment' },
    { label: 'https://evil.test/label' },
    { help: 'https://evil.test/help' },
  ]) assert.throws(() => parseSafeSnipingJsonObject(value), /forbidden field|secret-like/);
  assert.deepEqual(parseSafeSnipingJsonObject({ description: 'Annotation text without a URL.' }), {
    description: 'Annotation text without a URL.',
  });
});

test('save and shadow envelopes are closed and bounded', () => {
  assert.deepEqual(parseSnipingConfigSaveInput({
    ...RELEASE,
    name: 'SPCX watcher',
    config: {
      quote_token_address: `0x${'1'.repeat(40)}`,
      spend_amount_decimal: '0.1',
    },
    primary_region: 'sg',
    standby_region: 'jp',
    expected_revision: 0,
  }).expected_revision, 0);
  assert.throws(() => parseSnipingConfigSaveInput({
    ...RELEASE,
    name: 'unsafe',
    config: {},
    primary_region: 'sg',
    standby_region: 'jp',
    expected_revision: 0,
    coreToken: 'secret',
  }), /unknown field/);

  assert.deepEqual(parseSnipingShadowRequestInput({
    config_id: '12',
    expected_revision: 3,
    request_id: 'shadow-1',
    shadow_policy: {
      max_events: 30,
      checkpoint_blocks: [1, 3, 12],
      evidence_ttl_seconds: 900,
    },
  }).shadow_policy.checkpoint_blocks, [1, 3, 12]);
  assert.throws(() => parseSnipingShadowRequestInput({
    config_id: '12',
    expected_revision: 3,
    request_id: 'shadow-1',
    shadow_policy: {
      max_events: 30,
      checkpoint_blocks: [3, 1],
      evidence_ttl_seconds: 900,
    },
  }), /checkpoint_blocks is invalid/);
});

test('pinned release input requires strict SemVer identifiers', () => {
  for (const componentVersion of ['1.0.0-01', '1.0.0-..', '1.0.0-alpha..1', '1.0.0+']) {
    assert.throws(() => parseSnipingConfigSaveInput({
      ...RELEASE,
      component_version: componentVersion,
      name: 'strict release',
      config: {},
      primary_region: 'sg',
      standby_region: 'jp',
      expected_revision: 0,
    }), /component_version is invalid/);
  }
  assert.equal(parseSnipingConfigSaveInput({
    ...RELEASE,
    component_version: '1.0.0-alpha.1+build.7',
    name: 'strict release',
    config: {},
    primary_region: 'sg',
    standby_region: 'jp',
    expected_revision: 0,
  }).component_version, '1.0.0-alpha.1+build.7');
});
