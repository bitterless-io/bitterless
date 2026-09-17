/* eslint-disable @typescript-eslint/explicit-function-return-type -- Isolated protocol fixtures. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';

const folder = mkdtempSync(join(tmpdir(), 'zellij-native-copy-'));
const output = join(folder, 'copy.cjs');
buildSync({
  stdin: {
    contents: `export * from './src/main/zellij/zellijNativeCopy.service'; export * from './src/main/zellij/zellijNativeProtocol';`,
    resolveDir: process.cwd()
  },
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs'
});
const {
  ZellijNativeCopyService,
  encodeZellijClientMessage,
  encodeZellijServerMessage,
  decodeZellijClientMessage,
  ZellijNativeFrameDecoder
} = createRequire(import.meta.url)(output);
test.after(() => rmSync(folder, { recursive: true, force: true }));
const body = (message) => encodeZellijServerMessage(message).subarray(4);
const marker = encodeZellijClientMessage({
  key: { rawBytes: [...Buffer.from('\x1b[99;9u')], isKittyKeyboardProtocol: true }
}).subarray(4);
const fence = body({ log: { lines: ['fixture-tab'] } });
const osc = (text) => `\x1b]52;c;${Buffer.from(text).toString('base64')}\x1b\\`;
const fixture = (options = {}) => {
  const sent = [];
  const service = new ZellijNativeCopyService((frame) => sent.push(frame), options);
  const request = (options = {}) => {
    const controller = new AbortController();
    let markers = 0;
    const result = service.request({
      signal: controller.signal,
      sendMarker: async () => {
        markers++;
        return true;
      },
      ...options
    });
    return { result, controller, markers: () => markers };
  };
  const render = (content) => service.consumeServerFrame(body({ render: { content } }));
  const begin = () => {
    assert.equal(service.consumeClientFrame(marker), true);
    assert.equal(service.consumeServerFrame(fence), true);
  };
  const finish = () => assert.equal(service.consumeServerFrame(fence), true);
  return { service, sent, request, render, begin, finish };
};

test('Copy uses the attached client and exactly two screen FIFO fences; prior OSC52 is ignored', async () => {
  const f = fixture();
  try {
    const request = f.request();
    f.render(osc('earlier automatic copy'));
    assert.equal(f.service.consumeClientFrame(marker), true);
    f.render(osc('queued before the first fence'));
    assert.equal(f.service.consumeServerFrame(fence), true);
    const text = '\ufeff中文 😀\nsecond line';
    const payload = osc(text);
    for (const character of payload)
      assert.equal(f.render(character), false, 'renders remain forwarded');
    f.finish();
    assert.equal(await request.result, text);
    const actions = new ZellijNativeFrameDecoder(8 * 1024 * 1024)
      .push(f.sent[0])
      .map(decodeZellijClientMessage);
    assert.deepEqual(
      actions.map((value) => Object.keys(value.action.action)[0]),
      ['queryTabNames', 'copy', 'queryTabNames']
    );
    for (const value of actions) {
      assert.equal(value.action.isCliClient, false);
      assert.equal(value.action.clientId, undefined);
    }
    // Pin the actual protobuf field numbers, not just our schema's symbolic names.
    assert.ok(f.sent[0].includes(Buffer.from([0xa2, 0x04, 0x00])), 'QueryTabNames = field 68');
    assert.ok(f.sent[0].includes(Buffer.from([0xd2, 0x03, 0x00])), 'Copy = field 58');
    const empty = f.request();
    f.begin();
    f.finish();
    assert.equal(await empty.result, '', 'no selection never reuses the earlier native text');
  } finally {
    f.service.dispose();
  }
});

test('each repeated copy requests fresh native text and accepts BEL termination', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 3; i++) {
      const request = f.request();
      f.begin();
      f.render(osc('same selection').replace('\x1b\\', '\x07'));
      f.finish();
      assert.equal(await request.result, 'same selection');
    }
    assert.equal(f.sent.length, 3);
  } finally {
    f.service.dispose();
  }
});

test('invalid, ambiguous, incomplete, and oversized OSC52 fail closed', async () => {
  const packets = [
    osc('one') + osc('two'),
    '\x1b]52;c;not-base64!\x07',
    '\x1b]52;c;/w==\x07',
    '\x1b]52;c;YQ\x07',
    '\x1b]52;c;YQ==',
    osc('a'.repeat(1024 * 1024 + 1)),
    '\x1b]52;c;' + 'a'.repeat(2 * 1024 * 1024 + 1),
    '\x1b]52;bad;YQ==\x07'
  ];
  for (const packet of packets) {
    const f = fixture();
    try {
      const request = f.request();
      f.begin();
      f.render(packet);
      // Invalid UTF-8 disables the copy peer, so a later fence is simply forwarded.
      f.service.consumeServerFrame(fence);
      assert.equal(await request.result, '');
    } finally {
      f.service.dispose();
    }
  }
});

test('canceled markers drain before the newest queued request; old markers never leak to shell', async () => {
  const f = fixture();
  try {
    const first = f.request();
    first.controller.abort();
    const superseded = f.request();
    const latest = f.request();
    assert.equal(await first.result, '');
    assert.equal(await superseded.result, '');
    assert.equal(latest.markers(), 0);
    assert.equal(f.service.consumeClientFrame(marker), true);
    assert.equal(f.sent.length, 0, 'canceled copy never triggers a native Copy');
    assert.equal(latest.markers(), 1);
    f.begin();
    f.render(osc('latest'));
    f.finish();
    assert.equal(await latest.result, 'latest');
    assert.equal(f.service.consumeClientFrame(marker), true, 'late markers are reserved');
    const normalKey = encodeZellijClientMessage({ key: { rawBytes: [3] } }).subarray(4);
    assert.equal(f.service.consumeClientFrame(normalKey), false, 'Ctrl+C is forwarded');
  } finally {
    f.service.dispose();
  }
});

test('aborting within the native fence drains both logs before starting another copy', async () => {
  const f = fixture();
  try {
    const first = f.request();
    f.begin();
    first.controller.abort();
    const second = f.request();
    f.render(osc('old'));
    f.finish();
    assert.equal(await first.result, '');
    assert.equal(second.markers(), 1);
    f.begin();
    f.render(osc('new'));
    f.finish();
    assert.equal(await second.result, 'new');
  } finally {
    f.service.dispose();
  }
});

test('missing page sender, disposal, abort, errors and timeout preserve the caller clipboard', async () => {
  const f = fixture({ timeoutMs: 20 });
  assert.equal(await f.request({ sendMarker: async () => false }).result, '');
  const controller = new AbortController();
  controller.abort();
  assert.equal(await f.request({ signal: controller.signal }).result, '');
  const timed = f.request();
  f.begin();
  assert.equal(await timed.result, '');
  assert.equal(f.service.consumeClientFrame(marker), true);
  assert.equal(await f.request().result, '', 'untagged late fences cannot satisfy another request');
  f.service.dispose();
  const error = fixture();
  const pending = error.request();
  error.begin();
  assert.equal(error.service.consumeServerFrame(body({ logError: { lines: ['error'] } })), false);
  assert.equal(await pending.result, '');
  error.service.dispose();
  const disposed = fixture();
  const active = disposed.request();
  const queued = disposed.request();
  disposed.service.dispose();
  assert.equal(await active.result, '');
  assert.equal(await queued.result, '');
});
