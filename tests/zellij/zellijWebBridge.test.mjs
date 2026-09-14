/* eslint-disable @typescript-eslint/explicit-function-return-type -- Isolated Unix socket fixtures. */
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';

const folder = mkdtempSync(
  join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'bl177-bridge-')
);
const output = join(folder, 'bridge.cjs');
buildSync({
  stdin: {
    contents: `export * from './src/main/zellij/zellijWebBridge.service'; export * from './src/main/zellij/zellijNativeIpc.service';`,
    resolveDir: process.cwd()
  },
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  tsconfig: 'tsconfig.node.json'
});
const { ZellijWebBridgeService, ZellijNativeIpcService } = createRequire(import.meta.url)(output);
const unixTest = process.platform === 'win32' ? test.skip : test;
test.after(() => rmSync(folder, { recursive: true, force: true }));
const listen = (server, path) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, resolve);
  });

unixTest(
  'a transient bridge listen failure is retryable and never advertises a missing listener',
  async () => {
    const bridge = new ZellijWebBridgeService(() => {});
    const path = join(bridge.directory, 'contract_version_1', 'retry');
    const blocker = createServer();
    try {
      await listen(blocker, path);
      await assert.rejects(
        bridge.register('retry', join(folder, 'target')),
        (error) => error.code === 'EADDRINUSE'
      );
      await new Promise((resolve) => blocker.close(resolve));
      await bridge.register('retry', join(folder, 'target'));
      assert.equal(existsSync(path), true);
      assert.equal(await new ZellijNativeIpcService(path).probe(), 'ready');
    } finally {
      if (blocker.listening) await new Promise((resolve) => blocker.close(resolve));
      await bridge.stop();
    }
  }
);

unixTest(
  'many tombstones answer bridge discovery immediately without contacting failed native endpoints',
  async () => {
    const bridge = new ZellijWebBridgeService(() => {});
    try {
      const names = Array.from({ length: 24 }, (_, index) => `closed-${index}`);
      await Promise.all(names.map((name) => bridge.register(name, join(folder, 'missing-native'))));
      for (const name of names) bridge.retire(name);
      const started = Date.now();
      // Native discovery is sequential; this remains independent of upstream timeout/count.
      for (const name of names)
        assert.equal(
          await new ZellijNativeIpcService(
            join(bridge.directory, 'contract_version_1', name)
          ).probe(),
          'ready'
        );
      assert.ok(Date.now() - started < 1000);
      await assert.rejects(
        new ZellijNativeIpcService(
          join(bridge.directory, 'contract_version_1', names[0])
        ).listPanes(),
        (error) => error.code === 'rejected'
      );
    } finally {
      await bridge.stop();
    }
  }
);
