/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DIAGNOSTIC_TEXT_LIMIT,
  sanitizeDiagnostic
} from '../../src/shared/diagnostics/diagnostic.service.ts';
import { parseSettingOpenNotice } from '../../src/shared/setting/settingNavigation.contract.ts';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const runtimeSource = read('src/main/codex/codexRuntime.service.ts');
const serviceSource = read('src/main/translator/translator.service.ts');
const contractSource = read('src/shared/translator/translator.contract.ts');
const appSource = read('src/renderer/translator/src/App.vue');
const styleSource = read('src/renderer/translator/src/App.less');
const storeSource = read('src/renderer/translator/src/store/translator.store.ts');
const mainWindowSource = read('src/main/xpc/mainWindow.handler.ts');
const subscriberSource = read('src/renderer/home/src/xpc/setting.subscriber.ts');
const homeMainSource = read('src/renderer/home/src/main.ts');
const settingSource = read('src/renderer/home/src/views/setting/Setting.vue');
const settingNavSource = read('src/renderer/home/src/views/setting/store/settingNav.store.ts');
const loginSource = read('src/renderer/home/src/views/login/Login.vue');
const llmStoreSource = read(
  'src/renderer/home/src/views/setting/components/LLMSetting/llmSetting.store.ts'
);
const llmViewSource = read(
  'src/renderer/home/src/views/setting/components/LLMSetting/LLMSetting.vue'
);
const englishSource = read('src/renderer/common/i18n/en.ts');
const chineseSource = read('src/renderer/common/i18n/zh.ts');

test('diagnostics redact credentials, identity, and machine paths', () => {
  assert.equal(sanitizeDiagnostic('auth failed for sk-livekey123456789'), 'auth failed for sk-***');
  assert.equal(sanitizeDiagnostic('header Bearer abc123def456ghi'), 'header Bearer ***');
  assert.equal(sanitizeDiagnostic('token eyJhbGciOiJIUzI1.eyJzdWIiOiIx.QWxhZGRpbg'), 'token ***');
  assert.equal(sanitizeDiagnostic('reported by ral@micromeet.ai'), 'reported by ***@***');
  assert.equal(
    sanitizeDiagnostic('cannot read /Users/ral/.codex/auth.json'),
    'cannot read ~/.codex/auth.json'
  );
  assert.equal(
    sanitizeDiagnostic('cannot read C:\\Users\\ral\\auth.json'),
    'cannot read ~\\auth.json'
  );
  assert.equal(
    sanitizeDiagnostic('cannot read c:\\users\\Ral\\auth.json'),
    'cannot read ~\\auth.json'
  );
  assert.equal(sanitizeDiagnostic('opaque 0123456789abcdef0123456789abcdef'), 'opaque ***');
});

test('diagnostics keep useful provider prose intact', () => {
  assert.equal(
    sanitizeDiagnostic('429 rate limit exceeded, retry after 21s'),
    '429 rate limit exceeded, retry after 21s'
  );
  assert.equal(
    sanitizeDiagnostic('  stream   disconnected \n unexpectedly '),
    'stream disconnected unexpectedly'
  );
  assert.equal(sanitizeDiagnostic(new Error('401 Unauthorized')), '401 Unauthorized');
  assert.equal(sanitizeDiagnostic(undefined), '');
  assert.equal(
    sanitizeDiagnostic({ message: 'cross-process rejection' }),
    'cross-process rejection'
  );
  assert.equal(sanitizeDiagnostic({ errorMessage: 'stream error' }), 'stream error');
  assert.equal(sanitizeDiagnostic({ unrelated: 'ignored' }), '');
});

test('redaction runs before truncation so no token prefix can survive', () => {
  const secret = `sk-${'a'.repeat(400)}`;
  const sanitized = sanitizeDiagnostic(`failed with ${secret}`);
  assert.equal(sanitized, 'failed with sk-***');
  assert.ok(!sanitized.includes('aaaa'));

  const long = sanitizeDiagnostic(`${'word '.repeat(200)}`);
  assert.ok(long.length <= DIAGNOSTIC_TEXT_LIMIT);
  assert.ok(long.endsWith('…'));
  assert.ok(sanitizeDiagnostic('short', 5000).length <= DIAGNOSTIC_TEXT_LIMIT);
});

test('the runtime carries a sanitized detail on every failure it raises', () => {
  assert.match(
    runtimeSource,
    /export class CodexRuntimeError extends Error \{[\s\S]*?readonly detail: string;[\s\S]*?this\.detail = sanitizeDiagnostic\(detail\);/
  );
  assert.match(runtimeSource, /new CodexRuntimeAuthRequiredError\(reason, value\)/);
  assert.match(runtimeSource, /'runtime-unavailable',\s*`Pi module load failed/);
  assert.match(runtimeSource, /`model registry unavailable: \$\{sanitizeDiagnostic\(error\)\}`/);
  assert.match(runtimeSource, /`session creation failed: \$\{sanitizeDiagnostic\(error\)\}`/);
  assert.match(runtimeSource, /'not-configured', `no configured auth for/);
  assert.match(runtimeSource, /'provider-error', 'provider returned no text'/);
  assert.match(runtimeSource, /new CodexRuntimeError\('provider-error', error\)/);
  assert.match(runtimeSource, /'tool-violation', toolViolationDetail/);
  assert.match(runtimeSource, /'output-limit', outputLimitDetail\(input\)/);
  assert.ok(
    !/new CodexRuntimeError\('provider-error'\)/.test(runtimeSource),
    'no provider failure may be raised without a cause'
  );
});

test('the translator contract and service expose a bounded sanitized detail', () => {
  assert.match(contractSource, /export interface TranslatorError \{[\s\S]*?detail\?: string;/);
  assert.match(
    serviceSource,
    /const publicError = \(code: TranslatorErrorCode, detail\?: unknown\)[\s\S]*?sanitizeDiagnostic\(detail\)/
  );
  assert.match(serviceSource, /\.\.\.\(bounded \? \{ detail: bounded \} : \{\}\)/);
  assert.match(serviceSource, /console\.warn\(`\[translator\] request failed: \$\{error\.code\}`/);
  assert.match(serviceSource, /'invalid-output',\s*`response was not JSON/);
  assert.match(
    serviceSource,
    /`response was not JSON \(\$\{Buffer\.byteLength\(text, 'utf8'\)\} bytes\)`/
  );
  assert.ok(
    !serviceSource.includes('outputPrefix'),
    'invalid JSON diagnostics must not expose a model response prefix'
  );
  assert.match(serviceSource, /no response within \$\{this\.timeoutMs\}ms/);
  assert.match(serviceSource, /Codex session \$\{error\.reason\}/);
  assert.match(
    serviceSource,
    /return this\.failed\(input, runtimeErrorCode\(error\), error\.detail\)/
  );
});

test('the store keeps detail beside the error and clears both together', () => {
  assert.match(storeSource, /errorDetail = ''/);
  assert.match(
    storeSource,
    /private fail\(error: TranslatorUiError, detail: unknown\): void \{[\s\S]*?this\.errorDetail = sanitizeDiagnostic\(detail\);/
  );
  assert.match(
    storeSource,
    /private clearError\(\): void \{[\s\S]*?this\.error = null;[\s\S]*?this\.errorDetail = '';/
  );
  assert.match(storeSource, /this\.fail\(result\.error\.code, result\.error\.detail\)/);
  assert.match(
    storeSource,
    /wasReady && !this\.ready && this\.authState !== 'invalidated'/,
    'an invalidated snapshot must not discard the active auth-error response detail'
  );
  assert.ok(
    !/this\.error = '(?:load-provider|login|runtime-unavailable)'/.test(storeSource),
    'every error assignment must record its detail through fail()'
  );

  const authMatch = storeSource.match(
    /const AUTH_TRANSLATION_ERRORS = new Set<TranslatorUiError>\(\[([\s\S]*?)\]\);/
  );
  assert.ok(authMatch, 'Missing auth error set');
  assert.deepEqual(
    [...authMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]),
    ['authenticating', 'load-provider', 'login', 'login-required', 'provider-unavailable']
  );
});

test('the error strip shows the code, the detail, and both recovery actions', () => {
  assert.match(appSource, /name="translator__error-detail"[\s\S]*?:title="errorDetail"/);
  assert.match(appSource, /\$\{translatorStore\.error\} · \$\{translatorStore\.errorDetail\}/);
  assert.match(
    appSource,
    /v-if="translatorStore\.canLoginFromError"[\s\S]*?translatorStore\.login\(\)/
  );
  assert.match(
    appSource,
    /name="translator__error-settings"[\s\S]*?translatorStore\.openModelSettings\(\)/
  );
  assert.ok(
    !appSource.includes('errors.generic'),
    'the unreachable generic fallback must be removed'
  );
  assert.match(styleSource, /\.translator__error-detail \{[\s\S]*?user-select: text;/);
  assert.match(styleSource, /\.translator__error-detail \{[\s\S]*?text-overflow: ellipsis;/);
});

test('Setting navigation validates its payload and survives a cold Home window', () => {
  assert.equal(parseSettingOpenNotice({ tab: 'llm' })?.tab, 'llm');
  assert.equal(parseSettingOpenNotice({ tab: 'nope' }), null);
  assert.equal(parseSettingOpenNotice(null), null);
  assert.equal(parseSettingOpenNotice('llm'), null);

  assert.match(mainWindowSource, /implements StartupDiagnosticsApi, SettingNavigationApi/);
  assert.match(
    mainWindowSource,
    /const notice = parseSettingOpenNotice\(params\);\s*if \(!notice\) return;/
  );
  assert.match(
    mainWindowSource,
    /if \(window\.webContents\.isLoading\(\)\) \{[\s\S]*?this\.pendingSetting = notice;/
  );
  assert.match(mainWindowSource, /xpcMain\.broadcast\(SETTING_OPEN_EVENT, notice\)/);
  assert.match(
    mainWindowSource,
    /async consumePendingSetting\(\): Promise<SettingOpenNotice \| null> \{[\s\S]*?this\.pendingSetting = null;/
  );

  assert.match(subscriberSource, /xpcRenderer\.subscribe\(SETTING_OPEN_EVENT/);
  assert.match(subscriberSource, /consumePendingSetting\(\)/);
  assert.match(subscriberSource, /settingNavStore\.requestOpen\(notice\.tab\)/);
  assert.match(subscriberSource, /if \(router\.currentRoute\.value\.name === 'login'\) return;/);
  assert.match(homeMainSource, /initSettingSubscriber\(\);/);
  assert.match(settingSource, /const activeTab = computed\(\(\) => settingNavStore\.activeTab\)/);
  assert.match(settingNavSource, /pendingOpen = false;/);
  assert.match(settingNavSource, /consumeOpenRequest\(\): boolean/);
  assert.match(loginSource, /const hasPendingSetting = settingNavStore\.pendingOpen;/);
  assert.match(loginSource, /\? \{ name: 'setting' as const \}/);
  assert.match(loginSource, /settingNavStore\.consumeOpenRequest\(\)/);
});

test('the Model tab can sign out and sign in through one action', () => {
  assert.match(
    llmStoreSource,
    /async reconnect\(\): Promise<void> \{[\s\S]*?modelProviderEmitter\.disconnect\([\s\S]*?modelProviderEmitter\.connect\(/
  );
  assert.match(
    llmStoreSource,
    /action: 'login' \| 'cancel' \| 'logout' \| 'reconnect' \| null/
  );
  assert.match(
    llmViewSource,
    /name="modelConfig__detail__reconnect"[\s\S]*?llmSettingStore\.reconnect\(\)/
  );

  for (const source of [englishSource, chineseSource]) {
    assert.ok(source.includes('reconnect:'), 'both locales need Reconnect copy');
    assert.ok(source.includes('openModelSettings:'), 'both locales need the settings action copy');
    assert.ok(!source.includes('generic:'), 'the unreachable generic key must be removed');
  }
});
