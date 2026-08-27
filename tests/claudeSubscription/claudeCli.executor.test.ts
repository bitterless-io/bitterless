import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLAUDE_DECISION_SCHEMA,
  CLAUDE_ISOLATED_SETTINGS,
  ClaudeCliExecutor,
  assertClaudeSubscriptionPreflight,
  buildClaudeAuthStatusArguments,
  buildClaudeExecutionArguments,
  validateClaudeDecision,
  type ClaudeExecutionRequest
} from '../../src/main/claudeSubscription/claudeCli.executor';
import {
  CLAUDE_COMPETING_AUTH_VARIABLES,
  buildClaudeSubscriptionEnvironment
} from '../../src/main/claudeSubscription/claudeSubscription.environment';
import {
  ClaudeAuthenticationError,
  ClaudeDecisionError,
  ClaudeExecutionError,
  ClaudeRequestAbortedError,
  ClaudeSubscriptionRequiredError,
  ClaudeTimeoutError,
  ClaudeUsageLimitError,
  isClaudeRoutingFailure
} from '../../src/main/claudeSubscription/claudeSubscription.errors';
import {
  buildClaudeBridgePayload,
  parseClaudeResponsesRequest
} from '../../src/main/claudeSubscription/claudeResponses.translator';
import { redactClaudeSubscriptionSecrets } from '../../src/shared/claudeSubscription/claudeSubscription.redaction';
import { fakeClaudeScript, readClaudeFixture } from './claudeSubscriptionTest.helper';

const executionRequest = async (): Promise<ClaudeExecutionRequest> => {
  const raw = await readClaudeFixture<unknown>('codex-tool-request.json');
  return {
    model: 'opus',
    effort: 'high',
    payload: buildClaudeBridgePayload(parseClaudeResponsesRequest(raw)),
    context: {
      configDirectory: '/tmp/bitterless-claude-account-a/profile',
      secureStorageConfigDirectory: '/tmp/bitterless-claude-account-a/profile',
      anthropicConfigDirectory: '/tmp/bitterless-claude-account-a/profile/anthropic'
    }
  };
};

const executor = (
  mode: string,
  options: {
    timeoutMs?: number;
    authStatusTimeoutMs?: number;
    stdoutLimitBytes?: number;
    parentEnvironment?: NodeJS.ProcessEnv;
  } = {}
): ClaudeCliExecutor =>
  new ClaudeCliExecutor({
    claudeExecutable: process.execPath,
    commandPrefixArguments: [fakeClaudeScript, mode],
    ...options
  });

test('builds an allowlisted child environment with exact isolated directories and no token', () => {
  const child = buildClaudeSubscriptionEnvironment(
    {
      PATH: '/usr/bin',
      HOME: '/Users/test',
      HTTPS_PROXY: 'http://127.0.0.1:8080',
      ANTHROPIC_API_KEY: 'sk-ant-api-danger',
      ANTHROPIC_AUTH_TOKEN: 'auth-danger',
      CLAUDE_CODE_OAUTH_TOKEN: 'inherited-danger',
      CLAUDE_CODE_REFRESH_TOKEN: 'refresh-danger',
      ANTHROPIC_BASE_URL: 'https://danger.example',
      ANTHROPIC_PROFILE: 'danger',
      CLAUDE_CODE_API_KEY_HELPER: '/tmp/helper',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_VERTEX: '1',
      CLAUDE_CODE_USE_FOUNDRY: '1',
      AWS_SECRET_ACCESS_KEY: 'aws-danger',
      GOOGLE_APPLICATION_CREDENTIALS: '/tmp/google-danger',
      RANDOM_SECRET: 'must-not-pass'
    },
    {
      configDirectory: '/tmp/account-profile',
      secureStorageConfigDirectory: '/tmp/account-profile',
      anthropicConfigDirectory: '/tmp/account-profile/anthropic'
    }
  );

  assert.equal(child.PATH, '/usr/bin');
  assert.equal(child.HTTPS_PROXY, 'http://127.0.0.1:8080');
  assert.equal(child.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(child.CLAUDE_CONFIG_DIR, '/tmp/account-profile');
  assert.equal(child.CLAUDE_SECURESTORAGE_CONFIG_DIR, '/tmp/account-profile');
  assert.equal(child.ANTHROPIC_CONFIG_DIR, '/tmp/account-profile/anthropic');
  assert.equal(child.RANDOM_SECRET, undefined);
  for (const name of CLAUDE_COMPETING_AUTH_VARIABLES) {
    if (
      name === 'CLAUDE_CONFIG_DIR' ||
      name === 'CLAUDE_SECURESTORAGE_CONFIG_DIR' ||
      name === 'ANTHROPIC_CONFIG_DIR'
    ) {
      continue;
    }
    assert.equal(child[name], undefined, `${name} must not be inherited`);
  }
  assert.throws(
    () =>
      buildClaudeSubscriptionEnvironment(
        {},
        {
          configDirectory: 'relative/config',
          secureStorageConfigDirectory: 'relative/config',
          anthropicConfigDirectory: 'relative/config/anthropic'
        }
      ),
    ClaudeExecutionError
  );
});

test('uses safe-mode isolation for preflight and no-tool execution', () => {
  const args = buildClaudeExecutionArguments('sonnet', 'high', '/tmp/system-prompt.txt');
  const serialized = JSON.stringify(args);
  assert.match(serialized, /--safe-mode/u);
  assert.match(serialized, /--setting-sources/u);
  assert.match(serialized, /apiKeyHelper/u);
  assert.equal(CLAUDE_ISOLATED_SETTINGS.apiKeyHelper, null);
  assert.match(serialized, /--no-chrome/u);
  assert.match(serialized, /--strict-mcp-config/u);
  assert.match(serialized, /mcpServers/u);
  assert.match(serialized, /--no-session-persistence/u);
  assert.match(serialized, /--json-schema/u);
  assert.doesNotMatch(serialized, /--bare|selected-token/u);

  const authStatus = buildClaudeAuthStatusArguments();
  assert.deepEqual(authStatus.slice(-3), ['auth', 'status', '--json']);
  assert.match(JSON.stringify(authStatus), /apiKeyHelper/u);
  assert.throws(() => new ClaudeCliExecutor({ claudeExecutable: 'claude' }), /absolute path/u);
  assert.throws(
    () => new ClaudeCliExecutor({ claudeExecutable: process.execPath, timeoutMs: 0 }),
    /execution timeout/u
  );
  assert.throws(
    () =>
      new ClaudeCliExecutor({
        claudeExecutable: process.execPath,
        authStatusTimeoutMs: 0
      }),
    /authentication timeout/u
  );
});

test('preflight accepts only paid first-party Claude.ai OAuth without API-key sources', () => {
  const valid = {
    stdout: JSON.stringify({
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      subscriptionType: 'max',
      email: 'ral@example.com'
    }),
    stderr: '',
    exitCode: 0,
    signal: null
  };
  assert.deepEqual(assertClaudeSubscriptionPreflight(valid), {
    loggedIn: true,
    authMethod: 'claude.ai',
    apiProvider: 'firstParty',
    subscriptionType: 'max',
    email: 'ral@example.com'
  });
  assert.deepEqual(
    assertClaudeSubscriptionPreflight({
      ...valid,
      stdout: JSON.stringify({ ...JSON.parse(valid.stdout), email: null })
    }),
    {
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      subscriptionType: 'max'
    }
  );

  const invalid = [
    { ...JSON.parse(valid.stdout), apiKeySource: 'apiKeyHelper' },
    { ...JSON.parse(valid.stdout), apiKeySource: null },
    { ...JSON.parse(valid.stdout), authMethod: 'api_key' },
    { ...JSON.parse(valid.stdout), authMethod: 'oauth_token' },
    { ...JSON.parse(valid.stdout), apiProvider: 'bedrock' },
    { ...JSON.parse(valid.stdout), loggedIn: false },
    { ...JSON.parse(valid.stdout), forcedLoginMethod: 'console' }
  ];
  for (const status of invalid) {
    assert.throws(
      () => assertClaudeSubscriptionPreflight({ ...valid, stdout: JSON.stringify(status) }),
      ClaudeAuthenticationError
    );
  }
  for (const subscriptionType of [null, 'free', 'unknown']) {
    assert.throws(
      () =>
        assertClaudeSubscriptionPreflight({
          ...valid,
          stdout: JSON.stringify({ ...JSON.parse(valid.stdout), subscriptionType })
        }),
      ClaudeSubscriptionRequiredError
    );
  }
  assert.throws(
    () => assertClaudeSubscriptionPreflight({ ...valid, stdout: 'not-json' }),
    ClaudeAuthenticationError
  );
  assert.throws(
    () => assertClaudeSubscriptionPreflight({ ...valid, exitCode: 1 }),
    ClaudeAuthenticationError
  );
});

test('executes final and available tool decisions through an isolated fake CLI', async () => {
  const final = await executor('final').execute(await executionRequest());
  assert.deepEqual(final.decision, { action: 'final', text: 'hello from fake Claude' });
  assert.deepEqual(final.rawUsage.usage, {
    input_tokens: 7,
    cache_read_input_tokens: 2,
    output_tokens: 3
  });

  const tool = await executor('tool').execute(await executionRequest());
  assert.deepEqual(tool.decision, {
    action: 'tool_call',
    toolName: 'read_file',
    argumentsJson: '{"path":"package.json"}'
  });
  const request = await executionRequest();
  assert.throws(
    () =>
      validateClaudeDecision(
        { action: 'final', text: 'ok', extra: true },
        request.payload.available_tools
      ),
    ClaudeDecisionError
  );
  await assert.rejects(
    executor('malformed').execute(await executionRequest()),
    ClaudeDecisionError
  );
});

test('quota state comes from the CLI stream, not from the diagnostic text', async () => {
  // Execution must stream: `rate_limit_event` is emitted in no other output format,
  // and `--verbose` is mandatory for `stream-json` under `--print`.
  const argv = buildClaudeExecutionArguments('sonnet', 'low', '/tmp/system-prompt.txt');
  assert.equal(argv[argv.indexOf('--output-format') + 1], 'stream-json');
  assert.ok(argv.includes('--verbose'));
  assert.ok(!argv.includes('json'), 'the single-object output format carries no quota signal');

  // Success path: NDJSON parses, and the observed state is exposed to callers.
  const final = await executor('final').execute(await executionRequest());
  assert.deepEqual(final.decision, { action: 'final', text: 'hello from fake Claude' });
  assert.deepEqual(final.rateLimit, {
    status: 'allowed',
    resetsAt: 1999999999,
    rateLimitType: 'five_hour'
  });

  // A 429 whose text matches the legacy pattern while Anthropic still reports
  // `allowed` must not be treated as exhaustion — this is what cooled down
  // accounts that had quota left.
  await assert.rejects(
    executor('rate-limit-allowed').execute(await executionRequest()),
    (error) => {
      assert.ok(
        !(error instanceof ClaudeUsageLimitError),
        'must not be classified as a usage limit'
      );
      assert.equal(isClaudeRoutingFailure(error), false, 'must not trigger cooldown or failover');
      return true;
    }
  );

  // A real stop uses the reported reset, in preference to the timestamp in the text.
  await assert.rejects(
    executor('rate-limit-exceeded').execute(await executionRequest()),
    (error: unknown) => {
      assert.ok(error instanceof ClaudeUsageLimitError);
      assert.equal(error.resetAt, 1999999999 * 1000);
      return true;
    }
  );
});

test('the decision schema stays within Anthropic tool-schema limits', async () => {
  // `--json-schema` is sent as a tool `input_schema`, which rejects a top-level
  // combinator with `400 … does not support oneOf, allOf, or anyOf at the top
  // level`. That failed every request before the model was reached.
  // See docs/issues/claude-subscription-decision-schema-rejected.md.
  const schema = CLAUDE_DECISION_SCHEMA as Record<string, unknown>;
  for (const combinator of ['oneOf', 'allOf', 'anyOf']) {
    assert.equal(schema[combinator], undefined, `top-level ${combinator} is rejected by the API`);
  }
  assert.equal(schema.type, 'object');
  assert.deepEqual(
    (schema.properties as Record<string, { enum?: readonly string[] }>).action.enum,
    ['final', 'tool_call']
  );

  // Flattening moved the per-variant rule entirely into validation, so both
  // directions have to hold there.
  const request = await executionRequest();
  const tools = request.payload.available_tools;

  assert.deepEqual(validateClaudeDecision({ action: 'final', text: 'ok' }, tools), {
    action: 'final',
    text: 'ok'
  });

  // A structured-output model may echo the unused variant's fields as empty
  // strings now that the schema declares all four. That is not a decision.
  assert.deepEqual(
    validateClaudeDecision({ action: 'final', text: 'ok', tool_name: '', arguments: '' }, tools),
    { action: 'final', text: 'ok' }
  );

  // A populated foreign field is genuinely ambiguous and must still be refused.
  assert.throws(
    () => validateClaudeDecision({ action: 'final', text: 'ok', tool_name: 'read_file' }, tools),
    ClaudeDecisionError
  );
  assert.throws(
    () => validateClaudeDecision({ action: 'tool_call', arguments: '{}' }, tools),
    ClaudeDecisionError
  );
});

test('passes the per-request Claude effort to the child process', async () => {
  const request = await executionRequest();
  request.effort = 'xhigh';
  const result = await executor('effort').execute(request);
  assert.deepEqual(result.decision, { action: 'final', text: 'effort-xhigh' });
});

test('the child observes no competing credentials and a 0600 system prompt', async () => {
  const result = await executor('environment', {
    parentEnvironment: {
      ...process.env,
      ANTHROPIC_API_KEY: 'sk-ant-api-secret',
      ANTHROPIC_AUTH_TOKEN: 'auth-secret',
      CLAUDE_CODE_OAUTH_TOKEN: 'wrong-token',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_VERTEX: '1',
      CLAUDE_CODE_USE_FOUNDRY: '1',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      GOOGLE_APPLICATION_CREDENTIALS: '/tmp/google-secret',
      BITTERLESS_CLAUDE_TEST_SECRET: 'private'
    }
  }).execute(await executionRequest());
  assert.deepEqual(result.decision, { action: 'final', text: 'environment-ok' });
});

test('classifies only explicit auth and subscription limit diagnostics', async () => {
  await assert.rejects(
    executor('auth-api-key-source').execute(await executionRequest()),
    ClaudeAuthenticationError
  );
  await assert.rejects(
    executor('usage-limit').execute(await executionRequest()),
    (error: unknown) => {
      assert.ok(error instanceof ClaudeUsageLimitError);
      assert.equal(error.resetAt, 1_999_999_999_000);
      return true;
    }
  );
  await assert.rejects(
    executor('authentication').execute(await executionRequest()),
    (error: unknown) => {
      assert.ok(error instanceof ClaudeAuthenticationError);
      assert.doesNotMatch(error.message, /sk-ant|secret-code|secret-state|claude\.ai/u);
      return true;
    }
  );
});

test('bounds output and terminates timeout and cancelled children', async () => {
  await assert.rejects(
    executor('oversized', { stdoutLimitBytes: 128 }).execute(await executionRequest()),
    ClaudeExecutionError
  );

  const timeoutStarted = Date.now();
  await assert.rejects(
    executor('hang', { timeoutMs: 40 }).execute(await executionRequest()),
    ClaudeTimeoutError
  );
  assert.ok(Date.now() - timeoutStarted < 2_000);

  const controller = new AbortController();
  const pending = executor('hang', { timeoutMs: 5_000 }).execute(await executionRequest(), {
    signal: controller.signal
  });
  setTimeout(() => controller.abort(), 40);
  await assert.rejects(pending, ClaudeRequestAbortedError);
});

test('maps auth-status process failures to authentication while preserving caller abort', async () => {
  const timeoutStarted = Date.now();
  await assert.rejects(
    executor('preflight-hang', {
      authStatusTimeoutMs: 40,
      timeoutMs: 5_000
    }).execute(await executionRequest()),
    ClaudeAuthenticationError
  );
  assert.ok(Date.now() - timeoutStarted < 2_000);

  const startFailure = new ClaudeCliExecutor({
    claudeExecutable: process.execPath,
    spawnProcess: (): never => {
      throw new Error('fake process start failure');
    }
  });
  await assert.rejects(startFailure.execute(await executionRequest()), ClaudeAuthenticationError);

  const controller = new AbortController();
  const pending = executor('preflight-hang', {
    authStatusTimeoutMs: 5_000,
    timeoutMs: 5_000
  }).execute(await executionRequest(), { signal: controller.signal });
  setTimeout(() => controller.abort(), 40);
  await assert.rejects(pending, ClaudeRequestAbortedError);
});

test('redacts tokens, bearer values, JSON auth fields, and complete OAuth URLs', () => {
  const raw =
    'Bearer secret.value sk-ant-oat01-secret CLAUDE_CODE_OAUTH_TOKEN=another-secret https://claude.ai/oauth/authorize?client_id=my-client&redirect_uri=http%3A%2F%2Flocalhost&code=my-code&state=my-state ' +
    '{"authorization_code":"plain-code","auth":"Basic opaque-auth"} ' +
    String.raw`{\"url\":\"https:\/\/claude.com\/oauth\/authorize?client_id=escaped&state=opaque\"}`;
  const redacted = redactClaudeSubscriptionSecrets(raw);
  assert.doesNotMatch(
    redacted,
    /secret\.value|oat01-secret|another-secret|my-client|localhost|my-code|my-state|plain-code|opaque-auth|escaped|claude\.(?:ai|com)/u
  );
  assert.match(redacted, /REDACTED_AUTHORIZATION_URL/u);
  assert.match(redacted, /\[REDACTED/u);
});
