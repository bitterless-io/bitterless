import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// ui_act hover + timerHelper (docs/features/ui-act-wait-hover-jev.md #1 #2 #2.3 #6). `wait` and
// `wait_for` were dropped on 2026-09-24 (feature doc Request); they must parse as unknown actions.
// Same actual-member harness as uiActSelectorMiss.test.mjs: the real text of each member and
// declaration is lifted out of its source file and run against stubs — no Electron, no model.
// The in-page scripts (clickLocator, deepFindElement) really run, inside a vm context holding a
// fake DOM with its own clock.
const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const source = (path) => ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);

const declarationsOf = (path, names) => {
  const ast = source(path);
  const found = [];
  for (const node of ast.statements) {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (names.includes(declaration.name.getText(ast))) found.push(`const ${declaration.getText(ast)};`);
      }
    } else if (ts.isFunctionDeclaration(node) && names.includes(node.name?.getText(ast))) {
      found.push(node.getText(ast));
    }
  }
  assert.equal(found.length, names.length, `missing declarations in ${path}`);
  return found;
};

const membersOf = (path, names) => {
  const ast = source(path);
  const found = ast.statements.filter(ts.isClassDeclaration).flatMap((node) => [...node.members])
    .filter((node) => names.includes(node.name?.getText(ast)));
  assert.equal(found.length, names.length, `missing members in ${path}`);
  return found.map((node) => node.getText(ast));
};

const compile = (declarations, members, bindings) => {
  const compiled = ts.transpileModule(`${declarations.join('\n')}\nclass Actual { ${members.join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}; return Actual;`)(...Object.values(bindings));
};

// What the agent sees: CDP returnByValue and the tool result both go through JSON.
const wire = (value) => JSON.parse(JSON.stringify(value));

const HELPER = 'src/main/maestro/drive/requestExec.helper.ts';
const ENGINE = 'src/main/maestro/drive/replayEngine.ts';
const parseDeclarations = declarationsOf(HELPER, ['parseAgentUiActions']);
const parse = new Function(`${ts.transpileModule(parseDeclarations.join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText}; return parseAgentUiActions;`)();

// Main-process pauses (the 180 ms between actions) are recorded, not slept.
const delays = [];
const fakeTimerHelper = {
  delay: async (ms) => {
    delays.push(ms);
  }
};
const Engine = compile(
  declarationsOf(ENGINE, ['deepFindElement', 'clickLocator', 'browserStepRunner']),
  membersOf(ENGINE, ['runUiActions', 'runStep', 'clickStep', 'hoverStep', 'locateTarget']),
  { timerHelper: fakeTimerHelper }
);

const element = ({ id = '', box = { left: 10, top: 20, width: 80, height: 24 } } = {}) => ({
  tagName: 'BUTTON',
  id,
  shadowRoot: null,
  getAttribute: () => null,
  getBoundingClientRect: () => box,
  scrollIntoView: () => {}
});

// A fake page. Every Runtime.evaluate really runs its expression in this context.
const createPage = () => {
  const page = { clock: 0, elements: new Map(), evaluations: 0 };
  page.context = vm.createContext({
    document: {
      querySelector: (selector) => page.elements.get(selector) ?? null,
      querySelectorAll: () => []
    },
    getComputedStyle: () => ({}),
    // In-page sleeps (clickLocator polls up to 6 s for a selector) run on the page's own clock.
    setTimeout: (callback, ms) => {
      page.clock += ms;
      Promise.resolve().then(callback);
    },
    Date: { now: () => page.clock }
  });
  return page;
};

const setup = () => {
  delays.length = 0;
  const page = createPage();
  const mouse = { moves: [], clicks: [] };
  const engine = new Engine();
  engine.wc = {
    debugger: {
      sendCommand: async (method, params) => {
        assert.equal(method, 'Runtime.evaluate');
        page.evaluations += 1;
        const value = await vm.runInContext(params.expression, page.context);
        return { result: { value: value === undefined ? undefined : wire(value) } };
      }
    }
  };
  engine.mouse = {
    moveTo: async (box) => {
      mouse.moves.push(box);
      return box;
    },
    click: async (box) => {
      mouse.clicks.push(box);
      return box;
    }
  };
  const run = async (raw) => wire(await engine.runUiActions(parse(raw)));
  return { page, mouse, engine, run };
};

test('timerHelper.delay awaits about ms, and treats negative / NaN as 0', async (context) => {
  const output = ts.transpileModule(read('src/shared/timerHelper/timer.helper.ts'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const { timerHelper } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

  const started = performance.now();
  await timerHelper.delay(60);
  const waited = performance.now() - started;
  assert.ok(waited >= 50 && waited < 1000, `delay(60) waited ${waited}ms`);

  const seen = [];
  context.mock.method(globalThis, 'setTimeout', (callback, ms) => {
    seen.push(ms);
    callback();
  });
  await timerHelper.delay(-5);
  await timerHelper.delay(Number.NaN);
  await timerHelper.delay(250);
  assert.deepEqual(seen, [0, 0, 250]);
});

test('parse accepts hover next to the existing five; wait / wait_for are unknown actions', () => {
  assert.deepEqual(wire(parse([
    { action: 'hover', ref: 'e1' },
    { action: 'wait', ms: 500 },
    { action: 'wait', selector: 'body', ms: 500 },
    { action: 'wait_for', text: 'Download invoice' },
    { action: 'wait_for', ref: 'e3' },
    { action: 'hover', selector: '.menu > .more' },
    { action: 'click', ref: 'e2' },
    { action: 'hover' }
  ])), [
    { action: 'hover', selector: '[data-coach-ref="e1"]' },
    { action: 'hover', selector: '.menu > .more' },
    { action: 'click', selector: '[data-coach-ref="e2"]' }
  ]);
  assert.deepEqual(parse([{ action: 'wait' }, { action: 'wait_for', until: 'the list has loaded' }]), []);
});

test('hover moves the human pointer onto the located box without pressing', async () => {
  const { page, mouse, run } = setup();
  page.elements.set('[data-coach-ref="e5"]', element({ id: 'more' }));
  assert.deepEqual(await run([{ action: 'hover', ref: 'e5' }]), {
    ok: true,
    results: [{ action: 'hover', selector: '[data-coach-ref="e5"]', ok: true, target: { tag: 'button', id: 'more', name: '' } }]
  });
  assert.deepEqual(mouse.moves, [{ x: 50, y: 32, width: 80, height: 24 }]);
  assert.deepEqual(mouse.clicks, []);
});

test('hover not located: ok:false "hover target not located", no pointer move, batch stops', async () => {
  const { page, mouse, run } = setup();
  page.elements.set('[data-coach-ref="e2"]', element());
  const outcome = await run([{ action: 'hover', ref: 'e9' }, { action: 'click', ref: 'e2' }]);
  assert.deepEqual(outcome, {
    ok: false,
    results: [{
      action: 'hover',
      selector: '[data-coach-ref="e9"]',
      ok: false,
      error: 'hover target not located: Selector not found: [data-coach-ref="e9"]'
    }]
  });
  assert.deepEqual(mouse.moves, []);
  assert.deepEqual(mouse.clicks, []);
  assert.deepEqual(delays, []);
  assert.equal(page.evaluations, 1);
});

test('hover on a zero-size element says so in hover terms, not click terms', async () => {
  const { page, mouse, run } = setup();
  page.elements.set('[data-coach-ref="e4"]', element({ box: { left: 0, top: 0, width: 0, height: 0 } }));
  const outcome = await run([{ action: 'hover', ref: 'e4' }]);
  assert.deepEqual(outcome.results, [{
    action: 'hover',
    selector: '[data-coach-ref="e4"]',
    ok: false,
    error: 'hover target not located: element has no box (0x0); nothing on screen to move the pointer onto',
    target: { tag: 'button', id: '', name: '' }
  }]);
  assert.doesNotMatch(outcome.results[0].error, /click/);
  assert.deepEqual(mouse.moves, []);
});

test('click still goes through the shared locateTarget: same box, same errors as before', async () => {
  const { page, mouse, run } = setup();
  page.elements.set('[data-coach-ref="e1"]', element({ id: 'pay' }));
  page.elements.set('[data-coach-ref="e4"]', element({ box: { left: 0, top: 0, width: 0, height: 0 } }));
  assert.deepEqual(await run([{ action: 'click', ref: 'e1' }]), {
    ok: true,
    results: [{ action: 'click', selector: '[data-coach-ref="e1"]', ok: true, target: { tag: 'button', id: 'pay', name: '' } }]
  });
  assert.deepEqual(mouse.clicks, [{ x: 50, y: 32, width: 80, height: 24 }]);
  assert.deepEqual(delays, [180]);
  assert.deepEqual((await run([{ action: 'click', ref: 'e9' }])).results, [{
    action: 'click',
    selector: '[data-coach-ref="e9"]',
    ok: false,
    error: 'Selector not found: [data-coach-ref="e9"]'
  }]);
  assert.equal((await run([{ action: 'click', ref: 'e4' }])).results[0].error, 'element has no box (0x0); cannot click by coordinate');
});

// toolUiAct end to end: the actual tool entry point, the actual BJ3 gate (decision helper stubbed), the actual engine.
const jevCalls = [];
const Tool = compile(
  [
    ...parseDeclarations,
    ...declarationsOf(HELPER, ['describeUiActionResult']),
    ...declarationsOf('src/main/maestro/capture/traceTimeline.ts', ['TOOL_RESULT_LIMIT', 'clipText']),
    ...declarationsOf('src/main/maestro/drive/uiActGate.ts', [
      'RISK_CRITERIA', 'needsJudgement', 'SHOT_MAX_EDGE', 'SHOT_TIMEOUT_MS', 'UNLABELLED',
      'describeUiAction', 'shootWithin', 'gateUiActions'
    ])
  ],
  membersOf('src/main/maestro/drive/requestExec.service.ts', ['targetReplay', 'toolUiAct']),
  {
    // decision-helper-199: the gate asks through `decisionHelper.choose`; switched off = the gate lets everything through.
    decisionHelper: {
      choose: async (question, state) => {
        jevCalls.push({ question, state });
        return { decided: false, reason: 'off', message: 'switched off', durationMs: 0 };
      }
    },
    agentDecisionRegistry: { request: async () => assert.fail('BJ3 asked the operator') }
  }
);

const toolSetup = (context, replayEngine) => {
  jevCalls.length = 0;
  context.mock.method(globalThis, 'setTimeout', (callback, ms) => {
    assert.equal(ms, 700);
    queueMicrotask(callback);
  });
  const activities = [];
  const tool = new Tool();
  tool.browserTarget = { getStore: () => undefined };
  tool._state = {
    replayEngine,
    lastAgentRun: {},
    broadcastActivity: (...args) => activities.push(args),
    emitTrace: () => {},
    drainNewTabsNote: () => '\nNEW TAB: fixture-popup'
  };
  return { tool, activities };
};

test('toolUiAct answers wait / wait_for with "no valid actions" and runs nothing', async (context) => {
  const idle = { runUiActions: async () => assert.fail('an empty batch must not run') };
  const { tool } = toolSetup(context, idle);
  const noValid = 'ERROR: no valid actions. Each needs {"action":"click|fill|select|check|submit|hover","ref":"<eN from the snapshot>", ...} (or "selector":"<css>").';
  assert.equal(await tool.toolUiAct('[{"action":"wait"}]'), noValid);
  assert.equal(await tool.toolUiAct('[{"action":"wait_for","text":"Download invoice","timeout_ms":5000}]'), noValid);
  assert.equal(await tool.toolUiAct('{"action":"wait_for","until":"the invoice list has loaded"}'), noValid);
  assert.deepEqual(jevCalls, []);
});

test('BJ3 makes zero Jev calls for hover; a click is still judged', async (context) => {
  const { page, engine } = setup();
  page.elements.set('[data-coach-ref="e1"]', element());
  page.elements.set('[data-coach-ref="e2"]', element({ id: 'menu' }));
  // The gate reads the element's label with readLabel (decision-maker-card-198), never readText.
  engine.readLabel = async () => 'Delete';
  const { tool, activities } = toolSetup(context, engine);
  const output = await tool.toolUiAct(JSON.stringify([{ action: 'hover', ref: 'e1' }, { action: 'hover', ref: 'e2' }]));
  assert.deepEqual(jevCalls, []);
  assert.equal(JSON.parse(output.replace('\nNEW TAB: fixture-popup', '')).ok, true);
  assert.deepEqual(activities, [['act', 'hover button', true], ['act', 'hover button | menu', true]]);

  // Control: the stubbed gate is live — the same call with a click reaches Jev exactly once.
  await tool.toolUiAct(JSON.stringify([{ action: 'hover', ref: 'e1' }, { action: 'click', ref: 'e2' }]));
  assert.equal(jevCalls.length, 1);
  assert.equal(jevCalls[0].state.pending_action, 'click "Delete"');
});
