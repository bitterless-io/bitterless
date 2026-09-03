/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = process.cwd();
const source = (relativePath) => readFileSync(join(root, relativePath), 'utf8');
const nodeRequire = createRequire(import.meta.url);

const loadTypeScriptModule = (relativePath, dependencies = {}) => {
  const transpiled = ts.transpileModule(source(relativePath), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    fileName: relativePath,
    reportDiagnostics: true
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  assert.deepEqual(
    errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    []
  );
  const loaded = { exports: {} };
  const localRequire = (specifier) => {
    if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
    if (specifier.startsWith('.') || specifier.startsWith('@')) {
      throw new Error(`Missing test dependency ${specifier} for ${relativePath}`);
    }
    return nodeRequire(specifier);
  };
  const execute = new Function(
    'require',
    'module',
    'exports',
    `${transpiled.outputText}\n//# sourceURL=${join(root, relativePath)}`
  );
  execute(localRequire, loaded, loaded.exports);
  return loaded.exports;
};

const tick = () => new Promise((resolve) => setImmediate(resolve));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const loadShortcutPredicate = (windowHelperSource, predicateName, platform) => {
  const marker = `const ${predicateName} = (input: Input): boolean => {`;
  const markerIndex = windowHelperSource.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${predicateName} must remain a standalone predicate`);
  const bodyStart = markerIndex + marker.length;
  const bodyEnd = windowHelperSource.indexOf('\n};', bodyStart);
  assert.notEqual(bodyEnd, -1, `${predicateName} body must be complete`);
  const execute = new Function(
    'input',
    'isCommandModifier',
    'process',
    windowHelperSource.slice(bodyStart, bodyEnd)
  );
  return (input) =>
    execute(
      input,
      (candidate) => (platform === 'darwin' ? candidate.meta : candidate.control),
      { platform }
    );
};

const shortcutInput = (platform, overrides = {}) => ({
  type: 'keyDown',
  isAutoRepeat: false,
  key: 'f',
  shift: false,
  alt: false,
  control: platform !== 'darwin',
  meta: platform === 'darwin',
  ...overrides
});

const sharedTypes = loadTypeScriptModule('src/shared/onlypreview/onlyPreview.types.ts');
const entryName = loadTypeScriptModule('src/shared/onlypreview/onlyPreviewEntryName.shared.ts');
const contract = loadTypeScriptModule('src/shared/onlypreview/onlyPreview.contract.ts', {
  './onlyPreviewEntryName.shared': entryName
});
const hostToken = 'host-token-123456789';
const hostId = 'host-for-find-tests';

const readyState = (overrides = {}) => ({
  state: 'ready',
  hostId,
  selectionRevision: 3,
  surface: 'vue',
  findRevision: 0,
  capability: { mode: 'content-adapter', adapter: 'monaco' },
  coverage: { kind: 'complete' },
  ...overrides
});

const success = (value) => ({ ok: true, value });

const createDenseModel = (value) => ({
  getValue: () => value,
  getValueLength: () => value.length,
  getPositionAt: (offset) => ({ lineNumber: 1, column: offset + 1 }),
  getOffsetAt: ({ column }) => column - 1,
  findNextMatch: (query, position, _isRegex, caseSensitive) => {
    const start = position.column - 1;
    const haystack = caseSensitive ? value : value.toLocaleLowerCase();
    const needle = caseSensitive ? query : query.toLocaleLowerCase();
    const nextIndex = haystack.indexOf(needle, start);
    const index = nextIndex < 0 ? haystack.indexOf(needle) : nextIndex;
    if (index < 0) return null;
    return {
      range: {
        startLineNumber: 1,
        startColumn: index + 1,
        endLineNumber: 1,
        endColumn: index + query.length + 1
      }
    };
  },
  findPreviousMatch: (query, position, _isRegex, caseSensitive) => {
    const start = position.column - 1;
    const haystack = caseSensitive ? value : value.toLocaleLowerCase();
    const needle = caseSensitive ? query : query.toLocaleLowerCase();
    const index =
      start <= 0
        ? haystack.lastIndexOf(needle)
        : haystack.lastIndexOf(needle, Math.max(0, start - 1));
    if (index < 0) return null;
    return {
      range: {
        startLineNumber: 1,
        startColumn: index + 1,
        endLineNumber: 1,
        endColumn: index + query.length + 1
      }
    };
  }
});

test('Monaco adapter counts dense models beyond 999 with one active decoration and no editor selection', async () => {
  const monacoModule = loadTypeScriptModule(
    'src/renderer/onlypreview/preview/src/onlyPreviewMonacoFind.service.ts'
  );
  const decorationSizes = [];
  let clearCount = 0;
  const revealed = [];
  let selectionCalls = 0;
  const editor = {
    createDecorationsCollection: () => ({
      set: (items) => decorationSizes.push(items.length),
      clear: () => {
        clearCount += 1;
      }
    }),
    revealRangeInCenter: (range) => revealed.push(range),
    setSelection: () => {
      selectionCalls += 1;
      throw new Error('find highlighting must not mutate the user selection');
    }
  };
  const matchCount = 8 * 1024 * 1024;
  const adapter = monacoModule.createOnlyPreviewMonacoFindAdapter(
    editor,
    createDenseModel('a'.repeat(matchCount))
  );
  const first = await adapter.execute({
    hostId,
    selectionRevision: 1,
    surface: 'vue',
    findRevision: 1,
    query: 'a',
    caseSensitive: true,
    direction: 'forward',
    findNext: true,
    adapter: 'monaco'
  });
  assert.deepEqual(first, {
    activeMatchOrdinal: 1,
    matches: matchCount,
    finalUpdate: true,
    coverage: { kind: 'complete' }
  });
  const second = await adapter.execute({
    hostId,
    selectionRevision: 1,
    surface: 'vue',
    findRevision: 2,
    query: 'a',
    caseSensitive: true,
    direction: 'forward',
    findNext: false,
    adapter: 'monaco'
  });
  assert.equal(second.activeMatchOrdinal, 2);
  assert.equal(second.matches, matchCount);
  const previous = await adapter.execute({
    hostId,
    selectionRevision: 1,
    surface: 'vue',
    findRevision: 3,
    query: 'a',
    caseSensitive: true,
    direction: 'backward',
    findNext: false,
    adapter: 'monaco'
  });
  assert.equal(previous.activeMatchOrdinal, 1);
  const wrapped = await adapter.execute({
    hostId,
    selectionRevision: 1,
    surface: 'vue',
    findRevision: 4,
    query: 'a',
    caseSensitive: true,
    direction: 'backward',
    findNext: false,
    adapter: 'monaco'
  });
  assert.equal(wrapped.activeMatchOrdinal, matchCount);
  assert.ok(decorationSizes.length >= 4);
  assert.ok(Math.max(...decorationSizes) <= 1);
  assert.equal(revealed.length, 4);
  assert.equal(selectionCalls, 0);
  adapter.clear();
  adapter.dispose();
  assert.ok(clearCount >= 2);
});

test('Monaco case-insensitive find keeps Unicode expansion offsets in the original model', async () => {
  const monacoModule = loadTypeScriptModule(
    'src/renderer/onlypreview/preview/src/onlyPreviewMonacoFind.service.ts'
  );
  const decorated = [];
  const revealed = [];
  const originalRange = {
    startLineNumber: 1,
    startColumn: 2,
    endLineNumber: 1,
    endColumn: 3
  };
  const model = {
    getValue: () => 'İx',
    getValueLength: () => 2,
    getPositionAt: (offset) => ({ lineNumber: 1, column: offset + 1 }),
    findNextMatch: () => ({ range: originalRange }),
    findPreviousMatch: () => ({ range: originalRange })
  };
  const adapter = monacoModule.createOnlyPreviewMonacoFindAdapter(
    {
      createDecorationsCollection: () => ({
        set: (items) => decorated.push(items),
        clear: () => undefined
      }),
      revealRangeInCenter: (range) => revealed.push(range)
    },
    model
  );
  const result = await adapter.execute({
    hostId,
    selectionRevision: 1,
    surface: 'vue',
    findRevision: 1,
    query: 'x',
    caseSensitive: false,
    direction: 'forward',
    findNext: true,
    adapter: 'monaco'
  });
  assert.equal(result.matches, 1);
  assert.deepEqual(decorated.at(-1), [
    {
      range: originalRange,
      options: { inlineClassName: 'onlypreview-monaco__find-match--active' }
    }
  ]);
  assert.equal(revealed.at(-1), originalRange);
});

test('Shell rapid a-to-ab submission ignores an older snapshot that resolves last', async () => {
  const initialSnapshot = {
    state: readyState(),
    open: true,
    query: '',
    caseSensitive: false,
    result: null
  };
  const fetchA = deferred();
  const fetchAB = deferred();
  const submitA = deferred();
  const submitAB = deferred();
  const submitted = [];
  let snapshotCalls = 0;
  const client = {
    getPreviewFindSnapshot: async () => {
      snapshotCalls += 1;
      if (snapshotCalls === 1) return success(initialSnapshot);
      if (snapshotCalls === 2) return fetchA.promise;
      if (snapshotCalls === 3) return fetchAB.promise;
      throw new Error(`unexpected snapshot call ${snapshotCalls}`);
    },
    submitPreviewFind: async (intent) => {
      submitted.push(intent);
      return intent.query === 'a' ? submitA.promise : submitAB.promise;
    },
    closePreviewFind: async () => success(undefined)
  };
  const storeModule = loadTypeScriptModule(
    'src/renderer/onlypreview/shell/src/onlyPreviewFind.store.ts',
    {
      vue: { reactive: (value) => value },
      '@shared/onlypreview/onlyPreview.contract': contract,
      '@shared/onlypreview/onlyPreview.types': sharedTypes,
      '../../common/onlyPreviewClient': { onlyPreviewClient: client },
      '../../common/contextBridge/onlyPreviewEnv.bridge': {
        onlyPreviewEnv: { hostId, hostToken }
      },
      '../../common/onlyPreviewI18n': {
        onlyPreviewI18n: {
          preview: {
            findFailed: 'failed',
            findSizeLimit: 'size',
            findRenderFailed: 'render',
            findUnavailable: 'unavailable'
          }
        }
      }
    }
  );
  const store = storeModule.onlyPreviewFindStore;
  await store.initialize();
  store.setQuery('a');
  store.setQuery('ab');
  assert.equal(store.query, 'ab');
  assert.deepEqual(
    submitted.map(({ query }) => query),
    ['a', 'ab']
  );

  submitA.resolve(success(undefined));
  await tick();
  assert.equal(snapshotCalls, 2);
  submitAB.resolve(success(undefined));
  await tick();
  assert.equal(snapshotCalls, 3);

  fetchAB.resolve(
    success({ ...initialSnapshot, state: readyState({ findRevision: 2 }), query: 'ab' })
  );
  await tick();
  assert.equal(store.query, 'ab');
  fetchA.resolve(
    success({ ...initialSnapshot, state: readyState({ findRevision: 1 }), query: 'a' })
  );
  await tick();
  assert.equal(store.query, 'ab');
  assert.equal(store.snapshot.query, 'ab');
});

test('Shell Store preserves an IME draft across snapshots and commits the final value once', async () => {
  const initialSnapshot = {
    state: readyState(),
    open: true,
    query: 'old',
    caseSensitive: false,
    result: null
  };
  const submitted = [];
  let snapshotCalls = 0;
  const client = {
    getPreviewFindSnapshot: async () => {
      snapshotCalls += 1;
      if (snapshotCalls === 1) return success(initialSnapshot);
      if (snapshotCalls === 2) {
        return success({ ...initialSnapshot, caseSensitive: true });
      }
      return success({
        ...initialSnapshot,
        state: readyState({ findRevision: 1 }),
        query: '正在组合'
      });
    },
    submitPreviewFind: async (intent) => {
      submitted.push(intent);
      return success(undefined);
    },
    closePreviewFind: async () => success(undefined)
  };
  const storeModule = loadTypeScriptModule(
    'src/renderer/onlypreview/shell/src/onlyPreviewFind.store.ts',
    {
      vue: { reactive: (value) => value },
      '@shared/onlypreview/onlyPreview.contract': contract,
      '@shared/onlypreview/onlyPreview.types': sharedTypes,
      '../../common/onlyPreviewClient': { onlyPreviewClient: client },
      '../../common/contextBridge/onlyPreviewEnv.bridge': {
        onlyPreviewEnv: { hostId, hostToken }
      },
      '../../common/onlyPreviewI18n': {
        onlyPreviewI18n: {
          preview: {
            findFailed: 'failed',
            findSizeLimit: 'size',
            findRenderFailed: 'render',
            findUnavailable: 'unavailable'
          }
        }
      }
    }
  );
  const store = storeModule.onlyPreviewFindStore;
  await store.initialize();
  store.beginComposition();
  store.updateComposition('正在');
  await store.sync();
  assert.equal(store.query, '正在');
  assert.equal(store.caseSensitive, false);
  store.updateComposition('正在组合');
  store.endComposition('正在组合');
  store.acceptInput('正在组合', false);
  await tick();
  await tick();
  assert.deepEqual(
    submitted.map(({ query, caseSensitive }) => ({ query, caseSensitive })),
    [{ query: '正在组合', caseSensitive: false }]
  );
  assert.equal(store.query, '正在组合');
});

test('find UI source keeps one shell input, IME safety, narrow-pane layout, and independent selected text', () => {
  const findBar = source('src/renderer/onlypreview/shell/src/components/FindBar/FindBar.vue');
  const findBarStyles = source(
    'src/renderer/onlypreview/shell/src/components/FindBar/FindBar.less'
  );
  const toolbarStyles = source(
    'src/renderer/onlypreview/shell/src/components/PreviewToolbar/PreviewToolbar.less'
  );
  const toolbar = source(
    'src/renderer/onlypreview/shell/src/components/PreviewToolbar/PreviewToolbar.vue'
  );
  const globalSearchWorkspace = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.vue'
  );
  const globalSearchApp = source('src/renderer/onlypreview/globalSearch/src/App.vue');
  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  const previewStore = source('src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts');
  const findService = source('src/main/onlypreview/views/onlyPreviewFind.service.ts');
  const monacoFind = source(
    'src/renderer/onlypreview/preview/src/onlyPreviewMonacoFind.service.ts'
  );
  const previewRegion = source('src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts');
  const previewViewService = source('src/main/onlypreview/views/onlyPreviewPreviewView.service.ts');
  const windowHelper = source('src/main/windows/onlyPreviewWindow.helper.ts');

  assert.equal((findBar.match(/<input\b/g) ?? []).length, 1);
  assert.match(findBar, /name="onlypreview__findInput"/);
  assert.match(findBar, /@compositionstart=/);
  assert.match(findBar, /@compositionend=/);
  assert.match(findBar, /event\.isComposing/);
  assert.match(findBar, /beginComposition/);
  assert.match(findBar, /acceptInput/);
  assert.match(findBarStyles, /min-width:\s*38px/);
  assert.match(toolbar, /<FindBar v-if="onlyPreviewFindStore\.open"/);
  assert.match(toolbarStyles, /container-type:\s*inline-size/);
  assert.match(toolbarStyles, /@container \(max-width:\s*520px\)/);
  assert.match(toolbarStyles, /@container \(max-width:\s*440px\)/);

  assert.doesNotMatch(app, /onlyPreviewGlobalSearchStore|GlobalSearchWorkspace/);
  assert.match(globalSearchApp, /<GlobalSearchWorkspace \/>/);
  assert.match(globalSearchWorkspace, /ref="inputRef"/);
  assert.match(previewStore, /ONLY_PREVIEW_FIND_STATE_EVENT/);
  assert.match(previewStore, /nativeFindSuppressesSelection/);
  assert.match(previewStore, /presentation\.adapterId === 'markdown-dom'/);
  assert.doesNotMatch(previewStore, /presentation\.adapterId === 'docx-dom'/);
  assert.match(previewStore, /\['ooxml-xlsx', 'ooxml-docx', 'ooxml-pptx'\]\.includes/);
  assert.match(previewStore, /reportReady\(selectionRevision, \{ kind: 'complete' \}, 'office'\)/);
  assert.match(previewStore, /broadcastCharacterCount\(0\)/);
  assert.doesNotMatch(findService, /activateSelection/);
  assert.doesNotMatch(monacoFind, /setSelection\s*\(/);
  assert.doesNotMatch(findService, /executeJavaScript/);
  assert.equal((previewViewService.match(/private \w*PreviewView:/g) ?? []).length, 2);
  assert.doesNotMatch(
    `${previewRegion}\n${previewViewService}`,
    /findPreviewView|searchPreviewView/
  );
  assert.match(
    windowHelper,
    /const isCurrentFileFindShortcut[\s\S]*?input\.shift[\s\S]*?isCommandModifier/
  );
  assert.match(windowHelper, /if \(isGlobalSearchShortcut\(input\)\) return 'focus-search'/);
  assert.match(windowHelper, /if \(isCurrentFileFindShortcut\(input\)\) return 'find-in-file'/);
  assert.match(windowHelper, /createView\(host, 'shell'\)/);
  assert.match(
    windowHelper,
    /createView\([\s\S]*host,[\s\S]*'preview',[\s\S]*previewRuntimeToken,[\s\S]*officeBrokerCapability,[\s\S]*previewReadBrokerCapability/
  );
  assert.match(windowHelper, /createView\(host, 'globalSearch'\)/);
  assert.match(windowHelper, /bindChromeShortcuts: \(webContents\)/);
});

test('Main shortcut predicates reserve Shift+CommandOrControl+F for Global Search', () => {
  const windowHelper = source('src/main/windows/onlyPreviewWindow.helper.ts');
  for (const platform of ['darwin', 'win32']) {
    const globalSearch = loadShortcutPredicate(
      windowHelper,
      'isGlobalSearchShortcut',
      platform
    );
    const currentFileFind = loadShortcutPredicate(
      windowHelper,
      'isCurrentFileFindShortcut',
      platform
    );
    // Copy Path / Copy Name are window-wide now, so they must survive focus living in any view —
    // and plain Cmd+C must stay with the focused document, where it means "copy the selection".
    const projectCopy = loadShortcutPredicate(windowHelper, 'isProjectItemCopyShortcut', platform);
    const copyInput = (overrides) => shortcutInput(platform, { key: 'c', ...overrides });
    assert.equal(projectCopy(copyInput({ shift: true })), true);
    assert.equal(projectCopy(copyInput({ alt: true })), true);
    assert.equal(projectCopy(copyInput({})), false, 'plain Cmd+C belongs to the focused document');
    assert.equal(projectCopy(copyInput({ shift: true, alt: true })), false);
    assert.equal(projectCopy(copyInput({ shift: true, isAutoRepeat: true })), false);
    assert.equal(projectCopy(copyInput({ shift: true, type: 'keyUp' })), false);
    assert.equal(projectCopy(shortcutInput(platform, { shift: true })), false, 'only the C key');
    assert.equal(
      projectCopy({
        type: 'keyDown',
        isAutoRepeat: false,
        key: 'c',
        shift: true,
        alt: false,
        control: true,
        meta: true
      }),
      false,
      'the opposite platform modifier must not also be held'
    );

    assert.equal(globalSearch(shortcutInput(platform, { shift: true })), true);
    assert.equal(globalSearch(shortcutInput(platform, { alt: true })), false);
    assert.equal(globalSearch(shortcutInput(platform)), false);
    assert.equal(globalSearch(shortcutInput(platform, { shift: true, alt: true })), false);
    assert.equal(globalSearch(shortcutInput(platform, { isAutoRepeat: true, shift: true })), false);
    assert.equal(globalSearch(shortcutInput(platform, { type: 'keyUp', shift: true })), false);
    assert.equal(globalSearch(shortcutInput(platform, { key: 'g', shift: true })), false);
    assert.equal(
      globalSearch(shortcutInput(platform, { control: false, meta: false, shift: true })),
      false
    );
    assert.equal(
      globalSearch(shortcutInput(platform, { control: true, meta: true, shift: true })),
      false
    );

    assert.equal(currentFileFind(shortcutInput(platform)), true);
    assert.equal(currentFileFind(shortcutInput(platform, { shift: true })), false);
    assert.equal(currentFileFind(shortcutInput(platform, { alt: true })), false);
  }

  const resolveCommandBody = windowHelper.slice(
    windowHelper.indexOf('private resolveNativeCommand('),
    windowHelper.indexOf('\n}\n\nexport const onlyPreviewWindowHelper')
  );
  assert.match(
    resolveCommandBody,
    /isGlobalSearchShortcut\(input\)[\s\S]*return 'focus-search'[\s\S]*isCurrentFileFindShortcut\(input\)[\s\S]*return 'find-in-file'/
  );
  const shortcutBindingBody = windowHelper.slice(
    windowHelper.indexOf('bindNativeShortcuts('),
    windowHelper.indexOf('\n  getStandaloneHost(')
  );
  assert.match(
    shortcutBindingBody,
    /const command = this\.resolveNativeCommand\(host, input\);[\s\S]*if \(!command\) return;[\s\S]*event\.preventDefault\(\)/
  );
  assert.match(
    shortcutBindingBody,
    /command === 'focus-search'[\s\S]*closeFind\(host\.hostToken\)[\s\S]*onlyPreviewGlobalSearchWindowService\.open\(host, origin, webContents\)/
  );
  const globalSearchBranch = shortcutBindingBody.slice(
    shortcutBindingBody.indexOf("if (command === 'focus-search')"),
    shortcutBindingBody.indexOf("if (command === 'focus-project')")
  );
  assert.doesNotMatch(globalSearchBranch, /focusActiveContent|shellView\.webContents\.focus|xpcMain\.broadcast/);
});
