/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-drawio-session-'));
const bundlePath = join(buildRoot, 'drawio-session.mjs');

await build({
  stdin: {
    contents: `
      export { OnlyPreviewContractError } from './src/shared/onlypreview/onlyPreview.contract';
      export { OnlyPreviewDrawioSession } from './src/renderer/onlypreview/preview/src/onlyPreviewDrawio.service';
    `,
    loader: 'ts',
    resolveDir: projectRoot,
    sourcefile: 'onlyPreviewDrawioSession.test-entry.ts'
  },
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json')
});

const runtime = await import(pathToFileURL(bundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const xml = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>';
const bytes = Buffer.from(xml);

const responseFor = (body = bytes) =>
  new Response(body, {
    status: 200,
    headers: { 'content-length': String(body.byteLength) }
  });

class FakeWorker {
  listeners = new Map();
  terminated = false;
  request = null;
  onPost = null;

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(request) {
    this.request = request;
    this.onPost?.(request);
  }

  terminate() {
    this.terminated = true;
  }

  emit(type, value) {
    for (const listener of this.listeners.get(type) ?? []) listener(value);
  }
}

const expectCode = (code) => (error) =>
  error instanceof runtime.OnlyPreviewContractError && error.code === code;

test('fetches exact bytes and accepts only the exact identity-bound Worker response', async () => {
  const worker = new FakeWorker();
  worker.onPost = (request) => {
    queueMicrotask(() =>
      worker.emit('message', {
        data: {
          hostId: request.hostId,
          runtimeId: request.runtimeId,
          selectionRevision: request.selectionRevision,
          workerGeneration: request.workerGeneration,
          requestId: request.requestId,
          type: 'preflight-ready',
          bytes: request.bytes,
          pageCount: 1,
          cellCount: 1
        }
      })
    );
  };
  const session = new runtime.OnlyPreviewDrawioSession({
    hostId: 'host-id',
    selectionRevision: 7,
    fetchImpl: async () => responseFor(),
    workerFactory: () => worker
  });
  assert.deepEqual(await session.load('bitterless-preview://asset/token', bytes.byteLength), {
    xml,
    pageCount: 1,
    cellCount: 1
  });
  assert.equal(worker.terminated, true);
});

test('dispose immediately settles and terminates a pending Worker preflight', async () => {
  const worker = new FakeWorker();
  const session = new runtime.OnlyPreviewDrawioSession({
    hostId: 'host-id',
    selectionRevision: 8,
    fetchImpl: async () => responseFor(),
    workerFactory: () => worker,
    timeoutMs: 60_000
  });
  const pending = session.load('bitterless-preview://asset/token', bytes.byteLength);
  while (!worker.request) await new Promise((resolve) => setImmediate(resolve));
  session.dispose();
  await assert.rejects(pending, expectCode('DIAGRAM_RENDER_TIMEOUT'));
  assert.equal(worker.terminated, true);
});

test('times out a non-responsive Worker once and rejects malformed Worker envelopes', async () => {
  const timeoutWorker = new FakeWorker();
  const timeoutSession = new runtime.OnlyPreviewDrawioSession({
    hostId: 'host-id',
    selectionRevision: 9,
    fetchImpl: async () => responseFor(),
    workerFactory: () => timeoutWorker,
    timeoutMs: 5
  });
  await assert.rejects(
    timeoutSession.load('bitterless-preview://asset/token', bytes.byteLength),
    expectCode('DIAGRAM_RENDER_TIMEOUT')
  );
  assert.equal(timeoutWorker.terminated, true);

  const invalidWorker = new FakeWorker();
  invalidWorker.onPost = () => {
    queueMicrotask(() =>
      invalidWorker.emit('message', {
        data: { type: 'preflight-ready', bytes: new ArrayBuffer(0) }
      })
    );
  };
  const invalidSession = new runtime.OnlyPreviewDrawioSession({
    hostId: 'host-id',
    selectionRevision: 10,
    fetchImpl: async () => responseFor(),
    workerFactory: () => invalidWorker
  });
  await assert.rejects(
    invalidSession.load('bitterless-preview://asset/token', bytes.byteLength),
    expectCode('DIAGRAM_PARSE_FAILED')
  );
  assert.equal(invalidWorker.terminated, true);
});

test('rejects size/content-length drift before starting a Worker', async () => {
  let workerCreated = false;
  const session = new runtime.OnlyPreviewDrawioSession({
    hostId: 'host-id',
    selectionRevision: 11,
    fetchImpl: async () => responseFor(Buffer.from('short')),
    workerFactory: () => {
      workerCreated = true;
      return new FakeWorker();
    }
  });
  await assert.rejects(
    session.load('bitterless-preview://asset/token', bytes.byteLength),
    expectCode('DIAGRAM_PARSE_FAILED')
  );
  assert.equal(workerCreated, false);
});
