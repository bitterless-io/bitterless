/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, renameSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(new URL('../..', import.meta.url).pathname);
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-preview-reader-build-'));
const bundlePath = join(buildRoot, 'preview-reader.mjs');

await build({
  stdin: {
    contents: `
      export { FileSearchPreviewReader } from './src/preload/fileSearch/fileSearchPreviewReader.service.ts';
      export {
        ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_IDENTITIES,
        ONLY_PREVIEW_READ_CHUNK_BYTES
      } from './src/shared/onlypreview/onlyPreviewPreviewReadRuntime.types.ts';
      export {
        ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_BYTES,
        ONLY_PREVIEW_MAX_DOCUMENT_TOTAL_BYTES
      } from './src/shared/onlypreview/onlyPreview.types.ts';
      export { OnlyPreviewContractError } from './src/shared/onlypreview/onlyPreview.contract.ts';
    `,
    resolveDir: projectRoot,
    sourcefile: 'onlyPreviewPreviewReaderTest.entry.ts',
    loader: 'ts'
  },
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});

const runtime = await import(pathToFileURL(bundlePath).href);
const {
  FileSearchPreviewReader,
  ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_BYTES,
  ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_IDENTITIES,
  ONLY_PREVIEW_MAX_DOCUMENT_TOTAL_BYTES,
  ONLY_PREVIEW_READ_CHUNK_BYTES,
  OnlyPreviewContractError
} = runtime;

const runtimeInstanceId = '123e4567-e89b-42d3-a456-426614174000';
const workspaceId = 'workspace-preview-reader';
const workspaceGeneration = 7;

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const withRoot = async (run) => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-preview-reader-'));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const write = (path, content = '') => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
};

const grant = (selectionRevision, relativePath) => ({
  grantId: `123e4567-e89b-42d3-a456-${String(selectionRevision).padStart(12, '0')}`,
  selectionRevision,
  workspaceId,
  workspaceGeneration,
  relativePath
});

const sessionId = (suffix) => `223e4567-e89b-42d3-a456-${String(suffix).padStart(12, '0')}`;

const expectError = (code) => (error) =>
  error instanceof OnlyPreviewContractError && error.code === code;

const bind = async (reader, root) => {
  await reader.bindWorkspace(workspaceId, workspaceGeneration, root);
};

test('generic Preview reader rejects every Office package kind before file access', async () => {
  await withRoot(async (root) => {
    const reader = new FileSearchPreviewReader();
    await bind(reader, root);
    for (const [index, extension] of ['xlsx', 'xlsm', 'docx', 'pptx'].entries()) {
      await assert.rejects(
        () => reader.prepare(runtimeInstanceId, grant(index + 1, `missing.${extension}`)),
        expectError('INVALID_INPUT')
      );
    }
    reader.dispose();
  });
});

test('text reads use exact sequential frames no larger than 512 KiB and close at EOF', async () => {
  await withRoot(async (root) => {
    const source = Buffer.alloc(ONLY_PREVIEW_READ_CHUNK_BYTES + 137, 0x61);
    write(join(root, 'notes.txt'), source);
    const reader = new FileSearchPreviewReader();
    await bind(reader, root);
    const prepared = await reader.prepare(runtimeInstanceId, grant(1, 'notes.txt'));
    const opened = await reader.open(runtimeInstanceId, {
      grantId: prepared.grantId,
      selectionRevision: prepared.selectionRevision,
      sessionId: sessionId(1),
      method: 'GET',
      source: { kind: 'selection' },
      start: 0,
      end: source.length - 1
    });

    assert.equal(opened.workspaceId, workspaceId);
    assert.equal(opened.relativePath, 'notes.txt');
    assert.equal(opened.eof, false);
    const first = await reader.readNext(
      runtimeInstanceId,
      prepared.grantId,
      prepared.selectionRevision,
      opened.sessionId,
      0
    );
    assert.equal(first.offset, 0);
    assert.equal(first.bytes.byteLength, ONLY_PREVIEW_READ_CHUNK_BYTES);
    assert.equal(first.eof, false);
    await assert.rejects(
      () =>
        reader.readNext(
          runtimeInstanceId,
          prepared.grantId,
          prepared.selectionRevision,
          opened.sessionId,
          first.bytes.byteLength + 1
        ),
      expectError('INVALID_INPUT')
    );
    const second = await reader.readNext(
      runtimeInstanceId,
      prepared.grantId,
      prepared.selectionRevision,
      opened.sessionId,
      first.bytes.byteLength
    );
    assert.equal(second.offset, first.bytes.byteLength);
    assert.equal(second.bytes.byteLength, 137);
    assert.equal(second.eof, true);
    assert.deepEqual(Buffer.concat([Buffer.from(first.bytes), Buffer.from(second.bytes)]), source);
    await assert.rejects(
      () =>
        reader.readNext(
          runtimeInstanceId,
          prepared.grantId,
          prepared.selectionRevision,
          opened.sessionId,
          source.length
        ),
      expectError('INVALID_INPUT')
    );
    reader.dispose();
  });
});

test('two range sessions over one prepared asset advance independently', async () => {
  await withRoot(async (root) => {
    const source = Buffer.alloc(900_000);
    for (let index = 0; index < source.length; index += 1) source[index] = index % 251;
    source.write('%PDF-1.7\n', 0, 'ascii');
    write(join(root, 'paper.pdf'), source);
    const reader = new FileSearchPreviewReader();
    await bind(reader, root);
    const prepared = await reader.prepare(runtimeInstanceId, grant(1, 'paper.pdf'));
    const leftRange = { start: 10, end: 550_000 };
    const rightRange = { start: 100_000, end: 800_000 };
    const [left, right] = await Promise.all([
      reader.open(runtimeInstanceId, {
        grantId: prepared.grantId,
        selectionRevision: prepared.selectionRevision,
        sessionId: sessionId(2),
        method: 'GET',
        source: { kind: 'selection' },
        ...leftRange
      }),
      reader.open(runtimeInstanceId, {
        grantId: prepared.grantId,
        selectionRevision: prepared.selectionRevision,
        sessionId: sessionId(3),
        method: 'GET',
        source: { kind: 'selection' },
        ...rightRange
      })
    ]);
    const [leftFirst, rightFirst] = await Promise.all([
      reader.readNext(
        runtimeInstanceId,
        prepared.grantId,
        prepared.selectionRevision,
        left.sessionId,
        leftRange.start
      ),
      reader.readNext(
        runtimeInstanceId,
        prepared.grantId,
        prepared.selectionRevision,
        right.sessionId,
        rightRange.start
      )
    ]);
    assert.deepEqual(
      Buffer.from(leftFirst.bytes),
      source.subarray(leftRange.start, leftRange.start + leftFirst.bytes.byteLength)
    );
    assert.deepEqual(
      Buffer.from(rightFirst.bytes),
      source.subarray(rightRange.start, rightRange.start + rightFirst.bytes.byteLength)
    );
    assert.equal(leftFirst.eof, false);
    assert.equal(rightFirst.eof, false);

    const [leftLast, rightLast] = await Promise.all([
      reader.readNext(
        runtimeInstanceId,
        prepared.grantId,
        prepared.selectionRevision,
        left.sessionId,
        leftRange.start + leftFirst.bytes.byteLength
      ),
      reader.readNext(
        runtimeInstanceId,
        prepared.grantId,
        prepared.selectionRevision,
        right.sessionId,
        rightRange.start + rightFirst.bytes.byteLength
      )
    ]);
    assert.equal(leftLast.eof, true);
    assert.equal(rightLast.eof, true);
    assert.deepEqual(
      Buffer.from(leftLast.bytes),
      source.subarray(leftRange.start + leftFirst.bytes.byteLength, leftRange.end + 1)
    );
    assert.deepEqual(
      Buffer.from(rightLast.bytes),
      source.subarray(rightRange.start + rightFirst.bytes.byteLength, rightRange.end + 1)
    );
    reader.dispose();
  });
});

test('exact session cancellation returns before a blocked frame and does not revoke its sibling', async () => {
  await withRoot(async (root) => {
    const source = Buffer.alloc(700_000, 0x42);
    source.write('%PDF-1.7\n', 0, 'ascii');
    write(join(root, 'blocked.pdf'), source);
    const reader = new FileSearchPreviewReader();
    await bind(reader, root);
    const prepared = await reader.prepare(runtimeInstanceId, grant(1, 'blocked.pdf'));
    const blocked = await reader.open(runtimeInstanceId, {
      grantId: prepared.grantId,
      selectionRevision: prepared.selectionRevision,
      sessionId: sessionId(4),
      method: 'GET',
      source: { kind: 'selection' },
      start: 0,
      end: source.length - 1
    });
    const sibling = await reader.open(runtimeInstanceId, {
      grantId: prepared.grantId,
      selectionRevision: prepared.selectionRevision,
      sessionId: sessionId(5),
      method: 'GET',
      source: { kind: 'selection' },
      start: 0,
      end: source.length - 1
    });

    const active = reader.sessions.get(blocked.sessionId);
    assert.ok(active, 'blocked session should be active');
    let releaseRead;
    let markEntered;
    const entered = new Promise((resolveEntered) => {
      markEntered = resolveEntered;
    });
    const gate = new Promise((resolveRead) => {
      releaseRead = resolveRead;
    });
    active.handle.read = async (buffer, offset, length) => {
      markEntered();
      await gate;
      buffer.fill(0x42, offset, offset + length);
      return { bytesRead: length, buffer };
    };
    const pending = reader.readNext(
      runtimeInstanceId,
      prepared.grantId,
      prepared.selectionRevision,
      blocked.sessionId,
      0
    );
    await entered;

    reader.cancel(prepared.grantId, prepared.selectionRevision, blocked.sessionId);
    assert.equal(reader.sessions.has(blocked.sessionId), false);
    assert.equal(reader.sessions.has(sibling.sessionId), true);
    releaseRead();
    await assert.rejects(() => pending, expectError('OPERATION_FAILED'));
    const siblingFrame = await reader.readNext(
      runtimeInstanceId,
      prepared.grantId,
      prepared.selectionRevision,
      sibling.sessionId,
      0
    );
    assert.equal(siblingFrame.bytes.byteLength, ONLY_PREVIEW_READ_CHUNK_BYTES);
    reader.cancel(prepared.grantId, prepared.selectionRevision, sibling.sessionId);
    reader.dispose();
  });
});

test('cancelling a pending open prevents its late handle from publishing a session', async () => {
  await withRoot(async (root) => {
    const source = Buffer.alloc(64, 0x41);
    source.write('%PDF-1.7\n', 0, 'ascii');
    write(join(root, 'late.pdf'), source);
    const reader = new FileSearchPreviewReader();
    await bind(reader, root);
    const prepared = await reader.prepare(runtimeInstanceId, grant(1, 'late.pdf'));
    const lateSessionId = sessionId(50);
    const requireSelectionCurrent = reader.requireSelectionCurrent.bind(reader);
    let releaseOpen;
    let markEntered;
    const entered = new Promise((resolveEntered) => {
      markEntered = resolveEntered;
    });
    const gate = new Promise((resolveOpen) => {
      releaseOpen = resolveOpen;
    });
    let firstCheck = true;
    reader.requireSelectionCurrent = async (selection) => {
      if (firstCheck) {
        firstCheck = false;
        markEntered();
        await gate;
      }
      await requireSelectionCurrent(selection);
    };

    const pending = reader.open(runtimeInstanceId, {
      grantId: prepared.grantId,
      selectionRevision: prepared.selectionRevision,
      sessionId: lateSessionId,
      method: 'GET',
      source: { kind: 'selection' },
      start: 0,
      end: source.length - 1
    });
    await entered;
    reader.cancel(prepared.grantId, prepared.selectionRevision, lateSessionId);
    releaseOpen();

    await assert.rejects(() => pending, expectError('OPERATION_FAILED'));
    assert.equal(reader.sessions.has(lateSessionId), false);
    assert.equal(reader.pendingOpens.has(lateSessionId), false);
    reader.dispose();
  });
});

test('HTML resources require pinned identities; HEAD is free and GET budget is non-refundable', async () => {
  await withRoot(async (root) => {
    write(join(root, 'site/index.html'), '<script src="asset.js"></script>');
    write(join(root, 'site/mutable.js'), 'first');
    const largeResource = write(join(root, 'site/large.bin'), 'x');
    truncateSync(largeResource, ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_BYTES);
    const reader = new FileSearchPreviewReader();
    await bind(reader, root);
    const prepared = await reader.prepare(runtimeInstanceId, grant(1, 'site/index.html'));

    await assert.rejects(
      () =>
        reader.open(runtimeInstanceId, {
          grantId: prepared.grantId,
          selectionRevision: prepared.selectionRevision,
          sessionId: sessionId(6),
          method: 'HEAD',
          source: { kind: 'document', requestPath: 'mutable.js' },
          start: 0,
          end: 4
        }),
      expectError('INVALID_INPUT')
    );
    const mutable = await reader.inspectDocumentResource(
      runtimeInstanceId,
      prepared.grantId,
      prepared.selectionRevision,
      'mutable.js'
    );
    assert.equal(mutable.size, 5);
    renameSync(join(root, 'site/mutable.js'), join(root, 'site/mutable.old.js'));
    write(join(root, 'site/mutable.js'), 'other');
    await assert.rejects(
      () =>
        reader.open(runtimeInstanceId, {
          grantId: prepared.grantId,
          selectionRevision: prepared.selectionRevision,
          sessionId: sessionId(7),
          method: 'HEAD',
          source: { kind: 'document', requestPath: 'mutable.js' },
          start: 0,
          end: 4
        }),
      expectError('PATH_NOT_FOUND')
    );

    const large = await reader.inspectDocumentResource(
      runtimeInstanceId,
      prepared.grantId,
      prepared.selectionRevision,
      'large.bin'
    );
    assert.equal(large.size, ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_BYTES);
    assert.equal(
      ONLY_PREVIEW_MAX_DOCUMENT_TOTAL_BYTES / ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_BYTES,
      4
    );
    for (let index = 0; index < 6; index += 1) {
      const head = await reader.open(runtimeInstanceId, {
        grantId: prepared.grantId,
        selectionRevision: prepared.selectionRevision,
        sessionId: sessionId(100 + index),
        method: 'HEAD',
        source: { kind: 'document', requestPath: 'large.bin' },
        start: 0,
        end: large.size - 1
      });
      assert.equal(head.eof, true);
    }
    for (let index = 0; index < 4; index += 1) {
      const body = await reader.open(runtimeInstanceId, {
        grantId: prepared.grantId,
        selectionRevision: prepared.selectionRevision,
        sessionId: sessionId(200 + index),
        method: 'GET',
        source: { kind: 'document', requestPath: 'large.bin' },
        start: 0,
        end: large.size - 1
      });
      assert.equal(body.eof, false);
      reader.cancel(prepared.grantId, prepared.selectionRevision, body.sessionId);
    }
    const postBudgetHead = await reader.open(runtimeInstanceId, {
      grantId: prepared.grantId,
      selectionRevision: prepared.selectionRevision,
      sessionId: sessionId(300),
      method: 'HEAD',
      source: { kind: 'document', requestPath: 'large.bin' },
      start: 0,
      end: large.size - 1
    });
    assert.equal(postBudgetHead.eof, true);
    await assert.rejects(
      () =>
        reader.open(runtimeInstanceId, {
          grantId: prepared.grantId,
          selectionRevision: prepared.selectionRevision,
          sessionId: sessionId(301),
          method: 'GET',
          source: { kind: 'document', requestPath: 'large.bin' },
          start: 0,
          end: 0
        }),
      expectError('OPERATION_FAILED')
    );

    const selection = reader.selections.get(prepared.grantId);
    assert.ok(selection);
    while (selection.resourceIdentities.size < ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_IDENTITIES) {
      const index = selection.resourceIdentities.size;
      selection.resourceIdentities.set(`synthetic-${index}`, {
        realPath: `/synthetic/${index}`,
        identity: selection.identity
      });
    }
    write(join(root, 'site/overflow.js'), 'overflow');
    await assert.rejects(
      () =>
        reader.inspectDocumentResource(
          runtimeInstanceId,
          prepared.grantId,
          prepared.selectionRevision,
          'overflow.js'
        ),
      expectError('OPERATION_FAILED')
    );
    reader.dispose();
  });
});
