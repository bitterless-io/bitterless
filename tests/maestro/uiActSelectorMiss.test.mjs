import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

// Follow maestroAgentBrowserSession's actual-member harness: no Electron window or model.
const source = (path) => ts.createSourceFile(path, readFileSync(new URL('../../' + path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const service = source('src/main/maestro/drive/requestExec.service.ts');
const members = service.statements.filter(ts.isClassDeclaration).flatMap(node => [...node.members])
  .filter(node => ['targetReplay', 'toolUiAct'].includes(node.name?.getText(service)));
assert.equal(members.length, 2);
const declarations = [];
for (const [path, names] of [
  ['src/main/maestro/drive/requestExec.helper.ts', ['parseAgentUiActions', 'describeUiActionResult']],
  ['src/main/maestro/capture/traceTimeline.ts', ['TOOL_RESULT_LIMIT', 'clipText']]
]) {
  const ast = source(path);
  const found = ast.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
    .filter(node => names.includes(node.name.getText(ast)));
  assert.equal(found.length, names.length);
  for (const node of found) declarations.push(`const ${node.getText(ast)};`);
}
const compiled = ts.transpileModule(`${declarations.join('\n')}\nclass Actual { ${members.map(node => node.getText(service)).join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const Actual = new Function(`${compiled}; return Actual;`)();

for (const [name, action, selector] of [
  ['ordinary CSS', { action: 'click', selector: 'iframe' }, 'iframe'],
  ['snapshot ref', { action: 'click', ref: 'e2' }, '[data-coach-ref="e2"]'],
  ['compound CSS', { action: 'click', selector: '[data-coach-ref="e2"] iframe' }, '[data-coach-ref="e2"] iframe']
]) {
  test(`${name} miss stays neutral at the actual Bitterless tool entry point`, async context => {
    context.mock.method(globalThis, 'setTimeout', (callback, ms) => { assert.equal(ms, 700); queueMicrotask(callback); });
    const run = { ok: false, results: [{ action: 'click', selector, ok: false, error: `Selector not found: ${selector}` }] };
    const traces = [], activities = [], batches = [], drains = [];
    const skill = { id: 'fixture-skill' }, skills = [skill];
    const request = new Actual();
    request.browserTarget = { getStore: () => undefined };
    request._state = {
      replayEngine: { runUiActions: async actions => { batches.push(actions); return run; } },
      capture: { snapshot: () => assert.fail('Bitterless has no recovery-snapshot block to port') },
      lastAgentRun: { skill, skills },
      broadcastActivity: (...args) => activities.push(args),
      emitTrace: event => traces.push(event),
      drainNewTabsNote: session => { drains.push(session); return '\nNEW TAB: fixture-popup'; }
    };
    const output = await request.toolUiAct(JSON.stringify(action));
    assert.equal(output, JSON.stringify(run, null, 1) + '\nNEW TAB: fixture-popup');
    assert.doesNotMatch(output, /STALE|DOM changed|no longer exist|NOT a missing element/i);
    assert.equal(batches.length, 1);
    assert.equal(batches[0][0].selector, selector);
    assert.deepEqual(activities, [['act', `click ${selector}`, false]]);
    assert.equal(traces.length, 1);
    assert.equal(traces[0].kind, 'error');
    assert.deepEqual(drains, [undefined]);
    assert.deepEqual(request._state.lastAgentRun, { skill, skills, replay: {
      ok: false, skillId: skill.id, stepsRun: 0, errors: [`click ${selector}: Selector not found: ${selector}`], mode: 'ui'
    } });
  });
}
