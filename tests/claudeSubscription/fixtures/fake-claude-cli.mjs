#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { statSync, writeFileSync } from 'node:fs';

const mode = process.argv[2] ?? 'final';

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

const write = (value, exitCode = 0) => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exitCode = exitCode;
};

const authIndex = process.argv.indexOf('auth');
const isAuthStatus = authIndex > 0 && process.argv[authIndex + 1] === 'status';
const isAuthLogout = authIndex > 0 && process.argv[authIndex + 1] === 'logout';

if (isAuthLogout) {
  write({}, mode === 'logout-fail' ? 1 : 0);
} else if (
  isAuthStatus &&
  (mode === 'preflight-hang' ||
    (mode === 'preflight-hang-first' && process.env.CLAUDE_CONFIG_DIR?.includes('000000000001')))
) {
  process.stdin.resume();
  setInterval(() => undefined, 10_000);
} else if (isAuthStatus) {
  if (mode === 'logout-ok') {
    write({ loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' }, 1);
  } else if (mode === 'logout-wrong-exit') {
    write({ loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' }, 0);
  } else if (mode === 'logout-invalid-status') {
    write({ loggedIn: false, authMethod: 'none', apiProvider: 'firstParty', apiKeySource: null }, 1);
  } else if (mode === 'auth-api-key-source') {
    write({
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      subscriptionType: 'max',
      apiKeySource: 'apiKeyHelper'
    });
  } else {
    write({
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      subscriptionType: 'max',
      email: 'fixture@example.com'
    });
  }
} else if (mode === 'hang' || mode === 'prompt-hang-marker') {
  if (mode === 'prompt-hang-marker' && process.argv[3]) {
    writeFileSync(process.argv[3], 'started', { mode: 0o600 });
  }
  process.stdin.resume();
  setInterval(() => undefined, 10_000);
} else if (mode === 'oversized') {
  await readStdin();
  process.stdout.write('x'.repeat(8_192));
} else {
  const payload = JSON.parse(await readStdin());
  if (mode === 'environment') {
    const forbidden = [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_PROFILE',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'CLAUDE_CODE_REFRESH_TOKEN',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
      'AWS_SECRET_ACCESS_KEY',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'BITTERLESS_CLAUDE_TEST_SECRET'
    ];
    const systemPromptIndex = process.argv.indexOf('--system-prompt-file');
    const systemPromptPath = process.argv[systemPromptIndex + 1];
    const settingSourcesIndex = process.argv.indexOf('--setting-sources');
    const settingsIndex = process.argv.indexOf('--settings');
    const isolated =
      systemPromptIndex > 0 &&
      (statSync(systemPromptPath).mode & 0o777) === 0o600 &&
      process.env.CLAUDE_CONFIG_DIR === '/tmp/bitterless-claude-account-a/profile' &&
      process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR ===
        '/tmp/bitterless-claude-account-a/profile' &&
      process.env.ANTHROPIC_CONFIG_DIR ===
        '/tmp/bitterless-claude-account-a/profile/anthropic' &&
      forbidden.every((name) => process.env[name] === undefined) &&
      !process.argv.some((value) => value.includes('oauth-token')) &&
      settingSourcesIndex > 0 &&
      process.argv[settingSourcesIndex + 1] === '' &&
      settingsIndex > 0 &&
      process.argv[settingsIndex + 1] === '{"apiKeyHelper":null}';
    write({
      is_error: false,
      structured_output: {
        action: 'final',
        text: isolated ? 'environment-ok' : 'environment-leaked'
      },
      usage: { input_tokens: 1, output_tokens: 1 }
    });
  } else if (mode === 'tool') {
    write({
      is_error: false,
      structured_output: {
        action: 'tool_call',
        tool_name: 'read_file',
        arguments: '{"path":"package.json"}'
      },
      usage: { input_tokens: 10, cache_read_input_tokens: 3, output_tokens: 4 }
    });
  } else if (mode === 'selected-tool') {
    const selected = payload.available_tools[0];
    write({
      is_error: false,
      structured_output: {
        action: 'tool_call',
        tool_name: selected.decision_name,
        arguments: '{"value":"fixture"}'
      },
      usage: { input_tokens: 1, output_tokens: 1 }
    });
  } else if (mode === 'effort') {
    const effortIndex = process.argv.indexOf('--effort');
    write({
      is_error: false,
      structured_output: {
        action: 'final',
        text: `effort-${process.argv[effortIndex + 1]}`
      }
    });
  } else if (mode === 'failover') {
    if (process.env.CLAUDE_CONFIG_DIR?.includes('000000000001')) {
      write(
        {
          is_error: true,
          subtype: 'rate_limit_error',
          reset_at: 1999999999000,
          result: 'Usage limit reached; resets at 2033-05-18T03:33:19Z'
        },
        1
      );
    } else {
      write({
        is_error: false,
        structured_output: { action: 'final', text: 'failover-ok' },
        usage: { input_tokens: 1, output_tokens: 1 }
      });
    }
  } else if (mode === 'usage-limit') {
    write(
      {
        is_error: true,
        subtype: 'rate_limit_error',
        reset_at: 1999999999000,
        result: 'Out of usage credits; resets at 2033-05-18T03:33:19Z'
      },
      1
    );
  } else if (mode === 'authentication') {
    write(
      {
        is_error: true,
        subtype: 'authentication_error',
        result:
          'OAuth session expired for sk-ant-oat01-super-secret at https://claude.ai/oauth/authorize?code=secret-code&state=secret-state'
      },
      1
    );
  } else if (mode === 'malformed') {
    write({
      is_error: false,
      structured_output: { action: 'tool_call', tool_name: 'missing', arguments: '[]' }
    });
  } else {
    write({
      is_error: false,
      structured_output: { action: 'final', text: 'hello from fake Claude' },
      usage: { input_tokens: 7, cache_read_input_tokens: 2, output_tokens: 3 },
      modelUsage: {
        sonnet: { inputTokens: 100, cacheReadInputTokens: 50, outputTokens: 20 }
      },
      payloadSeen: Boolean(payload)
    });
  }
}
