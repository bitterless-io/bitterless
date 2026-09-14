import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const turnSource = readFileSync(resolve(root, 'src/renderer/maestro/control/src/store/turn.service.ts'), 'utf8');
const extract = (source, names) => {
  const ast = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const found = [];
  const visit = node => {
    if (ts.isMethodDeclaration(node) && names.includes(node.name.getText(ast))) found.push(node.getText(ast));
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(found.length, names.length);
  return found.join('\n');
};

test('four new sessions reserve independently before claim resolves; a fifth waits and steering still works', async () => {
  const claims = [], aborts = [], steering = [];
  const sessions = Array.from({ length: 5 }, (_, index) => ({ id: `session-${index}`, messages: [], detail: {} }));
  let sequence = 0;
  const source = `const MAX_CONCURRENT_TURNS = ${turnSource.match(/const MAX_CONCURRENT_TURNS = (\d+)/)[1]}; class Target { ${extract(turnSource, ['send', 'runningTurnCount', 'busyElsewhere'])} }`;
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const Target = runInNewContext(`${output}\nTarget`, {
    Set, Date, uid: () => `turn-${++sequence}`,
    turnDiagnostics: { emit() {}, stage: (_id, _stage, run) => run() },
    withStageTimeout: (_stage, run) => run(),
    coach: {
      claimAgentTurn: params => new Promise(resolve => claims.push({ params, resolve })),
      abortAgent: async params => { aborts.push(params); }
    }
  });
  const service = new Target();
  service.rootDispatchWaiters = new Map();
  service.settleRootDispatch = () => {};
  service.sendSteering = async (session, text) => { steering.push(session.id); return { text }; };
  service._state = { sessions, activeAgentTurnSnapshots: [], getSession: id => sessions.find(item => item.id === id), updateSessionContextUsage() {}, scrollToBottom() {} };
  const pending = sessions.slice(0, 4).map(session => service.send(session.id, 'work'));
  assert.equal(claims.length, 4);
  assert.equal(service.runningTurnCount(), 4);
  assert.equal(service.busyElsewhere(sessions[0].id), false);
  assert.equal((await service.send(sessions[4].id, 'fifth')).reason, 'busy-elsewhere');
  await service.send(sessions[0].id, 'continue');
  assert.deepEqual(steering, [sessions[0].id]);
  assert.equal(claims.length, 4);
  service._state.activeAgentTurnSnapshots = [{ sessionId: sessions[0].id }];
  assert.equal(service.runningTurnCount(), 4, 'main/local records do not double-count a session');
  for (const claim of claims) claim.resolve({ ok: false, reason: 'not-sendable' });
  await Promise.all(pending);
  assert.equal(aborts.length, 4);
  assert.deepEqual(new Set(aborts.map(item => item.sessionId)), new Set(sessions.slice(0, 4).map(item => item.id)));
});

test('main snapshots count toward capacity even before their sessions are loaded', () => {
  const output = ts.transpileModule(`const MAX_CONCURRENT_TURNS = 4; class Target { ${extract(turnSource, ['runningTurnCount', 'busyElsewhere'])} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const Target = runInNewContext(`${output}\nTarget`, { Set });
  const service = new Target();
  service._state = { sessions: [], activeAgentTurnSnapshots: Array.from({ length: 4 }, (_, i) => ({ sessionId: `reserved-${i}` })), getSession: () => undefined };
  assert.equal(service.busyElsewhere('next'), true);
  service._state.activeAgentTurnSnapshots.pop();
  assert.equal(service.busyElsewhere('next'), false);
});
