import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const runtimeSource = read('src/main/codex/codexRuntime.service.ts');
const serviceSource = read('src/main/translator/translator.service.ts');
const translatorRuntimeSource = read('src/main/translator/translator.runtime.ts');
const logPolicySource = read('src/main/logging/logPolicy.service.ts');
const translatorLogSource = read('src/main/logging/translatorLog.service.ts');

test('one accepted-request deadline races provider, runtime, and observation work', () => {
  const timerIndex = serviceSource.indexOf('this.setTimer(() =>');
  const providerIndex = serviceSource.indexOf("awaitStage('provider-context'");
  assert.ok(timerIndex > 0 && timerIndex < providerIndex);
  assert.match(
    serviceSource,
    /const waitForAbortable = async <T>[\s\S]*?void operation\.catch\(\(\) => undefined\);[\s\S]*?Promise\.race\(\[operation, aborted\]\)/
  );
  assert.match(serviceSource, /awaitStage\('provider-context'/);
  assert.match(serviceSource, /awaitStage\('provider-observation'/);
  assert.match(serviceSource, /awaitStage\('provider-auth-observation'/);
  assert.match(serviceSource, /output-validation-started/);
  assert.match(serviceSource, /output-validation-completed/);
});

test('Pi preparation and prompt stages race the same abort signal', () => {
  assert.match(runtimeSource, /waitForAbortable\([\s\S]*?dependencies\.loadPiModule\(\)/);
  assert.match(runtimeSource, /waitForAbortable\([\s\S]*?createPiTargetContext\(/);
  assert.match(runtimeSource, /waitForSession\(creation, input\.signal\)/);
  assert.match(runtimeSource, /waitForPrompt\(session, input\.prompt, input\.signal, abortSession\)/);
  assert.match(runtimeSource, /void operation\.catch\(\(\) => undefined\);/);
  assert.match(runtimeSource, /void creation[\s\S]*?session\.abort\(\)[\s\S]*?session\.dispose\(\)/);
});

test('Translator disables model catalog network and duplicate registry refresh', () => {
  assert.match(serviceSource, /allowModelNetwork: false/);
  assert.match(runtimeSource, /allowModelNetwork\?: boolean;/);
  assert.match(runtimeSource, /allowModelNetwork\s*\n\s*\}\);/);
  assert.doesNotMatch(runtimeSource, /modelRegistry\.refresh\?\.\(\)/);
});

test('dedicated Translator logging is profile-safe, file-only, and sanitized', () => {
  assert.match(
    logPolicySource,
    /join\(paths\.userData, 'logs', 'translator', 'translator\.log'\)/
  );
  assert.match(
    logPolicySource,
    /join\(paths\.libraryDefaultDir, 'translator', 'translator\.log'\)/
  );
  assert.match(translatorLogSource, /log\.create\(\{ logId: 'translator' \}\)/);
  assert.match(translatorLogSource, /transports\.console\.level = false/);
  assert.match(translatorLogSource, /transports\.ipc\.level = false/);
  assert.match(translatorLogSource, /transports\.remote\.level = false/);
  assert.match(translatorLogSource, /APPLICATION_LOG_FILE_MAX_SIZE/);
  assert.match(translatorLogSource, /formatApplicationLogMessage/);
  assert.match(translatorLogSource, /sanitizeApplicationLogMessage/);
  assert.match(serviceSource, /logger: TranslatorLogger;/);
  assert.match(translatorRuntimeSource, /logger: translatorLogger/);
});

test('Translator diagnostics exclude user and credential-bearing identifiers', () => {
  assert.doesNotMatch(
    translatorLogSource,
    /\b(?:sourceText|translation|prompt|clientId|requestId|token|credential|authorization|oauth)\??:/i
  );
  assert.match(serviceSource, /sourceCodePoints: Array\.from\(input\.sourceText\)\.length/);
  assert.match(serviceSource, /errorCause\(cause\)/);
  assert.doesNotMatch(serviceSource, /logger\?\.write\([\s\S]{0,500}clientId/);
  assert.doesNotMatch(serviceSource, /logger\?\.write\([\s\S]{0,500}requestId/);
});
