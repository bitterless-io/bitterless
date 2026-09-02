import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'onlypreview-global-contract-'));
const bundlePath = join(buildRoot, 'contract.mjs');

await build({
  entryPoints: [join(projectRoot, 'tests/onlypreview/globalSearch.runtime.entry.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});

const runtime = await import(pathToFileURL(bundlePath).href);
after(() => rmSync(buildRoot, { recursive: true, force: true }));

const request = {
  hostToken: 'host-token',
  workspaceId: 'workspace-token',
  generation: 2,
  requestId: 'request-token',
  query: 'needle',
  maxResults: 500,
  scope: { kind: 'directory', relativePath: 'src' }
};
const file = (index = 0) => ({
  section: 'files',
  resultToken: `file-token-${index}`,
  name: `file-${index}.md`,
  relativePath: `src/file-${index}.md`,
  parentRelativePath: 'src',
  nodeKind: 'file',
  previewHint: 'text',
  mediaType: 'text'
});
const content = (index = 0) => ({
  section: 'contents',
  resultToken: `content-token-${index}`,
  fileName: `file-${index}.md`,
  relativePath: `src/file-${index}.md`,
  parentRelativePath: 'src',
  mediaType: 'text',
  contentMatch: { snippetText: 'before needle after', highlightStart: 7, highlightLength: 6 }
});

test('Global Search request and token-only preview request keep exact relative shapes', () => {
  assert.deepEqual(runtime.parseOnlyPreviewSearchRequest(request), request);
  const preview = {
    hostToken: request.hostToken,
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    resultToken: 'opaque-result-token'
  };
  assert.deepEqual(runtime.parseOnlyPreviewGlobalSearchPreviewRequest(preview), preview);
  for (const invalid of [
    { ...preview, relativePath: 'src/file.md' },
    { ...preview, resultToken: '' },
    { ...preview, absolutePath: '/private/file.md' },
    { ...preview, generation: -1 }
  ]) {
    assert.throws(
      () => runtime.parseOnlyPreviewGlobalSearchPreviewRequest(invalid),
      (error) => error?.code === 'INVALID_INPUT'
    );
  }
});

test('Global Search Office read requests are exact and offset-bound', () => {
  const officeRead = {
    hostToken: request.hostToken,
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    resultToken: 'office-result-token',
    readGrant: 'office-read-grant'
  };
  assert.deepEqual(runtime.parseOnlyPreviewGlobalSearchOfficeReadRequest(officeRead), officeRead);
  assert.deepEqual(
    runtime.parseOnlyPreviewGlobalSearchOfficeReadChunkRequest({
      ...officeRead,
      offset: 512 * 1024
    }),
    { ...officeRead, offset: 512 * 1024 }
  );
  for (const invalid of [
    { ...officeRead, readGrant: '' },
    { ...officeRead, offset: 0 },
    { ...officeRead, relativePath: 'private.xlsx' }
  ]) {
    assert.throws(
      () => runtime.parseOnlyPreviewGlobalSearchOfficeReadRequest(invalid),
      (error) => error?.code === 'INVALID_INPUT'
    );
  }
  assert.throws(
    () => runtime.parseOnlyPreviewGlobalSearchOfficeReadChunkRequest({ ...officeRead, offset: -1 }),
    (error) => error?.code === 'INVALID_INPUT'
  );
});

test('relay validators require strict independent Files and Contents sections', () => {
  const expectation = {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId
  };
  const response = {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    files: [file()],
    contents: [content()],
    filesTruncated: false,
    contentsTruncated: false
  };
  assert.equal(runtime.isOnlyPreviewGlobalSearchResponse(response, expectation), true);
  assert.equal(
    runtime.isOnlyPreviewGlobalSearchResponse({ ...response, results: [] }, expectation),
    false
  );
  assert.equal(
    runtime.isOnlyPreviewGlobalSearchResponse(
      { ...response, files: Array.from({ length: 251 }, (_, index) => file(index)) },
      expectation
    ),
    false
  );
  assert.equal(
    runtime.isOnlyPreviewGlobalSearchResponse(
      { ...response, contents: [{ ...content(), relativePath: '/private/file.md' }] },
      expectation
    ),
    false
  );

  const presentationFile = {
    ...file(),
    name: 'slides.pptx',
    relativePath: 'src/slides.pptx',
    previewHint: 'presentation',
    mediaType: 'unknown'
  };
  assert.equal(
    runtime.isOnlyPreviewGlobalSearchResponse(
      { ...response, files: [presentationFile], contents: [] },
      expectation
    ),
    true
  );
});

test('preview variants are bounded and never carry authority paths', () => {
  assert.equal(
    runtime.isOnlyPreviewGlobalSearchPreview({
      kind: 'text',
      adapter: 'markdown',
      name: 'readme.md',
      text: '# safe',
      truncated: false
    }),
    true
  );
  assert.equal(
    runtime.isOnlyPreviewGlobalSearchPreview({
      kind: 'info',
      name: 'manual.pdf',
      previewHint: 'pdf',
      mediaType: 'pdf',
      size: 10,
      modifiedAt: 1,
      absolutePath: '/private/manual.pdf'
    }),
    false
  );
  assert.equal(
    runtime.isOnlyPreviewGlobalSearchPreview({
      kind: 'text',
      adapter: 'plain',
      name: 'large.txt',
      text: 'x'.repeat(256 * 1024 + 1),
      truncated: true
    }),
    false
  );
  assert.equal(
    runtime.isOnlyPreviewGlobalSearchPreview({
      kind: 'context',
      name: 'readme.md',
      before: 'before ',
      match: 'needle',
      after: ' after',
      truncated: false
    }),
    false
  );
  const expectation = {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    resultToken: 'office-result-token',
    readGrant: 'office-read-grant',
    offset: 0
  };
  const office = {
    kind: 'office',
    adapter: 'xlsx',
    name: 'book.xlsm',
    sourceExtension: '.xlsm',
    size: 1024,
    modifiedAt: 1,
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    resultToken: expectation.resultToken,
    readGrant: expectation.readGrant
  };
  assert.equal(runtime.isOnlyPreviewGlobalSearchPreview(office, expectation), true);
  assert.equal(
    runtime.isOnlyPreviewGlobalSearchPreview({ ...office, sourceExtension: '.pptx' }, expectation),
    false
  );
  assert.equal(
    runtime.isOnlyPreviewGlobalSearchPreview({ ...office, absolutePath: '/private/book.xlsm' }),
    false
  );
  const opened = {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    resultToken: expectation.resultToken,
    readGrant: expectation.readGrant,
    totalBytes: 4
  };
  assert.equal(runtime.isOnlyPreviewGlobalSearchOfficeReadOpenResult(opened, expectation), true);
  assert.equal(
    runtime.isOnlyPreviewGlobalSearchOfficeReadChunkResult(
      {
        ...opened,
        totalBytes: undefined,
        offset: 0,
        bytes: new Uint8Array([1, 2]).buffer,
        eof: false
      },
      expectation
    ),
    false
  );
  assert.equal(
    runtime.isOnlyPreviewGlobalSearchOfficeReadChunkResult(
      {
        workspaceId: request.workspaceId,
        generation: request.generation,
        requestId: request.requestId,
        resultToken: expectation.resultToken,
        readGrant: expectation.readGrant,
        offset: 0,
        bytes: new Uint8Array([1, 2]).buffer,
        eof: false
      },
      expectation
    ),
    true
  );
});
