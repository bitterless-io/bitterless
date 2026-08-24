import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { buildRoot, projectRoot } from './onlyPreviewSheetGridTest.helper.mjs';

test('SheetPreview controller reports workflow errors through Preview Store at its revision', async () => {
  globalThis.__onlyPreviewSheetErrors = [];
  const { createOnlyPreviewSheetPreviewStore } = await import(
    pathToFileURL(join(buildRoot, 'sheetPreviewStore.mjs')).href
  );
  const session = {
    requestLayout: async () => {
      throw new Error('controlled layout failure');
    },
    requestViewport: async () => assert.fail('a failed layout must not request a viewport'),
    query: async () => assert.fail('search was not requested'),
    next: async () => assert.fail('search was not requested'),
    previous: async () => assert.fail('search was not requested'),
    clear: async () => assert.fail('search was not requested'),
    reveal: async () => assert.fail('search was not requested'),
    dispose: () => undefined
  };
  const store = createOnlyPreviewSheetPreviewStore({
    session,
    manifest: {
      sheets: [{ id: 0, name: 'Sheet 1', rowCount: 1, columnCount: 1 }],
      acceptedCells: 1,
      coverage: { kind: 'complete' }
    },
    reportingRevision: '42',
    hooks: {
      getViewportMetrics: () => null,
      prepareViewport: async () => {},
      afterViewportInstall: async () => {},
      scrollToCell: () => false,
      reportReady: () => undefined
    }
  });

  assert.equal(await store.activateSheet(0), false);
  assert.deepEqual(globalThis.__onlyPreviewSheetErrors, [
    { revision: '42', errorCode: 'SHEET_PARSE_FAILED' }
  ]);
  delete globalThis.__onlyPreviewSheetErrors;
});

test('SheetPreview has no parameterized error event or parent-forwarded stale revision', () => {
  const component = readFileSync(
    join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/components/SheetPreview/SheetPreview.vue'
    ),
    'utf8'
  );
  const controller = readFileSync(
    join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/components/SheetPreview/SheetPreview.store.ts'
    ),
    'utf8'
  );
  const surface = readFileSync(
    join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue'
    ),
    'utf8'
  );

  assert.doesNotMatch(component, /error:\s*\[/);
  assert.doesNotMatch(component, /emit\(['"]error['"]/);
  assert.doesNotMatch(surface, /<SheetPreview[\s\S]*?@error=/);
  assert.match(controller, /reportSurfaceError\(this\.reportingRevision,/);
});
