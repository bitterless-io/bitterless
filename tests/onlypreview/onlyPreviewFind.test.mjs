/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
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

const sharedTypes = loadTypeScriptModule('src/shared/onlypreview/onlyPreview.types.ts');
const entryName = loadTypeScriptModule('src/shared/onlypreview/onlyPreviewEntryName.shared.ts');
const contract = loadTypeScriptModule('src/shared/onlypreview/onlyPreview.contract.ts', {
  './onlyPreviewEntryName.shared': entryName
});
const registry = loadTypeScriptModule('src/shared/onlypreview/onlyPreviewFind.registry.ts');

const hostToken = 'host-token-123456789';
const previewRuntimeToken = 'preview-runtime-token-123456789';
const hostId = 'host-for-find-tests';

const success = (value) => ({ ok: true, value });

test('find registry is exhaustive and maps every preview adapter to one truthful engine', () => {
  assert.deepEqual(Object.keys(registry.ONLY_PREVIEW_ADAPTERS).sort(), [
    'audio',
    'chromium-pdf',
    'drawio-viewer',
    'html-page',
    'image',
    'markdown-dom',
    'monaco',
    'ooxml-docx',
    'ooxml-pptx',
    'ooxml-xlsx',
    'unsupported',
    'video'
  ]);
  assert.deepEqual(registry.ONLY_PREVIEW_ADAPTERS, {
    monaco: { surface: 'vue', find: { mode: 'content-adapter', adapter: 'monaco' } },
    'markdown-dom': { surface: 'vue', find: { mode: 'webcontents-find' } },
    'html-page': { surface: 'chrome', find: { mode: 'webcontents-find' } },
    'chromium-pdf': { surface: 'chrome', find: { mode: 'webcontents-find' } },
    'ooxml-xlsx': { surface: 'vue', find: { mode: 'content-adapter', adapter: 'office' } },
    'ooxml-docx': { surface: 'vue', find: { mode: 'content-adapter', adapter: 'office' } },
    'ooxml-pptx': { surface: 'vue', find: { mode: 'content-adapter', adapter: 'office' } },
    'drawio-viewer': { surface: 'vue', find: { mode: 'none' } },
    image: { surface: 'vue', find: { mode: 'none' } },
    audio: { surface: 'vue', find: { mode: 'none' } },
    video: { surface: 'vue', find: { mode: 'none' } },
    unsupported: { surface: 'vue', find: { mode: 'none' } }
  });
});

test('find IPC parsers enforce exact shapes, bounded values, valid coverage, and valid ordinals', () => {
  assert.deepEqual(contract.parseOnlyPreviewFindCoverage({ kind: 'complete' }), {
    kind: 'complete'
  });
  const partialCoverage = {
    kind: 'partial',
    reason: 'sheet-model-cap',
    acceptedSheets: 2,
    acceptedCells: 20_000
  };
  assert.deepEqual(contract.parseOnlyPreviewFindCoverage(partialCoverage), partialCoverage);
  assert.throws(() => contract.parseOnlyPreviewFindCoverage({ kind: 'complete', ignored: true }), {
    code: 'INVALID_INPUT'
  });
  assert.throws(
    () =>
      contract.parseOnlyPreviewFindCoverage({
        ...partialCoverage,
        acceptedSheets: 0
      }),
    { code: 'INVALID_INPUT' }
  );

  const readyRequest = {
    hostToken,
    previewRuntimeToken,
    selectionRevision: 3,
    findCoverage: partialCoverage,
    findAdapter: 'office'
  };
  assert.deepEqual(contract.parseOnlyPreviewPreviewReadyRequest(readyRequest), readyRequest);
  assert.throws(
    () => contract.parseOnlyPreviewPreviewReadyRequest({ ...readyRequest, findAdapter: 'other' }),
    { code: 'INVALID_INPUT' }
  );
  assert.throws(
    () => contract.parseOnlyPreviewPreviewReadyRequest({ ...readyRequest, extra: true }),
    { code: 'INVALID_INPUT' }
  );

  const intent = {
    hostToken,
    selectionRevision: 3,
    surface: 'vue',
    query: 'needle',
    caseSensitive: false,
    direction: 'forward',
    findNext: true
  };
  assert.deepEqual(contract.parseOnlyPreviewFindIntent(intent), intent);
  assert.throws(() => contract.parseOnlyPreviewFindIntent({ ...intent, extra: true }), {
    code: 'INVALID_INPUT'
  });
  assert.throws(() => contract.parseOnlyPreviewFindIntent({ ...intent, query: 'x'.repeat(4097) }), {
    code: 'INVALID_INPUT'
  });

  const result = {
    hostId,
    selectionRevision: 3,
    surface: 'vue',
    findRevision: 4,
    activeMatchOrdinal: 2,
    matches: 5,
    finalUpdate: true,
    coverage: partialCoverage
  };
  assert.deepEqual(contract.parseOnlyPreviewFindResult(result), result);
  assert.deepEqual(
    contract.parseOnlyPreviewFindResultRequest({ hostToken, previewRuntimeToken, result }),
    { hostToken, previewRuntimeToken, result }
  );
  assert.throws(() => contract.parseOnlyPreviewFindResult({ ...result, activeMatchOrdinal: 6 }), {
    code: 'INVALID_INPUT'
  });
  assert.throws(
    () => contract.parseOnlyPreviewFindResult({ ...result, matches: 0, activeMatchOrdinal: 1 }),
    { code: 'INVALID_INPUT' }
  );
  assert.throws(
    () =>
      contract.parseOnlyPreviewFindResultRequest({
        hostToken,
        previewRuntimeToken,
        result,
        extra: true
      }),
    { code: 'INVALID_INPUT' }
  );
});

class FakeWebContents extends EventEmitter {
  constructor(requestIds = [1]) {
    super();
    this.destroyed = false;
    this.findCalls = [];
    this.stopCalls = [];
    this.requestIds = [...requestIds];
    this.nextRequestId = requestIds.at(-1) ?? 1;
    this.findError = null;
  }

  isDestroyed() {
    return this.destroyed;
  }

  findInPage(query, options) {
    this.findCalls.push({ query, options: { ...options } });
    if (this.findError) throw this.findError;
    return this.requestIds.length ? this.requestIds.shift() : ++this.nextRequestId;
  }

  stopFindInPage(action) {
    this.stopCalls.push(action);
  }
}

const descriptor = (previewError = null) => ({ previewError });

const presentation = ({
  adapterId = 'monaco',
  selectionRevision = 1,
  status = 'ready',
  surface = 'vue',
  descriptorValue = descriptor(),
  error = null
} = {}) => ({
  hostId,
  workspaceId: 'workspace-for-find-tests',
  selectionRevision,
  surface,
  adapterId,
  status,
  fileRef: { workspaceId: 'workspace-for-find-tests', relativePath: 'notes/file.txt' },
  descriptor: descriptorValue,
  error,
  selectedTextAvailable: false
});

const createFindServiceHarness = () => {
  const broadcasts = [];
  const findModule = loadTypeScriptModule('src/main/onlypreview/views/onlyPreviewFind.service.ts', {
    'electron-xpc/main': {
      xpcMain: {
        broadcast: (eventName, params) => broadcasts.push({ eventName, params })
      }
    },
    '@shared/onlypreview/onlyPreview.contract': contract,
    '@shared/onlypreview/onlyPreviewFind.registry': registry,
    '@shared/onlypreview/onlyPreview.types': sharedTypes
  });
  return {
    broadcasts,
    service: new findModule.OnlyPreviewFindService()
  };
};

const commandsFrom = (broadcasts) =>
  broadcasts
    .filter(({ eventName }) => eventName === sharedTypes.ONLY_PREVIEW_FIND_COMMAND_EVENT)
    .map(({ params }) => params);

test('Main keeps a query pending and dispatches it exactly once when the same selection becomes ready', () => {
  const { broadcasts, service } = createFindServiceHarness();
  const loading = presentation({
    adapterId: 'monaco',
    status: 'loading',
    descriptorValue: null
  });
  service.reset(loading);
  assert.equal(service.snapshot().state.state, 'pending');
  assert.equal(service.open(), true);
  service.submit({
    selectionRevision: 1,
    surface: 'vue',
    query: 'needle',
    caseSensitive: true,
    direction: 'backward',
    findNext: true
  });
  assert.equal(commandsFrom(broadcasts).length, 0);
  assert.equal(service.snapshot().query, 'needle');

  const ready = presentation({ adapterId: 'monaco' });
  service.syncPresentation(ready, { kind: 'complete' });
  assert.equal(service.snapshot().state.state, 'ready');
  assert.deepEqual(commandsFrom(broadcasts), [
    {
      hostId,
      selectionRevision: 1,
      surface: 'vue',
      findRevision: 1,
      query: 'needle',
      caseSensitive: true,
      direction: 'backward',
      findNext: true,
      adapter: 'monaco'
    }
  ]);

  service.syncPresentation(ready, { kind: 'complete' });
  assert.equal(commandsFrom(broadcasts).length, 1);
});

test('a pending PDF query reaches Chromium exactly once after document readiness', () => {
  const { service } = createFindServiceHarness();
  const chromeContents = new FakeWebContents([73]);
  service.bindWebContents('chrome', chromeContents, 1);
  const loadingPdf = presentation({
    adapterId: 'chromium-pdf',
    status: 'loading',
    surface: 'chrome'
  });
  service.reset(loadingPdf);
  assert.equal(service.open(), true);
  service.submit({
    selectionRevision: 1,
    surface: 'chrome',
    query: 'invoice',
    caseSensitive: false,
    direction: 'forward',
    findNext: true
  });
  assert.equal(chromeContents.findCalls.length, 0);

  const readyPdf = presentation({ adapterId: 'chromium-pdf', surface: 'chrome' });
  service.syncPresentation(readyPdf, { kind: 'complete' });
  assert.deepEqual(chromeContents.findCalls, [
    {
      query: 'invoice',
      options: { forward: true, findNext: true, matchCase: false }
    }
  ]);

  service.syncPresentation(readyPdf, { kind: 'complete' });
  assert.equal(chromeContents.findCalls.length, 1);
});

test('Main routes native find options and accepts only the live request, target generation, selection, and revision', () => {
  const { service } = createFindServiceHarness();
  const oldContents = new FakeWebContents([41]);
  service.bindWebContents('vue', oldContents, 1);
  service.reset(presentation({ adapterId: 'markdown-dom' }));
  assert.equal(service.open(), true);
  service.submit({
    selectionRevision: 1,
    surface: 'vue',
    query: 'first',
    caseSensitive: false,
    direction: 'forward',
    findNext: true
  });
  assert.deepEqual(oldContents.findCalls, [
    {
      query: 'first',
      options: { forward: true, findNext: true, matchCase: false }
    }
  ]);

  const newContents = new FakeWebContents([41, 42]);
  service.unbindWebContents('vue', oldContents);
  service.bindWebContents('vue', newContents, 2);
  service.submit({
    selectionRevision: 1,
    surface: 'vue',
    query: 'second',
    caseSensitive: true,
    direction: 'backward',
    findNext: true
  });
  assert.deepEqual(newContents.findCalls[0], {
    query: 'second',
    options: { forward: false, findNext: true, matchCase: true }
  });

  oldContents.emit(
    'found-in-page',
    {},
    {
      requestId: 41,
      activeMatchOrdinal: 1,
      matches: 7,
      finalUpdate: true
    }
  );
  assert.equal(service.snapshot().result, null, 'a replaced WebContents must be fenced');
  newContents.emit(
    'found-in-page',
    {},
    {
      requestId: 999,
      activeMatchOrdinal: 1,
      matches: 9,
      finalUpdate: true
    }
  );
  assert.equal(service.snapshot().result, null, 'a stale request id must be fenced');
  newContents.emit(
    'found-in-page',
    {},
    {
      requestId: 41,
      activeMatchOrdinal: 2,
      matches: 9,
      finalUpdate: true
    }
  );
  assert.deepEqual(service.snapshot().result, {
    hostId,
    selectionRevision: 1,
    surface: 'vue',
    findRevision: 2,
    activeMatchOrdinal: 2,
    matches: 9,
    finalUpdate: true,
    coverage: { kind: 'complete' }
  });

  service.submit({
    selectionRevision: 1,
    surface: 'vue',
    query: 'second',
    caseSensitive: true,
    direction: 'forward',
    findNext: false
  });
  assert.deepEqual(newContents.findCalls[1], {
    query: 'second',
    options: { forward: true, findNext: false, matchCase: true }
  });
  newContents.emit(
    'found-in-page',
    {},
    {
      requestId: 41,
      activeMatchOrdinal: 3,
      matches: 9,
      finalUpdate: true
    }
  );
  assert.equal(service.snapshot().result, null, 'the prior find revision/request must be fenced');

  service.reset(
    presentation({ adapterId: 'markdown-dom', selectionRevision: 2, status: 'loading' })
  );
  newContents.emit(
    'found-in-page',
    {},
    {
      requestId: 42,
      activeMatchOrdinal: 1,
      matches: 1,
      finalUpdate: true
    }
  );
  assert.equal(service.snapshot().result, null, 'the prior selection must be fenced');
});

test('Main rejects a found-in-page callback captured from an older generation of the same WebContents', () => {
  const { service } = createFindServiceHarness();
  const contents = new FakeWebContents([71, 72]);
  service.bindWebContents('vue', contents, 1);
  const staleGenerationListener = contents.listeners('found-in-page')[0];
  service.reset(presentation({ adapterId: 'markdown-dom' }));
  service.open();
  service.submit({
    selectionRevision: 1,
    surface: 'vue',
    query: 'old',
    caseSensitive: false,
    direction: 'forward',
    findNext: true
  });

  service.bindWebContents('vue', contents, 2);
  const currentGenerationListener = contents.listeners('found-in-page')[1];
  service.submit({
    selectionRevision: 1,
    surface: 'vue',
    query: 'current',
    caseSensitive: false,
    direction: 'forward',
    findNext: true
  });
  const currentResult = {
    requestId: 72,
    activeMatchOrdinal: 1,
    matches: 3,
    finalUpdate: true
  };
  staleGenerationListener({}, currentResult);
  assert.equal(service.snapshot().result, null);
  currentGenerationListener({}, currentResult);
  assert.equal(service.snapshot().result?.matches, 3);
});

test('Main rejects changed navigation intents, reports native failures truthfully, and never opens unsupported content', () => {
  const changed = createFindServiceHarness();
  const contents = new FakeWebContents([5]);
  changed.service.bindWebContents('vue', contents, 1);
  changed.service.reset(presentation({ adapterId: 'markdown-dom' }));
  changed.service.open();
  changed.service.submit({
    selectionRevision: 1,
    surface: 'vue',
    query: 'stable',
    caseSensitive: false,
    direction: 'forward',
    findNext: true
  });
  assert.throws(
    () =>
      changed.service.submit({
        selectionRevision: 1,
        surface: 'vue',
        query: 'changed',
        caseSensitive: false,
        direction: 'forward',
        findNext: false
      }),
    { code: 'INVALID_INPUT' }
  );
  assert.throws(
    () =>
      changed.service.submit({
        selectionRevision: 1,
        surface: 'vue',
        query: 'stable',
        caseSensitive: true,
        direction: 'forward',
        findNext: false
      }),
    { code: 'INVALID_INPUT' }
  );

  const destroyed = createFindServiceHarness();
  const destroyedContents = new FakeWebContents();
  destroyedContents.destroyed = true;
  destroyed.service.bindWebContents('vue', destroyedContents, 1);
  destroyed.service.reset(presentation({ adapterId: 'markdown-dom' }));
  destroyed.service.open();
  destroyed.service.submit({
    selectionRevision: 1,
    surface: 'vue',
    query: 'needle',
    caseSensitive: false,
    direction: 'forward',
    findNext: true
  });
  assert.deepEqual(destroyed.service.snapshot().state, {
    state: 'unavailable',
    hostId,
    selectionRevision: 1,
    surface: 'vue',
    findRevision: 2,
    reason: 'render-failed'
  });
  assert.equal(destroyed.service.snapshot().open, false);

  const throwing = createFindServiceHarness();
  const throwingContents = new FakeWebContents();
  throwingContents.findError = new Error('renderer disappeared');
  throwing.service.bindWebContents('vue', throwingContents, 1);
  throwing.service.reset(presentation({ adapterId: 'markdown-dom' }));
  throwing.service.open();
  throwing.service.submit({
    selectionRevision: 1,
    surface: 'vue',
    query: 'needle',
    caseSensitive: false,
    direction: 'forward',
    findNext: true
  });
  assert.equal(throwing.service.snapshot().state.state, 'unavailable');
  assert.equal(throwing.service.snapshot().state.reason, 'render-failed');

  const unsupported = createFindServiceHarness();
  unsupported.service.reset(presentation({ adapterId: 'unsupported' }));
  assert.equal(unsupported.service.snapshot().state.reason, 'unsupported');
  assert.equal(unsupported.service.open(), false);
  assert.equal(unsupported.service.snapshot().open, false);
});

test('Main clears native selection without activating it and validates Office adapter coverage', () => {
  const native = createFindServiceHarness();
  const contents = new FakeWebContents([4]);
  native.service.bindWebContents('chrome', contents, 7);
  native.service.reset(
    presentation({ adapterId: 'html-page', surface: 'chrome', selectionRevision: 8 })
  );
  native.service.open();
  native.service.submit({
    selectionRevision: 8,
    surface: 'chrome',
    query: 'text',
    caseSensitive: false,
    direction: 'forward',
    findNext: true
  });
  native.service.close();
  assert.ok(contents.stopCalls.length >= 1);
  assert.deepEqual(new Set(contents.stopCalls), new Set(['clearSelection']));

  const office = createFindServiceHarness();
  const completeCoverage = { kind: 'complete' };
  const officePresentation = presentation({ adapterId: 'ooxml-xlsx', selectionRevision: 11 });
  office.service.reset(officePresentation);
  assert.equal(office.service.snapshot().state.state, 'pending');
  office.service.syncPresentation(officePresentation, completeCoverage);
  assert.equal(office.service.open(), true);
  office.service.submit({
    selectionRevision: 11,
    surface: 'vue',
    query: 'invoice',
    caseSensitive: false,
    direction: 'forward',
    findNext: true
  });
  const [command] = commandsFrom(office.broadcasts);
  assert.equal(command.adapter, 'office');
  assert.equal(command.findRevision, 1);
  assert.throws(
    () =>
      office.service.reportContentResult({
        hostId,
        selectionRevision: 11,
        surface: 'vue',
        findRevision: 0,
        activeMatchOrdinal: 1,
        matches: 2,
        finalUpdate: true,
        coverage: completeCoverage
      }),
    { code: 'INVALID_INPUT' }
  );
  assert.throws(
    () =>
      office.service.reportContentResult({
        hostId,
        selectionRevision: 11,
        surface: 'vue',
        findRevision: 1,
        activeMatchOrdinal: 1,
        matches: 2,
        finalUpdate: true,
        coverage: {
          kind: 'partial',
          reason: 'sheet-model-cap',
          acceptedSheets: 3,
          acceptedCells: 30_000
        }
      }),
    { code: 'INVALID_INPUT' }
  );
  office.service.reportContentResult({
    hostId,
    selectionRevision: 11,
    surface: 'vue',
    findRevision: 1,
    activeMatchOrdinal: 1,
    matches: 2,
    finalUpdate: true,
    coverage: completeCoverage
  });
  assert.deepEqual(office.service.snapshot().result?.coverage, completeCoverage);
});

test('content adapter bridge executes only the exact registered adapter and reports its coverage', async () => {
  const subscriptions = new Map();
  const reports = [];
  const bridgeModule = loadTypeScriptModule(
    'src/renderer/onlypreview/preview/src/onlyPreviewFindAdapter.service.ts',
    {
      'electron-xpc/renderer': {
        xpcRenderer: {
          subscribe: (eventName, callback) => subscriptions.set(eventName, callback)
        }
      },
      '@shared/onlypreview/onlyPreview.types': sharedTypes,
      '../../common/onlyPreviewClient': {
        onlyPreviewClient: {
          reportPreviewFindResult: async (request) => {
            reports.push(request);
            return success(undefined);
          }
        }
      },
      '../../common/contextBridge/onlyPreviewEnv.bridge': {
        onlyPreviewEnv: { hostId, hostToken, previewRuntimeToken }
      }
    }
  );
  const bridge = bridgeModule.onlyPreviewFindAdapterBridge;
  const executions = [];
  const clears = [];
  bridge.initialize();
  bridge.register('office', 9, {
    execute: async (command) => {
      executions.push(command);
      return {
        activeMatchOrdinal: 2,
        matches: 4,
        finalUpdate: true,
        coverage: {
          kind: 'complete'
        }
      };
    },
    clear: () => {
      clears.push(true);
    }
  });
  const onCommand = subscriptions.get(sharedTypes.ONLY_PREVIEW_FIND_COMMAND_EVENT);
  const command = {
    hostId,
    selectionRevision: 9,
    surface: 'vue',
    findRevision: 5,
    query: 'cell',
    caseSensitive: false,
    direction: 'forward',
    findNext: true,
    adapter: 'monaco'
  };
  onCommand({ params: command });
  await tick();
  assert.equal(executions.length, 0, 'a wrong adapter command must not cross the registry fence');

  onCommand({ params: { ...command, adapter: 'office' } });
  await tick();
  await tick();
  assert.equal(executions.length, 1);
  assert.deepEqual(reports, [
    {
      hostToken,
      previewRuntimeToken,
      result: {
        hostId,
        selectionRevision: 9,
        surface: 'vue',
        findRevision: 5,
        activeMatchOrdinal: 2,
        matches: 4,
        finalUpdate: true,
        coverage: {
          kind: 'complete'
        }
      }
    }
  ]);

  onCommand({ params: { ...command, findRevision: 4, adapter: 'office' } });
  await tick();
  assert.equal(executions.length, 1, 'an older adapter command must not replace live highlights');

  onCommand({ params: { ...command, findRevision: 6, adapter: 'office', query: '' } });
  await tick();
  await tick();
  assert.equal(clears.length, 1);
});
