import assert from 'node:assert/strict';
import test from 'node:test';
import { ZodError } from 'zod';
import {
  CLAUDE_SUBSCRIPTION_SNAPSHOT_SCHEMA,
  parseClaudeSubscriptionActionResult,
  parseClaudeSubscriptionAccountIdInput,
  parseClaudeSubscriptionFlowIdInput,
  parseClaudeSubscriptionRenameAccountInput,
  parseClaudeSubscriptionSetAccountEnabledInput,
  parseClaudeSubscriptionSnapshot,
  parseClaudeSubscriptionStartAuthInput,
  parseClaudeSubscriptionSubmitAuthCodeInput
} from '../../src/shared/claudeSubscription';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const FLOW_ID = '00000000-0000-4000-8000-000000000002';

const createValidSnapshot = () => ({
  schema: CLAUDE_SUBSCRIPTION_SNAPSHOT_SCHEMA,
  revision: 7,
  observedAt: Date.parse('2026-08-24T08:00:00.000Z'),
  secureStorageAvailable: true,
  accounts: [
    {
      id: ACCOUNT_ID,
      label: 'Personal Max',
      email: 'ral@example.com',
      subscriptionType: 'max',
      enabled: true,
      status: 'usable',
      activeRequests: 0,
      createdAt: '2026-08-24T07:00:00.000Z',
      updatedAt: '2026-08-24T08:00:00.000Z'
    }
  ],
  server: {
    state: 'ready',
    host: '127.0.0.1',
    port: 8741
  },
  authFlow: {
    flowId: FLOW_ID,
    accountId: ACCOUNT_ID,
    status: 'awaiting_code',
    canSubmitCode: true,
    codeAttempt: 1,
    error: {
      code: 'authorization_output_invalid',
      retryable: true
    }
  },
  codexUpstream: {
    connected: true,
    models: ['gpt-5.5']
  }
});

const assertZodRejected = (parse: () => unknown): void => {
  assert.throws(parse, ZodError);
};

test('parses strict metadata-only snapshots and every documented server state', () => {
  for (const state of ['starting', 'ready', 'attention', 'stopped']) {
    const snapshot = createValidSnapshot();
    snapshot.server.state = state;

    const parsed = parseClaudeSubscriptionSnapshot(snapshot);

    assert.equal(parsed.schema, CLAUDE_SUBSCRIPTION_SNAPSHOT_SCHEMA);
    assert.equal(parsed.revision, 7);
    assert.equal(parsed.observedAt, Date.parse('2026-08-24T08:00:00.000Z'));
    assert.equal(parsed.server.state, state);
    assert.deepEqual(parsed.authFlow?.error, {
      code: 'authorization_output_invalid',
      retryable: true
    });
  }

  assert.equal(
    parseClaudeSubscriptionSnapshot({ ...createValidSnapshot(), authFlow: null }).authFlow,
    null
  );
});

test('rejects missing, fractional, or invalid snapshot revision and observation metadata', () => {
  const missingRevision: Record<string, unknown> = createValidSnapshot();
  delete missingRevision.revision;

  assertZodRejected(() => parseClaudeSubscriptionSnapshot(missingRevision));
  assertZodRejected(() =>
    parseClaudeSubscriptionSnapshot({ ...createValidSnapshot(), revision: 1.5 })
  );
  assertZodRejected(() =>
    parseClaudeSubscriptionSnapshot({ ...createValidSnapshot(), revision: -1 })
  );
  assertZodRejected(() =>
    parseClaudeSubscriptionSnapshot({ ...createValidSnapshot(), observedAt: 1.5 })
  );
  assertZodRejected(() =>
    parseClaudeSubscriptionSnapshot({ ...createValidSnapshot(), observedAt: -1 })
  );
});

test('rejects unknown account, server, and authorization-flow states', () => {
  const invalidAccountStatus = createValidSnapshot();
  invalidAccountStatus.accounts[0].status = 'expired';
  const invalidServerState = createValidSnapshot();
  invalidServerState.server.state = 'running';
  const invalidAuthFlowStatus = createValidSnapshot();
  invalidAuthFlowStatus.authFlow.status = 'failed';

  assertZodRejected(() => parseClaudeSubscriptionSnapshot(invalidAccountStatus));
  assertZodRejected(() => parseClaudeSubscriptionSnapshot(invalidServerState));
  assertZodRejected(() => parseClaudeSubscriptionSnapshot(invalidAuthFlowStatus));
});

test('rejects snapshot extras, secret-bearing account fields, and raw authorization messages', () => {
  assertZodRejected(() =>
    parseClaudeSubscriptionSnapshot({
      ...createValidSnapshot(),
      oauthToken: 'must-not-cross-the-shared-boundary'
    })
  );
  assertZodRejected(() => {
    const snapshot = createValidSnapshot();
    return parseClaudeSubscriptionSnapshot({
      ...snapshot,
      accounts: [
        {
          ...snapshot.accounts[0],
          encryptedToken: 'ciphertext-is-still-not-metadata'
        }
      ]
    });
  });
  for (const forbidden of [
    { secureStorageConfigDirectory: '/private/account/profile' },
    { anthropicConfigDirectory: '/private/account/profile/anthropic' },
    { partition: 'persist:private' },
    { refreshToken: 'must-not-cross-the-shared-boundary' }
  ]) {
    const snapshot = createValidSnapshot();
    assertZodRejected(() =>
      parseClaudeSubscriptionSnapshot({
        ...snapshot,
        accounts: [{ ...snapshot.accounts[0], ...forbidden }]
      })
    );
  }
  for (const subscriptionType of [null, 'free', 'unknown']) {
    const snapshot = createValidSnapshot();
    assertZodRejected(() =>
      parseClaudeSubscriptionSnapshot({
        ...snapshot,
        accounts: [{ ...snapshot.accounts[0], subscriptionType }]
      })
    );
  }
  assertZodRejected(() => {
    const snapshot = createValidSnapshot();
    return parseClaudeSubscriptionSnapshot({
      ...snapshot,
      accounts: [
        {
          ...snapshot.accounts[0],
          configDirectory: '/private/account/config'
        }
      ]
    });
  });
  assertZodRejected(() => {
    const snapshot = createValidSnapshot();
    return parseClaudeSubscriptionSnapshot({
      ...snapshot,
      authFlow: {
        ...snapshot.authFlow,
        error: {
          ...snapshot.authFlow.error,
          message: 'raw provider failure'
        }
      }
    });
  });
});

test('normalizes command labels and authorization codes without widening their shape', () => {
  assert.deepEqual(
    parseClaudeSubscriptionStartAuthInput({
      label: '  Personal\t Max  ',
      accountId: ACCOUNT_ID
    }),
    { label: 'Personal Max', accountId: ACCOUNT_ID }
  );
  assert.deepEqual(
    parseClaudeSubscriptionRenameAccountInput({
      accountId: ACCOUNT_ID,
      label: '  Backup   Opus  '
    }),
    { accountId: ACCOUNT_ID, label: 'Backup Opus' }
  );
  assert.deepEqual(
    parseClaudeSubscriptionSubmitAuthCodeInput({ flowId: FLOW_ID, code: '  oauth-code  ' }),
    { flowId: FLOW_ID, code: 'oauth-code' }
  );
  assert.deepEqual(parseClaudeSubscriptionFlowIdInput({ flowId: FLOW_ID }), {
    flowId: FLOW_ID
  });
  assert.deepEqual(parseClaudeSubscriptionAccountIdInput({ accountId: ACCOUNT_ID }), {
    accountId: ACCOUNT_ID
  });
  assert.deepEqual(
    parseClaudeSubscriptionSetAccountEnabledInput({ accountId: ACCOUNT_ID, enabled: false }),
    { accountId: ACCOUNT_ID, enabled: false }
  );
});

test('rejects extra command fields, bad identifiers, multiline codes, and invalid values', () => {
  const strictCommandCases: Array<{ parse: (value: unknown) => unknown; value: unknown }> = [
    {
      parse: parseClaudeSubscriptionStartAuthInput,
      value: { label: 'Personal', unexpected: true }
    },
    {
      parse: parseClaudeSubscriptionSubmitAuthCodeInput,
      value: { flowId: FLOW_ID, code: 'oauth-code', unexpected: true }
    },
    {
      parse: parseClaudeSubscriptionFlowIdInput,
      value: { flowId: FLOW_ID, unexpected: true }
    },
    {
      parse: parseClaudeSubscriptionAccountIdInput,
      value: { accountId: ACCOUNT_ID, unexpected: true }
    },
    {
      parse: parseClaudeSubscriptionRenameAccountInput,
      value: { accountId: ACCOUNT_ID, label: 'Renamed', unexpected: true }
    },
    {
      parse: parseClaudeSubscriptionSetAccountEnabledInput,
      value: { accountId: ACCOUNT_ID, enabled: true, unexpected: true }
    }
  ];

  for (const commandCase of strictCommandCases) {
    assertZodRejected(() => commandCase.parse(commandCase.value));
  }

  assertZodRejected(() =>
    parseClaudeSubscriptionStartAuthInput({ label: 'Personal', accountId: 'not-a-uuid' })
  );
  assertZodRejected(() => parseClaudeSubscriptionFlowIdInput({ flowId: 'not-a-uuid' }));
  assertZodRejected(() => parseClaudeSubscriptionAccountIdInput({ accountId: 'not-a-uuid' }));
  assertZodRejected(() =>
    parseClaudeSubscriptionRenameAccountInput({ accountId: 'not-a-uuid', label: 'Renamed' })
  );
  assertZodRejected(() =>
    parseClaudeSubscriptionSetAccountEnabledInput({ accountId: ACCOUNT_ID, enabled: 'true' })
  );
  assertZodRejected(() =>
    parseClaudeSubscriptionSubmitAuthCodeInput({ flowId: FLOW_ID, code: 'line-one\nline-two' })
  );
  assertZodRejected(() =>
    parseClaudeSubscriptionSubmitAuthCodeInput({ flowId: FLOW_ID, code: 'oauth\u0000code' })
  );
  assertZodRejected(() =>
    parseClaudeSubscriptionSubmitAuthCodeInput({ flowId: 'not-a-uuid', code: 'oauth-code' })
  );
  assertZodRejected(() =>
    parseClaudeSubscriptionSubmitAuthCodeInput({ flowId: FLOW_ID, code: 'x'.repeat(4_097) })
  );
  assertZodRejected(() => parseClaudeSubscriptionStartAuthInput({ label: '   ' }));
});

test('strict action results cannot carry secret fields or untyped errors', () => {
  assert.deepEqual(
    parseClaudeSubscriptionActionResult({ ok: true, snapshot: createValidSnapshot() }).ok,
    true
  );
  assertZodRejected(() =>
    parseClaudeSubscriptionActionResult({
      ok: false,
      snapshot: createValidSnapshot(),
      error: { code: 'raw_provider_error', retryable: true }
    })
  );
  assertZodRejected(() =>
    parseClaudeSubscriptionActionResult({
      ok: false,
      snapshot: createValidSnapshot(),
      error: {
        code: 'claude_execution',
        retryable: true,
        message: 'sk-ant-oat01-must-not-cross-boundary'
      }
    })
  );
});
