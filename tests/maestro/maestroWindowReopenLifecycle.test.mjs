/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const requireMatch = (source, pattern, message) => {
  const match = source.match(pattern);
  assert.ok(match, message);
  return match[0];
};

test('normal native close hides the live Maestro runtime without tearing it down', () => {
  const handler = read('src/main/xpc/maestroWindow.handler.ts');
  const closeListener = requireMatch(
    handler,
    /window\.on\('close', \(event\) => \{[\s\S]*?\n      \}\)/,
    'Missing Maestro native close listener',
  );
  const closedListener = requireMatch(
    handler,
    /window\.once\('closed', \(\) => \{[\s\S]*?\n      \}\)/,
    'Missing Maestro native destruction listener',
  );

  assert.match(closeListener, /event\.preventDefault\(\)/);
  assert.match(closeListener, /window\.hide\(\)/);
  assert.doesNotMatch(closeListener, /destroyMaestroRuntime|shutdown|destroy\(/);
  assert.match(closedListener, /this\.destroyMaestroRuntime\(\)/);
});

test('repeat Open shows the preserved singleton before any cold boot is created', () => {
  const handler = read('src/main/xpc/maestroWindow.handler.ts');
  const open = requireMatch(
    handler,
    /async openMaestroWindow\(\): Promise<void> \{[\s\S]*?\n  \}/,
    'Missing Maestro open entrypoint',
  );

  assert.ok(
    open.indexOf('const current = maestroWindowHelper.browserWindow') <
      open.indexOf('const boot = this.boot()'),
  );
  const reuseBranch = requireMatch(
    open,
    /if \(current && !current\.isDestroyed\(\)\) \{[\s\S]*?\n      \}/,
    'Missing preserved Maestro singleton branch',
  );
  assert.match(reuseBranch, /requestDiagnostics\.route\('reuse'\)/);
  assert.match(reuseBranch, /maestroWindowHelper\.show\(\)/);
  assert.match(reuseBranch, /requestDiagnostics\.terminal\('success', 'ready'\)/);
  assert.match(reuseBranch, /return/);
});

test('authentication and host quit retain complete Maestro runtime cleanup', () => {
  const handler = read('src/main/xpc/maestroWindow.handler.ts');
  const destroyForAuth = requireMatch(
    handler,
    /async _destroyForAuth\(\): Promise<void> \{[\s\S]*?\n  \}/,
    'Missing auth teardown entrypoint',
  );
  const destroyForHostQuit = requireMatch(
    handler,
    /async destroyForHostQuit\(\): Promise<void> \{[\s\S]*?\n  \}/,
    'Missing host quit teardown entrypoint',
  );
  const performAuthCleanup = requireMatch(
    handler,
    /private async performAuthCleanup\(\): Promise<void> \{[\s\S]*?\n  \}/,
    'Missing authenticated runtime cleanup',
  );

  assert.match(destroyForAuth, /await this\.runAuthCleanup\(\)/);
  assert.match(performAuthCleanup, /await this\.destroyMaestroRuntime/);
  assert.match(destroyForHostQuit, /await this\.destroyMaestroRuntime\(\)/);
});
