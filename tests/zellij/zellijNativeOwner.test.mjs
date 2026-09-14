/* eslint-disable @typescript-eslint/explicit-function-return-type -- Isolated native ownership fixtures. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';

const root = mkdtempSync('/tmp/bl177-owner-');
const output = join(root, 'owner.cjs');
buildSync({
  entryPoints: ['src/main/zellij/zellijNativeOwner.service.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: output,
  tsconfig: 'tsconfig.node.json'
});
const { inspectZellijNativeOwner, isZellijNativeOwnerAlive, finishZellijNativeShutdown } =
  createRequire(import.meta.url)(output);
const stateOutput = join(root, 'owner-state.cjs');
buildSync({
  stdin: {
    contents: readFileSync('src/main/zellij/zellijNativeOwner.service.ts', 'utf8').replace(
      'const execute = promisify(execFile);',
      'const execute = (...args) => globalThis.__nativeOwnerKernelState(...args);'
    ),
    resolveDir: process.cwd(),
    sourcefile: 'src/main/zellij/zellijNativeOwner.service.ts',
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: stateOutput,
  tsconfig: 'tsconfig.node.json'
});
const stateOwner = createRequire(import.meta.url)(stateOutput);
const nativeTest = process.platform === 'darwin' ? test : test.skip;
test.after(() => rmSync(root, { recursive: true, force: true }));

const listener = async (t, titleBinary = process.execPath) => {
  const directory = mkdtempSync(join(root, 'socket-'));
  const socket = join(directory, 's');
  // A mutable title is deliberately indistinguishable from a native --server argv in ps.
  const script = `
    const net = require('node:net');
    process.title = process.argv[1] + ' --server ' + process.argv[2];
    const server = net.createServer();
    server.listen(process.argv[2], () => process.stdout.write('ready'));
  `;
  const child = spawn(process.execPath, ['-e', script, titleBinary, socket], {
    stdio: ['ignore', 'pipe', 'ignore']
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      child.kill('SIGKILL');
      await closed;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 3_000);
  try {
    const ready = await Promise.race([
      once(child.stdout, 'data'),
      once(child, 'close').then(() => {
        throw new Error('fixture child exited before listening');
      })
    ]);
    assert.equal(ready[0].toString(), 'ready');
  } finally {
    clearTimeout(timeout);
  }
  return { socket, child, titleBinary };
};

nativeTest(
  'mutable argv cannot make a Node socket owner pass as the bundled Zellij executable',
  async (t) => {
    const binary = join(process.cwd(), 'build/maestro-tools/zellij');
    assert.ok(existsSync(binary), 'the pinned binary must be staged for this regression');
    const fixture = await listener(t, binary);
    assert.equal(await inspectZellijNativeOwner(fixture.socket, binary), null);
    assert.equal(fixture.child.exitCode, null);
    assert.equal(fixture.child.signalCode, null);
    assert.equal(existsSync(fixture.socket), true);
  }
);

nativeTest(
  'exact executable image, UID, birth and socket identify a real owned fixture',
  async (t) => {
    const fixture = await listener(t);
    const owner = await inspectZellijNativeOwner(fixture.socket, process.execPath);
    assert.ok(owner);
    assert.equal(owner.pid, fixture.child.pid);
    assert.equal(owner.executable, realpathSync(process.execPath));
    assert.equal(owner.uid, process.getuid());
    assert.equal(await isZellijNativeOwnerAlive(owner), true);
  }
);

nativeTest(
  'an executable symlink with spaces resolves to the same actual process image',
  async (t) => {
    const binary = join(root, 'node binary link');
    symlinkSync(process.execPath, binary);
    const fixture = await listener(t, binary);
    const owner = await inspectZellijNativeOwner(fixture.socket, binary);
    assert.ok(owner);
    assert.equal(owner.executable, realpathSync(process.execPath));
    assert.equal(await isZellijNativeOwnerAlive(owner), true);
  }
);

nativeTest(
  'legacy records without an image remain unknown and cannot authorize socket cleanup',
  async (t) => {
    const fixture = await listener(t);
    const owner = await inspectZellijNativeOwner(fixture.socket, process.execPath);
    assert.ok(owner);
    const legacy = { ...owner };
    delete legacy.executable;
    await assert.rejects(isZellijNativeOwnerAlive(legacy), /operation-failed/);
    await assert.rejects(finishZellijNativeShutdown(fixture.socket, legacy), /operation-failed/);
    assert.equal(existsSync(fixture.socket), true);
    assert.equal(await isZellijNativeOwnerAlive(owner), true);
  }
);

nativeTest(
  'image and UID mismatches are unknown rather than proof of a dead recorded owner',
  async (t) => {
    const fixture = await listener(t);
    const owner = await inspectZellijNativeOwner(fixture.socket, process.execPath);
    assert.ok(owner);
    for (const changed of [
      { ...owner, executable: realpathSync('/bin/sh') },
      { ...owner, uid: owner.uid + 1 }
    ]) {
      await assert.rejects(isZellijNativeOwnerAlive(changed), /operation-failed/);
      await assert.rejects(finishZellijNativeShutdown(fixture.socket, changed), /operation-failed/);
    }
    assert.equal(existsSync(fixture.socket), true);
    assert.equal(await isZellijNativeOwnerAlive(owner), true);
  }
);

nativeTest(
  'confirmed fixture death is still reported as dead after executable auditing',
  async (t) => {
    const fixture = await listener(t);
    const owner = await inspectZellijNativeOwner(fixture.socket, process.execPath);
    assert.ok(owner);
    const closed = once(fixture.child, 'close');
    fixture.child.kill('SIGTERM');
    await closed;
    assert.equal(await isZellijNativeOwnerAlive(owner), false);
  }
);

const kernelFixture = (t, states) => {
  const identity = {
    pid: 177,
    started: 'Sun Sep 13 16:00:00 2026',
    command: '/fixture/zellij --server /fixture/socket',
    executable: process.execPath,
    uid: process.getuid?.() ?? 0
  };
  const calls = [];
  globalThis.__nativeOwnerKernelState = async (file, args) => {
    calls.push(file);
    if (file !== '/bin/ps') throw new Error('image lookup unavailable');
    assert.ok(args.includes('uid=,stat=,lstart=,command='));
    const state = states.length > 1 ? states.shift() : states[0];
    return {
      stdout: `${state.uid ?? identity.uid} ${state.status} ${identity.started} ${state.command ?? '(zellij)'}\n`,
      stderr: ''
    };
  };
  t.after(() => delete globalThis.__nativeOwnerKernelState);
  return { identity, calls };
};

test('a post-signal matching-birth exiting process waits for confirmed zombie state', async (t) => {
  const fixture = kernelFixture(t, [{ status: '?E' }, { status: 'Z' }]);
  assert.equal(await stateOwner.isZellijNativeOwnerAlive(fixture.identity), false);
  assert.deepEqual(fixture.calls, ['/bin/ps', '/bin/ps']);
});

test('an exiting flag that never reaches confirmed death remains unknown after bounded rechecks', async (t) => {
  const fixture = kernelFixture(t, [{ status: '?E' }]);
  await assert.rejects(stateOwner.isZellijNativeOwnerAlive(fixture.identity), /operation-failed/);
  assert.equal(fixture.calls.length, 11);
});

test('a zombie with a different UID cannot authorize recorded ownership cleanup', async (t) => {
  const fixture = kernelFixture(t, [{ status: 'Z', uid: (process.getuid?.() ?? 0) + 1 }]);
  await assert.rejects(stateOwner.isZellijNativeOwnerAlive(fixture.identity), /operation-failed/);
  assert.deepEqual(fixture.calls, ['/bin/ps']);
});

test('a live process with unavailable image metadata stays unknown rather than becoming dead', async (t) => {
  const fixture = kernelFixture(t, [
    { status: 'S', command: '/fixture/zellij --server /fixture/socket' }
  ]);
  await assert.rejects(stateOwner.isZellijNativeOwnerAlive(fixture.identity), /operation-failed/);
  assert.deepEqual(fixture.calls, ['/bin/ps', '/usr/sbin/lsof', '/bin/ps']);
});
