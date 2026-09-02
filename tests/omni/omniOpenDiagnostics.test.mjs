import assert from 'node:assert/strict';
import test from 'node:test';
import { createOmniOpenDiagnostics } from '../../src/shared/omni/omniOpenDiagnostics.mjs';

test('Omni open diagnostics emit only fixed privacy-safe fields', () => {
  let now = 100;
  const lines = [];
  const diagnostics = createOmniOpenDiagnostics({
    clock: () => now,
    write: (line) => lines.push(line),
  });
  const trace = diagnostics.trace('open', {
    route: 'api',
    mode: 'cold',
    generation: 4,
    url: 'https://private.example',
    cellId: 'secret-cell',
    token: 'secret-token',
  });
  now = 125.9;
  trace.mark({
    phase: 'restore',
    totalCount: 6,
    browserCount: 2,
    miniAppCount: 4,
    path: '/private/path',
    error: new Error('secret'),
  });
  now = 151.2;
  trace.end({
    outcome: 'success',
    reason: 'none',
    pendingTopLoad: 0,
    pendingTopMount: 0,
    pendingBrowserLoad: 0,
    pendingBrowserMount: 0,
    payload: { query: 'secret' },
  });

  assert.deepEqual(lines, [
    '[omni-open] event=open-start tag=o1 route=api mode=cold generation=4',
    '[omni-open] event=open-stage tag=o1 phase=restore totalCount=6 browserCount=2 miniAppCount=4 elapsedMs=25 stageMs=25',
    '[omni-open] event=open-terminal tag=o1 outcome=success reason=none pendingTopLoad=0 pendingTopMount=0 pendingBrowserLoad=0 pendingBrowserMount=0 elapsedMs=51',
  ]);
  assert.doesNotMatch(
    lines.join('\n'),
    /private|secret|url|cellId|token|capability|query|path|error|payload/i,
  );
});

test('Omni renderer diagnostics cover fixed lifecycle/bootstrap phases', () => {
  const lines = [];
  const diagnostics = createOmniOpenDiagnostics({
    clock: () => 10,
    write: (line) => lines.push(line),
  });
  const phases = [
    'create',
    'load-start',
    'dom-ready',
    'load-finish',
    'load-fail',
    'unresponsive',
    'responsive',
    'process-gone',
    'renderer-script',
    'renderer-language',
    'renderer-import',
    'renderer-mount',
    'renderer-receipt',
    'layout-ready',
  ];
  const trace = diagnostics.trace('renderer', {
    parentTag: 'o1',
    role: 'control',
    generation: 2,
  }, 'r');
  for (const phase of phases) trace.mark({ phase, role: 'control' });
  trace.end({ outcome: 'ready', reason: 'none', role: 'control' });

  assert.equal(lines.length, phases.length + 2);
  for (const phase of phases) assert.match(lines.join('\n'), new RegExp(`phase=${phase}`));
  assert.match(lines.at(-1), /event=renderer-terminal tag=r1 role=control outcome=ready reason=none/);
});

test('Omni timeout summaries clamp counts and traces terminate once', () => {
  let now = 50;
  const lines = [];
  const diagnostics = createOmniOpenDiagnostics({
    clock: () => now,
    write: (line) => lines.push(line),
  });
  const trace = diagnostics.trace('open', { route: 'api', mode: 'cold', generation: 1 });
  now = -20;
  trace.mark({ phase: 'native', visible: false, focused: false });
  now = Number.POSITIVE_INFINITY;
  assert.equal(trace.end({
    outcome: 'timeout',
    reason: 'diagnostic-timeout',
    pendingTopLoad: -2,
    pendingTopMount: 1,
    pendingBrowserLoad: Number.MAX_SAFE_INTEGER,
    pendingBrowserMount: 3.9,
  }), true);
  assert.equal(trace.end({ outcome: 'success', reason: 'none' }), false);
  assert.equal(trace.mark({ phase: 'ready' }), false);
  assert.match(lines[1], /elapsedMs=0 stageMs=0$/);
  assert.match(
    lines[2],
    /pendingTopLoad=0 pendingTopMount=1 pendingBrowserLoad=1000000 pendingBrowserMount=3 elapsedMs=0$/,
  );
});

test('Omni deferred navigation records scheduled, start, and one terminal', () => {
  let now = 0;
  const lines = [];
  const diagnostics = createOmniOpenDiagnostics({
    clock: () => now,
    write: (line) => lines.push(line),
  });
  const trace = diagnostics.trace('navigation', { parentTag: 'o1', generation: 7 }, 'n');
  trace.mark({ phase: 'scheduled' });
  now = 5;
  trace.mark({ phase: 'start' });
  now = 12;
  assert.equal(trace.end({ outcome: 'success' }), true);
  assert.equal(trace.end({ outcome: 'failure' }), false);
  assert.deepEqual(lines, [
    '[omni-open] event=navigation-start tag=n1 parentTag=o1 generation=7',
    '[omni-open] event=navigation-stage tag=n1 phase=scheduled elapsedMs=0 stageMs=0',
    '[omni-open] event=navigation-stage tag=n1 phase=start elapsedMs=5 stageMs=5',
    '[omni-open] event=navigation-terminal tag=n1 outcome=success elapsedMs=12',
  ]);
});

test('Omni open diagnostics swallow clock and writer failures', () => {
  const diagnostics = createOmniOpenDiagnostics({
    clock: () => { throw new Error('clock failed'); },
    write: () => { throw new Error('writer failed'); },
  });
  const trace = diagnostics.trace('open', { route: 'api', mode: 'existing', generation: 0 });
  assert.equal(trace.mark({ phase: 'interactive' }), false);
  assert.equal(trace.end({ outcome: 'success', reason: 'none' }), false);
  assert.equal(trace.end({ outcome: 'failure', reason: 'create-fail' }), false);
  assert.equal(diagnostics.emit('not-allowlisted', { path: '/secret' }), false);
});
