// decision-helper-199 —— docs/features/decision-helper.md #3–#5.
// Paired with micromeet-cowork `apps/cowork/tests/unit/decisionHelper.test.mjs`.
//
// What is pinned:
//  · the helper: strictly-greater threshold, default 0.5, an invalid threshold falls back to 0.5 and says so (a BigInt
//    included, without throwing); the three question types (check treats yes and no alike), the method's type winning
//    over one a script put in the question; every failure reason passed through with its #3 fixed sentence — `judge()`
//    too — and the raw relay text in the helper's log only; a reply outside the question's criteria or outside [0, 1]
//    is `invalid`, logged once with the answer that came back; `message` never says Jev;
//  · migration parity: BJ3 (ui_act gate), BJ1 (snapshot segment) and the skill sandbox send the very bytes they sent
//    before and give the same results, with the low-level judge stubbed — the only differences are the ones #4 lists,
//    each pinned on its own;
//  · the `jev` sandbox alias is the same object as `decision`;
//  · the renderer module passes `options` through untouched and hands the result back untouched; the xpc facade is
//    `DecisionHandler` and only unpacks;
//  · source guards: `jevDecision.service` is imported by the main-process helper only; the `DecisionHandler` channel
//    name appears in the renderer and preload only inside `renderer/common/decision/decisionHelper.ts`.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import test, { after } from 'node:test';
import ts from 'typescript';

const APP_ROOT = resolve(import.meta.dirname, '../..');
const JEV = /jev/i;

// ── loader (same as decisionMakerCard.test.mjs) ─────────────────────────────────────────────────────

const ALIASES = [
  ['@maestro-main/', 'src/main/maestro/'],
  ['@maestro-shared/', 'src/shared/maestro/'],
  ['@main/', 'src/main/'],
  ['@shared/', 'src/shared/']
];

/** Transpile + alias-resolve one module tree; `stubs` win by specifier anywhere in the tree. A fresh cache per call. */
const load = (path, stubs = {}) => {
  const cache = new Map();
  const fileFor = (spec, parent) => {
    for (const [prefix, dir] of ALIASES) if (spec.startsWith(prefix)) return join(APP_ROOT, dir, `${spec.slice(prefix.length)}.ts`);
    return spec.startsWith('.') ? resolve(dirname(parent), `${spec}.ts`) : null;
  };
  const read = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
    });
    const native = createRequire(file);
    new Function('require', 'module', 'exports', outputText)((spec) => {
      if (spec in stubs) return stubs[spec];
      const next = fileFor(spec, file);
      return next ? read(next) : native(spec);
    }, module, module.exports);
    return module.exports;
  };
  return read(join(APP_ROOT, path));
};

// ── one stubbed low-level judge, shared by every module under test ──────────────────────────────────

let verdict;
let judged = [];
let enabled = true;
const judge = {
  jevJudge: async (request) => {
    judged.push(request);
    return verdict;
  },
  isJevEnabled: async () => enabled
};
const JUDGE = { '@main/decision/jevDecision.service': judge };
const reset = (next) => {
  verdict = next;
  judged = [];
};

const { decisionHelper, DECISION_DEFAULT_THRESHOLD } = load('src/main/decision/decisionHelper.ts', JUDGE);

const answered = (name, answer) => ({ ok: true, model: 'fixture', answers: { [name]: answer }, durationMs: 7 });
/** What the relay actually receives: `jevJudge` sends the request as JSON, so undefined fields do not exist there. */
const wire = (value) => JSON.parse(JSON.stringify(value));
/** The exact body `jevJudge` POSTs for a request (`jevDecision.service.ts`), key order included. */
const onTheWire = (request) =>
  JSON.stringify({ state: request.state, model: request.model ?? 'jev-latest', questions: request.questions });

const FAILURES = [
  { ok: false, reason: 'off', message: 'The decision maker is switched off in Settings → Decision.', durationMs: 0 },
  {
    ok: false,
    reason: 'unauthenticated',
    message: 'Not signed in to Bitterless; sign in so Maestro can reuse that session for the decision maker.',
    durationMs: 1
  },
  // The relay passes the upstream error body through; it may itself say "jev" (decision-maker card review F6).
  { ok: false, reason: 'http', status: 502, message: 'jev upstream exploded: {"detail":"bad gateway"}', durationMs: 12 },
  { ok: false, reason: 'network', message: 'decision maker request timed out', durationMs: 8000 },
  { ok: false, reason: 'invalid', message: 'relay returned no answers object', durationMs: 3 }
];

// ── #3 the helper ───────────────────────────────────────────────────────────────────────────────────

const PICK = { name: 'pick', instructions: 'Which one?', criteria: { a: 'the first', none: 'neither' } };
const READY = { name: 'ready', instructions: 'Is the page ready?' };
const chose = (choice, confidence) => answered('pick', { choice, confidence, probabilities: {} });

test('#3 the threshold is strictly greater than; default 0.5; a per-call threshold replaces it', async () => {
  assert.equal(DECISION_DEFAULT_THRESHOLD, 0.5);
  const cases = [
    [0.5, undefined, false],
    [0.500001, undefined, true],
    [0.49, undefined, false],
    [0.7, 0.7, false],
    [0.700001, 0.7, true],
    [0.6, 0.7, false],
    [0.2, 0.1, true]
  ];
  for (const [confidence, threshold, decided] of cases) {
    reset(chose('a', confidence));
    const outcome = await decisionHelper.choose(PICK, { x: 1 }, threshold === undefined ? undefined : { threshold });
    const label = `confidence ${confidence} vs threshold ${threshold ?? 'default'}`;
    if (decided) assert.deepEqual(outcome, { decided: true, value: 'a', confidence, durationMs: 7 }, label);
    else assert.deepEqual([outcome.decided, outcome.reason, outcome.value, outcome.confidence], [false, 'low-confidence', 'a', confidence], label);
  }
});

test('#3 a threshold that is not a number strictly between 0 and 1 counts as 0.5: the message says so when undecided, the log always', async (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  // A number is written as is; anything else as JSON, so a string gets its quotes and `[0.7]` does not read as 0.7.
  // What JSON cannot write goes through String() — a BigInt makes JSON.stringify throw, a function makes it return
  // undefined — and the call must not throw (#3, review 001-1 N3). What String() cannot write either reads
  // `(unprintable)`: an object with no prototype (so no toString) holding a BigInt, a function whose toString throws.
  const noPrototype = Object.assign(Object.create(null), { big: 10n });
  const throwingToString = Object.assign(() => 0.7, { toString: () => { throw new Error('no'); } });
  for (const [threshold, shown] of [
    [0, '0'], [1, '1'], [-0.2, '-0.2'], [1.5, '1.5'], [Number.NaN, 'NaN'], ['0.7', '"0.7"'], [null, 'null'], [[0.7], '[0.7]'],
    [10n, '10'], [() => 0.7, '() => 0.7'], [noPrototype, '(unprintable)'], [throwingToString, '(unprintable)']
  ]) {
    const note = `Threshold ${shown} is not a number strictly between 0 and 1, so the default 0.5 was used.`;
    warned.mock.resetCalls();
    reset(chose('a', 0.6));
    const decided = await decisionHelper.choose(PICK, {}, { threshold });
    assert.deepEqual(decided, { decided: true, value: 'a', confidence: 0.6, durationMs: 7 }, `${shown} → 0.5, and 0.6 > 0.5; a decided outcome has no message (#3)`);

    reset(chose('a', 0.4));
    const low = await decisionHelper.choose(PICK, {}, { threshold });
    assert.deepEqual([low.decided, low.reason], [false, 'low-confidence']);
    assert.equal(low.message, `The decision maker was not confident enough (0.4, needs more than 0.5). ${note}`);

    assert.deepEqual(warned.mock.calls.map((call) => call.arguments), [['[coach:decision:helper]', note], ['[coach:decision:helper]', note]], 'logged every time');
  }
  warned.mock.resetCalls();
  reset(chose('a', 0.6));
  await decisionHelper.choose(PICK, {}, { threshold: 0.3 });
  assert.equal(warned.mock.callCount(), 0, 'a valid threshold logs nothing');
});

test('#3 what is sent: the name is the key, the method sets the type (first), options add model / timeoutMs', async () => {
  reset(answered('risk', { choice: 'a', confidence: 0.9, probabilities: {} }));
  await decisionHelper.choose({ ...PICK, name: 'risk' }, { s: 1 });
  assert.deepEqual(wire(judged[0]), {
    state: { s: 1 },
    questions: { risk: { type: 'choice', instructions: 'Which one?', criteria: { a: 'the first', none: 'neither' } } }
  });
  assert.equal(JSON.stringify(Object.keys(judged[0].questions.risk)), '["type","instructions","criteria"]', 'the order a hand-written question had');

  reset(answered('ready', { noul: 0.9 }));
  await decisionHelper.check(READY, { s: 2 }, { threshold: 0.6, model: 'pinned-1', timeoutMs: 1500 });
  assert.deepEqual(wire(judged[0]), {
    state: { s: 2 },
    questions: { ready: { type: 'noul', instructions: 'Is the page ready?' } },
    model: 'pinned-1',
    timeoutMs: 1500
  });

  reset(answered('how', { score: 2, confidence: 0.9 }));
  await decisionHelper.score({ name: 'how', instructions: 'How risky?', criteria: ['low', 'high'] }, {});
  assert.equal(judged[0].questions.how.type, 'score');
});

test('#3 a `type` a script put in the question does not count: the method sets it, still first, same bytes', async () => {
  // A skill script is plain JS, so nothing stops it from sending a `type` (review 001-1 N2). Before this fix, the
  // script's type won: a noul question went out and its reply was then read as a choice — always `invalid`.
  const cases = [
    [
      () => decisionHelper.choose({ type: 'noul', ...PICK }, { s: 1 }),
      chose('a', 0.9),
      { pick: { type: 'choice', instructions: 'Which one?', criteria: { a: 'the first', none: 'neither' } } },
      { decided: true, value: 'a', confidence: 0.9, durationMs: 7 }
    ],
    [
      () => decisionHelper.choose({ ...PICK, type: 'score' }, { s: 1 }),
      chose('a', 0.9),
      { pick: { type: 'choice', instructions: 'Which one?', criteria: { a: 'the first', none: 'neither' } } },
      { decided: true, value: 'a', confidence: 0.9, durationMs: 7 }
    ],
    [
      () => decisionHelper.check({ ...READY, type: 'choice' }, { s: 1 }),
      answered('ready', { noul: 0.9 }),
      { ready: { type: 'noul', instructions: 'Is the page ready?' } },
      { decided: true, value: true, confidence: 0.9, durationMs: 7 }
    ],
    [
      () => decisionHelper.score({ type: 'noul', name: 'how', instructions: 'How risky?', criteria: ['low', 'high'] }, { s: 1 }),
      answered('how', { score: 1, confidence: 0.9 }),
      { how: { type: 'score', instructions: 'How risky?', criteria: ['low', 'high'] } },
      { decided: true, value: 1, confidence: 0.9, durationMs: 7 }
    ],
    // Whatever the stray `type` holds: a non-string one such as `null` is dropped too, not sent (review 001-3 N3).
    [
      () => decisionHelper.check({ ...READY, type: null }, { s: 1 }),
      answered('ready', { noul: 0.9 }),
      { ready: { type: 'noul', instructions: 'Is the page ready?' } },
      { decided: true, value: true, confidence: 0.9, durationMs: 7 }
    ]
  ];
  for (const [call, reply, questions, outcome] of cases) {
    reset(reply);
    assert.deepEqual(await call(), outcome, 'the reply is read as the method\'s type');
    assert.equal(onTheWire(judged[0]), onTheWire({ state: { s: 1 }, questions }), 'the bytes of a hand-written question');
  }
});

test('#3 choose reads the choice; score reads the score; both compare their confidence', async () => {
  reset(chose('none', 0.8));
  assert.deepEqual(await decisionHelper.choose(PICK, {}), { decided: true, value: 'none', confidence: 0.8, durationMs: 7 }, '"none" is an answer like any other');
  reset(answered('how', { score: 3, confidence: 0.8, legend: {} }));
  const how = { name: 'how', instructions: 'How risky?', criteria: ['low', 'mid', 'high', 'very high'] };
  assert.deepEqual(await decisionHelper.score(how, {}), { decided: true, value: 3, confidence: 0.8, durationMs: 7 });
  reset(answered('how', { score: 3, confidence: 0.8 }));
  assert.deepEqual((await decisionHelper.score(how, {}, { threshold: 0.9 })).reason, 'low-confidence');
});

test('#3 check treats yes and no alike: value = noul > 0.5, confidence = the chosen side\'s probability', async () => {
  const cases = [
    // [noul, threshold, decided, value, confidence]
    [0.86, 0.7, true, true, 0.86],
    [0.02, undefined, true, false, 1 - 0.02], // a confident "no" is decided (the #3 correction of 2026-09-24)
    [0.28, 0.7, true, false, 1 - 0.28],
    [0.6, 0.7, false, true, 0.6],
    [0.4, undefined, true, false, 1 - 0.4],
    [0.4, 0.7, false, false, 1 - 0.4],
    [0.5, undefined, false, false, 0.5] // the midpoint is a "no" at 0.5 — never above the default 0.5
  ];
  for (const [noul, threshold, decided, value, confidence] of cases) {
    reset(answered('ready', { noul }));
    const outcome = await decisionHelper.check(READY, {}, threshold === undefined ? undefined : { threshold });
    const label = `noul ${noul}, threshold ${threshold ?? 'default'}`;
    if (decided) assert.deepEqual(outcome, { decided: true, value, confidence, durationMs: 7 }, label);
    else assert.deepEqual([outcome.decided, outcome.reason, outcome.value, outcome.confidence], [false, 'low-confidence', value, confidence], label);
  }
});

test('#3 every failure reason comes back as is, with the HTTP status; the raw relay text never reaches the message', async (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  for (const failure of FAILURES) {
    reset(failure);
    warned.mock.resetCalls();
    const outcome = await decisionHelper.choose(PICK, {});
    // The raw text goes to the helper's log line only — and only where there is raw text to keep (#3).
    const logged = { http: 'decision maker http 502', network: 'decision maker network', invalid: 'decision maker invalid' }[failure.reason];
    assert.deepEqual(
      warned.mock.calls.map((call) => call.arguments),
      logged ? [['[coach:decision:helper]', logged, failure.message]] : [],
      `${failure.reason}: logged`
    );
    assert.equal(outcome.decided, false);
    assert.equal(outcome.reason, failure.reason);
    assert.equal(outcome.status, failure.status);
    assert.equal(outcome.durationMs, failure.durationMs);
    assert.equal('value' in outcome || 'confidence' in outcome, false, 'nothing was judged');
    // The #3 fixed sentences: off / unauthenticated are the service's own sentences for people; http / network are
    // type + status only; invalid names the question.
    const expected = {
      off: failure.message,
      unauthenticated: failure.message,
      http: 'The decision maker could not judge it (http 502).',
      network: 'The decision maker could not judge it (network).',
      invalid: 'The decision maker gave no usable answer to "pick".'
    }[failure.reason];
    assert.equal(outcome.message, expected);
  }
  // An http failure without a status says just `http`.
  reset({ ok: false, reason: 'http', message: 'bad gateway at relay.internal.example', durationMs: 2 });
  assert.equal((await decisionHelper.choose(PICK, {})).message, 'The decision maker could not judge it (http).');
  // An invalid threshold's note follows any of these sentences after one space (#3).
  reset(FAILURES[2]);
  assert.equal(
    (await decisionHelper.choose(PICK, {}, { threshold: 7 })).message,
    'The decision maker could not judge it (http 502). Threshold 7 is not a number strictly between 0 and 1, so the default 0.5 was used.'
  );
  // … the helper's own `invalid` included: a reply it could not use (review 001-3 N1).
  reset(chose('A', 0.9));
  assert.equal(
    (await decisionHelper.choose(PICK, {}, { threshold: 7 })).message,
    'The decision maker gave no usable answer to "pick". Threshold 7 is not a number strictly between 0 and 1, so the default 0.5 was used.'
  );
});

test('#3 a broken reply is `invalid`, never a guess and never a throw: missing, wrong type (NaN, Infinity, string, boolean, object), outside [0, 1], or a choice the question did not offer', async (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  const HOW = { name: 'how', instructions: 'i', criteria: ['a', 'b'] };
  const choose = () => decisionHelper.choose(PICK, {});
  const check = () => decisionHelper.check(READY, {});
  const score = () => decisionHelper.score(HOW, {});
  // [label, the question's name, the call, the reply]
  const cases = [
    ['choose: answer missing', 'pick', choose, { ok: true, model: 'fixture', answers: {}, durationMs: 1 }],
    ['choose: answered another question', 'pick', choose, answered('other', { choice: 'a', confidence: 0.9 })],
    ['choose: answer null', 'pick', choose, answered('pick', null)],
    ['choose: answer is a number', 'pick', choose, answered('pick', 5)],
    ['choose: choice not a string', 'pick', choose, answered('pick', { choice: 3, confidence: 0.9 })],
    ['choose: confidence missing', 'pick', choose, answered('pick', { choice: 'a' })],
    ...[['a string', '0.9'], ['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY], ['a boolean', true], ['an object', {}]].map(
      ([what, confidence]) => [`choose: confidence ${what}`, 'pick', choose, answered('pick', { choice: 'a', confidence })]
    ),
    // [0, 1] (review 001-1 N4): a probability outside it is as broken as a non-number.
    ['choose: confidence above 1', 'pick', choose, chose('a', 1.5)],
    ['choose: confidence below 0', 'pick', choose, chose('a', -0.2)],
    // Not one of the criteria keys (review 001-1 N4): BJ3 takes anything but `irreversible` as safe.
    ['choose: a choice the question did not offer', 'pick', choose, chose('b', 0.9)],
    ['choose: a choice that differs in case', 'pick', choose, chose('A', 0.9)],
    ['choose: an inherited key is not an offered choice', 'pick', choose, chose('toString', 0.9)],
    // A script is plain JS: a question without criteria offers nothing — `invalid`, not a TypeError.
    ['choose: a script question without criteria', 'pick', () => decisionHelper.choose({ name: 'pick', instructions: 'i' }, {}), chose('a', 0.9)],
    ['check: noul a string', 'ready', check, answered('ready', { noul: '0.9' })],
    ['check: noul NaN', 'ready', check, answered('ready', { noul: Number.NaN })],
    ['check: noul Infinity', 'ready', check, answered('ready', { noul: Number.POSITIVE_INFINITY })],
    ['check: noul a boolean', 'ready', check, answered('ready', { noul: true })],
    ['check: noul above 1', 'ready', check, answered('ready', { noul: 1.5 })],
    ['check: noul below 0', 'ready', check, answered('ready', { noul: -0.2 })],
    ['check: a choice answer', 'ready', check, answered('ready', { choice: 'a', confidence: 0.9 })],
    ['score: confidence missing', 'how', score, answered('how', { score: 2 })],
    ['score: confidence above 1', 'how', score, answered('how', { score: 2, confidence: 1.5 })],
    ['score: score Infinity', 'how', score, answered('how', { score: Number.POSITIVE_INFINITY, confidence: 0.9 })]
  ];
  for (const [label, name, call, reply] of cases) {
    reset(reply);
    warned.mock.resetCalls();
    const outcome = await call();
    const message = `The decision maker gave no usable answer to "${name}".`;
    assert.deepEqual(outcome, { decided: false, reason: 'invalid', message, durationMs: reply.durationMs }, label);
    // The helper's own invalid logs exactly one line, with the answer that came back as JSON; the message above
    // stays the #3 sentence (#3「日志」, review 199-1 O2).
    assert.deepEqual(
      warned.mock.calls.map((entry) => entry.arguments),
      [
        [
          '[coach:decision:helper]',
          `decision maker gave an unusable answer to "${name}"`,
          JSON.stringify(reply.answers[name])
        ]
      ],
      `${label}: logged once`
    );
  }
  // The same line, spelled out once.
  reset(chose('A', 0.9));
  warned.mock.resetCalls();
  await choose();
  assert.deepEqual(
    warned.mock.calls.map((entry) => entry.arguments),
    [
      [
        '[coach:decision:helper]',
        'decision maker gave an unusable answer to "pick"',
        '{"choice":"A","confidence":0.9,"probabilities":{}}'
      ]
    ]
  );
  warned.mock.resetCalls();
  // The range is closed: 0 and 1 are probabilities like any other.
  reset(chose('a', 1));
  assert.deepEqual(await choose(), { decided: true, value: 'a', confidence: 1, durationMs: 7 });
  reset(chose('none', 0));
  assert.deepEqual([(await choose()).reason, (await choose()).confidence], ['low-confidence', 0]);
  reset(answered('ready', { noul: 0 }));
  assert.deepEqual(await check(), { decided: true, value: false, confidence: 1, durationMs: 7 });
  reset(answered('ready', { noul: 1 }));
  assert.deepEqual(await check(), { decided: true, value: true, confidence: 1, durationMs: 7 });
  reset(chose('a', 0.9));
  assert.equal((await decisionHelper.choose(PICK, {}, null)).decided, true, 'a script may pass null options');
  assert.equal(warned.mock.callCount(), 0, 'an answer the helper could use logs nothing');
});

test('#3 no outcome message says Jev', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const messages = [];
  for (const next of [...FAILURES, chose('a', 0.9), chose('a', 0.2), answered('pick', {})]) {
    for (const options of [undefined, { threshold: 7 }]) {
      reset(next);
      const outcome = await decisionHelper.choose(PICK, {}, options);
      if (outcome.decided === false) messages.push(outcome.message);
    }
  }
  for (const failure of FAILURES) {
    reset(failure);
    messages.push((await decisionHelper.judge({ state: {}, questions: {} })).message);
  }
  assert.equal(messages.length, 19);
  for (const message of messages) assert.doesNotMatch(message, JEV);
});

test('#3 judge: a judged JevResult comes back untouched, the threshold ignored; enabled is the Settings switch', async () => {
  const result = chose('a', 0.1);
  reset(result);
  const request = { state: { s: 1 }, questions: { q: { type: 'noul', instructions: 'i' } }, model: 'm', timeoutMs: 10 };
  assert.equal(await decisionHelper.judge(request, { threshold: 0.9 }), result, 'the same object — no threshold applied');
  assert.deepEqual(judged[0], request);
  await decisionHelper.judge(request, { model: 'override', timeoutMs: 99 });
  assert.deepEqual([judged[1].model, judged[1].timeoutMs], ['override', 99], 'per-call options win over the request');

  for (const value of [true, false]) {
    enabled = value;
    assert.equal(await decisionHelper.enabled(), value);
  }
  enabled = true;
});

test('#3 judge: a failure keeps every other field, in place; only the message follows the #3 table — nameless for invalid, raw text logged (review 198-F4)', async (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  const sentence = {
    off: FAILURES[0].message,
    unauthenticated: FAILURES[1].message,
    http: 'The decision maker could not judge it (http 502).',
    network: 'The decision maker could not judge it (network).',
    // `judge()` answers the whole request, not one question, so the sentence names none (#3).
    invalid: 'The decision maker gave no usable answer.'
  };
  for (const failure of FAILURES) {
    reset(failure);
    const out = await decisionHelper.judge({ state: {}, questions: {} }, { threshold: 7 });
    assert.deepEqual(out, { ...failure, message: sentence[failure.reason] }, failure.reason);
    assert.deepEqual(Object.keys(out), Object.keys(failure), `${failure.reason}: the same fields in the same order`);
  }
  assert.deepEqual(warned.mock.calls.map((call) => call.arguments), [
    ['[coach:decision:helper]', 'decision maker http 502', FAILURES[2].message],
    ['[coach:decision:helper]', 'decision maker network', FAILURES[3].message],
    ['[coach:decision:helper]', 'decision maker invalid', FAILURES[4].message]
  ], 'the raw text survives in the log only; judge ignores the threshold, so no threshold note either');
});

test('#3 judge with no request at all (a script\'s bare `jev.judge()`) does not throw: switched off reads off, switched on goes to the service as `{}`', async (t) => {
  t.mock.method(console, 'warn', () => {});
  // The real service this time, so "off" and "what reaches the relay" are its own behaviour, not a stub's.
  const helperWith = (switchRow) =>
    load('src/main/decision/decisionHelper.ts', {
      'electron-xpc/main': { createXpcMainEmitter: () => ({ get: async () => switchRow }) },
      '@main/auth/customerSession.service': { customerSessionService: { current: { token: 'fixture-token' } } }
    }).decisionHelper;

  // Switched off it reads off — as before the migration, when the sandbox handed `undefined` to `jevJudge` as is.
  const off = await helperWith(null).judge();
  assert.deepEqual([off.ok, off.reason, off.message], [false, 'off', 'The decision maker is switched off in Settings → Decision.']);

  const posted = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    posted.push(init.body);
    return { ok: false, status: 422, text: async () => '{"detail":{"message":"jev: state is required"}}' };
  });
  // Switched on, #4's sandbox exception: one relay call whose body holds only the default model, and its failure in
  // the #3 wording. Before the migration this call was a TypeError in the script, and nothing was sent.
  const on = await helperWith({ options: true }).judge(undefined, undefined);
  assert.deepEqual(posted, ['{"model":"jev-latest"}'], 'one request, with only the default model in its body');
  assert.deepEqual([on.ok, on.reason, on.status, on.message], [false, 'http', 422, 'The decision maker could not judge it (http 422).']);
  const nullRequest = await helperWith({ options: true }).judge(null);
  assert.equal(nullRequest.reason, 'http', 'null is no request either');
});

// ── #4 #5 migration parity: BJ3 (ui_act gate) ───────────────────────────────────────────────────────
//
// "Before" is the pre-migration decision code of uiActGate.ts (with decision-maker-card-198's wording), copied
// verbatim but for the TypeScript types. "After" is the real gate on the real helper. Both see the same stubbed verdict.

const RISK_CRITERIA = {
  read_only: 'only reads or navigates; nothing is written',
  reversible_write: 'writes something the same UI can undo (draft, filter, selection, form field)',
  irreversible: 'deletes data, submits a payment/order, or otherwise cannot be undone from this UI'
};
const bj3Before = (result) => {
  const CONFIDENCE_FLOOR = 0.5;
  if (result.ok === false && result.reason === 'off') return { asks: false };
  const answer = result.ok ? result.answers.risk : undefined;
  const undecided = !answer || typeof answer.choice !== 'string' || (answer.confidence ?? 0) <= CONFIDENCE_FLOOR;
  const risk = undecided ? 'irreversible' : answer.choice;
  if (risk !== 'irreversible') return { asks: false };
  const why =
    result.ok === false
      ? `The decision maker could not judge it (${result.reason}${result.status ? ` ${result.status}` : ''})`
      : undecided
        ? `The decision maker was not confident enough (${answer?.confidence ?? 0})`
        : `The decision maker classified it as irreversible (${answer?.confidence ?? 0})`;
  return { asks: true, why };
};

let asked = [];
const { gateUiActions } = load('src/main/maestro/drive/uiActGate.ts', {
  ...JUDGE,
  '@main/agent/decisionRegistry.service': {
    agentDecisionRegistry: {
      request: async (sessionId, questions) => {
        asked.push(questions[0]);
        return { picked: [['Stop']] };
      }
    }
  }
});
const bj3After = async (result) => {
  reset(result);
  asked = [];
  const out = await gateUiActions([{ action: 'click', selector: '[data-coach-ref="e25"]' }], {
    sessionId: 'chat-a',
    pageUrl: 'https://fixture.invalid/',
    readLabel: async () => 'Delete all'
  });
  assert.equal(judged.length, 1);
  // The request the decision maker sees is the one the gate used to write by hand, key `risk` included —
  // byte for byte, key order too.
  assert.equal(
    onTheWire(judged[0]),
    onTheWire({
      state: { page_url: 'https://fixture.invalid/', pending_action: 'click "Delete all"' },
      questions: {
        risk: {
          type: 'choice',
          instructions: 'Classify what this single UI action does to the application state once it lands.',
          criteria: RISK_CRITERIA
        }
      }
    })
  );
  if (!asked.length) {
    assert.deepEqual(out, { ok: true });
    return { asks: false };
  }
  const why = asked[0].question.split('\n\n')[1];
  assert.equal(asked[0].question, `Run this action?\nclick "Delete all"\n\n${why}`);
  assert.deepEqual(out, { ok: false, error: `ERROR: operator did not approve click "Delete all" — ${why}` });
  return { asks: true, why };
};

const risk = (choice, confidence) => ({ ok: true, model: 'fixture', answers: { risk: { choice, confidence, probabilities: {} } }, durationMs: 4 });
const riskAnswer = (answer) => ({ ok: true, model: 'fixture', answers: answer === undefined ? {} : { risk: answer }, durationMs: 4 });

test('#5 BJ3 before/after: same request, same verdict, same card text for every well-formed reply', async (t) => {
  t.mock.method(console, 'warn', () => {}); // the helper logs the upstream failures' raw text
  // Well-formed: one of the three risk levels, with a confidence in [0, 1].
  const cases = [...FAILURES];
  for (const choice of Object.keys(RISK_CRITERIA)) {
    for (const confidence of [0, 0.2, 0.39, 0.5, 0.500001, 0.8, 0.93, 1]) cases.push(risk(choice, confidence));
  }
  for (const result of cases) assert.deepEqual(await bj3After(result), bj3Before(result), JSON.stringify(result));
});

test('#5 BJ3 deliberate change (#4): a broken reply is "could not judge it (invalid)" — and always asks now', async (t) => {
  t.mock.method(console, 'warn', () => {}); // the helper logs each answer it could not use
  const invalid = { asks: true, why: 'The decision maker could not judge it (invalid)' };
  // #4 ①: asked before too; only the reason on the card changes. The old gate asked when the answer was missing, the
  // choice was not a string, `(confidence ?? 0) <= 0.5` in JS, or the choice was `irreversible`: a missing or negative
  // confidence, one that converts to ≤ 0.5 (`'0.3'`, `[0.3]`), a non-string choice and another string with a low
  // confidence read as "not confident enough (X)". Of `irreversible` with a broken confidence, only one that does not
  // convert to ≤ 0.5 (NaN, Infinity, above 1, `'0.9'`, `true`, `{}`, `[0.9]`) read "classified it as irreversible
  // (X)"; a missing, negative or `'0.3'`-like one read "not confident enough (X)" like the rest.
  for (const [answer, before] of [
    [undefined, 'The decision maker was not confident enough (0)'],
    [null, 'The decision maker was not confident enough (0)'],
    [{ choice: 'read_only' }, 'The decision maker was not confident enough (0)'],
    [{ choice: 3, confidence: 0.9 }, 'The decision maker was not confident enough (0.9)'],
    [{ choice: 'read_only', confidence: -0.2 }, 'The decision maker was not confident enough (-0.2)'],
    [{ choice: 'read_only', confidence: [0.3] }, 'The decision maker was not confident enough (0.3)'],
    [{ choice: 'an unknown choice', confidence: 0.3 }, 'The decision maker was not confident enough (0.3)'],
    [{ choice: 'irreversible', confidence: Number.NaN }, 'The decision maker classified it as irreversible (NaN)'],
    [{ choice: 'irreversible', confidence: 1.5 }, 'The decision maker classified it as irreversible (1.5)']
  ]) {
    assert.deepEqual(bj3Before(riskAnswer(answer)), { asks: true, why: before }, JSON.stringify(answer));
    assert.deepEqual(await bj3After(riskAnswer(answer)), invalid, JSON.stringify(answer));
  }
  // #4 ②: ran without asking before, asks now. The old gate took any string choice but `irreversible` as safe — a
  // label the criteria never offered, or `Irreversible` in another case — and a confidence that does not convert to
  // ≤ 0.5 as confident: `NaN <= 0.5`, `'0.9' <= 0.5`, `Infinity <= 0.5`, `true <= 0.5`, `{} <= 0.5` and
  // `[0.9] <= 0.5` are all false.
  for (const [choice, confidence] of [
    ['read_only', Number.NaN],
    ['read_only', '0.9'],
    ['reversible_write', Number.POSITIVE_INFINITY],
    ['read_only', true],
    ['read_only', {}],
    ['read_only', [0.9]],
    ['Irreversible', 0.9],
    ['an unknown choice', 0.9],
    ['delete', 0.99],
    // Above 1 (#4 ②, #3's [0, 1]).
    ['read_only', 1.5]
  ]) {
    const label = `${choice} at ${String(confidence)}`;
    assert.deepEqual(bj3Before(risk(choice, confidence)), { asks: false }, label);
    assert.deepEqual(await bj3After(risk(choice, confidence)), invalid, `${label}: the person is asked`);
  }
});

// ── #4 #5 migration parity: BJ1 (snapshot segment) ──────────────────────────────────────────────────

const BLOCKS = [
  { id: 'b1', start: 0, end: 7, bytes: 100, share: 0.5, label: 'navigation — top' },
  { id: 'b2', start: 7, end: 9, bytes: 100, share: 0.5, label: 'main — body' }
];
const COMPOSED = ['# tab: t1', '# page: https://fixture.invalid/', '# title: Fixture', '# elements: 2', '# snapshot: s1', '', '- button "Go" [ref=e1]', '- link "Home" [ref=e2]'].join('\n');

/** Pre-migration snapshotSegment.ts, the lines this task replaced (card-198 wording), verbatim but for types. */
const bj1Before = (result) => {
  const CONFIDENCE_FLOOR = 0.7;
  const answer = result.ok ? result.answers.block : undefined;
  const picked = answer && answer.choice !== 'none' ? BLOCKS.find((block) => block.id === answer.choice) : undefined;
  if (result.ok === false) return `not segmented (decision maker ${result.reason}${result.status ? ` ${result.status}` : ''})`;
  if (!picked) return 'not segmented (decision maker picked none)';
  if ((answer?.confidence ?? 0) < CONFIDENCE_FLOOR) return `not segmented (confidence ${answer?.confidence})`;
  const savedPct = (((COMPOSED.length - picked.bytes) / COMPOSED.length) * 100).toFixed(0);
  return `segmented to ${picked.id} (${savedPct}% saved, confidence ${answer?.confidence})`;
};

const scratch = mkdtempSync(join(tmpdir(), 'decision-helper-segment-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const { segmentSnapshot } = load('src/main/maestro/drive/snapshotSegment.ts', {
  ...JUDGE,
  electron: { app: { getPath: () => scratch } },
  '@maestro-main/drive/snapshotPrune': { PRUNE_MIN_BYTES: Number.POSITIVE_INFINITY, pruneSnapshot: () => ({ pruned: false }) },
  '@maestro-main/drive/snapshotChunker': {
    chunkSnapshot: (text) => ({ lines: text.split('\n'), totalBytes: text.length, skip: '', blocks: BLOCKS })
  }
});
const bj1After = async (result) => {
  reset(result);
  const { text, note } = await segmentSnapshot(COMPOSED, 'find the Go button');
  assert.equal(judged.length, 1);
  assert.deepEqual(Object.keys(judged[0].questions), ['block'], 'the question keeps its key');
  assert.deepEqual(judged[0].questions.block.criteria, { none: 'no block contains what the goal describes', b1: 'navigation — top', b2: 'main — body' });
  assert.deepEqual(judged[0].state, { goal: 'find the Go button', blocks: BLOCKS.map(({ id, label }) => ({ id, label })) });
  // The bytes the pre-migration code wrote by hand, key order too.
  assert.equal(
    onTheWire(judged[0]),
    onTheWire({
      state: { goal: 'find the Go button', blocks: BLOCKS.map((block) => ({ id: block.id, label: block.label })) },
      questions: {
        block: {
          type: 'choice',
          instructions:
            'Which block contains the elements and text needed to carry out the goal? Judge by whether the controls/text the goal names would be inside that block, not by which block looks most important.',
          criteria: { none: 'no block contains what the goal describes', b1: 'navigation — top', b2: 'main — body' }
        }
      }
    })
  );
  if (note.startsWith('not segmented')) {
    assert.equal(text, COMPOSED, 'fail-open: nothing judged, nothing cut');
    return note;
  }
  // "not pruned · <segment note> · N% saved"
  assert.match(text, /# SEGMENTED: showing 1 of 2 page sections/);
  return note.split(' · ')[1];
};

const block = (choice, confidence) => ({ ok: true, model: 'fixture', answers: { block: { choice, confidence, probabilities: {} } }, durationMs: 4 });
const blockAnswer = (answer) => ({ ok: true, model: 'fixture', answers: answer === undefined ? {} : { block: answer }, durationMs: 4 });

test('#5 BJ1 before/after: same request, same note, same text — the threshold stays 0.7, not the default 0.5', async (t) => {
  t.mock.method(console, 'warn', () => {}); // the helper logs the upstream failures' raw text
  const cases = [
    ...FAILURES,
    block('none', 0.9),
    block('b1', 0.9),
    block('b2', 0.71),
    block('b1', 0.69),
    block('b1', 0.6), // above the default 0.5: the explicit 0.7 is what keeps this one unsegmented
    block('none', 0.2),
    block('b1', 1),
    block('b2', 0)
  ];
  for (const result of cases) assert.equal(await bj1After(result), bj1Before(result), JSON.stringify(result));
});

test('#5 BJ1 deliberate changes (#4): exactly 0.7 keeps the whole snapshot now; a broken reply says invalid', async (t) => {
  t.mock.method(console, 'warn', () => {}); // the helper logs each answer it could not use
  // #4, segmented before and the whole snapshot now (it only costs context): exactly 0.7. `< 0.7` was rejected, so
  // 0.7 itself was taken; #3 makes every threshold strictly greater.
  assert.match(bj1Before(block('b1', 0.7)), /^segmented to b1 /);
  assert.equal(await bj1After(block('b1', 0.7)), 'not segmented (confidence 0.7)');
  // #4, only the note changes: the model got the whole snapshot before too (bj1After pins the text). A missing
  // answer and a choice outside the criteria (a non-string one included) read as "picked none"; a missing or negative
  // confidence showed that confidence. Now each is `decision maker invalid`.
  for (const [answer, before] of [
    [undefined, 'not segmented (decision maker picked none)'],
    [{ choice: 1, confidence: 0.9 }, 'not segmented (decision maker picked none)'],
    [{ choice: 'b9', confidence: 0.9 }, 'not segmented (decision maker picked none)'],
    [{ choice: 'b1' }, 'not segmented (confidence undefined)'],
    [{ choice: 'b1', confidence: -0.2 }, 'not segmented (confidence -0.2)']
  ]) {
    assert.equal(bj1Before(blockAnswer(answer)), before, JSON.stringify(answer));
    assert.equal(await bj1After(blockAnswer(answer)), 'not segmented (decision maker invalid)', JSON.stringify(answer));
  }
  // #4, segmented before and the whole snapshot now: a confidence that does not convert to < 0.7 but is not a number
  // in [0, 1]. `NaN < 0.7`, `'0.9' < 0.7`, `Infinity < 0.7`, `true < 0.7`, `{} < 0.7` and `[0.9] < 0.7` are all
  // false, and 1.5 is above 1 (#3's [0, 1]), so the model got one block.
  for (const confidence of [Number.NaN, '0.9', Number.POSITIVE_INFINITY, true, {}, [0.9], 1.5]) {
    const label = `b1 at ${String(confidence)}`;
    assert.match(bj1Before(block('b1', confidence)), /^segmented to b1 /, label);
    assert.equal(await bj1After(block('b1', confidence)), 'not segmented (decision maker invalid)', label);
  }
});

// ── #4 #5 the skill sandbox: `decision`, and `jev` as the same object ─────────────────────────────────

const { runSkillScript } = load('src/main/maestro/drive/skillScript.ts', JUDGE);
const run = (script, signal) => runSkillScript({ script, replay: {}, vars: {}, signal });

test('#5 the sandbox has `decision`; `jev` is the same object, and the old `jev.judge` / `jev.enabled` behave as before — but a failure\'s message and a bare `jev.judge()`', async (t) => {
  t.mock.method(console, 'warn', () => {});
  assert.deepEqual(await run('return jev === decision'), { ok: true, result: true });

  // Before: `jev.judge(request)` returned `jevJudge(request)` as is. A judged result still does, through the helper.
  const request = { state: { page: 'p' }, questions: { q: { type: 'choice', instructions: 'i', criteria: { a: 'A' } } } };
  const judgedResult = chose('a', 0.1);
  reset(judgedResult);
  const out = await run(`return await jev.judge(${JSON.stringify(request)})`);
  assert.equal(out.result, judgedResult, 'a judged JevResult comes back untouched — no threshold applied');
  assert.equal(onTheWire(judged[0]), onTheWire(request), 'the very bytes the script asked for');
  // Options a script passes to `judge` reach the service too (review 199-1 F3).
  reset(judgedResult);
  await run(`return await decision.judge(${JSON.stringify(request)}, { model: 'x' })`);
  assert.equal(judged[0].model, 'x');

  // #4: a failure keeps its fields; only `message` is now the #3 sentence instead of the relay's raw text — the tool
  // result goes back to the model, and a script that throws the message puts it on the activity strip (review 198-F4).
  for (const [failure, message] of [
    [FAILURES[0], FAILURES[0].message],
    [FAILURES[2], 'The decision maker could not judge it (http 502).'],
    [FAILURES[3], 'The decision maker could not judge it (network).'],
    [FAILURES[4], 'The decision maker gave no usable answer.']
  ]) {
    for (const binding of ['jev', 'decision']) {
      reset(failure);
      const returned = await run(`return await ${binding}.judge(${JSON.stringify(request)})`);
      assert.deepEqual(returned, { ok: true, result: { ...failure, message } }, `${binding}.judge: ${failure.reason}`);
      reset(failure);
      const thrown = await run(`const r = await ${binding}.judge(${JSON.stringify(request)}); if (!r.ok) throw new Error(r.message)`);
      assert.deepEqual(thrown, { ok: false, error: message }, `${binding}.judge thrown: ${failure.reason}`);
    }
  }

  // #4's one exception: a bare `jev.judge()` reaches the service as `{}`. Switched on, that is one relay call (the
  // real-service test above pins it); before the migration it was a TypeError in the script, and nothing was sent.
  reset(FAILURES[0]);
  assert.deepEqual(await run('return await jev.judge()'), { ok: true, result: FAILURES[0] });
  assert.deepEqual(wire(judged[0]), {});

  enabled = false;
  assert.deepEqual(await run('return await jev.enabled()'), { ok: true, result: false });
  enabled = true;
  assert.deepEqual(await run('return await decision.enabled()'), { ok: true, result: true });
});

test('#4 the sandbox `decision` offers choose / check / score, and a script-passed threshold is applied', async () => {
  const pick = "{ name: 'pick', instructions: 'Which?', criteria: { a: 'A' } }";
  reset(chose('a', 0.65));
  const strict = await run(`return await decision.choose(${pick}, { x: 1 }, { threshold: 0.7 })`);
  assert.deepEqual([strict.result.decided, strict.result.reason, strict.result.value], [false, 'low-confidence', 'a']);
  reset(chose('a', 0.65));
  const loose = await run(`return await jev.choose(${pick}, { x: 1 })`);
  assert.equal(loose.result.decided, true, 'default 0.5 through the alias too');

  reset(answered('ready', { noul: 0.1 }));
  assert.deepEqual((await run("return await decision.check({ name: 'ready', instructions: 'Ready?' }, {})")).result, { decided: true, value: false, confidence: 0.9, durationMs: 7 });
  reset(answered('how', { score: 1, confidence: 0.9 }));
  assert.equal((await run("return (await decision.score({ name: 'how', instructions: 'How?', criteria: ['a', 'b'] }, {})).value")).result, 1);
  // check and score take a script's threshold too (review 199-2 F1): 0.9 is not above 0.95, and a dropped options
  // object would fall back to 0.5 and decide.
  reset(answered('ready', { noul: 0.1 }));
  assert.equal((await run("return await decision.check({ name: 'ready', instructions: 'Ready?' }, {}, { threshold: 0.95 })")).result.reason, 'low-confidence');
  reset(answered('how', { score: 1, confidence: 0.9 }));
  assert.equal((await run("return await decision.score({ name: 'how', instructions: 'How?', criteria: ['a', 'b'] }, {}, { threshold: 0.95 })")).result.reason, 'low-confidence');
});

test('#5 the sandbox still stops a script that was aborted while it waited for the decision maker', async () => {
  // judge / choose / check / score each look at the abort signal again after the wait (review 199-1 F3: check and
  // score were not covered).
  for (const [script, reply] of [
    ['await jev.judge({ state: {}, questions: {} })', chose('a', 0.9)],
    [
      "await decision.choose({ name: 'pick', instructions: 'i', criteria: { a: 'A' } }, {})",
      chose('a', 0.9)
    ],
    [
      "await decision.check({ name: 'ready', instructions: 'i' }, {})",
      answered('ready', { noul: 0.9 })
    ],
    [
      "await decision.score({ name: 'how', instructions: 'i', criteria: ['a', 'b'] }, {})",
      answered('how', { score: 1, confidence: 0.9 })
    ]
  ]) {
    const controller = new AbortController();
    judge.jevJudge = async (request) => {
      judged.push(request);
      controller.abort();
      return reply;
    };
    assert.deepEqual(await run(`${script}; return 'kept going'`, controller.signal), { ok: false, error: 'aborted' }, script);
  }
  judge.jevJudge = async (request) => {
    judged.push(request);
    return verdict;
  };
});

// ── #4 #5 the renderer module and the xpc facade ─────────────────────────────────────────────────────

const sent = [];
let emitterClass;
const REPLY = { decided: true, value: 'from main', confidence: 0.9, durationMs: 1 };
const renderer = load('src/renderer/common/decision/decisionHelper.ts', {
  'electron-xpc/renderer': {
    createXpcRendererEmitter: (className) => {
      emitterClass = className;
      return new Proxy({}, { get: (_, method) => async (params) => { sent.push({ method, params }); return REPLY; } });
    }
  }
}).decisionHelper;

test('#5 the renderer module sends each call as one object, options untouched, and hands the result back untouched', async () => {
  const options = Object.freeze({ threshold: 0.7, timeoutMs: 1200, model: 'pinned' });
  const state = { page: 'p' };
  const request = { state, questions: {} };
  const calls = [
    ['enabled', () => renderer.enabled(), undefined],
    ['judge', () => renderer.judge(request, options), { request, options }],
    ['choose', () => renderer.choose(PICK, state, options), { question: PICK, state, options }],
    ['check', () => renderer.check(READY, state, options), { question: READY, state, options }],
    ['score', () => renderer.score(PICK, state, options), { question: PICK, state, options }]
  ];
  for (const [method, call, params] of calls) {
    sent.length = 0;
    assert.equal(await call(), REPLY, `${method}: the main process's answer, as is`);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].method, method);
    assert.deepEqual(sent[0].params, params);
    if (params) assert.equal(sent[0].params.options, options, `${method}: the very options object — the renderer reads none of it`);
  }
  sent.length = 0;
  await renderer.choose(PICK, state);
  assert.deepEqual(sent[0].params, { question: PICK, state, options: undefined }, 'no options → none invented (the default lives in main)');
});

test('#5 the xpc facade is DecisionHandler — the renderer\'s channel — and only unpacks the one object', async () => {
  const forwarded = [];
  const helperStub = new Proxy({}, { get: (_, method) => async (...args) => { forwarded.push({ method, args }); return REPLY; } });
  const { DecisionHandler } = load('src/main/xpc/decision.handler.ts', {
    'electron-xpc/main': { XpcMainHandler: class {} },
    '@main/decision/decisionHelper': { decisionHelper: helperStub }
  });
  assert.equal(DecisionHandler.name, 'DecisionHandler', 'class name = channel name `xpc:DecisionHandler/*`');
  assert.equal(emitterClass, DecisionHandler.name, 'the renderer module calls exactly this class');

  const handler = new DecisionHandler();
  const options = { threshold: 0.7 };
  const state = { s: 1 };
  const request = { state, questions: {} };
  assert.equal(await handler.enabled(), REPLY);
  assert.equal(await handler.judge({ request, options }), REPLY);
  assert.equal(await handler.choose({ question: PICK, state, options }), REPLY);
  assert.equal(await handler.check({ question: READY, state, options }), REPLY);
  assert.equal(await handler.score({ question: PICK, state }), REPLY);
  assert.deepEqual(forwarded.map(({ method }) => method), ['enabled', 'judge', 'choose', 'check', 'score']);
  const same = (actual, expected) => actual.length === expected.length && actual.every((arg, at) => arg === expected[at]);
  assert.ok(same(forwarded[0].args, []));
  assert.ok(same(forwarded[1].args, [request, options]), 'judge(request, options) — the very objects');
  assert.ok(same(forwarded[2].args, [PICK, state, options]), 'choose');
  assert.ok(same(forwarded[3].args, [READY, state, options]), 'check');
  assert.ok(same(forwarded[4].args, [PICK, state, undefined]), 'score without options');

  const registry = readFileSync(join(APP_ROOT, 'src/main/xpc/xpc.helper.ts'), 'utf8');
  assert.match(registry, /^import '\.\/decision\.handler';$/m, 'registered at main start-up');
  assert.doesNotMatch(registry, /jev\.handler/);
  assert.equal(existsSync(join(APP_ROOT, 'src/main/xpc/jev.handler.ts')), false, 'renamed, not copied');
});

// ── #5 source guards ────────────────────────────────────────────────────────────────────────────────

const sourceFiles = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|mts|mjs|vue)$/.test(entry) && !entry.endsWith('.d.ts')) out.push(path);
  }
  return out;
};
/** Every module specifier in a file: import / export … from, require(), import(). Vue files: their script blocks. */
const specifiersOf = (path) => {
  const code = readFileSync(path, 'utf8');
  const scripts = path.endsWith('.vue') ? [...code.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]) : [code];
  const found = [];
  for (const script of scripts) {
    const visit = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) found.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const callee = node.expression;
        if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) found.push(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(path, script, ts.ScriptTarget.Latest, true));
  }
  return found;
};

test('#5 source guard: jevDecision.service is imported by the main-process decision helper only', () => {
  const importers = sourceFiles(join(APP_ROOT, 'src'))
    .filter((path) => specifiersOf(path).some((spec) => /(^|\/)jevDecision\.service$/.test(spec)))
    .map((path) => relative(APP_ROOT, path));
  assert.deepEqual(importers, ['src/main/decision/decisionHelper.ts']);
});

test('#5 source guard: in the renderer and preload the DecisionHandler channel appears only in renderer/common/decision/decisionHelper.ts', () => {
  const mentions = [...sourceFiles(join(APP_ROOT, 'src/renderer')), ...sourceFiles(join(APP_ROOT, 'src/preload'))]
    .filter((path) => /DecisionHandler/.test(readFileSync(path, 'utf8')))
    .map((path) => relative(APP_ROOT, path));
  assert.deepEqual(mentions, ['src/renderer/common/decision/decisionHelper.ts']);
  const oldChannel = sourceFiles(join(APP_ROOT, 'src')).filter((path) => /JevHandler/.test(readFileSync(path, 'utf8').replace(/\/\/.*$/gm, '')));
  assert.deepEqual(oldChannel.map((path) => relative(APP_ROOT, path)), [], 'the old channel name is gone from code');
});
