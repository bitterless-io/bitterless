import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  E2ETargetDisplayResolutionError,
  resolveE2EWindowPlacement,
  showWindowWithE2EPlacement
} from '../../src/main/windows/e2eWindowPlacement.service.ts';
import { resolveE2ETargetDisplayLabel } from './e2eDisplayTarget.ts';

const displays = [
  {
    label: 'DELL U3223QE',
    workArea: { x: 0, y: 0, width: 2560, height: 1415 }
  },
  {
    label: 'DELL S2721QS',
    workArea: { x: 2560, y: -159, width: 2560, height: 1440 }
  }
];

const baseRequest = {
  isE2E: true,
  targetDisplayLabel: 'DELL S2721QS',
  displays,
  windowBounds: { x: 0, y: 0, width: 1200, height: 800 },
  minWidth: 800,
  minHeight: 600
};

test('production and unconfigured E2E runs keep normal placement', () => {
  assert.equal(resolveE2EWindowPlacement({ ...baseRequest, isE2E: false }), null);
  assert.equal(
    resolveE2EWindowPlacement({ ...baseRequest, targetDisplayLabel: undefined }),
    null
  );
});

test('exact display label centers normal bounds on a negative-coordinate display', () => {
  assert.deepEqual(resolveE2EWindowPlacement(baseRequest), {
    bounds: { x: 3240, y: 161, width: 1200, height: 800 },
    maximized: false,
    fullScreen: false
  });
});

test('configured label fails fast instead of falling back to another display', () => {
  assert.throws(
    () => resolveE2EWindowPlacement({ ...baseRequest, targetDisplayLabel: 'dell s2721qs' }),
    (error) => {
      assert.ok(error instanceof E2ETargetDisplayResolutionError);
      assert.match(error.message, /"dell s2721qs"/);
      assert.match(error.message, /"DELL U3223QE"/);
      assert.match(error.message, /"DELL S2721QS"/);
      return true;
    }
  );
});

test('ambiguous exact labels fail instead of selecting by display order', () => {
  assert.throws(
    () => resolveE2EWindowPlacement({
      ...baseRequest,
      displays: [displays[1], displays[1]]
    }),
    E2ETargetDisplayResolutionError
  );
});

test('target work area constrains size while preserving the declared minimum', () => {
  assert.deepEqual(
    resolveE2EWindowPlacement(
      {
        ...baseRequest,
        displays: [
          { label: 'DELL S2721QS', workArea: { x: -700, y: -500, width: 700, height: 500 } }
        ],
        windowBounds: { x: 0, y: 0, width: 3000, height: 2000 }
      }
    ),
    {
      bounds: { x: -700, y: -500, width: 800, height: 600 },
      maximized: false,
      fullScreen: false
    }
  );
});

test('E2E show normalizes mode and applies target bounds before first show', () => {
  const calls = [];
  const placement = resolveE2EWindowPlacement(baseRequest);
  assert.ok(placement);
  showWindowWithE2EPlacement(
    {
      isFullScreen: () => true,
      setFullScreen: (value) => calls.push(['setFullScreen', value]),
      isMaximized: () => true,
      unmaximize: () => calls.push(['unmaximize']),
      setBounds: (bounds) => calls.push(['setBounds', bounds]),
      show: () => calls.push(['show'])
    },
    placement
  );
  assert.deepEqual(calls, [
    ['setFullScreen', false],
    ['unmaximize'],
    ['setBounds', placement.bounds],
    ['show']
  ]);
});

test('runner env overrides the ignored local display preference', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'bl-e2e-display-'));
  try {
    mkdirSync(join(projectRoot, 'local'));
    writeFileSync(join(projectRoot, 'local', 'e2e-display-label'), 'DELL S2721QS\nignored\n');
    assert.equal(resolveE2ETargetDisplayLabel(projectRoot, {}), 'DELL S2721QS');
    assert.equal(
      resolveE2ETargetDisplayLabel(projectRoot, {
        BITTERLESS_E2E_DISPLAY_LABEL: '  Windows Test Display  '
      }),
      'Windows Test Display'
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('runner without env or local preference leaves routing unconfigured', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'bl-e2e-display-empty-'));
  try {
    assert.equal(resolveE2ETargetDisplayLabel(projectRoot, {}), undefined);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
