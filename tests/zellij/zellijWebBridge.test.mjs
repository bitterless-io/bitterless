/* eslint-disable @typescript-eslint/explicit-function-return-type -- Isolated Unix socket fixtures. */
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { once } from 'node:events';
import { buildSync } from 'esbuild';

const folder = mkdtempSync(
  join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'bl177-bridge-')
);
const output = join(folder, 'bridge.cjs');
buildSync({
  stdin: {
    contents: `export * from './src/main/zellij/zellijWebBridge.service'; export * from './src/main/zellij/zellijNativeIpc.service'; export * from './src/main/zellij/zellijNativeProtocol';`,
    resolveDir: process.cwd()
  },
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  tsconfig: 'tsconfig.node.json'
});
const {
  ZellijWebBridgeService,
  ZellijNativeIpcService,
  encodeZellijClientMessage,
  encodeZellijServerMessage,
  decodeZellijClientMessage,
  decodeZellijServerMessage,
  ZellijNativeFrameDecoder
} = createRequire(import.meta.url)(output);
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

const marker = () =>
  encodeZellijClientMessage({ key: { rawBytes: [...Buffer.from('\x1b[99;9u')] } });
const render = (text) => encodeZellijServerMessage({ render: { content: text } });
const selection = (text) => render(`\x1b]52;c;${Buffer.from(text).toString('base64')}\x1b\\`);
let fixtureId = 0;
const nativeFixture = async () => {
  const failures = [];
  const bridge = new ZellijWebBridgeService((session) => failures.push(session));
  const sockets = new Set();
  const clients = [];
  const waits = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    const decoder = new ZellijNativeFrameDecoder(8 * 1024 * 1024);
    const peer = { socket, frames: [], text: '中文 😀\nsecond line', hold: false };
    socket.on('data', (chunk) => {
      for (const body of decoder.push(chunk)) {
        const message = decodeZellijClientMessage(body);
        peer.frames.push(message);
        if (message.attachClient) {
          clients.push(peer);
          socket.write(render('ready'));
          waits.shift()?.(peer);
        } else if (!peer.hold && message.action?.action.queryTabNames) {
          const frame = encodeZellijServerMessage({ log: { lines: ['tab'] } });
          socket.write(frame.subarray(0, 2));
          socket.write(frame.subarray(2));
        } else if (!peer.hold && message.action?.action.copy && peer.text) {
          const frame = selection(peer.text);
          socket.write(frame.subarray(0, 7));
          socket.write(frame.subarray(7));
        }
      }
    });
  });
  const target = join(folder, `copy-${++fixtureId}`);
  await listen(server, target);
  await bridge.register('copy', target);
  const attach = async (session = 'copy') => {
    const attached = new Promise((resolve) => waits.push(resolve));
    const socket = createConnection(join(bridge.directory, 'contract_version_1', session));
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    const frames = [];
    const decoder = new ZellijNativeFrameDecoder(8 * 1024 * 1024);
    socket.on('data', (chunk) =>
      frames.push(...decoder.push(chunk).map(decodeZellijServerMessage))
    );
    await once(socket, 'connect');
    const frame = encodeZellijClientMessage({ attachClient: { isWebClient: true } });
    socket.write(frame.subarray(0, 1));
    socket.write(frame.subarray(1));
    const peer = await attached;
    return {
      socket,
      peer,
      frames,
      copy: (options = {}) =>
        bridge.copySelection(session, {
          signal: new AbortController().signal,
          sendMarker: async () => {
            socket.write(marker());
            return true;
          },
          ...options
        })
    };
  };
  const close = async () => {
    for (const socket of sockets) socket.destroy();
    await bridge.stop();
    await new Promise((resolve) => server.close(resolve));
  };
  return { bridge, target, clients, failures, attach, close };
};

unixTest(
  'fresh native Copy follows the attached peer through fragmentation and same-target prepare',
  async () => {
    const f = await nativeFixture();
    try {
      let sent = false;
      assert.equal(
        await f.bridge.copySelection('copy', {
          signal: new AbortController().signal,
          sendMarker: async () => {
            sent = true;
            return true;
          }
        }),
        ''
      );
      assert.equal(sent, false, 'no attached peer must not send a marker');
      const client = await f.attach();
      client.peer.socket.write(selection('old automatic selection'));
      assert.equal(await client.copy(), client.peer.text);
      await f.bridge.register('copy', f.target);
      assert.equal(
        await client.copy(),
        client.peer.text,
        'same target stays attached and eligible'
      );
      assert.equal(f.clients.length, 1, 'copy never opens a fresh native client');
      client.peer.text = '';
      assert.equal(await client.copy(), '');
      client.peer.socket.write(render('after copy'));
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(
        client.frames.some((frame) => frame.log),
        false,
        'copy fences stay inside Main'
      );
      assert.equal(
        client.frames.some((frame) => frame.render?.content === 'after copy'),
        true
      );
      assert.deepEqual(f.failures, []);
    } finally {
      await f.close();
    }
  }
);

unixTest(
  'overlapping peers cancel old requests, fail closed, then copy from the surviving new peer',
  async () => {
    const f = await nativeFixture();
    try {
      const old = await f.attach();
      const controller = new AbortController();
      let markerReady;
      const markerSent = new Promise((resolve) => {
        markerReady = resolve;
      });
      const pending = old.copy({
        signal: controller.signal,
        sendMarker: async () => {
          markerReady();
          return true;
        }
      });
      await markerSent;
      const current = await f.attach();
      current.peer.text = 'new peer';
      assert.equal(await pending, '');
      assert.equal(await current.copy(), '', 'two peers are ambiguous');
      const closed = once(old.peer.socket, 'close');
      old.socket.destroy();
      await closed;
      assert.equal(await current.copy(), 'new peer');
      assert.deepEqual(f.failures, []);
    } finally {
      await f.close();
    }
  }
);

unixTest(
  'retirement or target replacement cancels copy; another surface cannot supply the text',
  async () => {
    const f = await nativeFixture();
    try {
      await f.bridge.register('other', f.target);
      const other = await f.attach('other');
      other.peer.text = 'other surface';
      const current = await f.attach();
      assert.equal(await current.copy(), current.peer.text);
      assert.equal(await other.copy(), 'other surface');
      const pending = current.copy({ sendMarker: async () => true });
      await f.bridge.register('copy', `${f.target}-replacement`);
      assert.equal(await pending, '');
      assert.equal(await current.copy(), '');
      const pendingOther = other.copy({ sendMarker: async () => true });
      f.bridge.retire('other');
      assert.equal(await pendingOther, '');
      assert.deepEqual(f.failures, []);
    } finally {
      await f.close();
    }
  }
);

unixTest(
  'a copy timeout disables only copying on that peer and leaves native rendering healthy',
  async () => {
    const f = await nativeFixture();
    try {
      const client = await f.attach();
      client.peer.hold = true;
      assert.equal(await client.copy(), '');
      assert.equal(client.socket.destroyed, false);
      client.peer.socket.write(render('healthy after timeout'));
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(
        client.frames.some((frame) => frame.render?.content === 'healthy after timeout'),
        true
      );
      assert.deepEqual(f.failures, []);
      assert.equal(await client.copy(), '');
    } finally {
      await f.close();
    }
  }
);
