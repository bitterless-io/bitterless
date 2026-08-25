import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const runtimeSource = read('src/main/codex/codexRuntime.service.ts');
const serviceSource = read('src/main/translator/translator.service.ts');
const logSource = read('src/main/logging/translatorLog.service.ts');
const contractSource = read('src/shared/translator/translator.contract.ts');

test('Codex runtime reduces Pi diagnostics to a log-only allowlist', () => {
  assert.match(runtimeSource, /diagnostics\?: CodexRuntimePiDiagnostic\[\];/);
  assert.match(runtimeSource, /diagnostic\?: CodexRuntimeDiagnosticSummary/);
  assert.match(runtimeSource, /diagnostic\.type !== 'provider_transport_failure'/);
  assert.match(runtimeSource, /readDiagnosticField\(details, 'configuredTransport'\)/);
  assert.match(runtimeSource, /readDiagnosticField\(details, 'fallbackTransport'\)/);
  assert.match(runtimeSource, /readDiagnosticField\(details, 'phase'\)/);
  assert.match(runtimeSource, /transportDiagnostic\?: CodexRuntimeDiagnosticEvidence;/);
  assert.match(runtimeSource, /terminalDiagnostic\?: CodexRuntimeDiagnosticEvidence;/);
  assert.match(runtimeSource, /canonicalProviderDetail\(category\)/);
  assert.doesNotMatch(
    runtimeSource,
    /providerEvidenceText|statusFromEvidence|codeFromEvidence|errorNameFromEvidence/
  );
  assert.doesNotMatch(runtimeSource, /summarize[^\n]*\(message\.errorMessage/);
  assert.doesNotMatch(runtimeSource, /readDiagnosticField\(errorRecord, 'message'\)/);
  assert.doesNotMatch(runtimeSource, /readDiagnosticField\(details, 'requestBytes'\)/);
  assert.doesNotMatch(runtimeSource, /readDiagnosticField\(details, 'eventsEmitted'\)/);
});

test('typed response status is observed without retaining response metadata', () => {
  assert.match(runtimeSource, /onResponse\?: SimpleStreamOptions\['onResponse'\];/);
  assert.match(runtimeSource, /const status = diagnosticStatus\(response\.status\);/);
  assert.match(runtimeSource, /if \(onResponse\) await onResponse\.call\(agent, response, model\);/);
  assert.match(runtimeSource, /observedProviderStatus = status;/);
  assert.match(runtimeSource, /summarizeTerminalStatus\(observedProviderStatus\)/);
  assert.doesNotMatch(runtimeSource, /response\.headers/);
});

test('terminal provider summary ignores all free-form error text', () => {
  assert.match(
    runtimeSource,
    /if \(!\(value instanceof Error\)\) return summarizeTerminalStatus\(observedStatus\);/
  );
  assert.match(runtimeSource, /readDiagnosticField\(record, 'status'\)/);
  assert.match(runtimeSource, /readDiagnosticField\(record, 'statusCode'\)/);
  assert.match(runtimeSource, /readDiagnosticField\(record, 'name'\)/);
  assert.match(runtimeSource, /readDiagnosticField\(record, 'code'\)/);
  assert.match(runtimeSource, /'provider-unknown': 'provider request failed'/);
  assert.doesNotMatch(runtimeSource, /readDiagnosticField\(record, 'message'\)/);
  assert.doesNotMatch(runtimeSource, /summarizeCaughtProviderError\([^)]*\.message/);
});

test('Translator logs provider summary without widening its public error contract', () => {
  assert.match(
    serviceSource,
    /cause instanceof CodexRuntimeError && cause\.diagnostic[\s\S]*?diagnostic: cause\.diagnostic/
  );
  assert.match(contractSource, /export interface TranslatorError \{\s*code: TranslatorErrorCode;\s*retryable: boolean;\s*\}/);
  assert.doesNotMatch(contractSource, /export interface TranslatorError \{[\s\S]*?diagnostic/);
  assert.doesNotMatch(serviceSource, /error:\s*\{[\s\S]{0,160}diagnostic/);
});

test('Translator lifecycle and provider fields survive the opaque-token sanitizer', () => {
  assert.match(logSource, /export type TranslatorLogPhase = 'completed' \| 'started'/);
  assert.match(logSource, /provider-auth-observation' \? 'provider-auth-observe'/);
  assert.match(logSource, /lastStage=\$\{safeToken\(entry\.lastStage\)\}/);
  assert.match(logSource, /lastPhase=\$\{safeToken\(entry\.lastPhase\)\}/);
  assert.match(logSource, /category=\$\{safeToken\(diagnostic\.category, 23\)\}/);
  assert.match(logSource, /transport=\$\{safeToken\(diagnostic\.configuredTransport, 23\)\}/);
  assert.match(logSource, /fallback=\$\{safeToken\(diagnostic\.fallbackTransport, 23\)\}/);
  assert.match(logSource, /providerPhase=\$\{safeToken\(diagnostic\.providerPhase, 23\)\}/);
  assert.match(logSource, /httpStatus=\$\{Math\.trunc\(diagnostic\.httpStatus\)\}/);
  assert.match(logSource, /sanitizeDiagnostic\(diagnostic\.detail, 160\)/);
  assert.match(logSource, /diagnosticLogData\('transport', entry\.diagnostic\.transportDiagnostic\)/);
  assert.match(logSource, /diagnosticLogData\('terminal', entry\.diagnostic\.terminalDiagnostic\)/);
  assert.match(logSource, /sanitizeApplicationLogMessage/);
  assert.match(serviceSource, /lastPosition: activePosition/);
  assert.doesNotMatch(serviceSource, /cause: `\$\{activeStage\}-/);
});

test('provider logger has no source, output, auth, identity, or raw-object fields', () => {
  assert.doesNotMatch(
    logSource,
    /\b(?:sourceText|translation|prompt|output|clientId|requestId|requestBytes|responseBody|headers|token|oauth|credential)\??:/i
  );
  assert.doesNotMatch(logSource, /JSON\.stringify\(entry\.diagnostic\)/);
  assert.doesNotMatch(logSource, /data:\s*\[[\s\S]{0,300}entry\.diagnostic\s*[,\]]/);
});
