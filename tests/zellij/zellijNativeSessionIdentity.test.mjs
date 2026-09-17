/* eslint-disable @typescript-eslint/explicit-function-return-type -- Isolated ownership persistence/close fixtures. */
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = mkdtempSync('/tmp/zellij-owner-close-');
const output = join(root, 'session.cjs');
await build({
  entryPoints: ['src/main/zellij/zellijNativeSession.service.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: output,
  tsconfig: 'tsconfig.node.json',
  plugins: [{
    name: 'isolated-kernel-and-ipc',
    setup: (builder) => {
      builder.onLoad({ filter: /zellijNativeOwner\.service\.ts$/ }, (args) => ({
        contents: readFileSync(args.path, 'utf8').replace(
          'const execute = promisify(execFile);',
          'const execute = (...args) => globalThis.__nativeOwnerKernelState(...args);'
        ),
        loader: 'ts'
      }));
      builder.onLoad({ filter: /zellijNativeIpc\.service\.ts$/ }, () => ({
        contents: `
          export class ZellijNativeIpcError extends Error {}
          export class ZellijNativeIpcService {
            async killSession(options) {
              if (!options.verifyEndpoint()) throw new Error('operation-failed');
              await globalThis.__nativeOwnerClose();
            }
          }
        `,
        loader: 'ts'
      }));
    }
  }]
});
const { ZellijNativeSessionService } = createRequire(import.meta.url)(output);
test.after(() => rmSync(root, { recursive: true, force: true }));

const fixture = async (t, fields = {}, mappedPath = '/old-bundle-removed/zellij') => {
  const directory = mkdtempSync(join(root, 'case-'));
  const session = 'fixture';
  const socketDirectory = join(directory, 's');
  const socket = join(socketDirectory, 'contract_version_1', session);
  mkdirSync(join(socketDirectory, 'contract_version_1'), { recursive: true });
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socket, resolve);
  });
  const status = lstatSync(socket);
  const owner = {
    pid: 177,
    started: 'Sun Sep 13 16:00:00 2026',
    command: '/original-bundle/zellij --server ' + socket,
    executable: '/original-bundle/zellij',
    executableDevice: 17,
    executableInode: 23,
    device: status.dev,
    inode: status.ino,
    uid: process.getuid?.() ?? 0,
    ...fields
  };
  const ownershipFile = join(directory, 'owners.json');
  writeFileSync(ownershipFile, JSON.stringify({ [session]: owner }));
  const cacheDirectory = join(directory, 'cache');
  const cache = join(cacheDirectory, session);
  mkdirSync(cache, { recursive: true });
  let killed = 0;
  globalThis.__nativeOwnerKernelState = async (file, args) => {
    if (file === '/bin/ps')
      return { stdout: owner.uid + ' ' + (killed ? 'Z' : 'S') + ' ' + owner.started + ' ' + owner.command + '\n' };
    assert.equal(file, '/usr/sbin/lsof');
    assert.ok(args.includes('txt'), 'recorded ownership must not be replaced by fresh socket adoption');
    return { stdout: ['p177', '\nftxt', 'D0x11', 'i23', 'n' + mappedPath].join('\0') + '\0\n' };
  };
  globalThis.__nativeOwnerClose = async () => {
    killed += 1;
    await new Promise((resolve) => server.close(resolve));
  };
  const service = new ZellijNativeSessionService({
    socketDirectory,
    cacheDirectory,
    ownershipFile,
    binary: '/new-bundle/zellij',
    configFile: join(directory, 'config.kdl'),
    spawn: async () => { throw new Error('unexpected spawn'); }
  });
  t.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    delete globalThis.__nativeOwnerKernelState;
    delete globalThis.__nativeOwnerClose;
  });
  return { service, session, socket, cache, ownershipFile, kills: () => killed };
};

test('persisted ownership survives a missing old path and authorizes only its exact close', async (t) => {
  const f = await fixture(t);
  await f.service.close(f.session);
  assert.equal(f.kills(), 1);
  assert.equal(existsSync(f.socket), false);
  assert.equal(existsSync(f.cache), false);
  assert.deepEqual(JSON.parse(readFileSync(f.ownershipFile, 'utf8')), {});
});

test('wrong, partial and malformed persisted identities cannot send KillSession or remove cache', async (t) => {
  for (const fields of [
    { executableInode: 24 },
    { executableDevice: 18 },
    { executableInode: undefined },
    { executableDevice: undefined },
    { executableInode: '23' },
    { executableInode: 1.5 },
    { executableDevice: null, executableInode: null }
  ]) {
    await t.test(JSON.stringify(fields), async (t) => {
      const f = await fixture(t, fields);
      await assert.rejects(f.service.close(f.session), /operation-failed/);
      assert.equal(f.kills(), 0);
      assert.equal(existsSync(f.socket), true);
      assert.equal(existsSync(f.cache), true);
    });
  }
});

test('legacy persisted records retain strict image-path checks', async (t) => {
  await t.test('unchanged image', async (t) => {
    const executable = realpathSync(process.execPath);
    const f = await fixture(t, {
      executable,
      executableDevice: undefined,
      executableInode: undefined
    }, executable);
    await f.service.close(f.session);
    assert.equal(f.kills(), 1);
  });
  await t.test('moved image is unknown', async (t) => {
    const f = await fixture(t, {
      executableDevice: undefined,
      executableInode: undefined
    });
    await assert.rejects(f.service.close(f.session), /operation-failed/);
    assert.equal(f.kills(), 0);
    assert.equal(existsSync(f.cache), true);
  });
});

