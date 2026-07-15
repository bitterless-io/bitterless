import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CoinWindowStateStore,
  isCoinWindowVisible,
  parseCoinWindowState,
  restoreCoinWindowState,
  type CoinDisplayBounds,
  type CoinPersistedWindowState,
} from '../../../src/main/coin/coinWindowState';

const display: CoinDisplayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
const state: CoinPersistedWindowState = {
  version: 1,
  bounds: { x: 100, y: 80, width: 1360, height: 860 },
  maximized: false,
};

test('rejects malformed or unusably small geometry', () => {
  assert.equal(parseCoinWindowState(null), null);
  assert.equal(parseCoinWindowState({ ...state, version: 2 }), null);
  assert.equal(
    parseCoinWindowState({ ...state, bounds: { ...state.bounds, width: 799 } }),
    null,
  );
  assert.equal(
    parseCoinWindowState({ ...state, bounds: { ...state.bounds, x: Number.NaN } }),
    null,
  );
});

test('restores geometry only when a connected display retains a usable grab area', () => {
  assert.equal(isCoinWindowVisible(state.bounds, [display]), true);
  assert.deepEqual(restoreCoinWindowState(state, [display]), state);
  assert.equal(
    restoreCoinWindowState(
      { ...state, bounds: { ...state.bounds, x: 4000, y: 3000 } },
      [display],
    ),
    null,
  );
});

test('writes owner-only atomic state and ignores malformed persisted data', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-coin-state-'));
  try {
    const store = new CoinWindowStateStore(root);
    assert.equal(store.save(state, [display]), true);
    assert.deepEqual(store.read([display]), state);
    assert.equal(JSON.parse(readFileSync(store.filePath, 'utf8')).version, 1);
    if (process.platform !== 'win32') {
      assert.equal(statSync(store.filePath).mode & 0o777, 0o600);
    }

    writeFileSync(store.filePath, '{ malformed', 'utf8');
    assert.equal(store.read([display]), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
