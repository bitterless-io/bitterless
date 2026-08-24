import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expectOnlyPreviewError, runtime, source } from './onlyPreviewCoreTest.helper.mjs';

test('strict contracts normalize only relative capabilities and preserve error envelopes', () => {
  const token = 'a'.repeat(64);
  assert.equal(runtime.parseOnlyPreviewHostToken(token), token);
  assert.equal(runtime.normalizeOnlyPreviewRelativePath('folder/file.txt'), 'folder/file.txt');
  assert.equal(runtime.normalizeOnlyPreviewRelativePath('', { allowEmpty: true }), '');
  for (const invalid of [
    '',
    '../secret',
    'folder/../secret',
    './file',
    '/tmp/file',
    'C:/file',
    'a\\b',
    'a//b'
  ]) {
    assert.throws(
      () => runtime.normalizeOnlyPreviewRelativePath(invalid),
      expectOnlyPreviewError('INVALID_INPUT')
    );
  }
  assert.deepEqual(
    runtime.parseOnlyPreviewFileRef({
      workspaceId: 'b'.repeat(64),
      relativePath: 'safe.txt',
      ignoredAbsolutePath: '/tmp/secret'
    }),
    {
      workspaceId: 'b'.repeat(64),
      relativePath: 'safe.txt'
    }
  );

  const success = runtime.onlyPreviewSuccess({ selected: true });
  assert.deepEqual(runtime.unwrapOnlyPreviewResult(success), { selected: true });
  const typed = new runtime.OnlyPreviewContractError('PATH_NOT_FOUND', 'gone');
  assert.deepEqual(runtime.onlyPreviewFailure(typed), {
    ok: false,
    error: { code: 'PATH_NOT_FOUND', message: 'gone' }
  });
  assert.deepEqual(runtime.onlyPreviewFailure(new Error('/private/path leaked')), {
    ok: false,
    error: {
      code: 'OPERATION_FAILED',
      message: 'OnlyPreview could not complete this operation.'
    }
  });
  assert.throws(
    () => runtime.unwrapOnlyPreviewResult(null),
    expectOnlyPreviewError('OPERATION_FAILED')
  );
});

test('Preview descriptors exclude local paths while the Shell workspace keeps its display path', () => {
  const sharedTypes = source('src/shared/onlypreview/onlyPreview.types.ts');
  const workspaceContract = sharedTypes.slice(
    sharedTypes.indexOf('export interface OnlyPreviewWorkspace'),
    sharedTypes.indexOf('export interface OnlyPreviewFileRef')
  );
  const descriptorContract = sharedTypes.slice(
    sharedTypes.indexOf('export interface OnlyPreviewDescriptor {'),
    sharedTypes.indexOf('export interface OnlyPreviewTextContent')
  );

  assert.match(workspaceContract, /displayPath: string;/);
  assert.doesNotMatch(descriptorContract, /displayPath|absolutePath|canonicalPath/);

  const safeDescriptor = runtime.cloneOnlyPreviewDescriptor(
    {
      workspaceId: 'workspace-capability',
      relativePath: 'nested/fixture.png',
      name: '/Users/ral/private/fixture.png',
      extension: '.png',
      kind: 'image',
      mimeType: 'image/png',
      language: '',
      size: 42,
      modifiedAt: 1,
      assetUrl: 'bitterless-preview://asset/token/fixture.png',
      displayPath: '/Users/ral/private/fixture.png',
      canonicalPath: '/Users/ral/private/fixture.png'
    },
    { includeAsset: false }
  );
  assert.deepEqual(safeDescriptor, {
    workspaceId: 'workspace-capability',
    relativePath: 'nested/fixture.png',
    name: 'fixture.png',
    extension: '.png',
    kind: 'image',
    mimeType: 'image/png',
    language: '',
    size: 42,
    modifiedAt: 1
  });
});

test('settings and preview bounds reject partial, extra, and unsafe values', () => {
  assert.equal(runtime.DEFAULT_ONLY_PREVIEW_SETTINGS.showHiddenFiles, true);
  assert.deepEqual(
    runtime.parseOnlyPreviewSettings({
      theme: 'light',
      editorFontSize: 16,
      wordWrap: true,
      showHiddenFiles: false,
      openFilesWithSingleClick: true
    }),
    {
      theme: 'light',
      editorFontSize: 16,
      wordWrap: true,
      showHiddenFiles: false,
      openFilesWithSingleClick: true
    }
  );
  for (const invalid of [
    null,
    {},
    { ...runtime.DEFAULT_ONLY_PREVIEW_SETTINGS, editorFontSize: 10 },
    { ...runtime.DEFAULT_ONLY_PREVIEW_SETTINGS, editorFontSize: 25 },
    { ...runtime.DEFAULT_ONLY_PREVIEW_SETTINGS, theme: 'dark' },
    { ...runtime.DEFAULT_ONLY_PREVIEW_SETTINGS, absolutePath: '/tmp/leak' }
  ]) {
    assert.throws(() => runtime.parseOnlyPreviewSettings(invalid));
  }
  assert.deepEqual(
    runtime.parseOnlyPreviewBounds({ x: 1.4, y: 2.7, width: 300.2, height: 400.8 }),
    {
      x: 1,
      y: 3,
      width: 300,
      height: 401
    }
  );
  assert.throws(() => runtime.parseOnlyPreviewBounds({ x: -1, y: 0, width: 1, height: 1 }));
  assert.throws(() => runtime.parseOnlyPreviewBounds({ x: 0, y: 0, width: Infinity, height: 1 }));
});

test('Settings hides the retired hidden-files control while preserving serialized compatibility', () => {
  const settingsApp = source('src/renderer/onlypreview/settings/src/App.vue');
  const settingsStore = source(
    'src/renderer/onlypreview/settings/src/onlyPreviewSettings.store.ts'
  );
  const i18n = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');
  const sharedTypes = source('src/shared/onlypreview/onlyPreview.types.ts');
  const sharedContract = source('src/shared/onlypreview/onlyPreview.contract.ts');

  assert.doesNotMatch(
    settingsApp,
    /onlypreview-hidden-files|onlypreview__hiddenFiles|showHiddenFiles|settings\.hiddenFiles/
  );
  assert.doesNotMatch(settingsStore, /setShowHiddenFiles|draft\.showHiddenFiles/);
  assert.doesNotMatch(i18n, /^\s*hiddenFiles(?:Hint)?:/m);

  assert.match(
    sharedTypes,
    /interface OnlyPreviewSettings \{[\s\S]*showHiddenFiles: boolean;[\s\S]*\}/
  );
  assert.match(sharedContract, /DEFAULT_ONLY_PREVIEW_SETTINGS[\s\S]*showHiddenFiles: true/);
  const parseSettings = sharedContract.slice(
    sharedContract.indexOf('export const parseOnlyPreviewSettings'),
    sharedContract.indexOf('export const cloneDefaultOnlyPreviewSettings')
  );
  assert.match(parseSettings, /'showHiddenFiles'/);
  assert.match(parseSettings, /typeof record\.showHiddenFiles !== 'boolean'/);
  assert.match(parseSettings, /showHiddenFiles: record\.showHiddenFiles/);
  assert.match(
    settingsStore,
    /committed: OnlyPreviewSettings = cloneDefaultOnlyPreviewSettings\(\)[\s\S]*draft: OnlyPreviewSettings = cloneDefaultOnlyPreviewSettings\(\)/
  );
  assert.match(settingsStore, /settings: \{ \.\.\.this\.draft \}/);
  assert.match(
    settingsStore,
    /this\.committed = \{ \.\.\.settings \};[\s\S]*this\.draft = \{ \.\.\.settings \};/
  );
});

test('dormant Electron acceptance tracks the two-view security and geometry contract', () => {
  const fixture = source('tests/onlypreview/fixtures/onlyPreviewApp.fixture.ts');
  const e2e = [
    'tests/onlypreview/specs/onlyPreview.spec.ts',
    'tests/onlypreview/specs/onlyPreviewActions.spec.ts',
    'tests/onlypreview/specs/onlyPreviewPreview.spec.ts',
    'tests/onlypreview/specs/onlyPreviewTest.helper.ts'
  ]
    .map(source)
    .join('\n');

  assert.match(fixture, /OnlyPreviewRendererMode = 'shell' \| 'preview'/);
  const graph = e2e.slice(
    e2e.indexOf("test('owns two secure views"),
    e2e.indexOf('const menuBar = await evaluateRenderer')
  );
  assert.match(graph, /expect\(graph\.children\)\.toHaveLength\(2\)/);
  for (const renderer of ['shell', 'preview']) {
    assert.ok(graph.includes(`onlypreview\\/${renderer}\\/index`));
  }
  assert.match(graph, /url\.includes\('\/onlypreview\/previewHeader\/'\)\)\)\.toBe\(false\)/);
  assert.match(graph, /webContentsId: view\.webContents\.id/);
  assert.match(graph, /osProcessId: view\.webContents\.getOSProcessId\(\)/);
  assert.match(
    graph,
    /new Set\(graph\.children\.map\(\(\{ webContentsId \}\) => webContentsId\)\)\.size/
  );
  assert.equal((graph.match(/new Set\(/g) ?? []).length, 1);
  assert.match(graph, /expect\(child\.webContentsId\)\.toBeGreaterThan\(0\)/);
  assert.match(graph, /expect\(child\.osProcessId\)\.toBeGreaterThan\(0\)/);
  assert.match(graph, /sandbox: true/);
  assert.match(
    graph,
    /contextIsolation: true,[\s\S]*nodeIntegration: false,[\s\S]*webSecurity: true/
  );

  const geometry = e2e.slice(
    e2e.indexOf('const compact = await app.evaluate'),
    e2e.indexOf("await sendInputs('preview'", e2e.indexOf('const compact = await app.evaluate'))
  );
  assert.match(
    geometry,
    /expect\(previewContent\?\.bounds\)\.toEqual\(\{[\s\S]*x: domBounds\.x,[\s\S]*y: domBounds\.y,[\s\S]*width: domBounds\.width,[\s\S]*height: domBounds\.height/
  );
  assert.match(
    geometry,
    /onlypreview__previewToolbar[\s\S]*toEqual\(\{ height: 43, hasHost: true \}\)/
  );
  assert.match(geometry, /onlypreview__previewContentHost/);
  assert.match(geometry, /bounds\.y\)\.toBe\(75\)/);

  const devTools = e2e.slice(
    e2e.indexOf("test('toggles detached Shell and Preview DevTools"),
    e2e.indexOf("test('renders immutable text", e2e.indexOf("test('toggles detached"))
  );
  assert.match(devTools, /\['shell', 'preview'\] as const/);
  assert.match(devTools, /sendShortcut\('preview', 'F12'\)/);
  assert.match(devTools, /expectDevTools\(true, true\)/);
  assert.match(devTools, /expectDevTools\(false, false\)/);
  assert.match(
    e2e,
    /locator\('\[name="onlypreview__hiddenFiles"\], #onlypreview-hidden-files'\)[\s\S]*\.toHaveCount\(0\)/
  );
});

test('Settings bounds constrain oversized persisted dimensions to the current parent display', () => {
  assert.deepEqual(
    runtime.resolveOnlyPreviewSettingsBounds({
      parentBounds: { x: 1920, y: 34, width: 1000, height: 700 },
      workArea: { x: 1920, y: 0, width: 1024, height: 768 },
      width: 1600,
      height: 1000,
      minWidth: 800,
      minHeight: 600
    }),
    { x: 1920, y: 0, width: 1024, height: 768 }
  );
  assert.deepEqual(
    runtime.resolveOnlyPreviewSettingsBounds({
      parentBounds: { x: 40, y: 30, width: 620, height: 440 },
      workArea: { x: 0, y: 0, width: 640, height: 480 },
      width: 1600,
      height: 1000,
      minWidth: 800,
      minHeight: 600
    }),
    // Full containment is impossible below the app minimum, so use the minimum at the origin.
    { x: 0, y: 0, width: 800, height: 600 }
  );
  assert.deepEqual(
    runtime.resolveOnlyPreviewSettingsBounds({
      parentBounds: { x: 100, y: 80, width: 1000, height: 700 },
      workArea: { x: 0, y: 0, width: 1440, height: 900 },
      width: 800,
      height: 600,
      minWidth: 800,
      minHeight: 600
    }),
    { x: 200, y: 130, width: 800, height: 600 }
  );
});
