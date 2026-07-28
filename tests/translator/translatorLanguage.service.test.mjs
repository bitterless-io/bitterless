import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const nodeRequire = createRequire(import.meta.url);

const schemaSource = read('src/shared/translator/translator.schema.ts');
const serviceSource = read('src/main/translator/translator.service.ts');
const storeSource = read('src/renderer/translator/src/store/translator.store.ts');
const appSource = read('src/renderer/translator/src/App.vue');
const englishSource = read('src/renderer/common/i18n/en.ts');
const chineseSource = read('src/renderer/common/i18n/zh.ts');

const loadTranslatorSchema = () => {
  const transpiled = ts.transpileModule(schemaSource, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    fileName: 'src/shared/translator/translator.schema.ts',
    reportDiagnostics: true
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  assert.deepEqual(
    errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    []
  );

  const loadedModule = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier === './translator.contract') {
      return {
        TRANSLATOR_MAX_SOURCE_LENGTH: 12_000,
        TRANSLATOR_MAX_TRANSLATION_LENGTH: 24_000
      };
    }
    return nodeRequire(specifier);
  };
  const execute = new Function(
    'require',
    'module',
    'exports',
    `${transpiled.outputText}\n//# sourceURL=translator.schema.ts`
  );
  execute(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
};

test('strict output accepts only a validated target and translation', () => {
  const { parseTranslatorOutput } = loadTranslatorSchema();

  assert.deepEqual(parseTranslatorOutput({ targetLanguage: 'en', translation: 'Hello' }), {
    targetLanguage: 'en',
    translation: 'Hello'
  });
  assert.deepEqual(parseTranslatorOutput({ targetLanguage: 'zh-CN', translation: '你好' }), {
    targetLanguage: 'zh-CN',
    translation: '你好'
  });

  assert.throws(() => parseTranslatorOutput({ translation: 'Hello' }));
  assert.throws(() => parseTranslatorOutput({ targetLanguage: 'English', translation: 'Hello' }));
  assert.throws(() =>
    parseTranslatorOutput({ targetLanguage: 'en', translation: 'Hello', reasoning: 'hidden' })
  );
  assert.throws(() => parseTranslatorOutput({ targetLanguage: 'zh-CN', translation: '  ' }));
});

test('Main sends auto direction without a local target and returns the model target', () => {
  assert.match(
    serviceSource,
    /const requestPrompt = \(sourceText: string\): string =>[\s\S]*?direction: 'auto',[\s\S]*?sourceText/
  );
  assert.doesNotMatch(serviceSource, /resolveTranslatorTargetLanguage/);
  assert.doesNotMatch(serviceSource, /translatorLanguage\.service/);
  assert.match(serviceSource, /prompt: requestPrompt\(input\.sourceText\)/);
  assert.match(serviceSource, /targetLanguage: output\.targetLanguage/);
});

test('Store owns a nullable result target and removes stale direction on source edits', () => {
  assert.match(storeSource, /targetLanguage: TranslatorTargetLanguage \| null = null;/);
  assert.doesNotMatch(storeSource, /resolveTranslatorTargetLanguage/);
  assert.doesNotMatch(storeSource, /get targetLanguage\(\)/);
  assert.match(
    storeSource,
    /setSourceText\(value: string\): void \{[\s\S]*?this\.sourceText = boundedValue;[\s\S]*?this\.targetLanguage = null;/
  );
  assert.match(
    storeSource,
    /if \(result\.status === 'completed'\) \{\s*this\.targetLanguage = result\.targetLanguage;\s*this\.translation = result\.translation;/
  );
  assert.match(storeSource, /if \(wasReady && !this\.ready\) \{\s*this\.targetLanguage = null;/);
});

test('direction rail hides an unknown target and localizes the confirmed result', () => {
  assert.match(appSource, /<strong v-if="directionLabel">\{\{ directionLabel \}\}<\/strong>/);
  assert.match(
    appSource,
    /if \(translatorStore\.targetLanguage === 'zh-CN'\) \{[\s\S]*?translateToChinese/
  );
  assert.match(
    appSource,
    /if \(translatorStore\.targetLanguage === 'en'\) \{[\s\S]*?translateToEnglish/
  );
  assert.match(appSource, /return '';/);

  assert.match(englishSource, /translateToEnglish: 'Translate to English'/);
  assert.match(englishSource, /translateToChinese: 'Translate to Simplified Chinese'/);
  assert.match(chineseSource, /translateToEnglish: '翻译为英文'/);
  assert.match(chineseSource, /translateToChinese: '翻译为简体中文'/);
});
