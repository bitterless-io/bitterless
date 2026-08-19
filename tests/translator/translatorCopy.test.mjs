import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const appSource = read('src/renderer/translator/src/App.vue');
const styleSource = read('src/renderer/translator/src/App.less');
const storeSource = read('src/renderer/translator/src/store/translator.store.ts');
const englishSource = read('src/renderer/common/i18n/en.ts');
const chineseSource = read('src/renderer/common/i18n/zh.ts');
const featureDoc = read('docs/features/translator.md');

test('the result footer exists only while a translation is displayed', () => {
  assert.match(
    storeSource,
    /get hasTranslation\(\): boolean \{\s*return this\.ready && Boolean\(this\.translation\);\s*\}/
  );
  assert.match(
    appSource,
    /<footer\s+v-if="translatorStore\.hasTranslation"\s+name="translator__result-footer"/
  );
  assert.match(
    appSource,
    /v-if="translatorStore\.hasTranslation"\s+name="translator__translation"/
  );

  assert.ok(
    appSource.indexOf('name="translator__result-footer"') >
      appSource.indexOf('name="translator__translation"'),
    'the footer must follow the translation canvas'
  );
  assert.ok(
    appSource.indexOf('name="translator__result-footer"') <
      appSource.indexOf('name="translator__error"'),
    'the footer must stay above the conditional error strip'
  );
});

test('the footer copies the exact validated translation through the clipboard', () => {
  const copyMethodMatch = storeSource.match(
    /async copyTranslation\(\): Promise<void> \{([\s\S]*?)\n  \}/
  );
  assert.ok(copyMethodMatch, 'Missing copy method');
  const copyMethod = copyMethodMatch[1];

  assert.match(copyMethod, /^\s*if \(!this\.hasTranslation\) return;/);
  assert.match(copyMethod, /await navigator\.clipboard\.writeText\(this\.translation\);/);
  assert.match(copyMethod, /this\.markCopyState\('copied'\);/);
  assert.match(copyMethod, /this\.markCopyState\('failed'\);/);
  assert.doesNotMatch(copyMethod, /sourceText|targetLanguage|trim\(\)|JSON\./);

  assert.match(
    appSource,
    /name="translator__copy"[\s\S]*?type="text"[\s\S]*?size="mini"[\s\S]*?:aria-label="i18nHelper\.translator\.copyTranslation"[\s\S]*?@click="translatorStore\.copyTranslation\(\)"/
  );
});

test('copy feedback is transient and never survives a newer result or a source edit', () => {
  assert.match(storeSource, /const COPY_FEEDBACK_RESET_MS = 1_600;/);
  assert.match(
    storeSource,
    /private markCopyState\(state: Exclude<TranslatorCopyState, 'idle'>\): void \{\s*this\.resetCopyState\(\);\s*this\.copyState = state;\s*this\.copyResetTimer = setTimeout\(\(\) => \{\s*this\.copyState = 'idle';\s*this\.copyResetTimer = null;\s*\}, COPY_FEEDBACK_RESET_MS\);\s*\}/
  );
  assert.match(
    storeSource,
    /private resetCopyState\(\): void \{\s*if \(this\.copyResetTimer\) clearTimeout\(this\.copyResetTimer\);\s*this\.copyResetTimer = null;\s*this\.copyState = 'idle';\s*\}/
  );
  assert.match(storeSource, /this\.translation = result\.translation;\s*this\.resetCopyState\(\);/);

  const setSourceMatch = storeSource.match(
    /setSourceText\(value: string\): void \{([\s\S]*?)\n  \}\n\n  async login/
  );
  assert.ok(setSourceMatch, 'Missing source update method');
  assert.match(setSourceMatch[1], /this\.targetLanguage = null;\s*this\.resetCopyState\(\);/);

  assert.match(
    appSource,
    /name="translator__copy-status"[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?\{\{ copyStatusLabel \}\}/
  );
  assert.match(
    appSource,
    /<IconCheck v-if="translatorStore\.copyState === 'copied'"[\s\S]*?<IconCopy v-else/
  );
});

test('the footer is a pinned right-aligned strip below the scrolling canvas', () => {
  assert.match(
    styleSource,
    /\.translator__result-footer \{[\s\S]*?flex: 0 0 auto;[\s\S]*?justify-content: flex-end;[\s\S]*?\}/
  );
  assert.match(
    styleSource,
    /\.translator__copy \{[\s\S]*?color: var\(--translator-royal\);[\s\S]*?\}/
  );
  assert.match(
    styleSource,
    /\.translator__copy:hover \{\s*color: var\(--translator-royal\);\s*background: var\(--translator-royal-soft\);\s*\}/
  );
  assert.match(styleSource, /\.translator__copy:focus-visible \{/);

  assert.ok(
    styleSource.indexOf('.translator__result-footer {') >
      styleSource.indexOf('.translator__result {'),
    'footer styles belong to the result region'
  );
});

test('English and Chinese copy cover the action and both transient outcomes', () => {
  assert.match(englishSource, /copyTranslation: 'Copy translation'/);
  assert.match(englishSource, /copied: 'Copied'/);
  assert.match(englishSource, /copyFailed: 'Copy failed'/);
  assert.match(chineseSource, /copyTranslation: '复制译文'/);
  assert.match(chineseSource, /copied: '已复制'/);
  assert.match(chineseSource, /copyFailed: '复制失败'/);
});

test('the feature contract documents the result footer', () => {
  assert.match(featureDoc, /## Result Footer/);
  assert.match(featureDoc, /conditional result footer/);
});
