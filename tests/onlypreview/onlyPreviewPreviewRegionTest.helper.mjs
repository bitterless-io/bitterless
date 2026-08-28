/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const source = (relativePath) => readFileSync(join(root, relativePath), 'utf8');
const nodeRequire = createRequire(import.meta.url);

const loadTypeScriptModule = (relativePath, dependencies) => {
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

class ContractError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const tick = () => new Promise((resolve) => setImmediate(resolve));

const withFakeTimeouts = async (run) => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = [];
  globalThis.setTimeout = (callback, delay, ...args) => {
    const timer = { active: true, args, callback, delay };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    if (timer) timer.active = false;
  };
  try {
    await run(timers);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
};

let state;

class FakeSession extends EventEmitter {
  constructor() {
    super();
    this.protocol = { handle: async () => {}, unhandle: () => {} };
    this.clearStorageDataCalls = 0;
    this.clearCacheCalls = 0;
    this.closeAllConnectionsCalls = 0;
    this.webRequest = {
      onBeforeRequest: (filter, handler) => {
        this.webRequestFilter = filter;
        this.webRequestHandler = handler;
      }
    };
  }

  setPermissionCheckHandler(handler) {
    this.permissionCheckHandler = handler;
  }

  setPermissionRequestHandler(handler) {
    this.permissionRequestHandler = handler;
  }

  async setProxy(config) {
    this.proxyConfig = config;
    state.proxyCalls.push({ session: this, config });
    const pending = state.nextProxyDeferred;
    state.nextProxyDeferred = null;
    pending?.started.resolve(this);
    if (pending) await pending.completion.promise;
  }

  async closeAllConnections() {
    this.closeAllConnectionsCalls += 1;
    return undefined;
  }
  async clearStorageData() {
    this.clearStorageDataCalls += 1;
    return undefined;
  }
  async clearCache() {
    this.clearCacheCalls += 1;
    return undefined;
  }
}

class FakeWebContents extends EventEmitter {
  constructor(kind, sharedSession) {
    super();
    this.kind = kind;
    this.session = sharedSession ?? new FakeSession();
    this.destroyed = false;
    this.loadedUrls = [];
    // Electron exposes the frame tree here; the Chromium PDF viewer's document frame is the extra
    // non-main frame that a blank viewer never produces.
    this.mainFrame = { url: '', framesInSubtree: [] };
    this.mainFrame.framesInSubtree.push(this.mainFrame);
  }

  addSubframe(url) {
    this.mainFrame.framesInSubtree.push({ url });
  }

  isDestroyed() {
    return this.destroyed;
  }

  close() {
    this.destroyed = true;
  }

  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler;
  }

  setWebRTCIPHandlingPolicy(policy) {
    this.webRTCIPHandlingPolicy = policy;
  }

  async loadURL(url) {
    this.loadedUrls.push(url);
    if (state.nextChromeLoadError) {
      const error = state.nextChromeLoadError;
      state.nextChromeLoadError = null;
      throw error;
    }
  }
}

class FakeView {
  constructor(kind, sharedSession) {
    this.kind = kind;
    this.webContents = new FakeWebContents(kind, sharedSession);
    this.bounds = null;
  }

  setBounds(bounds) {
    this.bounds = { ...bounds };
  }
}

class FakeChromeView extends FakeView {
  constructor(options) {
    // One partition means one session, exactly as Electron resolves it.
    const partition = options?.webPreferences?.partition ?? '';
    if (!state.chromeSessions.has(partition))
      state.chromeSessions.set(partition, new FakeSession());
    super('chrome', state.chromeSessions.get(partition));
    this.options = options;
    this.partition = partition;
    state.chromeViews.push(this);
  }
}

const descriptorFor = (relativePath, kind, assetUrl) => {
  const extension = `.${relativePath.split('.').at(-1)}`.toLowerCase();
  return {
    workspaceId: 'workspace-id',
    relativePath,
    name: relativePath.split('/').at(-1),
    extension,
    kind,
    mimeType:
      kind === 'pdf'
        ? 'application/pdf'
        : kind === 'image'
          ? 'image/png'
          : kind === 'audio'
            ? 'audio/mpeg'
            : kind === 'video'
              ? 'video/mp4'
              : kind === 'diagram'
                ? 'application/vnd.jgraph.mxfile'
                : extension === '.html'
                  ? 'text/html; charset=utf-8'
                  : 'text/plain; charset=utf-8',
    size: 3,
    modifiedAt: 1,
    language: kind === 'text' ? 'markdown' : '',
    ...(assetUrl ? { assetUrl } : {})
  };
};

const createState = () => ({
  broadcasts: [],
  vueViews: [],
  vueLoads: [],
  chromeViews: [],
  chromeSessions: new Map(),
  proxyCalls: [],
  protocolInstalls: [],
  protocolCleanups: 0,
  protocolError: null,
  nextProxyDeferred: null,
  nextChromeLoadError: null,
  nextVueLoadError: null,
  nextDocumentIssueDeferred: null,
  describe: async () => descriptorFor('notes/readme.md', 'text'),
  readText: async (_file, adapterId) => ({
    workspaceId: 'workspace-id',
    relativePath: 'notes/readme.md',
    text: adapterId,
    encoding: 'utf-8',
    size: adapterId.length
  }),
  assertOpenedFileCurrent: async () => undefined,
  textReadCalls: [],
  assetIssues: [],
  assetRevocations: 0,
  assetSelectionRevocations: [],
  documentRevocations: 0,
  documentRevisionRevocations: [],
  assetUrlsRevoked: [],
  findBinds: [],
  findUnbinds: []
});

const host = {
  hostId: 'host-id',
  hostToken: 'host-token',
  kind: 'standalone',
  roles: ['content']
};

const hostRegistry = {
  require: (hostToken) => {
    if (hostToken !== host.hostToken) throw new ContractError('HOST_NOT_FOUND', 'missing host');
    return host;
  }
};

const workspaceRegistry = {
  openFile: async (_hostToken, fileRef) => ({
    host,
    workspace: { workspaceId: fileRef.workspaceId },
    relativePath: fileRef.relativePath,
    realPath: `/workspace/${fileRef.relativePath}`,
    size: 3,
    modifiedAt: 1,
    modifiedTimeNanoseconds: 1n,
    deviceId: 1n,
    inode: 1n,
    fileHandle: { close: async () => {} }
  }),
  assertOpenedFileCurrent: async (...args) => await state.assertOpenedFileCurrent(...args)
};

const assetRegistry = {
  issue: (file, mimeType, options) => {
    state.assetIssues.push({ file, mimeType, options });
    return `bitterless-preview://asset/${'a'.repeat(64)}/${options.selectionRevision}-${file.relativePath}`;
  },
  revokeHost: () => {
    state.assetRevocations += 1;
  },
  revokeSelection: (hostToken, selectionRevision) => {
    state.assetRevocations += 1;
    state.assetSelectionRevocations.push({ hostToken, selectionRevision });
  },
  revokeUrl: (url) => {
    if (url) state.assetUrlsRevoked.push(url);
  }
};

const documentRegistry = {
  issue: async (_file, revision) => {
    const url = `bitterless-preview://document/${'d'.repeat(64)}/${revision}.html`;
    const pending = state.nextDocumentIssueDeferred;
    state.nextDocumentIssueDeferred = null;
    pending?.started.resolve({ revision, url });
    if (pending) await pending.completion.promise;
    return url;
  },
  revokeSelection: (hostToken, revision) => {
    state.documentRevocations += 1;
    state.documentRevisionRevocations.push({ hostToken, revision });
  }
};

class FakeFindService {
  reset(presentation) {
    this.presentation = presentation;
  }
  bindWebContents(surface, webContents, generation) {
    state.findBinds.push({ surface, webContents, generation });
  }
  unbindWebContents(surface, webContents) {
    state.findUnbinds.push({ surface, webContents });
  }
  beginTransition() {
    return undefined;
  }
  syncPresentation(presentation) {
    this.presentation = presentation;
  }
  snapshot() {
    return {
      state: {
        state: 'unavailable',
        hostId: this.presentation.hostId,
        selectionRevision: this.presentation.selectionRevision,
        surface: this.presentation.surface,
        findRevision: 0,
        reason: 'unsupported'
      },
      open: false,
      query: '',
      caseSensitive: false,
      result: null
    };
  }
  open() {
    return false;
  }
  submit() {
    return undefined;
  }
  close() {
    return undefined;
  }
  isOpen() {
    return false;
  }
  reportContentResult() {
    return undefined;
  }
}

const findSpecs = {
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
};

const viewModule = loadTypeScriptModule(
  'src/main/onlypreview/views/onlyPreviewPreviewView.service.ts',
  {
    electron: { BaseWindow: class {}, WebContentsView: FakeChromeView },
    '@shared/onlypreview/onlyPreview.contract': {
      OnlyPreviewContractError: ContractError
    },
    '@main/onlypreview/onlyPreviewProtocol.service': {
      installOnlyPreviewSessionProtocol: (session, url) => {
        if (state.protocolError) throw state.protocolError;
        state.protocolInstalls.push({ session, url });
        return () => {
          state.protocolCleanups += 1;
        };
      }
    }
  }
);

const previewAdapterModule = loadTypeScriptModule(
  'src/main/onlypreview/views/onlyPreviewPreviewAdapter.service.ts',
  {}
);

const regionModule = loadTypeScriptModule(
  'src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts',
  {
    electron: { BaseWindow: class {}, WebContentsView: FakeChromeView },
    'electron-xpc/main': {
      xpcMain: {
        broadcast: (event, payload) => state.broadcasts.push({ event, payload })
      }
    },
    '@shared/onlypreview/onlyPreview.contract': {
      cloneOnlyPreviewDescriptor: (descriptor, options = {}) => ({
        workspaceId: descriptor.workspaceId,
        relativePath: descriptor.relativePath,
        name: descriptor.relativePath.split('/').at(-1) || descriptor.name,
        extension: descriptor.extension,
        kind: descriptor.kind,
        mimeType: descriptor.mimeType,
        language: descriptor.language,
        size: descriptor.size,
        modifiedAt: descriptor.modifiedAt,
        ...(options.includeAsset !== false && descriptor.assetUrl
          ? { assetUrl: descriptor.assetUrl }
          : {}),
        ...(descriptor.unsupportedCategory
          ? { unsupportedCategory: descriptor.unsupportedCategory }
          : {}),
        ...(descriptor.previewError ? { previewError: { ...descriptor.previewError } } : {})
      }),
      OnlyPreviewContractError: ContractError,
      parseOnlyPreviewFileRef: (value) => value,
      toOnlyPreviewErrorPayload: (error) => ({
        code: error?.code ?? 'OPERATION_FAILED',
        message: error instanceof Error ? error.message : 'failed'
      })
    },
    '@shared/onlypreview/onlyPreview.types': {
      getOnlyPreviewFileSizeLimit: (adapterId) =>
        ({
          'chromium-pdf': 100 * 1024 * 1024,
          'ooxml-xlsx': 25 * 1024 * 1024,
          'ooxml-docx': 25 * 1024 * 1024,
          'ooxml-pptx': 25 * 1024 * 1024,
          'drawio-viewer': 20 * 1024 * 1024,
          image: 100 * 1024 * 1024,
          audio: null,
          video: null
        })[adapterId] ?? 10 * 1024 * 1024,
      ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT: 'onlypreview/previewPresentation'
    },
    '@shared/onlypreview/onlyPreviewFind.registry': {
      getOnlyPreviewAdapterSpec: (adapterId) => findSpecs[adapterId]
    },
    '@main/onlypreview/onlyPreviewAsset.registry': {
      onlyPreviewAssetRegistry: assetRegistry
    },
    '@main/onlypreview/onlyPreviewClassifier.service': {
      onlyPreviewClassifierService: {
        describe: (...args) => state.describe(...args),
        readText: (...args) => {
          state.textReadCalls.push(args);
          return state.readText(...args);
        }
      }
    },
    '@main/onlypreview/onlyPreviewDocument.registry': {
      onlyPreviewDocumentRegistry: documentRegistry
    },
    '@main/onlypreview/onlyPreviewHost.registry': {
      onlyPreviewHostRegistry: hostRegistry
    },
    '@main/onlypreview/onlyPreviewWorkspace.registry': {
      onlyPreviewWorkspaceRegistry: workspaceRegistry
    },
    './onlyPreviewFind.service': { OnlyPreviewFindService: FakeFindService },
    './onlyPreviewPreviewAdapter.service': previewAdapterModule,
    './onlyPreviewPreviewView.service': viewModule
  }
);
const presentationModule = loadTypeScriptModule(
  'src/renderer/onlypreview/common/onlyPreviewPresentation.service.ts',
  {}
);

const createHarness = () => {
  state = createState();
  const children = new Set();
  const additions = [];
  const removals = [];
  const window = {
    isDestroyed: () => false,
    contentView: {
      addChildView: (view) => {
        children.add(view);
        additions.push(view);
      },
      removeChildView: (view) => {
        children.delete(view);
        removals.push(view);
      }
    }
  };
  const runtime = {
    window,
    host,
    createVuePreviewView: (previewRuntimeToken) => {
      const view = new FakeView('vue');
      view.previewRuntimeToken = previewRuntimeToken;
      state.vueViews.push(view);
      return view;
    },
    loadVuePreviewView: async (view) => {
      state.vueLoads.push(view);
      if (state.nextVueLoadError) {
        const error = state.nextVueLoadError;
        state.nextVueLoadError = null;
        throw error;
      }
    },
    bindChromeShortcuts: (webContents) => {
      webContents.shortcutsBound = true;
    }
  };
  const service = new regionModule.OnlyPreviewPreviewRegionService();
  service.start(runtime);
  return { service, runtime, children, additions, removals };
};

const fileRef = (relativePath) => ({ workspaceId: 'workspace-id', relativePath });
const bounds = { x: 300, y: 75, width: 700, height: 500 };

const acknowledgeCurrentVue = (service) => {
  const view = state.vueViews.at(-1);
  const snapshot = service.snapshot(host.hostToken);
  service.reportVueReset(host.hostToken, snapshot.selectionRevision, view.previewRuntimeToken);
  return view;
};

export {
  acknowledgeCurrentVue,
  bounds,
  ContractError,
  createHarness,
  deferred,
  descriptorFor,
  fileRef,
  host,
  presentationModule,
  source,
  state,
  tick,
  withFakeTimeouts
};
