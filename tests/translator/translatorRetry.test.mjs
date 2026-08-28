import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const appSource = read('src/renderer/translator/src/App.vue');
const styleSource = read('src/renderer/translator/src/App.less');
const storeSource = read('src/renderer/translator/src/store/translator.store.ts');
const englishSource = read('src/renderer/common/i18n/en.ts');
const chineseSource = read('src/renderer/common/i18n/zh.ts');

test('retry visibility is limited to the agreed translation errors', () => {
  const retryableMatch = storeSource.match(
    /const RETRYABLE_TRANSLATION_ERRORS = new Set<TranslatorUiError>\(\[([\s\S]*?)\]\);/
  );
  assert.ok(retryableMatch, 'Missing retryable translation error set');

  const retryableErrors = [...retryableMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(retryableErrors, [
    'provider-error',
    'runtime-unavailable',
    'timeout',
    'invalid-output',
    'output-too-large'
  ]);

  for (const nonRetryableError of [
    'invalid-input',
    'login-required',
    'authenticating',
    'provider-unavailable',
    'target-mismatch',
    'tool-violation',
    'load-provider',
    'login'
  ]) {
    assert.ok(!retryableErrors.includes(nonRetryableError), `${nonRetryableError} must not retry`);
  }
});

test('store guards retry and force-submits through the existing lifecycle', () => {
  assert.match(
    storeSource,
    /get canRetryTranslation\(\): boolean \{[\s\S]*?this\.ready[\s\S]*?Boolean\(this\.sourceText\.trim\(\)\)[\s\S]*?!this\.translating[\s\S]*?isRetryableTranslationError\(this\.error\)[\s\S]*?\}/
  );
  assert.match(
    storeSource,
    /async retryTranslation\(\): Promise<void> \{\s*if \(!this\.canRetryTranslation\) return;\s*await this\.translateLatest\(\{ force: true \}\);\s*\}/
  );
  assert.match(
    storeSource,
    /this\.lastSubmittedRevision = sourceRevision;\s*this\.translating = true;\s*this\.error = null;/
  );
  assert.ok(
    storeSource.indexOf('this.translation = result.translation;') <
      storeSource.indexOf('async retryTranslation()'),
    'retry must not clear the existing translation'
  );
});

test('blank source cannot retry and clearing source resets active translation state', () => {
  const eligibilityMatch = storeSource.match(
    /get canRetryTranslation\(\): boolean \{([\s\S]*?)\n  \}/
  );
  assert.ok(eligibilityMatch, 'Missing retry eligibility getter');
  assert.match(eligibilityMatch[1], /Boolean\(this\.sourceText\.trim\(\)\)/);

  const retryMethodMatch = storeSource.match(
    /async retryTranslation\(\): Promise<void> \{([\s\S]*?)\n  \}/
  );
  assert.ok(retryMethodMatch, 'Missing retry method');
  assert.match(
    retryMethodMatch[1],
    /^\s*if \(!this\.canRetryTranslation\) return;\s*await this\.translateLatest\(\{ force: true \}\);\s*$/
  );

  const setSourceMatch = storeSource.match(
    /setSourceText\(value: string\): void \{([\s\S]*?)\n  \}\n\n  async login/
  );
  assert.ok(setSourceMatch, 'Missing source update method');
  const setSourceBody = setSourceMatch[1];
  const blankBranchMatch = setSourceBody.match(
    /if \(!boundedValue\.trim\(\)\) \{([\s\S]*?)\n    \}/
  );
  assert.ok(blankBranchMatch, 'Missing blank-source reset branch');
  const blankBranch = blankBranchMatch[1];

  assert.ok(
    setSourceBody.indexOf('this.error = null;') <
      setSourceBody.indexOf('if (!boundedValue.trim())'),
    'blank input must clear the old error before reset'
  );
  assert.match(
    blankBranch,
    /^\s*this\.translation = '';\s*this\.lastSubmittedRevision = null;\s*void this\.cancelActiveRequest\(\);\s*return;\s*$/
  );
  assert.doesNotMatch(blankBranch, /translateLatest/);
});

test('error strip renders a localized accessible Arco retry button', () => {
  assert.match(appSource, /name="translator__error"[\s\S]*?role="alert"/);
  assert.match(
    appSource,
    /<a-button[\s\S]*?v-if="translatorStore\.canRetryTranslation"[\s\S]*?name="translator__retry"[\s\S]*?type="text"[\s\S]*?size="mini"[\s\S]*?:disabled="translatorStore\.translating"[\s\S]*?@click="translatorStore\.retryTranslation\(\)"[\s\S]*?i18nHelper\.translator\.tryAgain[\s\S]*?<\/a-button>/
  );
  assert.ok(
    appSource.indexOf('{{ errorMessage }}') <
      appSource.indexOf('{{ i18nHelper.translator.tryAgain }}'),
    'retry action must follow the error message'
  );
  assert.match(styleSource, /\.translator__retry:focus-visible\s*\{/);
  assert.match(
    styleSource,
    /\.translator__retry\s*\{[\s\S]*?color: var\(--translator-royal\);[\s\S]*?\}/
  );
  assert.match(
    styleSource,
    /\.translator__retry:hover\s*\{\s*color: var\(--translator-royal\);\s*background: var\(--translator-royal-soft\);\s*\}/
  );
});

test('English and Chinese copy separates the retry action from the failure message', () => {
  assert.match(englishSource, /tryAgain: 'Try again'/);
  assert.match(englishSource, /invalidOutput: 'Codex returned an invalid translation\.'/);
  assert.match(englishSource, /provider: 'Translation failed\.'/);
  assert.match(chineseSource, /tryAgain: '重试'/);
  assert.match(chineseSource, /invalidOutput: 'Codex 返回了无效翻译。'/);
  assert.match(chineseSource, /provider: '翻译失败。'/);

  assert.doesNotMatch(englishSource, /invalidOutput: '[^']*Edit the source/);
  assert.doesNotMatch(englishSource, /provider: '[^']*Edit the source/);
  assert.doesNotMatch(chineseSource, /invalidOutput: '[^']*修改原文/);
  assert.doesNotMatch(chineseSource, /provider: '[^']*修改原文/);
});
