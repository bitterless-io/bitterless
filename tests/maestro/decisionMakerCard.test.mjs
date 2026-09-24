// decision-maker-card-198 —— docs/features/decision-maker-naming-and-approval-card.md #1–#5
// (+ docs/issues/approval-card-shows-selector-instead-of-button-text.md, + "Carried over from Cowork review 1").
// Paired with micromeet-cowork `apps/cowork/tests/unit/decisionMakerCard.test.mjs`.
//
// What is pinned, one block per defect on Ral's 2026-09-24 card:
//  · no Jev in the session — reasons, failure messages, snapshot notes say "decision maker"; a relay's raw error body
//    only reaches the log (#1 #2), plus a source guard keyed by value + location;
//  · the three "waiting on you" cards and every other waiting accent in the chat are the theme blue, borderless,
//    answered cards at 70%; expired state, structure and BEM classes unchanged (#3);
//  · the action names the button text, not `click [data-coach-ref="e25"]`, and `readText` keeps its meaning (#4);
//  · an ask carries a thumbnail of the target: max edge 240, ≤ 2 s, `captureBeyondViewport: false`, a late shot never
//    runs, no image → the card falls back to the selector, never sent to the decision maker (#4.1);
//  · the timeline card and the answer sheet show it aspect-fit inside 120×120 (#4.1).
// Plus decision-maker-card-202 (#3 「Ral 已定」, review N1 ①): the session list's "waiting for your confirmation" is
// the blue text 「待确认」 / `To confirm`, no longer a blue dot like unread.
//
// In Bitterless the ui_act gate asks through `agentDecisionRegistry` (the ask_user decision sheet), so its card is
// `DecisionRecord` (timeline) + `DecisionSheet` (answer panel); `ChatConfirm` / `ChatConfirmSheet` are the task approvals.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { parseHTML } from 'linkedom';
import * as vue from 'vue';
import { renderToString } from 'vue/server-renderer';
import { compileScript, parse as parseSfc } from '@vue/compiler-sfc';

const APP_ROOT = resolve(import.meta.dirname, '../..');
const JEV = /jev/i;
const DATA_URL = 'data:image/jpeg;base64,QUJD';

// ── loaders ─────────────────────────────────────────────────────────────────────────────────────────

const ALIASES = [
  ['@maestro-main/', 'src/main/maestro/'],
  ['@maestro-shared/', 'src/shared/maestro/'],
  ['@main/', 'src/main/'],
  ['@shared/', 'src/shared/']
];

/** Transpile + alias-resolve one module tree; `stubs` win by specifier. A fresh cache per call, so a module loaded
 *  with a different stub set is a different instance. */
const load = (path, stubs = {}) => {
  const cache = new Map();
  const fileFor = (spec, parent) => {
    for (const [prefix, dir] of ALIASES)
      if (spec.startsWith(prefix)) return join(APP_ROOT, dir, `${spec.slice(prefix.length)}.ts`);
    return spec.startsWith('.') ? resolve(dirname(parent), `${spec}.ts`) : null;
  };
  const read = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true
      }
    });
    const native = createRequire(file);
    new Function('require', 'module', 'exports', outputText)(
      (spec) => {
        if (spec in stubs) return stubs[spec];
        const next = fileFor(spec, file);
        return next ? read(next) : native(spec);
      },
      module,
      module.exports
    );
    return module.exports;
  };
  return read(join(APP_ROOT, path));
};

// The actual-member harness of uiActWaitHover / uiActSelectorMiss: the real text of named class members and
// top-level declarations, compiled against explicit bindings — no Electron, no DI container.
const source = (path) =>
  ts.createSourceFile(
    path,
    readFileSync(join(APP_ROOT, path), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
const declarationsOf = (path, names) => {
  const ast = source(path);
  const found = ast.statements
    .filter(ts.isVariableStatement)
    .flatMap((node) => [...node.declarationList.declarations])
    .filter((node) => names.includes(node.name.getText(ast)))
    .map((node) => `const ${node.getText(ast)};`);
  assert.equal(found.length, names.length, `missing declarations in ${path}`);
  return found;
};
const membersOf = (path, names) => {
  const ast = source(path);
  const found = ast.statements
    .filter(ts.isClassDeclaration)
    .flatMap((node) => [...node.members])
    .filter((node) => names.includes(node.name?.getText(ast)))
    .map((node) => node.getText(ast));
  assert.equal(found.length, names.length, `missing members in ${path}`);
  return found;
};
const compile = (declarations, members, bindings) => {
  const compiled = ts.transpileModule(
    `${declarations.join('\n')}\nclass Actual { ${members.join('\n')} }`,
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }
  ).outputText;
  return new Function(...Object.keys(bindings), `${compiled}; return Actual;`)(
    ...Object.values(bindings)
  );
};

// ── one gate instance, stubbed decision maker + decision registry ──────────────────────────────────────

let verdict;
let approve = false;
let judged = [];
let asked = [];
const gate = load('src/main/maestro/drive/uiActGate.ts', {
  '@main/decision/jevDecision.service': {
    jevJudge: async (request) => {
      judged.push(request);
      return verdict;
    }
  },
  '@main/agent/decisionRegistry.service': {
    agentDecisionRegistry: {
      request: async (sessionId, questions) => {
        asked.push({ sessionId, questions });
        return { decisionId: `decision-${asked.length}`, picked: [[approve ? 'Run it' : 'Stop']] };
      }
    }
  }
});
const { gateUiActions } = gate;
const { ReplayEngine } = load('src/main/maestro/drive/replayEngine.ts', {
  './humanMouse': { HumanMouse: class {} }
});
const { captureElementShot } = load('src/main/maestro/capture/debuggerCapture.ts');

const judgedAs = (choice, confidence) => ({
  ok: true,
  model: 'fixture',
  answers: { risk: { choice, confidence } },
  durationMs: 1
});
const reset = (next) => {
  verdict = next;
  approve = false;
  judged = [];
  asked = [];
};
const click = (selector = '[data-coach-ref="e25"]') => ({ action: 'click', selector });
const question = (index = 0) => asked[index].questions[0];
const flush = () => new Promise((done) => setImmediate(done));
const context = (over = {}) => ({
  sessionId: 'chat-a',
  pageUrl: 'https://chatgpt.com/#settings/DataControls',
  ...over
});

// ── #1 #2 the reason wording ────────────────────────────────────────────────────────────────────────

test('#2 the approval reason says decision maker, never Jev — on the card and in the ERROR the model reads', async () => {
  const cases = [
    [judgedAs('read_only', 0.39), 'The decision maker was not confident enough (0.39)'],
    [judgedAs('irreversible', 0.93), 'The decision maker classified it as irreversible (0.93)'],
    [
      {
        ok: false,
        reason: 'network',
        message: 'decision maker request timed out',
        durationMs: 8000
      },
      'The decision maker could not judge it (network)'
    ],
    // The relay's raw error body stays out: failure type + HTTP status only (review F6). It may itself say "jev".
    [
      {
        ok: false,
        reason: 'http',
        status: 502,
        message: 'jev upstream exploded: {"detail":"bad gateway"}',
        durationMs: 12
      },
      'The decision maker could not judge it (http 502)'
    ]
  ];
  for (const [next, why] of cases) {
    reset(next);
    const out = await gateUiActions([click()], context({ readLabel: async () => 'Billing' }));
    assert.equal(asked.length, 1);
    assert.equal(asked[0].sessionId, 'chat-a');
    assert.equal(question().header, 'Irreversible');
    assert.equal(question().question, `Run this action?\nclick "Billing"\n\n${why}`);
    assert.deepEqual(out, {
      ok: false,
      error: `ERROR: operator did not approve click "Billing" — ${why}`
    });
    assert.doesNotMatch(
      question().question + out.error,
      JEV,
      'the model paraphrases the ERROR to the user — no Jev there either'
    );
    assert.doesNotMatch(
      question().question + out.error,
      /exploded|bad gateway/,
      'the raw relay body goes to the log only'
    );
  }
});

// jevDecision.service's own failures. Each path gets its own stub set, i.e. its own module instance.
const configEmitter = (row) => ({ createXpcMainEmitter: () => ({ get: async () => row }) });
const jevService = ({ enabled = true, token = 'fixture-token' } = {}) =>
  load('src/main/decision/jevDecision.service.ts', {
    'electron-xpc/main': configEmitter(enabled ? { options: true } : null),
    '@main/auth/customerSession.service': {
      customerSessionService: { current: token ? { token } : null }
    }
  });

test('#2 the switched-off reason says decision maker (an unreadable config store reads as off)', async () => {
  const result = await jevService({ enabled: false }).jevJudge({ state: {}, questions: {} });
  assert.equal(result.reason, 'off');
  assert.equal(result.message, 'The decision maker is switched off in Settings → Decision.');
});

test('#2 the signed-out reason says decision maker', async () => {
  const result = await jevService({ token: '' }).jevJudge({ state: {}, questions: {} });
  assert.equal(result.reason, 'unauthenticated');
  assert.equal(
    result.message,
    'Not signed in to Bitterless; sign in so Maestro can reuse that session for the decision maker.'
  );
});

test('#2 the timeout reason says decision maker, and relay failures are logged with their raw text', async (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => {
    throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
  });
  const timedOut = await jevService().jevJudge({ state: {}, questions: {} });
  assert.equal(timedOut.reason, 'network');
  assert.equal(timedOut.message, 'decision maker request timed out');

  // Non-2xx: the relay passes the upstream body through. The result keeps it for programs, the log records it,
  // and callers that show text to a person print "(http 502)" only (see the gate test above).
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 502,
    text: async () => '{"detail":{"message":"jev upstream exploded"}}'
  }));
  const http = await jevService().jevJudge({ state: {}, questions: {} });
  assert.deepEqual(
    [http.reason, http.status, http.message],
    ['http', 502, 'jev upstream exploded']
  );

  const lines = warned.mock.calls.map((call) => call.arguments.join(' '));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /\(network\): decision maker request timed out/);
  assert.match(lines[1], /\(http 502\): jev upstream exploded/);
});

test('#2 the snapshot segment notes say decision maker, with the failure type and status only', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'decision-maker-segment-'));
  try {
    let segmentVerdict;
    const { segmentSnapshot } = load('src/main/maestro/drive/snapshotSegment.ts', {
      electron: { app: { getPath: () => scratch } },
      '@main/decision/jevDecision.service': { jevJudge: async () => segmentVerdict },
      '@maestro-main/drive/snapshotPrune': {
        PRUNE_MIN_BYTES: Number.POSITIVE_INFINITY,
        pruneSnapshot: () => ({ pruned: false })
      },
      '@maestro-main/drive/snapshotChunker': {
        chunkSnapshot: (text) => ({
          lines: text.split('\n'),
          totalBytes: text.length,
          skip: '',
          blocks: [
            { id: 'b1', start: 0, end: 7, bytes: 100, share: 0.5, label: 'navigation — top' },
            { id: 'b2', start: 7, end: 8, bytes: 100, share: 0.5, label: 'main — body' }
          ]
        })
      }
    });
    const composed = [
      '# tab: t1',
      '# page: https://fixture.invalid/',
      '# title: Fixture',
      '# elements: 2',
      '# snapshot: s1',
      '',
      '- button "Go" [ref=e1]',
      '- link "Home" [ref=e2]'
    ].join('\n');

    segmentVerdict = {
      ok: false,
      reason: 'http',
      status: 502,
      message: 'jev upstream exploded',
      durationMs: 1
    };
    const http = await segmentSnapshot(composed, 'find the Go button');
    assert.equal(http.note, 'not segmented (decision maker http 502)');

    segmentVerdict = {
      ok: false,
      reason: 'network',
      message: 'decision maker request timed out',
      durationMs: 1
    };
    const network = await segmentSnapshot(composed, 'find the Go button');
    assert.equal(network.note, 'not segmented (decision maker network)');

    segmentVerdict = {
      ok: true,
      model: 'fixture',
      answers: { block: { choice: 'none', confidence: 0.9 } },
      durationMs: 1
    };
    const none = await segmentSnapshot(composed, 'find the Go button');
    assert.equal(none.note, 'not segmented (decision maker picked none)');
    assert.doesNotMatch(http.note + network.note + none.note, JEV);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ── #4 the label: the button's text, not the selector; readText unchanged ───────────────────────────────

/**
 * Real markup; the engine's Runtime.evaluate runs in it. linkedom's `<button>` has no `value` property, while a
 * browser's has one that defaults to '' — which is this bug's root cause — so it is added the browser way.
 */
const pageWith = (html) => {
  const { document, window } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  Object.defineProperty(window.HTMLButtonElement.prototype, 'value', {
    configurable: true,
    get() {
      return this.getAttribute('value') ?? '';
    }
  });
  const page = vm.createContext({ document, window });
  return new ReplayEngine({
    debugger: {
      sendCommand: async (method, params) => ({
        result: { value: vm.runInContext(params.expression, page) }
      })
    }
  });
};

const LABEL_PAGE = [
  '<button data-coach-ref="e25">Delete all</button>',
  '<button data-coach-ref="e26" aria-label="Close dialog">×</button>',
  '<input data-coach-ref="e27" type="submit" value="Pay now">',
  '<div data-coach-ref="e28" role="button" title="Remove row"><svg></svg></div>',
  '<a data-coach-ref="e29" href="#">  Billing\n      settings  </a>',
  `<button data-coach-ref="e30">${'x'.repeat(200)}</button>`,
  '<input data-coach-ref="e31" value="typed value">',
  '<div data-coach-ref="e32">Plain text</div>',
  // Text together with a value / a title (review F6): without these, swapping either pair of the order passes.
  '<button data-coach-ref="e33" value="1">Delete</button>',
  '<a data-coach-ref="e34" title="tip">Open</a>'
].join('');

test('#4 readLabel reads aria-label → visible text → value → title, whitespace-normalised, 120 chars', async () => {
  const engine = pageWith(LABEL_PAGE);
  assert.equal(
    await engine.readLabel('[data-coach-ref="e25"]'),
    'Delete all',
    'a <button> is its text, not its empty value'
  );
  assert.equal(await engine.readLabel('[data-coach-ref="e26"]'), 'Close dialog');
  assert.equal(await engine.readLabel('[data-coach-ref="e27"]'), 'Pay now');
  assert.equal(await engine.readLabel('[data-coach-ref="e28"]'), 'Remove row');
  assert.equal(await engine.readLabel('[data-coach-ref="e29"]'), 'Billing settings');
  assert.equal((await engine.readLabel('[data-coach-ref="e30"]')).length, 120);
  assert.equal(
    await engine.readLabel('[data-coach-ref="e33"]'),
    'Delete',
    'visible text wins over a value — the bug being fixed is a value hiding the text'
  );
  assert.equal(
    await engine.readLabel('[data-coach-ref="e34"]'),
    'Open',
    'visible text wins over a title'
  );
  assert.equal(
    await engine.readLabel('[data-coach-ref="e99"]'),
    '',
    'a miss is an empty label, not an error'
  );
});

test('#4 readText is unchanged — page.read() still gets the value of anything that has one', async () => {
  const engine = pageWith(LABEL_PAGE);
  assert.equal(await engine.readText('[data-coach-ref="e31"]'), 'typed value');
  assert.equal(await engine.readText('[data-coach-ref="e32"]'), 'Plain text');
  // The regression pin: readText keeps its "value first" rule, which is exactly why the gate stopped using it.
  assert.equal(await engine.readText('[data-coach-ref="e25"]'), '');
  assert.equal(await engine.readText('[data-coach-ref="e99"]'), '');
  const readText = source('src/main/maestro/drive/replayEngine.ts')
    .statements.filter(ts.isClassDeclaration)
    .flatMap((node) => [...node.members])
    .find((node) => node.name?.getText() === 'readText')
    .getText();
  assert.match(
    readText,
    /document\.querySelector\(\$\{JSON\.stringify\(selector\)\}\); if\(!e\) return ''; const v=\('value' in e\)\? e\.value : null;/
  );
});

test('#4 <button>Delete all</button> is described as "Delete all" on the card and to the decision maker', async () => {
  reset(judgedAs('irreversible', 0.9));
  const engine = pageWith(LABEL_PAGE);
  await gateUiActions([click()], context({ readLabel: (selector) => engine.readLabel(selector) }));
  assert.equal(judged[0].state.pending_action, 'click "Delete all"');
  assert.equal(
    question().question,
    'Run this action?\nclick "Delete all"\n\nThe decision maker classified it as irreversible (0.9)'
  );
  assert.doesNotMatch(question().question, /data-coach-ref/);
});

test('#4.1 no label + an image → "click this element" / "submit this form"; the decision maker and the model keep the selector', async () => {
  const shootTarget = async () => DATA_URL;
  reset(judgedAs('read_only', 0.2));
  const out = await gateUiActions(
    [click()],
    context({ readLabel: async () => '', pageUrl: 'https://fixture.invalid/', shootTarget })
  );
  assert.equal(
    question().question,
    'Run this action?\nclick this element\n\nThe decision maker was not confident enough (0.2)'
  );
  assert.equal(question().image, DATA_URL);
  assert.equal(
    judged[0].state.pending_action,
    'click [data-coach-ref="e25"]',
    'it has no picture to look at'
  );
  assert.match(
    out.error,
    /operator did not approve click \[data-coach-ref="e25"\]/,
    'the model needs the ref it tried'
  );

  reset(judgedAs('irreversible', 0.9));
  await gateUiActions(
    [{ action: 'submit', selector: '#f' }],
    context({
      readLabel: async () => {
        throw new Error('page gone');
      },
      shootTarget
    })
  );
  assert.equal(
    question().question,
    'Run this action?\nsubmit this form\n\nThe decision maker classified it as irreversible (0.9)',
    'a label read that throws is an empty label'
  );
});

test('#4.1 no label and no image → the card falls back to the selector (review F5)', async () => {
  for (const shootTarget of [undefined, async () => undefined]) {
    reset(judgedAs('irreversible', 0.9));
    await gateUiActions([click()], context({ readLabel: async () => '', shootTarget }));
    assert.equal(
      question().question,
      'Run this action?\nclick [data-coach-ref="e25"]\n\nThe decision maker classified it as irreversible (0.9)'
    );
    assert.equal('image' in question(), false);
  }
});

// ── #4.1 the shot: only when asking, ≤ 2 s, a late one never runs, never to the decision maker ────────────

test('#4.1 the ask carries the target thumbnail, shot at max edge 240, and the decision maker never sees it', async () => {
  reset(judgedAs('irreversible', 0.9));
  const shots = [];
  await gateUiActions(
    [click()],
    context({
      readLabel: async () => 'Delete all',
      shootTarget: async (selector, shot) => {
        shots.push([selector, shot.maxEdge, shot.signal.aborted]);
        return DATA_URL;
      }
    })
  );
  assert.deepEqual(shots, [['[data-coach-ref="e25"]', 240, false]]);
  assert.equal(question().image, DATA_URL);
  assert.equal(
    question().question,
    'Run this action?\nclick "Delete all"\n\nThe decision maker classified it as irreversible (0.9)'
  );
  assert.doesNotMatch(JSON.stringify(judged), /data:image/, 'the image is for the human only');
});

test('#4.1 no ask → no shot: confident read-only clicks and a switched-off decision maker never pay for a screenshot', async () => {
  let shots = 0;
  const shootTarget = async () => {
    shots += 1;
    return DATA_URL;
  };
  reset(judgedAs('read_only', 0.9));
  assert.deepEqual(
    await gateUiActions([click()], context({ readLabel: async () => 'Billing', shootTarget })),
    { ok: true }
  );
  reset({
    ok: false,
    reason: 'off',
    message: 'The decision maker is switched off in Settings → Decision.',
    durationMs: 0
  });
  assert.deepEqual(
    await gateUiActions([click()], context({ readLabel: async () => 'Billing', shootTarget })),
    { ok: true }
  );
  assert.equal(shots, 0);
  assert.equal(asked.length, 0);
});

test('#4.1 a shot that errors, comes back empty, or is not an image data URL → the card asks without one', async () => {
  const outcomes = [
    async () => {
      throw new Error('Target closed');
    },
    async () => undefined,
    async () => '',
    async () => 'https://evil.invalid/pixel.png',
    () => {
      throw new Error('the bound tab went away');
    }
  ];
  for (const shootTarget of outcomes) {
    reset(judgedAs('irreversible', 0.9));
    const out = await gateUiActions(
      [click()],
      context({ readLabel: async () => 'Delete all', shootTarget })
    );
    assert.equal(asked.length, 1, 'the approval still happens');
    assert.equal('image' in question(), false);
    assert.equal(out.ok, false);
  }
});

test('#4.1 a shot that hangs is abandoned after 2 s: the signal aborts and the approval goes on without it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  reset(judgedAs('irreversible', 0.9));
  approve = true;
  let signal;
  const pending = gateUiActions(
    [click()],
    context({
      readLabel: async () => 'Delete all',
      shootTarget: (_selector, shot) => {
        signal = shot.signal;
        return new Promise(() => {});
      }
    })
  );
  await flush();
  t.mock.timers.tick(1999);
  await flush();
  assert.equal(asked.length, 0, 'still inside the 2 s budget');
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(signal.aborted, true, 'the late shot is told not to run');
  assert.deepEqual(await pending, { ok: true });
  assert.equal(asked.length, 1);
  assert.equal('image' in question(), false);
});

// ReplayEngine.locateTargetBox: the click locator's element, clipped to what is visible, in document coordinates.
const boxPage = ({ locate, metrics = [0, 0, 1, 800, 600] }) => {
  const calls = [];
  const engine = new ReplayEngine({
    debugger: {
      sendCommand: async (method, params = {}) => {
        calls.push({ method, ...params });
        if (
          method === 'Runtime.evaluate' &&
          params.expression.includes('cannot click by coordinate')
        )
          return { result: { value: locate } };
        if (method === 'Runtime.evaluate') return { result: { value: metrics } };
        return assert.fail(`the engine only locates — it never sends ${method}`);
      }
    }
  });
  return { engine, calls };
};

test("#4.1 the box is the click locator's element, in document coordinates, with the page pixel ratio", async () => {
  // Scrolled Retina page: the locator reports viewport centre (400,300) for a 600×200 element; scroll (10,1000), DPR 2.
  const page = boxPage({
    locate: { ok: true, x: 400, y: 300, width: 600, height: 200 },
    metrics: [10, 1000, 2, 800, 600]
  });
  assert.deepEqual(await page.engine.locateTargetBox('[data-coach-ref="e25"]'), {
    rect: { x: 110, y: 1200, width: 600, height: 200 },
    devicePixelRatio: 2
  });
  assert.equal(
    page.calls.filter((call) => call.expression?.includes('cannot click by coordinate')).length,
    1,
    'located once, by the click locator'
  );
  const unknownRatio = boxPage({
    locate: { ok: true, x: 10, y: 10, width: 20, height: 20 },
    metrics: [0, 0, null, 800, 600]
  });
  assert.equal((await unknownRatio.engine.locateTargetBox('#x')).devicePixelRatio, 1);
});

test('#4.1 captureBeyondViewport:false can only shoot what is visible — the box is clipped to the viewport, or there is none', async () => {
  // Wider than the 800×600 viewport: only the visible part.
  const wide = boxPage({
    locate: { ok: true, x: 400, y: 300, width: 1000, height: 200 },
    metrics: [0, 50, 1, 800, 600]
  });
  assert.deepEqual((await wide.engine.locateTargetBox('#x')).rect, {
    x: 0,
    y: 250,
    width: 800,
    height: 200
  });
  // Entirely below the viewport, and a viewport whose size cannot be read: no box → no image.
  assert.equal(
    await boxPage({
      locate: { ok: true, x: 400, y: 900, width: 100, height: 100 }
    }).engine.locateTargetBox('#x'),
    undefined
  );
  assert.equal(
    await boxPage({
      locate: { ok: true, x: 10, y: 10, width: 20, height: 20 },
      metrics: null
    }).engine.locateTargetBox('#x'),
    undefined
  );
  assert.equal(
    await boxPage({
      locate: { ok: true, x: 10, y: 10, width: 20, height: 20 },
      metrics: [0, 0, 2]
    }).engine.locateTargetBox('#x'),
    undefined
  );
});

test('#4.1 nothing to shoot — a miss, a 0×0 box, a zero width, no answer, a CDP error — is no box, never a throw', async () => {
  for (const locate of [
    { ok: false, error: 'Selector not found: #x' },
    { ok: false, error: 'element has no box (0x0); cannot click by coordinate' },
    { ok: true, x: 10, y: 10, width: 0, height: 20 },
    undefined
  ]) {
    assert.equal(await boxPage({ locate }).engine.locateTargetBox('#x'), undefined);
  }
  const broken = new ReplayEngine({
    debugger: {
      sendCommand: async () => {
        throw new Error('Target closed');
      }
    }
  });
  assert.equal(await broken.locateTargetBox('#x'), undefined);
});

// captureElementShot: the one crop the recording thumbnail and the approval thumbnail share.
const shooter = (reply = { data: 'QUJD' }) => {
  const sent = [];
  const wc = {
    debugger: {
      sendCommand: async (method, params) => {
        sent.push({ method, ...params });
        if (reply instanceof Error) throw reply;
        return reply;
      }
    }
  };
  return { wc, sent };
};
const outputEdge = ({ clip }, ratio) => Math.max(clip.width, clip.height) * clip.scale * ratio;

test("#4.1 with maxEdge the whole element is scaled so the output image's longest edge is ≤ 240, JPEG 60", async () => {
  const wide = shooter();
  assert.equal(
    await captureElementShot(wide.wc, {
      rect: { x: 110, y: 1200, width: 600, height: 200 },
      maxEdge: 240,
      devicePixelRatio: 2,
      beyondViewport: false
    }),
    DATA_URL
  );
  const [shot] = wide.sent;
  assert.equal(shot.method, 'Page.captureScreenshot');
  assert.deepEqual(shot.clip, { x: 110, y: 1200, width: 600, height: 200, scale: 0.2 });
  assert.equal(outputEdge(shot, 2), 240, 'output pixels = CSS × DPR × scale');
  assert.equal(shot.format, 'jpeg');
  assert.equal(shot.quality, 60);
  assert.equal(
    shot.captureBeyondViewport,
    false,
    'the gate path never resizes the live viewport (review F2)'
  );

  const tall = shooter();
  await captureElementShot(tall.wc, {
    rect: { x: 0, y: 0, width: 50, height: 900 },
    maxEdge: 240,
    devicePixelRatio: 1
  });
  assert.ok(
    Math.abs(outputEdge(tall.sent[0], 1) - 240) < 1e-9,
    'a tall element is bounded by its height'
  );

  const small = shooter();
  await captureElementShot(small.wc, {
    rect: { x: 0, y: 0, width: 40, height: 20 },
    maxEdge: 240,
    devicePixelRatio: 2
  });
  assert.equal(small.sent[0].clip.scale, 1, 'a small element is never upscaled');
});

test('#4.1 one crop implementation: the recording thumbnail keeps its 640×480 1:1 clip beyond the viewport; failures are no image', async () => {
  const recording = shooter();
  assert.equal(
    await captureElementShot(recording.wc, { rect: { x: 5, y: 6, width: 1000, height: 900 } }),
    DATA_URL
  );
  assert.deepEqual(recording.sent[0].clip, { x: 5, y: 6, width: 640, height: 480, scale: 1 });
  assert.equal(recording.sent[0].captureBeyondViewport, true, 'the recording path is unchanged');
  assert.equal(
    await captureElementShot(shooter().wc, {
      rect: { x: 5, y: 6, width: 0, height: 900 },
      maxEdge: 240
    }),
    undefined
  );
  assert.equal(
    await captureElementShot(shooter(new Error('Unable to capture screenshot')).wc, {
      rect: { x: 0, y: 0, width: 30, height: 20 },
      maxEdge: 240
    }),
    undefined
  );
  assert.equal(
    await captureElementShot(shooter({}).wc, {
      rect: { x: 0, y: 0, width: 30, height: 20 },
      maxEdge: 240
    }),
    undefined
  );

  const read = (path) => readFileSync(join(APP_ROOT, path), 'utf8');
  const capture = read('src/main/maestro/capture/debuggerCapture.ts');
  const engine = read('src/main/maestro/drive/replayEngine.ts');
  const exec = read('src/main/maestro/drive/requestExec.service.ts');
  assert.match(
    capture,
    /const shot = await captureElementShot\(this\.wc, \{ rect: payload\.rect \}\)/,
    'recording uses the shared helper'
  );
  assert.equal(
    capture.match(/'Page\.captureScreenshot'/g)?.length,
    2,
    'the viewport shot and the one element crop — no second copy'
  );
  assert.doesNotMatch(capture, /private async captureElementShot/, 'the old private copy is gone');
  assert.doesNotMatch(
    engine + exec,
    /Page\.captureScreenshot/,
    'the gate path crops through captureElementShot, not its own copy'
  );
  assert.doesNotMatch(
    engine,
    /debuggerCapture/,
    'replayEngine.ts gains no dependency (tests/skillScopes/execution.test.mjs loads it with a fixed stub set)'
  );
});

// ── toolUiAct end to end: the actual members, the actual gate, the actual crop ───────────────────────────

const SERVICE = 'src/main/maestro/drive/requestExec.service.ts';
const HELPER = 'src/main/maestro/drive/requestExec.helper.ts';
const Tool = compile(
  [
    ...declarationsOf(HELPER, ['parseAgentUiActions', 'describeUiActionResult']),
    ...declarationsOf('src/main/maestro/capture/traceTimeline.ts', [
      'TOOL_RESULT_LIMIT',
      'clipText'
    ])
  ],
  membersOf(SERVICE, ['targetReplay', 'targetUrl', 'toolUiAct']),
  { gateUiActions, captureElementShot }
);

/** A chat bound to tab B while the foreground tab is A: any read of A (or of `activeTabId`) fails the test. */
const boundTool = (engine, url = 'https://chatgpt.com/#settings/DataControls') => {
  const tab = {
    id: 'tab-b',
    view: { webContents: { isDestroyed: () => false, isCrashed: () => false } },
    replay: engine
  };
  const tool = new Tool();
  tool.browserTarget = {
    getStore: () => ({ tab, capture: {}, replay: engine, url, sessionId: 'chat-b' })
  };
  tool._state = {
    tabs: [tab],
    replayEngine: new Proxy(
      {},
      { get: (_, key) => assert.fail(`ui_act touched the foreground engine (${String(key)})`) }
    ),
    currentUrl: 'https://foreground.invalid/',
    get activeTabId() {
      throw new Error('ui_act must act on the bound tab, never read the foreground tab');
    },
    lastAgentRun: {},
    broadcastActivity: () => {},
    emitTrace: () => {},
    drainNewTabsNote: () => ''
  };
  return tool;
};

test('#4.1 ui_act reads the label, locates and shoots on the tab it acts on — never the foreground tab', async () => {
  reset(judgedAs('read_only', 0.39));
  const reads = [];
  const located = [];
  const bound = shooter();
  const engine = {
    webContents: bound.wc,
    readEpoch: async () => '',
    readText: () => assert.fail('the gate must not read labels with readText'),
    readLabel: async (selector) => {
      reads.push(selector);
      return '';
    },
    locateTargetBox: async (selector) => {
      located.push(selector);
      return { rect: { x: 0, y: 40, width: 480, height: 120 }, devicePixelRatio: 2 };
    },
    runUiActions: () => assert.fail('a denied approval runs nothing')
  };
  const output = await boundTool(engine).toolUiAct(
    JSON.stringify([{ action: 'click', ref: 'e25' }])
  );
  assert.deepEqual(reads, ['[data-coach-ref="e25"]']);
  assert.deepEqual(located, ['[data-coach-ref="e25"]']);
  assert.equal(bound.sent.length, 1, "the screenshot went to the bound engine's webContents");
  assert.equal(bound.sent[0].captureBeyondViewport, false);
  assert.equal(outputEdge(bound.sent[0], 2), 240);
  assert.equal(
    judged[0].state.page_url,
    'https://chatgpt.com/#settings/DataControls',
    "judged against the bound tab's page"
  );
  assert.equal(asked[0].sessionId, 'chat-b');
  assert.equal(question().image, DATA_URL);
  assert.equal(
    question().question,
    'Run this action?\nclick this element\n\nThe decision maker was not confident enough (0.39)'
  );
  assert.equal(
    output,
    'ERROR: operator did not approve click [data-coach-ref="e25"] — The decision maker was not confident enough (0.39)'
  );
  assert.doesNotMatch(output + JSON.stringify(judged), /data:image/);

  // No box (0×0, a miss, off screen) → asked without an image, and the card shows the selector.
  reset(judgedAs('read_only', 0.39));
  engine.locateTargetBox = async () => undefined;
  await boundTool(engine).toolUiAct(JSON.stringify([{ action: 'click', ref: 'e25' }]));
  assert.equal(asked.length, 1);
  assert.equal('image' in question(), false);
  assert.equal(
    question().question,
    'Run this action?\nclick [data-coach-ref="e25"]\n\nThe decision maker was not confident enough (0.39)'
  );
});

test('#4.1 a locate that comes back after the 2 s budget never takes the screenshot', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  reset(judgedAs('irreversible', 0.9));
  const bound = shooter();
  let release;
  const engine = {
    webContents: bound.wc,
    readEpoch: async () => '',
    readLabel: async () => 'Delete all',
    locateTargetBox: () =>
      new Promise((done) => {
        release = done;
      }),
    runUiActions: () => assert.fail('a denied approval runs nothing')
  };
  const pending = boundTool(engine).toolUiAct(JSON.stringify([{ action: 'click', ref: 'e25' }]));
  await flush();
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(asked.length, 1, 'the approval did not wait for the shot');
  assert.equal('image' in question(), false);
  assert.match(await pending, /^ERROR: operator did not approve click "Delete all"/);
  release({ rect: { x: 0, y: 0, width: 100, height: 40 }, devicePixelRatio: 1 });
  await flush();
  assert.equal(bound.sent.length, 0, 'the late locate found the abort flag and shot nothing');
});

// ── the image travels to the card, and only there ──────────────────────────────────────────────────────

test('#4.1 the image rides the decision request to the renderer; ask_user cannot attach one; the card never enters the prompt', async () => {
  const broadcasts = [];
  const { agentDecisionRegistry, normalizeDecisionQuestions } = load(
    'src/main/agent/decisionRegistry.service.ts',
    {
      'electron-xpc/main': { xpcMain: { broadcast: (event, params) => broadcasts.push(params) } }
    }
  );
  const answered = agentDecisionRegistry.request('chat-image', [
    {
      header: 'Irreversible',
      question: 'Run this action?',
      options: [{ label: 'Run it' }, { label: 'Stop' }],
      image: DATA_URL
    }
  ]);
  const entry = agentDecisionRegistry.list().find((item) => item.sessionId === 'chat-image');
  assert.equal(entry.questions[0].image, DATA_URL);
  assert.equal(
    broadcasts.at(-1).decisions.find((item) => item.decisionId === entry.decisionId).questions[0]
      .image,
    DATA_URL
  );
  agentDecisionRegistry.resolve({ decisionId: entry.decisionId, picked: [['Stop']] });
  await answered;

  const [modelAuthored] = normalizeDecisionQuestions([
    { header: 'h', question: 'q', options: [{ label: 'a' }, { label: 'b' }], image: DATA_URL }
  ]);
  assert.equal(
    'image' in modelAuthored,
    false,
    'ask_user questions are rebuilt field by field — a model cannot smuggle an image in'
  );

  const store = readFileSync(
    join(APP_ROOT, 'src/renderer/maestro/control/src/store/message.store.ts'),
    'utf8'
  );
  assert.match(
    store,
    /type: 'decision', customType: 'decision' as const[\s\S]{0,160}decision: \{ \.\.\.decision \}/,
    'the card model keeps every field, image included'
  );
  const { entryClass } = load('src/renderer/maestro/control/src/store/messageClass.ts');
  assert.equal(
    entryClass({ role: 'ai', type: 'decision', customType: 'decision', content: '' }),
    'custom',
    'a decision card never enters the model context'
  );
});

// ── #3 theme blue, borderless; #4.1 the 120×120 aspect-fit image ──────────────────────────────────────

const read = (path) => readFileSync(join(APP_ROOT, path), 'utf8');
const TASK = 'src/renderer/maestro/control/src/task/';
const withoutComments = (text) =>
  text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
/** Flat Less → `{ selector, prop, value }` rows (these files do not nest). */
const declarations = (less) => {
  const rows = [];
  for (const [, selectors, body] of withoutComments(less).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of selectors.split(',').map((item) => item.trim())) {
      for (const part of body.split(';')) {
        const at = part.indexOf(':');
        if (at > 0)
          rows.push({ selector, prop: part.slice(0, at).trim(), value: part.slice(at + 1).trim() });
      }
    }
  }
  return rows;
};
const ruleOf = (less, selector) =>
  Object.fromEntries(
    declarations(less)
      .filter((row) => row.selector === selector)
      .map((row) => [row.prop, row.value])
  );
/** Amber / orange / yellow by hue — hex literals and Arco's warning / orange / gold / yellow palettes. */
const isAmber = (value) =>
  /--(?:warning|orange|gold|yellow)-\d/.test(value) ||
  [...value.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)].some(([, hex]) => {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 0.08 || max !== r) return false;
    const hue = (((g - b) / (max - min)) % 6) * 60;
    return hue >= 20 && hue <= 65;
  });
/** A border that draws a line: any border* property except the radius ones, unless it is a reset. */
const drawsLine = ({ prop, value }) =>
  /^border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-(?:color|style|width))?$/.test(
    prop
  ) && !/^(?:0|none)$/.test(value);
const primary = (value, shade) => value === `rgb(var(--primary-${shade}))`;

const CARD_LESS = ['ChatConfirm.less', 'ChatConfirmSheet.less', 'DecisionRecord.less'];

test('#3 no warning / amber colour and no border line on the card, the sheet or the decision record', () => {
  for (const name of CARD_LESS) {
    for (const row of declarations(read(TASK + name))) {
      assert.equal(
        isAmber(row.value),
        false,
        `${name} ${row.selector} { ${row.prop}: ${row.value} } is still a warning colour`
      );
      assert.equal(
        drawsLine(row),
        false,
        `${name} ${row.selector}: hierarchy without lines — ${row.prop}: ${row.value}`
      );
    }
  }
});

test('#3 waiting accents are the theme blue (Royal Blue primary-1 / 6 / 7); answered cards at 70%; the expired card stays grey', () => {
  const card = read(TASK + 'ChatConfirm.less');
  assert.ok(primary(ruleOf(card, '.chat-confirm').background, 1));
  assert.ok(primary(ruleOf(card, '.chat-confirm').color, 7));
  assert.ok(primary(ruleOf(card, '.chat-confirm__rail').background, 6));
  assert.ok(primary(ruleOf(card, '.chat-confirm__head').color, 6));
  assert.ok(primary(ruleOf(card, '.chat-confirm__detail').color, 6));
  assert.ok(primary(ruleOf(card, '.chat-confirm__waiting').color, 6));
  assert.equal(ruleOf(card, '.chat-confirm--answered').opacity, '0.7');
  // The expired (restart) state: exactly as before this task.
  for (const line of [
    '.chat-confirm--expired { border: 0; background: rgb(var(--gray-2)); color: rgb(var(--gray-8)); }',
    '.chat-confirm--expired .chat-confirm__rail { background: rgb(var(--gray-4)); }',
    '.chat-confirm--expired .chat-confirm__head { color: rgb(var(--gray-6)); }',
    '.chat-confirm--expired .chat-confirm__detail { color: rgb(var(--gray-6)); }',
    '.chat-confirm__answer--expired { color: rgb(var(--gray-6)); font-weight: 500; }'
  ])
    assert.ok(card.includes(line), `ChatConfirm.less lost ${line}`);

  const sheet = read(TASK + 'ChatConfirmSheet.less');
  assert.ok(primary(ruleOf(sheet, '.chat-confirm-sheet').background, 1));
  assert.ok(primary(ruleOf(sheet, '.chat-confirm-sheet').color, 7));
  assert.ok(primary(ruleOf(sheet, '.chat-confirm-sheet__head').color, 6));
  assert.ok(primary(ruleOf(sheet, '.chat-confirm-sheet__detail').color, 6));
  assert.equal(
    ruleOf(sheet, '.chat-confirm-sheet__payload')['border-top'],
    undefined,
    'no divider above the payload'
  );
  // Ral 2026-09-24: the unsourced mark stays the theme blue too (no red).
  assert.ok(primary(ruleOf(sheet, '.chat-confirm-sheet__field-source--unsourced').color, 6));
  for (const button of ['.chat-confirm-sheet__cancel', '.chat-confirm-sheet__confirm']) {
    assert.equal(
      ruleOf(sheet, button).border,
      '0',
      `${button} is a bare <button>: the UA border must be reset explicitly`
    );
  }

  const record = read(TASK + 'DecisionRecord.less');
  assert.ok(primary(ruleOf(record, '.decision-record__rail').background, 6), 'the waiting rail');
  assert.ok(
    primary(ruleOf(record, '.decision-record__head').color, 6),
    'the waiting icon and label'
  );
  assert.equal(ruleOf(record, '.decision-record--answered').opacity, '0.7');
  assert.equal(
    ruleOf(record, '.decision-record--declined .decision-record__rail').background,
    'rgb(var(--gray-4))'
  );
});

test('#3 structure is unchanged: every name attribute and BEM class of the three cards is still there', () => {
  const expected = {
    'ChatConfirm.vue': [
      'name="maestro__chat_confirm"',
      'class="chat-confirm"',
      "'chat-confirm--answered'",
      "'chat-confirm--expired'",
      'chat-confirm__rail',
      'chat-confirm__content',
      'chat-confirm__head',
      'chat-confirm__title',
      'chat-confirm__detail',
      'chat-confirm__answer chat-confirm__answer--expired',
      'class="chat-confirm__answer"',
      'chat-confirm__waiting'
    ],
    'ChatConfirmSheet.vue': [
      'name="maestro__chat_confirm_sheet"',
      'class="chat-confirm-sheet"',
      'chat-confirm-sheet__head',
      'chat-confirm-sheet__queue',
      'chat-confirm-sheet__title',
      'chat-confirm-sheet__detail',
      'chat-confirm-sheet__payload"',
      'chat-confirm-sheet__payload-toggle',
      'chat-confirm-sheet__chevron--open',
      'chat-confirm-sheet__payload-copy',
      'chat-confirm-sheet__intent',
      'chat-confirm-sheet__risk',
      'chat-confirm-sheet__payload-list',
      'chat-confirm-sheet__summary',
      'chat-confirm-sheet__field"',
      'chat-confirm-sheet__field-path',
      'chat-confirm-sheet__field-value',
      'chat-confirm-sheet__field-source--${field.provenance}',
      'chat-confirm-sheet__field-note',
      'chat-confirm-sheet__actions',
      'chat-confirm-sheet__cancel',
      'chat-confirm-sheet__confirm'
    ],
    'DecisionRecord.vue': [
      'name="maestro__decision_record"',
      'class="decision-record"',
      "'decision-record--answered'",
      "'decision-record--declined'",
      'decision-record__rail',
      'decision-record__content',
      'decision-record__head',
      'decision-record__question',
      'decision-record__prompt-row',
      'decision-record__header',
      'decision-record__prompt"',
      'decision-record__answers',
      'decision-record__answer"',
      'decision-record__declined'
    ]
  };
  for (const [name, needles] of Object.entries(expected)) {
    const vue = read(TASK + name);
    for (const needle of needles) assert.ok(vue.includes(needle), `${name} lost ${needle}`);
  }
});

test('#4.1 the timeline card and the answer sheet show the image after the prompt, aspect-fit inside 120×120, never enlarged', () => {
  for (const [name, block, nameAttr, after, before] of [
    [
      'DecisionRecord',
      'decision-record',
      'maestro__decision_record__image',
      'class="decision-record__prompt-row"',
      'class="decision-record__answers"'
    ],
    [
      'DecisionSheet',
      'decision-sheet',
      'decision-sheet__image',
      'class="decision-sheet__prompt-row"',
      'class="decision-sheet__option"'
    ]
  ]) {
    const vue = read(`${TASK}${name}.vue`);
    const tags = vue.match(/<img\b[^>]*>/g);
    assert.equal(tags?.length, 1, `${name}.vue has exactly one <img>`);
    const [tag] = tags;
    // `v-if` on the image alone: the timeline card keeps it after Answered.
    for (const attr of [
      'v-if="question.image"',
      ':src="question.image"',
      `name="${nameAttr}"`,
      `class="${block}__image"`,
      'alt=""'
    ]) {
      assert.ok(tag.includes(attr), `${name}.vue <img> needs ${attr}`);
    }
    const at = vue.indexOf(tag);
    assert.ok(
      vue.indexOf(after) < at && at < vue.indexOf(before),
      `${name}.vue: the image sits after the question text, before the answers`
    );

    const rule = ruleOf(read(`${TASK}${name}.less`), `.${block}__image`);
    assert.equal(rule['max-width'], '120px');
    assert.equal(rule['max-height'], '120px');
    assert.equal(rule.width, 'auto');
    assert.equal(rule.height, 'auto');
    assert.equal(
      rule['min-width'] ?? rule['min-height'],
      undefined,
      'no minimum — a small image is never blown up'
    );
    assert.ok(rule['border-radius'], 'rounded');
    assert.equal(
      Object.keys(rule).some((prop) => drawsLine({ prop, value: rule[prop] })),
      false,
      'no border'
    );
  }
  // The sheet's question is a column flex box: without this the default stretch would widen a small image to 120.
  assert.equal(
    ruleOf(read(`${TASK}DecisionSheet.less`), '.decision-sheet__image')['align-self'],
    'flex-start'
  );
});

// Ral 2026-09-24「颜色先都用蓝色的主题色」: every other "waiting on you" accent in the chat is the theme blue too.
test('#3 the other "waiting on you" accents in the chat are the theme blue: status row, pending dot and label, task hint, act tag, workflow approval', () => {
  const control = 'src/renderer/maestro/control/src/';
  const status = read(control + 'ResponseStatus.less');
  assert.ok(primary(ruleOf(status, '.response-status__dot--wait').background, 6));
  assert.ok(
    primary(ruleOf(status, '.response-status__dot').background, 6),
    "the dot's default is the wait colour"
  );
  assert.ok(primary(ruleOf(status, '.response-status__text--wait').color, 7));
  assert.ok(primary(ruleOf(status, '.response-status__agents--wait').color, 7));

  const panel = read(control + 'ChatPanel.less');
  assert.ok(
    primary(ruleOf(panel, '.chat-panel__sessions-confirm').color, 6),
    "the header's pending count"
  );
  assert.ok(
    primary(ruleOf(panel, '.chat-panel__sessions-confirm-dot').background, 6),
    "the header's pending dot"
  );
  assert.ok(
    primary(ruleOf(panel, '.chat-panel__history-item-confirm').color, 6),
    "the session list's 「待确认」 label — its shape is pinned by the N1 tests below"
  );

  const task = read(TASK + 'TaskPart.less');
  const hint = ruleOf(task, '.task-part__confirm-hint');
  assert.ok(
    primary(hint.background, 2) && primary(hint.color, 7),
    'the task card\'s "waiting on you" hint'
  );
  assert.equal(
    Object.keys(hint).some((prop) => drawsLine({ prop, value: hint[prop] })),
    false,
    'the hint lost its border'
  );
  // A stalled task is not waiting on the person — it keeps its warning colour, and is not what this test is about.
  assert.ok(isAmber(ruleOf(task, '.task-part__stall').background));

  assert.ok(
    primary(ruleOf(read(control + 'MessageItem.less'), '.message-activity__tag--act').color, 6),
    "the activity log's act tag"
  );

  const workflow = withoutComments(read(control + 'WorkflowTaskBar.less'));
  assert.match(
    workflow,
    /\[data-status='approval'\] &__state \{ color: rgb\(var\(--primary-7\)\); \}/,
    'a workflow agent "Waiting for you"'
  );
  assert.doesNotMatch(
    workflow.match(/^.*#b25e09.*$/m)?.[0] || '',
    /approval/,
    'waiting-for-a-tool and retrying keep their colour; approval left that rule'
  );

  for (const [file, selectors] of [
    [
      'ResponseStatus.less',
      [
        '.response-status__dot',
        '.response-status__dot--wait',
        '.response-status__text--wait',
        '.response-status__agents--wait'
      ]
    ],
    [
      'ChatPanel.less',
      [
        '.chat-panel__sessions-confirm',
        '.chat-panel__sessions-confirm-dot',
        '.chat-panel__history-item-confirm'
      ]
    ],
    ['MessageItem.less', ['.message-activity__tag--act']]
  ]) {
    const rows = declarations(read(control + file)).filter((row) =>
      selectors.includes(row.selector)
    );
    assert.ok(rows.length >= selectors.length, `${file}: rules found`);
    for (const row of rows)
      assert.equal(
        isAmber(row.value),
        false,
        `${file} ${row.selector} { ${row.prop}: ${row.value} }`
      );
  }
  assert.equal(isAmber(hint.background) || isAmber(hint.color), false);
});

// #3「Ral 已定」审查 N1 ①(decision-maker-card-202):主题蓝之后,会话列表的待答点和未读点都是蓝色圆点、一眼分不出,
// 所以改成蓝色小字「待确认」/ `To confirm`。真渲染 SessionsDrawer.vue(SSR → linkedom),文案走真的 en / zh 表;
// 其余依赖只给不炸的桩。
const CONTROL = 'src/renderer/maestro/control/src/';
const TO_CONFIRM = { en: 'To confirm', zh: '待确认' };
const LOCALES = {
  en: load('src/renderer/common/i18n/en.ts').en,
  zh: load('src/renderer/common/i18n/zh.ts').zh
};

const renderSessionList = async (i18nHelper, sessionListItems) => {
  const passthrough = vue.defineComponent({
    inheritAttrs: false,
    setup:
      (_props, { slots }) =>
      () =>
        slots.default?.()
  });
  const button = vue.defineComponent({
    setup:
      (_props, { slots, attrs }) =>
      () =>
        vue.h('button', attrs, slots.default?.())
  });
  const stubs = {
    vue,
    '@arco-design/web-vue': {
      Button: button,
      Drawer: vue.defineComponent({
        inheritAttrs: false,
        props: ['visible'],
        setup:
          (props, { slots }) =>
          () =>
            props.visible ? slots.default?.() : null
      })
    },
    '@tabler/icons-vue': { IconArchive: passthrough, IconSearch: passthrough, IconX: passthrough },
    '@renderer/common/i18n/i18n.helper': { i18nHelper },
    '../../../common/components/IconBtn/IconBtn.vue': { __esModule: true, default: button },
    './store/channel.store': { channelStore: { activeSessionId: '' } },
    './store/message.store': { messageStore: { sessionListItems } },
    './store/sessionActions.store': {
      sessionActions: { historyVisible: true, pendingIds: [] },
      isEditableTarget: () => false
    },
    './SessionsDrawer.less': {}
  };
  const { descriptor } = parseSfc(read(CONTROL + 'SessionsDrawer.vue'), {
    filename: 'SessionsDrawer.vue'
  });
  const code = ts.transpileModule(
    compileScript(descriptor, { id: 'sessions-drawer', inlineTemplate: true }).content,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    navigator: { platform: 'MacIntel' },
    require: (id) => stubs[id] || assert.fail(`SessionsDrawer.vue imports ${id} — give it a stub`)
  });
  const html = await renderToString(
    vue.createSSRApp({ render: () => vue.h(module.exports.default) })
  );
  return parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
};

test('#3 N1 the session list says 「待确认」 / "To confirm" where the confirm dot was — running and unread are unchanged', async () => {
  const row = (id, flags) => ({
    id,
    title: id,
    preview: 'preview',
    updatedAt: 0,
    running: false,
    unread: false,
    awaitingConfirm: false,
    ...flags
  });
  for (const [language, expected] of Object.entries(TO_CONFIRM)) {
    const chat = LOCALES[language].maestroControl.chat;
    assert.equal(chat.awaitingConfirmTag, expected, `${language} has the key`);
    const document = await renderSessionList(LOCALES[language], [
      row('waiting', { awaitingConfirm: true, running: true, unread: true }),
      row('running', { running: true, unread: true }),
      row('unread', { unread: true })
    ]);
    const rows = [...document.querySelectorAll('[name="maestro__history-item"]')];
    const shown = rows.map((item) =>
      ['confirm', 'running', 'unread'].filter((kind) =>
        item.querySelector(`[name="maestro__history-item-${kind}"]`)
      )
    );
    assert.deepEqual(
      shown,
      [['confirm'], ['running'], ['unread']],
      'the v-if chain is unchanged: confirm before running before unread'
    );

    const label = rows[0].querySelector('[name="maestro__history-item-confirm"]');
    assert.equal(label.textContent, expected, `${language}: the label renders the i18n text`);
    assert.equal(label.getAttribute('class'), 'chat-panel__history-item-confirm');
    assert.equal(
      label.getAttribute('title'),
      chat.awaitingConfirmSession,
      'the hover still says 等你确认 / Waiting for your confirmation'
    );
    assert.equal(
      label.previousElementSibling.getAttribute('class'),
      'chat-panel__history-item-body',
      "the dot's old place: right after the title column"
    );
    // Running and unread keep their empty indicator — unread is still the blue dot the label must not look like.
    for (const [index, kind] of [
      [1, 'running'],
      [2, 'unread']
    ]) {
      const indicator = rows[index].querySelector(`[name="maestro__history-item-${kind}"]`);
      assert.equal(indicator.getAttribute('class'), `chat-panel__history-item-${kind}`);
      assert.equal(indicator.textContent, '', `${language}: ${kind} has no text`);
    }
  }
});

test('#3 N1 the 「待确认」 label is plain theme-blue text with no dot, background or border; the title column truncates to make room', () => {
  const panel = read(CONTROL + 'ChatPanel.less');
  const label = ruleOf(panel, '.chat-panel__history-item-confirm');
  for (const [prop, value] of Object.entries({
    color: 'rgb(var(--primary-6))',
    'font-size': '11px',
    'font-weight': '500',
    'white-space': 'nowrap',
    flex: '0 0 auto'
  }))
    assert.equal(label[prop], value, `.chat-panel__history-item-confirm { ${prop} }`);
  // Every rule that reaches the label, compound selectors included: no dot size, no fill, no line, no radius.
  for (const file of ['ChatPanel.less', 'SessionsDrawer.less']) {
    for (const row of declarations(read(CONTROL + file)).filter((item) =>
      item.selector.includes('history-item-confirm')
    ))
      assert.doesNotMatch(
        row.prop,
        /^(?:background|border|width|height)/,
        `${file} ${row.selector} { ${row.prop}: ${row.value} } — a fill reads as a button, a dot as unread`
      );
  }

  // Unchanged: the header keeps its dot + count (the dot used to share the label's rule), unread keeps its dot.
  assert.deepEqual(ruleOf(panel, '.chat-panel__sessions-confirm-dot'), {
    width: '8px',
    height: '8px',
    'border-radius': '999px',
    background: 'rgb(var(--primary-6))'
  });
  const unread = ruleOf(panel, '.chat-panel__history-item-unread');
  assert.deepEqual(
    [unread.width, unread.height, unread['border-radius'], unread.background],
    ['8px', '8px', '999px', '@session-unread-blue']
  );

  // The label never shrinks or wraps; the title column does: the select button and the body may shrink below
  // their content, and the title clips with an ellipsis.
  const drawer = read(CONTROL + 'SessionsDrawer.less');
  assert.equal(ruleOf(drawer, '.chat-panel__history-select.arco-btn')['min-width'], '0');
  const body = ruleOf(drawer, '.chat-panel__history-item-body');
  assert.deepEqual([body.flex, body['min-width']], ['1 1 auto', '0']);
  const title = ruleOf(drawer, '.chat-panel__history-item-title');
  assert.deepEqual(
    [title.display, title.overflow, title['white-space'], title['text-overflow']],
    ['block', 'hidden', 'nowrap', 'ellipsis']
  );
});

// ── source guard: no Jev in a main / shared / control-renderer / i18n string literal ────────────────────
//
// The allowlist is keyed by **value + location** (file + the owning declaration / property path), not by value, so
// the same word anywhere else still fails. Every entry must match something — a dead entry fails too.
const SETTINGS_HINT_EN =
  "Jev decides the structured steps in the agent loop: which part of a snapshot matters, which element a step means, and whether an action can be undone. Off keeps today's loop unchanged.";
const SETTINGS_HINT_ZH =
  '打开后，agent 回路里的结构化判断交给 Jev：快照的哪一段相关、一步指的是哪个元素、这一下能不能撤销。关闭则完全按现有流程走。';
const ALLOWED = [
  // The relay's `model` parameter: it travels only in the request body.
  {
    file: 'src/main/decision/jevDecision.service.ts',
    owner: 'jevJudge.response.body.model',
    value: 'jev-latest'
  },
  // The config-store key behind the Settings switch.
  {
    file: 'src/shared/maestro/config.api.ts',
    owner: 'DECISION_JEV_ENABLED_KEY',
    value: 'jev-enabled'
  },
  // Settings → Decision: the Jev switch and its description — #1's only exception.
  {
    file: 'src/renderer/common/i18n/en.ts',
    owner: 'en.setting.decision.jevLabel',
    value: 'Use Jev for agent decisions'
  },
  {
    file: 'src/renderer/common/i18n/en.ts',
    owner: 'en.setting.decision.jevHint',
    value: SETTINGS_HINT_EN
  },
  {
    file: 'src/renderer/common/i18n/zh.ts',
    owner: 'zh.setting.decision.jevLabel',
    value: '用 Jev 做 agent 决策'
  },
  {
    file: 'src/renderer/common/i18n/zh.ts',
    owner: 'zh.setting.decision.jevHint',
    value: SETTINGS_HINT_ZH
  }
];
const ROOTS = [
  ['src/main', ['.ts']],
  ['src/shared', ['.ts']],
  ['src/renderer/maestro/control', ['.ts', '.vue']],
  ['src/renderer/common/i18n', ['.ts']]
];

const sourceFiles = (dir, extensions) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path, extensions));
    else if (extensions.some((ext) => entry.endsWith(ext)) && !entry.endsWith('.d.ts'))
      out.push(path);
  }
  return out;
};
const isModuleSpecifier = (node) => {
  const parent = node.parent;
  if (!parent) return false;
  if (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isExternalModuleReference(parent)
  )
    return true;
  if (ts.isLiteralTypeNode(parent) && parent.parent && ts.isImportTypeNode(parent.parent))
    return true;
  return (
    ts.isCallExpression(parent) &&
    (parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(parent.expression) && parent.expression.text === 'require'))
  );
};
/** Where a literal lives: the names of its enclosing declarations / object properties, outermost first. */
const ownerOf = (node) => {
  const names = [];
  for (let at = node.parent; at; at = at.parent) {
    const named =
      ts.isPropertyAssignment(at) ||
      ts.isVariableDeclaration(at) ||
      ts.isFunctionDeclaration(at) ||
      ts.isMethodDeclaration(at) ||
      ts.isPropertyDeclaration(at) ||
      ts.isClassDeclaration(at);
    if (named && at.name) names.unshift(at.name.getText());
  }
  return names.join('.');
};
const jevLiterals = (code, file) => {
  const hits = [];
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    const literal =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node);
    if (literal && JEV.test(node.text) && !isModuleSpecifier(node)) {
      hits.push({
        file,
        owner: ownerOf(node),
        value: node.text,
        line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
};
const allowedEntry = (hit) =>
  ALLOWED.find(
    (entry) => entry.file === hit.file && entry.owner === hit.owner && entry.value === hit.value
  );

test('source guard: no Jev in any main / shared / control-renderer / i18n string literal outside the allowlist', () => {
  const hits = [];
  for (const [root, extensions] of ROOTS) {
    for (const path of sourceFiles(join(APP_ROOT, root), extensions)) {
      const code = readFileSync(path, 'utf8');
      const file = relative(APP_ROOT, path);
      if (!path.endsWith('.vue')) {
        hits.push(...jevLiterals(code, file));
        continue;
      }
      for (const [, script] of code.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))
        hits.push(...jevLiterals(script, file));
      const template = code.match(/<template>([\s\S]*)<\/template>/)?.[1] || '';
      if (JEV.test(template.replace(/<!--[\s\S]*?-->/g, '')))
        hits.push({ file, owner: '<template>', value: 'mentions Jev', line: 0 });
    }
  }
  const denied = hits
    .filter((hit) => !allowedEntry(hit))
    .map((hit) => `${hit.file}:${hit.line} ${hit.owner} ${JSON.stringify(hit.value)}`);
  assert.deepEqual(
    denied,
    [],
    'the session calls it "decision maker"; only Settings → Decision and invisible identifiers may say Jev'
  );
  const dead = ALLOWED.filter((entry) => !hits.some((hit) => allowedEntry(hit) === entry)).map(
    (entry) => `${entry.file} ${entry.owner}`
  );
  assert.deepEqual(
    dead,
    [],
    'an allowlist entry that matches nothing is removed, not kept "just in case"'
  );
});

test('source guard is live: it catches a Jev literal, ignores module paths, and allows a value only where it is listed', () => {
  const values = (code, file = 'x.ts') => jevLiterals(code, file).map((hit) => hit.value);
  assert.deepEqual(values("const a = 'Jev 判不准'"), ['Jev 判不准']);
  assert.deepEqual(values('const b = `not segmented (jev ${r})`'), ['not segmented (jev ']);
  assert.deepEqual(
    values(
      "import { jevJudge } from '@main/decision/jevDecision.service'\nconst c = require('./jev.helper')"
    ),
    []
  );
  const elsewhere = jevLiterals("const model = 'jev-latest'", 'src/main/other.ts')[0];
  assert.equal(
    allowedEntry(elsewhere),
    undefined,
    'the allowed value at another location is still reported'
  );
  const [label] = jevLiterals(
    "export const en = { setting: { decision: { jevLabel: 'Use Jev for agent decisions' } } }",
    'src/renderer/common/i18n/en.ts'
  );
  assert.equal(allowedEntry(label)?.owner, 'en.setting.decision.jevLabel');
});
