// Fixture-driven tests for the vendored LAN IPv4 resolver and its resolve-once cache.
//
// The helper is bundled with esbuild and required as CJS — the `tests/zellij/*` idiom. Because
// `lanIp.helper.ts` has ZERO imports the bundle is trivial and needs no `external`, and because
// `LanIpCache` takes `read` / `platform` / `now` as constructor dependencies the cache contract is
// exercised with no `node:os` stubbing at all. A stubbed reader would otherwise assert against
// whatever network this machine happens to be on and go red on the next one.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';

import { pickCases } from './lanIp.cases.mjs';

const directory = mkdtempSync(join(tmpdir(), 'lan-ip-'));
test.after(() => rmSync(directory, { recursive: true, force: true }));

const outfile = join(directory, 'lanIp.cjs');
buildSync({
  entryPoints: ['src/shared/lanIp/lanIp.helper.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile
});
const { pickLanIpv4, LanIpCache } = createRequire(import.meta.url)(outfile);

const reverseKeys = (interfaces) =>
  Object.fromEntries(Object.entries(interfaces).reverse());

for (const testCase of pickCases) {
  test(testCase.name, () => {
    const pick = pickLanIpv4(testCase.interfaces, testCase.platform);
    assert.deepEqual(pick, testCase.expected);

    if (testCase.alsoReversedKeyOrder) {
      const reversed = pickLanIpv4(reverseKeys(testCase.interfaces), testCase.platform);
      assert.deepEqual(
        reversed,
        testCase.expected,
        'enumeration order must not change the winner — the sort is a total order'
      );
    }
  });
}

test('no sentinel address is ever emitted', () => {
  const forbidden = new Set(['0.0.0.0', '127.0.0.1', '', 'unknown', '-']);
  for (const testCase of pickCases) {
    const pick = pickLanIpv4(testCase.interfaces, testCase.platform);
    if (pick.status === 'ok') {
      assert.equal(forbidden.has(pick.address), false, `${testCase.name} emitted ${pick.address}`);
    }
  }
});

const makeCache = (tables, { platform = 'darwin', start = 1000 } = {}) => {
  const state = { reads: 0, clock: start };
  const cache = new LanIpCache({
    read: () => {
      const table = tables[Math.min(state.reads, tables.length - 1)];
      state.reads += 1;
      if (typeof table === 'function') return table();
      return table;
    },
    platform,
    now: () => {
      state.clock += 1;
      return state.clock;
    }
  });
  return { cache, state };
};

const WIFI = { en0: [{ address: '192.168.2.45', netmask: '255.255.252.0', family: 'IPv4', internal: false, cidr: '192.168.2.45/22' }] };
const OTHER_WIFI = { en0: [{ address: '10.1.2.3', netmask: '255.255.255.0', family: 'IPv4', internal: false, cidr: '10.1.2.3/24' }] };

test('the interface table is read once, however many times the state is asked for', () => {
  const { cache, state } = makeCache([WIFI]);

  const first = cache.state();
  const second = cache.state();

  assert.equal(state.reads, 1);
  assert.equal(first, second, 'later reads must return the identical cached snapshot');
  assert.equal(first.status, 'ok');
  assert.equal(first.address, '192.168.2.45');
});

test('refresh is the only re-resolve trigger, and resolvedAt moves only then', () => {
  const { cache, state } = makeCache([WIFI, OTHER_WIFI]);

  const first = cache.state();
  assert.equal(cache.state().resolvedAt, first.resolvedAt, 'a plain read must not restamp');

  const refreshed = cache.refresh();
  assert.equal(state.reads, 2);
  assert.notEqual(refreshed.resolvedAt, first.resolvedAt);
  assert.equal(refreshed.address, '10.1.2.3');

  assert.equal(cache.state().resolvedAt, refreshed.resolvedAt);
  assert.equal(state.reads, 2, 'a read after a refresh must come from the cache');
});

test('"no address" is cached — going offline is what the button is for', () => {
  const { cache, state } = makeCache([{}]);

  assert.equal(cache.state().status, 'none');
  assert.equal(cache.state().status, 'none');
  assert.equal(state.reads, 1);
});

test('a failed read is not an answer and is never cached', () => {
  const throwing = () => {
    throw new Error('EPERM: cannot enumerate interfaces');
  };
  const { cache, state } = makeCache([throwing, WIFI]);

  const originalError = console.error;
  console.error = () => {};
  let failed;
  try {
    failed = cache.state();
  } finally {
    console.error = originalError;
  }

  assert.equal(failed.status, 'error');
  assert.deepEqual(failed.others, []);
  assert.equal('address' in failed, false, 'the error snapshot must carry no address');
  assert.equal('message' in failed, false, 'no raw error text may cross the wire');

  const recovered = cache.state();
  assert.equal(state.reads, 2, 'the next read must retry rather than serve a cached failure');
  assert.equal(recovered.status, 'ok');
});

test('markStale invalidates lazily — the next read re-resolves, nothing is pushed', () => {
  const { cache, state } = makeCache([WIFI, OTHER_WIFI]);

  assert.equal(cache.state().address, '192.168.2.45');
  assert.equal(state.reads, 1);

  cache.markStale();
  assert.equal(state.reads, 1, 'marking stale must not resolve by itself');

  assert.equal(cache.state().address, '10.1.2.3');
  assert.equal(state.reads, 2);
});
