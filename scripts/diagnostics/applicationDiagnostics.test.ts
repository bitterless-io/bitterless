import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import electronLog from 'electron-log/node';
import { resolveRuntimeProfile } from '../../src/main/environment/runtimeProfile.service';
import {
  APPLICATION_LOG_FILE_MAX_SIZE,
  isFirstPartyRendererUrl,
  resolveFirstPartyRendererProcess,
  resolveApplicationLogFile
} from '../../src/main/logging/logPolicy.service';
import { buildDiagnosticEnvironmentStatus } from '../../src/main/diagnostics/diagnosticEnvironment.service';
import { parseApplicationDiagnosticDirectoryKey } from '../../src/shared/diagnostics/applicationDiagnostics.contract';
import {
  sanitizeDiagnostic,
  sanitizeDiagnosticUrl,
  sanitizeErrorCauseChain
} from '../../src/shared/diagnostics/diagnostic.service';
import { CodexTokenExchangeObserver } from '../../src/main/codex/codexTokenExchangeObserver.service';
import {
  formatApplicationLogMessage,
  sanitizeApplicationLogMessage
} from '../../src/main/logging/logSanitizer.service';

const projectRoot = process.cwd();
const source = (path: string): string => readFileSync(resolve(projectRoot, path), 'utf8');

test('resolves the exact four runtime profile names', () => {
  assert.deepEqual(resolveRuntimeProfile({ viteMode: 'release', viteEnv: 'prod' }), {
    id: 'production',
    appName: 'Bitterless',
    viteMode: 'release',
    viteEnv: 'prod'
  });
  assert.equal(
    resolveRuntimeProfile({ viteMode: 'debug', viteEnv: 'prod' }).appName,
    'Bitterless_DEBUG_PROD'
  );
  assert.equal(
    resolveRuntimeProfile({ viteMode: 'debug', viteEnv: 'dev' }).appName,
    'Bitterless_DEBUG_DEV'
  );
  assert.equal(
    resolveRuntimeProfile({ viteMode: 'release', viteEnv: 'dev' }).appName,
    'Bitterless_DEV'
  );
  assert.throws(() => resolveRuntimeProfile({ viteMode: 'production', viteEnv: 'prod' }));
});

test('resolves debug logs under active userData and release logs under OS log root', () => {
  const debug = resolveRuntimeProfile({ viteMode: 'debug', viteEnv: 'prod' });
  const release = resolveRuntimeProfile({ viteMode: 'release', viteEnv: 'prod' });
  assert.equal(
    resolveApplicationLogFile(debug, {
      userData: '/profiles/Bitterless_DEBUG_PROD',
      libraryDefaultDir: '/os/logs/Bitterless_DEBUG_PROD'
    }),
    '/profiles/Bitterless_DEBUG_PROD/logs/main.log'
  );
  assert.equal(
    resolveApplicationLogFile(release, {
      userData: '/profiles/Bitterless',
      libraryDefaultDir: '/os/logs/Bitterless'
    }),
    '/os/logs/Bitterless/main.log'
  );
});

test('renderer log capture accepts only known first-party renderer entries', () => {
  assert.equal(
    resolveFirstPartyRendererProcess(
      'http://127.0.0.1:5173/home/index.html#/setting',
      'http://127.0.0.1:5173'
    ),
    'renderer:home'
  );
  assert.equal(
    resolveFirstPartyRendererProcess(
      'file:///Applications/Bitterless.app/Contents/Resources/app.asar/out/renderer/omni/omniControl/index.html'
    ),
    'renderer:omniControl'
  );
  assert.equal(
    resolveFirstPartyRendererProcess(
      'file:///Applications/Bitterless.app/Contents/Resources/app.asar/out/renderer/translator/index.html#/translate'
    ),
    'renderer:translator'
  );
  assert.equal(
    resolveFirstPartyRendererProcess(
      'file:///Applications/Bitterless.app/Contents/Resources/app.asar/out/renderer/maestro/home/index.html'
    ),
    'renderer:maestroHome'
  );
  assert.equal(
    isFirstPartyRendererUrl(
      'https://remote.example/home/index.html#/setting',
      'http://127.0.0.1:5173'
    ),
    false
  );
  assert.equal(
    isFirstPartyRendererUrl(
      'http://127.0.0.1:5173/home/index.html?token=secret#/setting',
      'http://127.0.0.1:5173'
    ),
    false
  );
});

test('directory contract rejects renderer-provided paths and unknown keys', () => {
  assert.equal(parseApplicationDiagnosticDirectoryKey('logs'), 'logs');
  assert.equal(parseApplicationDiagnosticDirectoryKey('/Users/ral'), null);
  assert.equal(parseApplicationDiagnosticDirectoryKey('../private'), null);
  assert.equal(parseApplicationDiagnosticDirectoryKey({ key: 'logs' }), null);

  const serviceSource = source('src/main/diagnostics/applicationDiagnostics.service.ts');
  assert.match(serviceSource, /parseApplicationDiagnosticDirectoryKey\(params\?\.key\)/);
  assert.doesNotMatch(serviceSource, /shell\.openPath\(params/);
  assert.match(serviceSource, /shell\.showItemInFolder\(log\.file\)/);
});

test('environment diagnostics expose status and safe origins, never configured secrets', () => {
  const entries = buildDiagnosticEnvironmentStatus({
    VITE_ENV: 'prod',
    VITE_MODE: 'debug',
    VITE_BITTERLESS_CORE_URL: 'https://api.bitterless.io/private/path?access_token=core-secret',
    HTTPS_PROXY: 'http://proxy-user:proxy-secret@127.0.0.1:7890',
    https_proxy: 'http://lower-secret@127.0.0.1:7891',
    APPLE_APP_SPECIFIC_PASSWORD: 'apple-secret',
    MICROMEET_CRMS_CREDENTIAL_FILE: '/private/credential-secret.json'
  });
  assert.equal(entries.find((entry) => entry.key === 'VITE_ENV')?.safeValue, 'prod');
  assert.equal(entries.find((entry) => entry.key === 'VITE_MODE')?.safeValue, 'debug');
  assert.equal(
    entries.find((entry) => entry.key === 'VITE_BITTERLESS_CORE_URL')?.safeValue,
    'https://api.bitterless.io'
  );
  assert.deepEqual(
    entries.find((entry) => entry.key === 'HTTPS_PROXY'),
    { key: 'HTTPS_PROXY', configured: true }
  );
  assert.deepEqual(
    entries.find((entry) => entry.key === 'https_proxy'),
    { key: 'https_proxy', configured: true }
  );
  const serialized = JSON.stringify(entries);
  for (const secret of [
    'core-secret',
    'proxy-secret',
    'lower-secret',
    'apple-secret',
    'credential-secret'
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('OAuth URL and nested error causes are redacted before logging', () => {
  const url =
    'https://auth.openai.com/oauth/authorize?code=callback-secret&access_token=access-secret#refresh_token=refresh-secret';
  assert.equal(sanitizeDiagnosticUrl(url), 'https://auth.openai.com/oauth/authorize');
  assert.equal(
    sanitizeDiagnostic(`exchange failed at ${url}`),
    'exchange failed at https://auth.openai.com/oauth/authorize'
  );
  assert.equal(sanitizeDiagnostic('authorization code: ABCD-EFGH'), 'authorization code=***');
  assert.equal(sanitizeDiagnostic('refresh token=short-secret'), 'refresh token=***');
  assert.equal(
    sanitizeDiagnostic('exchange {"access_token":"json-secret","ok":false}'),
    'exchange {access_token=***,"ok":false}'
  );

  const cause = {
    name: 'TypeError',
    code: 'TOKEN_EXCHANGE_FAILED',
    message: `request failed ${url}`,
    response: { body: 'response-body-secret' },
    cause: {
      name: 'HTTPClientError',
      code: 'ETIMEDOUT',
      message: 'deadline exceeded',
      credential: 'credential-secret'
    }
  };
  const safe = sanitizeErrorCauseChain(cause);
  assert.match(safe, /TOKEN_EXCHANGE_FAILED/);
  assert.match(safe, /ETIMEDOUT/);
  assert.doesNotMatch(
    safe,
    /callback-secret|access-secret|refresh-secret|response-body-secret|credential-secret/
  );
});

test('modern Pi auth_url to token exchange is observed through real diagnostics channels', () => {
  const createChannel = channel('undici:request:create');
  const headersChannel = channel('undici:request:headers');
  const errorChannel = channel('undici:request:error');
  const stages: string[] = ['auth-url'];
  const errors: string[] = [];
  let callbackAccepted = false;
  const observer = new CodexTokenExchangeObserver({
    onRequest: () => {
      if (!callbackAccepted) {
        callbackAccepted = true;
        stages.push('callback-accepted');
      }
      stages.push('token-exchange-started');
    },
    onResponse: (statusCode) => stages.push(`token-exchange-response:${statusCode}`),
    onError: (error) => errors.push(sanitizeErrorCauseChain(error))
  });

  observer.start();
  observer.start();
  createChannel.publish({
    request: {
      method: 'POST',
      origin: 'https://api.openai.com',
      path: '/oauth/token'
    }
  });
  assert.deepEqual(stages, ['auth-url']);

  const tokenRequest = {
    method: 'POST',
    origin: 'https://auth.openai.com',
    path: '/oauth/token?unobserved=query-secret'
  };
  Object.defineProperties(tokenRequest, {
    body: {
      get: () => {
        throw new Error('request body must not be read');
      }
    },
    headers: {
      get: () => {
        throw new Error('request headers must not be read');
      }
    }
  });
  createChannel.publish({ request: tokenRequest });
  headersChannel.publish({
    request: tokenRequest,
    response: Object.defineProperties(
      { statusCode: 200 },
      {
        headers: {
          get: () => {
            throw new Error('response headers must not be read');
          }
        }
      }
    )
  });
  stages.push('token-credential-stored');

  assert.deepEqual(stages, [
    'auth-url',
    'callback-accepted',
    'token-exchange-started',
    'token-exchange-response:200',
    'token-credential-stored'
  ]);

  const failedRequest = {
    method: 'POST',
    origin: 'https://auth.openai.com',
    path: '/oauth/token'
  };
  createChannel.publish({ request: failedRequest });
  errorChannel.publish({
    request: failedRequest,
    error: Object.assign(new Error('token request failed code=raw-code-secret'), {
      code: 'ETIMEDOUT',
      cause: new Error('proxy http://proxy-user:proxy-password@127.0.0.1:7890?token=proxy-token')
    })
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ETIMEDOUT/);
  assert.doesNotMatch(errors[0], /raw-code-secret|proxy-user|proxy-password|proxy-token/);

  observer.stop();
  observer.stop();
  const countAfterStop = stages.length;
  createChannel.publish({
    request: {
      method: 'POST',
      origin: 'https://auth.openai.com',
      path: '/oauth/token'
    }
  });
  assert.equal(stages.length, countAfterStop);
});

test('electron-log writes sanitized UTC NDJSON through the single Main file pipeline', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-log-sanitizer-'));
  const file = join(root, 'main.log');
  try {
    const logger = electronLog.create({
      logId: `application-diagnostics-${Date.now()}`
    });
    Object.assign(logger.variables, {
      profile: 'production-debug',
      proc: 'main',
      world: 'main'
    });
    logger.hooks.push(sanitizeApplicationLogMessage);
    logger.transports.console.level = false;
    logger.transports.file.level = 'debug';
    logger.transports.file.format = ({ message }) => formatApplicationLogMessage(message);
    logger.transports.file.maxSize = APPLICATION_LOG_FILE_MAX_SIZE;
    logger.transports.file.resolvePathFn = () => file;

    logger.info(
      '[main-auth] Main https://auth.openai.com/oauth/authorize?code=main-code#access_token=main-token',
      'HTTP_PROXY=http://proxy-user:proxy-password@127.0.0.1:7890'
    );
    logger.processMessage({
      data: [
        '[translator] Renderer https://example.com/path?refresh_token=renderer-token',
        'Basic cmVuZGVyZXI6c2VjcmV0'
      ],
      date: new Date(),
      level: 'info',
      variables: { proc: 'renderer:translator', world: 'page' }
    });
    logger.error(
      '[codex] Unhandled rejection',
      Object.assign(
        new Error(
          'request https://auth.openai.com/oauth/token?code=error-code password=error-password ' +
            '{"access_token":"error-json-token"}'
        ),
        {
          code: 'TOKEN_EXCHANGE_FAILED',
          cause: new Error(
            'proxy socks5://error-user:error-password@127.0.0.1:1080?token=error-token'
          )
        }
      )
    );
    logger.info('[payload] object payload', {
      credential: 'object-credential',
      nested: { accessToken: 'object-token' }
    });

    const content = readFileSync(file, 'utf8');
    const records = content
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(records.length, 4);
    assert.deepEqual(Object.keys(records[0]), [
      'ts',
      'level',
      'profile',
      'proc',
      'world',
      'scope',
      'msg',
      'args'
    ]);
    assert.match(records[0].ts, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    assert.equal(records[0].profile, 'production-debug');
    assert.equal(records[0].proc, 'main');
    assert.equal(records[0].world, 'main');
    assert.equal(records[0].scope, 'main-auth');
    assert.match(records[0].msg, /^Main https:\/\/auth\.openai\.com\/oauth\/authorize$/);
    assert.equal(records[1].proc, 'renderer:translator');
    assert.equal(records[1].world, 'page');
    assert.equal(records[1].scope, 'translator');
    assert.equal(records[2].scope, 'codex');
    assert.equal(records[3].scope, 'payload');
    assert.deepEqual(records[3].args, ['[redacted-object]']);
    assert.equal(logger.transports.file.maxSize, 5 * 1024 * 1024);
    assert.match(content, /https:\/\/auth\.openai\.com\/oauth\/authorize/);
    assert.match(content, /\[redacted-object\]/);
    for (const secret of [
      'main-code',
      'main-token',
      'proxy-user',
      'proxy-password',
      'renderer-token',
      'cmVuZGVyZXI6c2VjcmV0',
      'error-code',
      'error-password',
      'error-user',
      'error-token',
      'error-json-token',
      'object-credential',
      'object-token'
    ]) {
      assert.equal(content.includes(secret), false, `log leaked ${secret}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('logging initializes before normal app startup and captures safe failures', () => {
  const appSource = source('src/main/app.main.ts');
  assert.match(
    appSource,
    /^import \{ runtimeProfile \} from '@main\/environment\/runtimeProfile\.bootstrap';/
  );
  assert.ok(
    source('src/main/environment/runtimeProfile.bootstrap.ts').includes('applyRuntimeProfile()')
  );
  assert.ok(
    appSource.indexOf('initializeApplicationLogging(runtimeProfile)') <
      appSource.indexOf('requestSingleInstanceLock()')
  );

  const logSource = source('src/main/logging/log.setup.ts');
  assert.match(logSource, /electron-log\/main/);
  assert.match(logSource, /Object\.assign\(console, log\.functions\)/);
  assert.match(logSource, /errorHandler\.startCatching\(\)/);
  assert.match(logSource, /resolveFirstPartyRendererProcess/);
  assert.match(logSource, /log\.hooks\.push\(sanitizeApplicationLogMessage\)/);
  assert.match(logSource, /log\.transports\.file\.maxSize = APPLICATION_LOG_FILE_MAX_SIZE/);
});

test('Settings places Log immediately above About', () => {
  const settingSource = source('src/renderer/home/src/views/setting/Setting.vue');
  assert.ok(
    settingSource.indexOf("onNavClick('log')") < settingSource.indexOf("onNavClick('about')")
  );
  assert.doesNotMatch(
    source('src/renderer/home/src/views/setting/components/LogSetting/LogSetting.vue'),
    /\b(?:flex-|grid-|p-|px-|py-|m-|text-|bg-|border-)\w+/
  );
  assert.match(
    source('src/renderer/home/src/views/setting/components/LogSetting/LogSetting.vue'),
    /logSettingStore\.revealLogFile\(\)/
  );
  assert.match(
    source('src/renderer/home/src/views/setting/components/LogSetting/logSetting.store.ts'),
    /diagnosticsEmitter\.revealLogFile\(\)/
  );
});
