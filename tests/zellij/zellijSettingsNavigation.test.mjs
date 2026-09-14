/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native Node test fixtures. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const mainSource = ts.createSourceFile(
  'handler.ts',
  readFileSync('src/main/xpc/zellij.handler.ts', 'utf8'),
  ts.ScriptTarget.Latest,
  true
);
const handler = mainSource.statements.find(ts.isClassDeclaration);
const members = handler.members.filter((member) =>
  ['settingsRequested', 'openSettings', 'consumeSettingsRequest'].includes(
    member.name?.getText(mainSource)
  )
);
assert.equal(members.length, 3);
const rendererSource = readFileSync('src/renderer/maestro/workbench/src/WorkbenchApp.vue', 'utf8');
const script = rendererSource.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
const rendererAst = ts.createSourceFile('app.ts', script, ts.ScriptTarget.Latest, true);
const consumer = rendererAst.statements.find(
  (statement) =>
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(
      (declaration) => declaration.name.getText(rendererAst) === 'openTerminalSettings'
    )
);
assert.ok(consumer);
const compiled = ts.transpileModule(
  `class Handler { ${members.map((member) => member.getText(mainSource)).join('\n')} }
   const zellij = new Handler();
   ${consumer.getText(rendererAst)}
   globalThis.fixture = { zellij, openTerminalSettings };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText;

const fixture = (boot = async () => {}) => {
  const calls = [];
  const context = vm.createContext({
    ZELLIJ_SETTINGS_OPEN_EVENT: 'zellij/settings-open',
    maestroWindowHandler: { openMaestroWindow: boot },
    maestroWindowHelper: { openWorkbenchTab: async () => calls.push('workbench') },
    xpcMain: { broadcast: (event) => calls.push(event) },
    settingNavStore: { select: (tab) => calls.push(tab) },
    router: { push: async (target) => calls.push(target.name) }
  });
  vm.runInContext(compiled, context);
  return { ...context.fixture, calls };
};

test('cold Workbench consumes pending terminal settings before its opening broadcast', async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const current = fixture(() => pending);
  const opening = current.zellij.openSettings();
  await current.openTerminalSettings();
  assert.deepEqual(current.calls, ['terminal', 'settings']);
  release();
  await opening;
  await current.openTerminalSettings();
  assert.deepEqual(current.calls, ['terminal', 'settings', 'workbench', 'zellij/settings-open']);
});

test('warm gear opens shared Terminal settings and unrelated mounts keep their current pane', async () => {
  const current = fixture();
  await current.openTerminalSettings();
  assert.deepEqual(current.calls, []);
  await current.zellij.openSettings();
  await current.openTerminalSettings();
  assert.deepEqual(current.calls, ['workbench', 'zellij/settings-open', 'terminal', 'settings']);
  await current.openTerminalSettings();
  assert.equal(current.calls.length, 4, 'one pending request is consumed once');
});
