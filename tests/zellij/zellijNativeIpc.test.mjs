/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native Node test fixtures. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'bl-ipc-'));
const unixTest = process.platform === 'win32' ? test.skip : test;
const output = join(directory, 'ipc.cjs');
buildSync({
  stdin: {
    contents: `export * from './src/main/zellij/zellijNativeIpc.service'; export * from './src/main/zellij/zellijNativeProtocol';`,
    resolveDir: process.cwd()
  },
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  tsconfig: 'tsconfig.node.json'
});
const {
  ZellijNativeIpcService,
  ZellijNativeFrameDecoder,
  encodeZellijClientMessage,
  encodeZellijServerMessage,
  decodeZellijClientMessage,
  decodeZellijServerMessage,
  encodeZellijConnectedFrame,
  encodeZellijExitFrame,
  isZellijConnStatusFrame
} = createRequire(import.meta.url)(output);
test.after(() => rmSync(directory, { recursive: true, force: true }));

let nextSocket = 0;
const fixture = async (t, handle) => {
  const path = join(directory, `s${nextSocket++}`);
  const sockets = new Set();
  const messages = [];
  let connections = 0;
  const server = createServer((socket) => {
    connections++;
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    const frames = new ZellijNativeFrameDecoder(1024 * 1024);
    socket.on('data', (chunk) => {
      for (const body of frames.push(chunk)) {
        const message = decodeZellijClientMessage(body);
        messages.push(message);
        handle(socket, message);
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, resolve);
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return { path, messages, connections: () => connections };
};

test('proxy helpers use pinned protobuf variants and a native four-byte length', () => {
  const probe = encodeZellijClientMessage({ connStatus: {} });
  assert.equal(probe.toString('hex'), '020000006a00');
  assert.equal(encodeZellijClientMessage({ killSession: {} }).toString('hex'), '020000006200');
  assert.equal(encodeZellijConnectedFrame().toString('hex'), '020000002200');
  assert.equal(isZellijConnStatusFrame(probe.subarray(4)), true);
  assert.equal(
    isZellijConnStatusFrame(encodeZellijClientMessage({ killSession: {} }).subarray(4)),
    false
  );
  const denied = encodeZellijExitFrame('Session unavailable');
  assert.equal(denied.readUInt32LE(), denied.length - 4);
  assert.deepEqual(decodeZellijServerMessage(denied.subarray(4)).exit, {
    exitReason: 7,
    payload: 'Session unavailable'
  });
  assert.throws(() => isZellijConnStatusFrame(Buffer.from([0xff])));
  const remoteLayout = encodeZellijClientMessage({
    firstClientConnected: {
      cliAssets: {
        configFilePath: '/config.kdl',
        layout: { url: 'https://example.com/layout.kdl' }
      }
    }
  });
  assert.deepEqual(
    decodeZellijClientMessage(remoteLayout.subarray(4)).firstClientConnected.cliAssets.layout,
    {
      url: 'https://example.com/layout.kdl'
    }
  );
});

test('fragmented and coalesced native frames preserve exact payloads', () => {
  const one = encodeZellijConnectedFrame();
  const two = encodeZellijExitFrame('No longer available');
  const source = Buffer.concat([one, two]);
  const decoder = new ZellijNativeFrameDecoder(1024);
  const frames = [];
  for (const byte of source) frames.push(...decoder.push(Buffer.from([byte])));
  assert.deepEqual(frames, [one.subarray(4), two.subarray(4)]);
  assert.equal(decoder.incomplete, false);
  assert.deepEqual(new ZellijNativeFrameDecoder(1024).push(source), frames);
  const oversized = Buffer.alloc(4);
  oversized.writeUInt32LE(1025);
  assert.throws(() => new ZellijNativeFrameDecoder(1024).push(oversized), /frame length/);
  assert.throws(() => new ZellijNativeFrameDecoder(1024).push(Buffer.alloc(4)), /frame length/);
});

unixTest('exact metadata and health never contact an unresponsive sibling', async (t) => {
  const sibling = await fixture(t, () => {});
  const target = await fixture(t, (socket, message) => {
    if (message.message === 'connStatus') socket.write(encodeZellijConnectedFrame());
    if (message.message === 'action') {
      const result = message.action.action.listPanes ? '[{"id":3}]' : '{"id":7}';
      const response = Buffer.concat([
        encodeZellijServerMessage({ unblockInputThread: {} }),
        encodeZellijServerMessage({ log: { lines: [result] } })
      ]);
      socket.write(response.subarray(0, 3));
      socket.write(response.subarray(3));
    }
  });
  const client = new ZellijNativeIpcService(target.path);
  assert.equal(await client.probe(), 'ready');
  assert.equal(await client.listPanes(), '[{"id":3}]');
  assert.equal(await client.currentTabInfo(), '{"id":7}');
  assert.equal(sibling.connections(), 0);
  assert.equal(target.messages[1].action.isCliClient, true);
  assert.equal(target.messages[1].action.action.listPanes.outputJson, true);
});

unixTest('first client initialization precedes ConnStatus on one connection', async (t) => {
  const target = await fixture(t, (socket, message) => {
    if (message.message === 'connStatus') {
      setTimeout(() => socket.write(encodeZellijConnectedFrame()), 20);
    }
  });
  const client = new ZellijNativeIpcService(target.path, { timeoutMs: 5 });
  await client.firstClientConnected({
    configFilePath: '/profile/config.kdl',
    configDir: '/profile',
    cwd: '/chosen',
    layout: { builtinName: 'compact' },
    forceRunLayoutCommands: true
  });
  assert.equal(target.connections(), 1);
  assert.deepEqual(
    target.messages.map((message) => message.message),
    ['firstClientConnected', 'connStatus']
  );
  assert.deepEqual(target.messages[0].firstClientConnected.cliAssets.terminalWindowSize, {
    cols: 50,
    rows: 50
  });
  assert.equal(target.messages[0].firstClientConnected.cliAssets.cwd, '/chosen');
  assert.equal(
    target.messages[0].firstClientConnected.cliAssets.configFilePath,
    '/profile/config.kdl'
  );
  assert.equal(target.messages[0].firstClientConnected.cliAssets.layout.builtinName, 'compact');
});

unixTest('missing and refused sockets are absent, while requests preserve the error', async () => {
  const missing = new ZellijNativeIpcService(join(directory, 'missing'));
  assert.equal(await missing.probe(), 'absent');
  await assert.rejects(missing.listPanes(), { code: 'absent' });
  const stale = join(directory, 'refused');
  execFileSync(process.execPath, [
    '-e',
    `require('node:net').createServer().listen(process.argv[1], () => process.exit(0));`,
    stale
  ]);
  assert.equal(await new ZellijNativeIpcService(stale).probe(), 'absent');
  await assert.rejects(new ZellijNativeIpcService('invalid\0address').probe(), {
    code: 'unavailable'
  });
});

unixTest('total deadline expires despite continuous nonterminal responses', async (t) => {
  const target = await fixture(t, (socket) => {
    const interval = setInterval(
      () => socket.write(encodeZellijServerMessage({ unblockInputThread: {} })),
      5
    );
    socket.once('close', () => clearInterval(interval));
  });
  const start = Date.now();
  await assert.rejects(new ZellijNativeIpcService(target.path, { timeoutMs: 80 }).probe(), {
    code: 'timeout'
  });
  assert.ok(Date.now() - start < 1000);
});

unixTest('AbortSignal prevents unopened requests and cancels an active request', async (t) => {
  let entered;
  const accepted = new Promise((resolve) => {
    entered = resolve;
  });
  const target = await fixture(t, () => entered());
  const client = new ZellijNativeIpcService(target.path);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(client.probe({ signal: cancelled.signal }), { code: 'aborted' });
  assert.equal(target.connections(), 0);
  const controller = new AbortController();
  const pending = client.probe({ signal: controller.signal });
  const rejection = assert.rejects(pending, { code: 'aborted' });
  await accepted;
  controller.abort();
  await rejection;
});

unixTest(
  'EOF, truncated frames, malformed protobuf and oversized frames remain distinct from absence',
  async (t) => {
    for (const [payload, expected] of [
      [Buffer.alloc(0), 'disconnected'],
      [Buffer.from([2, 0]), 'protocol-error'],
      [Buffer.from([2, 0, 0, 0, 0x22]), 'protocol-error'],
      [Buffer.from([1, 0, 0, 0, 0xff]), 'protocol-error'],
      [Buffer.from([0, 0, 0, 1]), 'protocol-error']
    ]) {
      const target = await fixture(t, (socket) => socket.end(payload));
      await assert.rejects(new ZellijNativeIpcService(target.path).probe(), { code: expected });
    }
  }
);

unixTest(
  'native rejections omit native payloads and KillSession only accepts normal exit',
  async (t) => {
    const denied = await fixture(t, (socket) =>
      socket.write(encodeZellijExitFrame('Web access disabled'))
    );
    await assert.rejects(new ZellijNativeIpcService(denied.path).killSession(), {
      code: 'rejected',
      message: 'Zellij rejected the request'
    });
    const noTab = await fixture(t, (socket) =>
      socket.write(encodeZellijServerMessage({ logError: { lines: ['No active tab'] } }))
    );
    await assert.rejects(new ZellijNativeIpcService(noTab.path).currentTabInfo(), {
      code: 'rejected',
      message: 'Zellij rejected the request'
    });
    const killed = await fixture(t, (socket) =>
      socket.write(encodeZellijServerMessage({ exit: { exitReason: 1 } }))
    );
    await new ZellijNativeIpcService(killed.path).killSession();
    assert.equal(killed.messages[0].message, 'killSession');
  }
);
