/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(new URL('../..', import.meta.url).pathname);
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-content-read-'));
const bundlePath = join(buildRoot, 'onlypreview-content-preload.mjs');
const originalArgv = process.argv;

const hostToken = 'host-token-for-onlypreview-content-test';
const previewRuntimeToken = 'preview-runtime-token-for-content-test';
const officeBrokerCapability = 'office-broker-capability-for-content-test';
const previewBrokerCapability = 'preview-broker-capability-for-content-test';
const selectionRevision = 17;
const runtimeInstanceId = 'hidden-preview-reader-runtime';
const grantId = 'preview-grant-17';
const sessionId = 'preview-session-17';
const maxTextBytes = 8 * 1024 * 1024;
const maxChunkBytes = 512 * 1024;

globalThis.__onlyPreviewContentReadHarness = {
  bridges: new Map(),
  emitterCount: 0,
  broker: null,
  expose(name, value) {
    this.bridges.set(name, value);
  },
  createEmitter() {
    this.emitterCount += 1;
    return new Proxy(
      {},
      {
        get:
          (_target, method) =>
          (...args) => {
            const operation = this.broker?.[method];
            if (typeof operation !== 'function') {
              throw new Error(`Unexpected broker operation: ${String(method)}`);
            }
            return operation(...args);
          }
      }
    );
  }
};

await build({
  entryPoints: [join(projectRoot, 'src/preload/onlypreview/onlypreviewContent.preload.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.node.json'),
  plugins: [
    {
      name: 'onlypreview-content-read-stubs',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^electron$/ }, () => ({
          path: 'electron',
          namespace: 'onlypreview-content-read-test'
        }));
        buildContext.onLoad(
          { filter: /^electron$/, namespace: 'onlypreview-content-read-test' },
          () => ({
            contents: `
              export const contextBridge = {
                exposeInMainWorld: (name, value) =>
                  globalThis.__onlyPreviewContentReadHarness.expose(name, value)
              };
            `
          })
        );
        buildContext.onResolve({ filter: /^electron-xpc\/preload$/ }, () => ({
          path: 'electron-xpc-preload',
          namespace: 'onlypreview-content-read-test'
        }));
        buildContext.onLoad(
          { filter: /^electron-xpc-preload$/, namespace: 'onlypreview-content-read-test' },
          () => ({
            contents: `
              export const createXpcPreloadEmitter = () =>
                globalThis.__onlyPreviewContentReadHarness.createEmitter();
            `
          })
        );
      }
    }
  ]
});

process.argv = [
  originalArgv[0],
  originalArgv[1],
  '--onlypreview-mode=preview',
  `--onlypreview-host-token=${hostToken}`,
  '--onlypreview-host-id=onlypreview-content-test-host',
  `--onlypreview-runtime-token=${previewRuntimeToken}`,
  `--onlypreview-office-broker-capability=${officeBrokerCapability}`,
  `--onlypreview-read-broker-capability=${previewBrokerCapability}`
];
await import(pathToFileURL(bundlePath).href);
process.argv = originalArgv;

const bridge = globalThis.__onlyPreviewContentReadHarness.bridges.get('onlyPreviewPreviewRead');
assert.ok(bridge, 'The preview text bridge was not exposed.');
assert.equal(globalThis.__onlyPreviewContentReadHarness.emitterCount, 2);

after(() => {
  process.argv = originalArgv;
  delete globalThis.__onlyPreviewContentReadHarness;
  rmSync(buildRoot, { recursive: true, force: true });
});

const success = (value) => ({ ok: true, value });

const toArrayBuffer = (value) => {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const createOpenResult = (totalBytes, overrides = {}) => ({
  runtimeInstanceId,
  grantId,
  selectionRevision,
  workspaceId: 'workspace-id',
  relativePath: 'notes/readme.md',
  sessionId,
  method: 'GET',
  start: 0,
  end: totalBytes === 0 ? -1 : totalBytes - 1,
  totalBytes,
  eof: totalBytes === 0,
  ...overrides
});

const createChunk = (bytes, offset, eof, overrides = {}) => ({
  runtimeInstanceId,
  grantId,
  selectionRevision,
  sessionId,
  offset,
  bytes: toArrayBuffer(bytes),
  eof,
  ...overrides
});

const installBroker = ({ bytes, chunks, openOverrides = {}, chunkOverride, chunkFactory }) => {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const frameSizes = chunks ?? [source.byteLength];
  const calls = { opens: [], reads: [], cancels: [] };
  let frameIndex = 0;
  globalThis.__onlyPreviewContentReadHarness.broker = {
    async openCurrentPreviewText(request) {
      calls.opens.push(request);
      return success(createOpenResult(source.byteLength, openOverrides));
    },
    async readCurrentPreviewTextChunk(request) {
      calls.reads.push(request);
      const requestedLength = frameSizes[frameIndex] ?? source.byteLength - request.offset;
      const frame = source.subarray(request.offset, request.offset + requestedLength);
      const eof = request.offset + frame.byteLength === source.byteLength;
      const result = createChunk(frame, request.offset, eof, chunkOverride);
      const customized = chunkFactory
        ? chunkFactory({ frameIndex, request, result, source })
        : result;
      frameIndex += 1;
      return success(customized);
    },
    async cancelCurrentPreviewText(request) {
      calls.cancels.push(request);
      return success(undefined);
    }
  };
  return calls;
};

const expectedIdentity = {
  brokerCapability: previewBrokerCapability,
  hostToken,
  previewRuntimeToken,
  selectionRevision
};

const assertScopedCancel = (calls) => {
  assert.deepEqual(calls.cancels, [
    {
      ...expectedIdentity,
      grantId,
      sessionId
    }
  ]);
};

test('assembles split UTF-8 frames before decoding an emoji exactly once', async () => {
  const encoded = new TextEncoder().encode('A😀B');
  const calls = installBroker({ bytes: encoded, chunks: [3, 1, 2] });
  const NativeTextDecoder = globalThis.TextDecoder;
  const decoderCalls = [];
  globalThis.TextDecoder = class {
    constructor(...args) {
      decoderCalls.push({ args, decodes: 0 });
      this.entry = decoderCalls.at(-1);
      this.decoder = new NativeTextDecoder(...args);
    }

    decode(...args) {
      this.entry.decodes += 1;
      return this.decoder.decode(...args);
    }
  };
  try {
    const result = await bridge.readCurrentText({ selectionRevision });
    assert.deepEqual(result, {
      ok: true,
      value: {
        workspaceId: 'workspace-id',
        relativePath: 'notes/readme.md',
        text: 'A😀B',
        encoding: 'utf-8',
        size: encoded.byteLength
      }
    });
  } finally {
    globalThis.TextDecoder = NativeTextDecoder;
  }
  assert.deepEqual(
    decoderCalls.map(({ args, decodes }) => ({ encoding: args[0], decodes })),
    [{ encoding: 'utf-8', decodes: 1 }]
  );
  assert.deepEqual(
    calls.reads.map(({ offset }) => offset),
    [0, 3, 4]
  );
  assert.deepEqual(calls.opens, [expectedIdentity]);
  assert.deepEqual(calls.cancels, []);
});

test('decodes UTF-8, UTF-16LE, and UTF-16BE BOM payloads after assembly', async (context) => {
  const text = 'BOM 中文';
  const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
  const utf16leBody = new Uint8Array(Buffer.from(text, 'utf16le'));
  const utf16beBody = new Uint8Array(utf16leBody.length);
  for (let index = 0; index < utf16leBody.length; index += 2) {
    utf16beBody[index] = utf16leBody[index + 1];
    utf16beBody[index + 1] = utf16leBody[index];
  }
  for (const fixture of [
    { name: 'UTF-8', bytes: utf8, encoding: 'utf-8' },
    {
      name: 'UTF-16LE',
      bytes: new Uint8Array([0xff, 0xfe, ...utf16leBody]),
      encoding: 'utf-16le'
    },
    {
      name: 'UTF-16BE',
      bytes: new Uint8Array([0xfe, 0xff, ...utf16beBody]),
      encoding: 'utf-16be'
    }
  ]) {
    await context.test(fixture.name, async () => {
      const calls = installBroker({ bytes: fixture.bytes, chunks: [1, 2, fixture.bytes.length] });
      const result = await bridge.readCurrentText({ selectionRevision });
      assert.equal(result.ok, true);
      assert.equal(result.value.text, text);
      assert.equal(result.value.encoding, fixture.encoding);
      assert.equal(result.value.size, fixture.bytes.byteLength);
      assert.deepEqual(calls.cancels, []);
    });
  }
});

test('accepts exactly 8 MiB and rejects a larger open before reading with scoped cancel', async () => {
  const atLimit = new Uint8Array(maxTextBytes).fill(0x61);
  const accepted = installBroker({
    bytes: atLimit,
    chunks: Array.from({ length: maxTextBytes / maxChunkBytes }, () => maxChunkBytes)
  });
  const acceptedResult = await bridge.readCurrentText({ selectionRevision });
  assert.equal(acceptedResult.ok, true);
  assert.equal(acceptedResult.value.size, maxTextBytes);
  assert.equal(acceptedResult.value.text.length, maxTextBytes);
  assert.equal(accepted.reads.length, maxTextBytes / maxChunkBytes);
  assert.deepEqual(accepted.cancels, []);

  const tooLarge = installBroker({ bytes: new Uint8Array(0) });
  tooLarge.opens.length = 0;
  globalThis.__onlyPreviewContentReadHarness.broker.openCurrentPreviewText = async (request) => {
    tooLarge.opens.push(request);
    return success(createOpenResult(maxTextBytes + 1));
  };
  const rejectedResult = await bridge.readCurrentText({ selectionRevision });
  assert.equal(rejectedResult.ok, false);
  assert.equal(rejectedResult.error.code, 'INVALID_INPUT');
  assert.deepEqual(tooLarge.reads, []);
  assertScopedCancel(tooLarge);
});

test('rejects malformed frames, offsets, echoes, and early EOF with exact session cancel', async (context) => {
  const source = new TextEncoder().encode('abcdef');
  const cases = [
    {
      name: 'malformed frame',
      mutate: ({ result }) => ({ ...result, bytes: new Uint8Array(result.bytes) })
    },
    {
      name: 'wrong offset',
      mutate: ({ result }) => ({ ...result, offset: result.offset + 1 })
    },
    {
      name: 'wrong echo',
      mutate: ({ result }) => ({ ...result, grantId: 'forged-grant' })
    },
    {
      name: 'early EOF',
      chunks: [2],
      mutate: ({ result }) => ({ ...result, eof: true })
    }
  ];
  for (const fixture of cases) {
    await context.test(fixture.name, async () => {
      const calls = installBroker({
        bytes: source,
        chunks: fixture.chunks,
        chunkFactory: fixture.mutate
      });
      const result = await bridge.readCurrentText({ selectionRevision });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'INVALID_INPUT');
      assert.equal(calls.reads.length, 1);
      assertScopedCancel(calls);
    });
  }
});
