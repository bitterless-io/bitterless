/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';

const root = mkdtempSync(join(tmpdir(), 'zellij-directory-'));
const output = join(root, 'directory.cjs');
buildSync({
  entryPoints: ['src/main/zellij/zellijDirectory.service.ts'],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  tsconfig: 'tsconfig.node.json'
});
const { ZellijDirectoryService, activeZellijPaneDirectory } = createRequire(import.meta.url)(
  output
);
test.after(() => rmSync(root, { recursive: true, force: true }));
const tab = (floating = false, id = 1) =>
  JSON.stringify({ tab_id: id, are_floating_panes_visible: floating });
const pane = (cwd, extra = {}) => ({
  tab_id: 1,
  is_plugin: false,
  is_focused: true,
  is_floating: false,
  is_suppressed: false,
  is_selectable: true,
  exited: false,
  pane_cwd: cwd,
  ...extra
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const fixture = () => {
  const directory = mkdtempSync(join(root, 'case-'));
  const home = join(directory, 'home');
  const next = join(directory, 'next');
  mkdirSync(home);
  mkdirSync(next);
  const file = join(directory, 'state.json');
  const calls = [];
  const live = new Set();
  const dead = new Set();
  const cwds = new Map();
  const deps = {
    file,
    home,
    configFile: join(directory, 'config.kdl'),
    run: async (args, cwd) => {
      calls.push({ args, cwd });
      const name = args[args.indexOf('--session') + 1];
      if (args.includes('list-sessions'))
        return [...live]
          .map((s) => `${s} [Created 1s ago]`)
          .concat([...dead].map((s) => `${s} [Created 1s ago] (EXITED - attach to resurrect)`))
          .join('\n');
      if (args.includes('current-tab-info')) return tab();
      if (args.includes('list-panes')) return JSON.stringify([pane(cwds.get(name) ?? home)]);
      if (args.includes('--create-background')) {
        const session = args[args.indexOf('--create-background') + 1];
        live.add(session);
        cwds.set(session, cwd);
      }
      if (args.includes('kill-session')) {
        live.delete(args.at(-1));
        dead.add(args.at(-1));
      }
      if (args.includes('delete-session')) dead.delete(args.at(-1));
      return '';
    }
  };
  const service = new ZellijDirectoryService(deps);
  return { service, deps, home, next, file, calls, live, dead, cwds };
};

test('native tab and visible layer identify the one focused live terminal', () => {
  const panes = [
    pane('/right'),
    pane('/other-tab', { tab_id: 2 }),
    pane('/plugin', { is_plugin: true, is_floating: true }),
    pane('/hidden', { is_floating: true })
  ];
  assert.equal(activeZellijPaneDirectory(tab(), JSON.stringify(panes)), '/right');
  assert.equal(activeZellijPaneDirectory(tab(true), JSON.stringify(panes)), '/hidden');
  assert.equal(
    activeZellijPaneDirectory(tab(), JSON.stringify([pane('/one'), pane('/two')])),
    null
  );
  for (const extra of [
    { exited: true },
    { is_suppressed: true },
    { is_selectable: false },
    { pane_cwd: 'relative' }
  ])
    assert.equal(activeZellijPaneDirectory(tab(), JSON.stringify([pane('/x', extra)])), null);
  assert.equal(activeZellijPaneDirectory('bad', '[]'), null);
});

test('first session uses home, active cwd persists and new/restored sessions keep their identity', async () => {
  const f = fixture();
  await f.service.prepare('one');
  assert.equal(f.cwds.get('one'), f.home);
  f.service.activate('one');
  await f.service.refresh();
  f.cwds.set('one', f.next);
  await f.service.prepare('two');
  assert.equal(f.cwds.get('two'), f.next);
  assert.equal(JSON.parse(readFileSync(f.file, 'utf8')).cwd, f.next);
  const before = f.calls.filter((c) => c.args.includes('--create-background')).length;
  await f.service.prepare('one');
  assert.equal(f.calls.filter((c) => c.args.includes('--create-background')).length, before);
  const restarted = new ZellijDirectoryService(f.deps);
  assert.equal(restarted.directory(), f.next);
  await f.service.stop();
  rmSync(f.next, { recursive: true });
  assert.equal(restarted.directory(), f.home);
  assert.equal(
    f.calls.some((c) => c.args.includes('--default-cwd')),
    false
  );
});

test('missing/corrupt remembered data falls back home and observation transitions retain valid cwd', async () => {
  const f = fixture();
  writeFileSync(f.file, JSON.stringify({ cwd: join(f.home, 'gone') }));
  assert.equal(new ZellijDirectoryService(f.deps).directory(), f.home);
  writeFileSync(f.file, 'invalid');
  assert.equal(new ZellijDirectoryService(f.deps).directory(), f.home);
  f.cwds.set('one', f.next);
  f.service.activate('one');
  await f.service.refresh();
  f.cwds.set('one', '/a-directory-that-does-not-exist-176');
  await f.service.refresh();
  assert.equal(f.service.directory(), f.next);
  await f.service.stop();
});

test('old background observation cannot overwrite focus and new session takes a fresh non-overlapping sample', async () => {
  const f = fixture();
  const wait = deferred();
  const entered = deferred();
  const original = f.deps.run;
  let held = true;
  let inFlight = 0;
  let max = 0;
  f.deps.run = async (args, cwd) => {
    if (!args.includes('action')) return original(args, cwd);
    inFlight++;
    max = Math.max(max, inFlight);
    try {
      if (held && args.includes('list-panes')) {
        held = false;
        entered.resolve();
        await wait.promise;
        return JSON.stringify([pane(f.next)]);
      }
      return original(args, cwd);
    } finally {
      inFlight--;
    }
  };
  f.service.activate('old');
  await entered.promise;
  f.service.activate('new');
  wait.resolve();
  await f.service.refresh();
  await f.service.prepare('third');
  assert.equal(f.cwds.get('third'), f.home);
  assert.equal(max, 1);
  f.cwds.set('new', f.next);
  await f.service.prepare('fourth');
  assert.equal(f.cwds.get('fourth'), f.next);
  await f.service.stop();
});

test('explicit close waits for pending creation, kills and deletes only that exact session; reopen uses remembered cwd', async () => {
  const f = fixture();
  const wait = deferred();
  const entered = deferred();
  const original = f.deps.run;
  f.deps.run = async (args, cwd) => {
    if (args.includes('--create-background') && args.includes('closing')) {
      entered.resolve();
      await wait.promise;
    }
    return original(args, cwd);
  };
  f.live.add('unrelated');
  const creating = f.service.prepare('closing');
  await entered.promise;
  const closing = f.service.close('closing');
  wait.resolve();
  await creating;
  await closing;
  assert.equal(f.live.has('closing'), false);
  assert.equal(f.dead.has('closing'), false);
  assert.equal(f.live.has('unrelated'), true);
  assert.deepEqual(
    f.calls
      .filter((c) => c.args.includes('kill-session') || c.args.includes('delete-session'))
      .map((c) => c.args.slice(-2)),
    [
      ['kill-session', 'closing'],
      ['delete-session', 'closing']
    ]
  );
  f.cwds.set('unrelated', f.next);
  f.service.activate('unrelated');
  await f.service.prepare('closing');
  assert.equal(f.cwds.get('closing'), f.next);
  const count = f.calls.length;
  await f.service.stop();
  assert.equal(f.live.has('closing'), true);
  assert.equal(
    f.calls.slice(count).some((c) => c.args.includes('kill-session')),
    false
  );
});

test('closing before delayed session discovery prevents a late create', async () => {
  const f = fixture();
  const wait = deferred();
  const entered = deferred();
  const original = f.deps.run;
  let hold = true;
  f.deps.run = async (args, cwd) => {
    if (hold && args.includes('list-sessions')) {
      hold = false;
      entered.resolve();
      await wait.promise;
    }
    return original(args, cwd);
  };
  const preparing = f.service.prepare('closed');
  await entered.promise;
  const closing = f.service.close('closed');
  wait.resolve();
  await assert.rejects(preparing, /operation-failed/);
  await closing;
  assert.equal(f.live.has('closed'), false);
  assert.equal(
    f.calls.some((c) => c.args.includes('--create-background')),
    false
  );
});

test('close, queued reopen, then close again cannot create an orphan session', async () => {
  const f = fixture();
  const wait = deferred();
  const entered = deferred();
  const original = f.deps.run;
  await f.service.prepare('window');
  f.deps.run = async (args, cwd) => {
    if (args.includes('kill-session')) {
      entered.resolve();
      await wait.promise;
    }
    return original(args, cwd);
  };
  const closing = f.service.close('window');
  await entered.promise;
  const reopen = f.service.prepare('window');
  const secondClose = f.service.close('window');
  wait.resolve();
  await closing;
  await secondClose;
  await assert.rejects(reopen, /operation-failed/);
  assert.equal(f.live.has('window'), false);
  assert.equal(f.calls.filter((c) => c.args.includes('--create-background')).length, 1);
});

test('failed session enumeration is not mistaken for no sessions or followed by speculative attach', async () => {
  const f = fixture();
  f.deps.run = async (args) => {
    f.calls.push({ args });
    throw new Error('operation-failed');
  };
  await assert.rejects(f.service.prepare('new'), /operation-failed/);
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].args.includes('list-sessions'));
});

test('a stalled active cwd sample remains bounded and cannot block another native session', async () => {
  const f = fixture();
  const created = [];
  let cancel = () => {};
  f.deps.native = {
    exists: async () => false,
    create: async (name, cwd) => created.push({ name, cwd }),
    close: async () => {},
    metadata: () =>
      new Promise((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 40);
        cancel = () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        };
      }),
    stop: () => cancel()
  };
  f.service.activate('unresponsive');
  const started = Date.now();
  await f.service.prepare('healthy');
  assert.ok(Date.now() - started < 500);
  assert.deepEqual(created, [{ name: 'healthy', cwd: f.home }]);
  assert.equal(f.calls.length, 0, 'native path never invokes global CLI discovery');
  f.service.activate('unresponsive');
  await f.service.stop();
  assert.equal(f.service.directory(), f.home);
  assert.equal(f.calls.length, 0);
});

test('shutdown joins an explicit close admitted while pending preparation is being cancelled', async () => {
  const f = fixture();
  const preparingGate = deferred();
  const prepareEntered = deferred();
  const closingGate = deferred();
  const closeEntered = deferred();
  f.deps.native = {
    exists: async () => {
      prepareEntered.resolve();
      await preparingGate.promise;
      return true;
    },
    create: async () => assert.fail('cancelled preparation cannot create'),
    close: async () => {
      closeEntered.resolve();
      await closingGate.promise;
    },
    metadata: async () => '[]',
    stop: () => {}
  };
  const preparing = assert.rejects(f.service.prepare('pending'), /operation-failed/);
  await prepareEntered.promise;
  let stopped = false;
  const stopping = f.service.stop().then(() => (stopped = true));
  const closing = f.service.close('late-close');
  await closeEntered.promise;
  preparingGate.resolve();
  await preparing;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false);
  closingGate.resolve();
  await closing;
  await stopping;
  assert.equal(stopped, true);
});
