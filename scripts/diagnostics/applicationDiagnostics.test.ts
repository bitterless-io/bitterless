import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { resolveRuntimeProfile } from '../../src/main/environment/runtimeProfile.service';
import {
  isFirstPartyRendererUrl,
  resolveApplicationLogFile
} from '../../src/main/logging/logPolicy.service';
import { buildDiagnosticEnvironmentStatus } from '../../src/main/diagnostics/diagnosticEnvironment.service';
import { parseApplicationDiagnosticDirectoryKey } from '../../src/shared/diagnostics/applicationDiagnostics.contract';
import {
  sanitizeDiagnostic,
  sanitizeDiagnosticUrl,
  sanitizeErrorCauseChain
} from '../../src/shared/diagnostics/diagnostic.service';

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
    isFirstPartyRendererUrl('http://127.0.0.1:5173/home/index.html', 'http://127.0.0.1:5173'),
    true
  );
  assert.equal(
    isFirstPartyRendererUrl(
      'file:///Applications/Bitterless.app/Contents/Resources/app.asar/out/renderer/omni/omniControl/index.html'
    ),
    true
  );
  assert.equal(
    isFirstPartyRendererUrl('https://remote.example/home/index.html', 'http://127.0.0.1:5173'),
    false
  );
  assert.equal(
    isFirstPartyRendererUrl(
      'http://127.0.0.1:5173/home/index.html?token=secret',
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
  assert.match(logSource, /isFirstPartyRendererUrl/);
});

test('Settings places Log immediately above About and Codex logs required safe stages', () => {
  const settingSource = source('src/renderer/home/src/views/setting/Setting.vue');
  assert.ok(
    settingSource.indexOf("onNavClick('log')") < settingSource.indexOf("onNavClick('about')")
  );
  assert.doesNotMatch(
    source('src/renderer/home/src/views/setting/components/LogSetting/LogSetting.vue'),
    /\b(?:flex-|grid-|p-|px-|py-|m-|text-|bg-|border-)\w+/
  );

  const codexSource = source('src/main/codex/codexCredential.service.ts');
  for (const stage of [
    'callback-received',
    'callback-observed',
    'login-promise-started',
    'login-promise-resolved',
    'token-credential-stored',
    'promotion-completed',
    'status-verification-resolved'
  ]) {
    assert.match(codexSource, new RegExp(stage));
  }
  assert.match(codexSource, /sanitizeDiagnosticUrl/);
  assert.match(codexSource, /sanitizeErrorCauseChain/);
  assert.match(codexSource, /const sanitizeCodexStage/);
  assert.doesNotMatch(codexSource, /console\.(?:log|info|warn|error)\([^)]*credential/);
});
