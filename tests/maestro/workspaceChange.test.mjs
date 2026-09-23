import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
const root = resolve(import.meta.dirname, '../..');
const source = readFileSync(resolve(root, 'src/main/agent/maestroAgent.service.ts'), 'utf8');
const ast = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true);
const member = ast.statements.filter(ts.isClassDeclaration).flatMap(c => [...c.members]).find(m => m.name?.getText(ast) === 'runWorkspaceChange');
const code = ts.transpileModule('class Subject { ' + member.getText(ast) + ' }', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const run = new Function(code + '; return Subject.prototype.runWorkspaceChange')();
const deferred = () => { let finish; const promise = new Promise(resolve => { finish = resolve }); return { promise, finish }; };
test('switch waits for the current turn, serializes choices, and releases the send gate after failure', async () => {
  const turn = deferred(), events = [];
  const state = { workspaceChanges: new Map(), manualCompactions: new Map(), agentSessionKey: value => value,
    activeAgentTurns: new Map([['chat', { finished: turn.promise }]]) };
  const first = run.call(state, 'chat', async () => { events.push('first'); throw Error('picker failed'); });
  const rejected = assert.rejects(first, /picker failed/);
  const second = run.call(state, 'chat', async () => { events.push('second'); return '/chosen'; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, []);
  assert.equal(state.workspaceChanges.has('chat'), true);
  turn.finish();
  await rejected;
  assert.equal(await second, '/chosen');
  assert.deepEqual(events, ['first', 'second']);
  assert.equal(state.workspaceChanges.has('chat'), false);
});
