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
    this.mainFrame = this.createFrame('');
    this.mainFrame.framesInSubtree.push(this.mainFrame);
  }

  createFrame(url) {
    const frame = {
      url,
      processId: 101,
      routingId: state.nextFrameRoutingId++,
      framesInSubtree: [],
      isDestroyed: () => false
    };
    state.framesById.set(`${frame.processId}:${frame.routingId}`, frame);
    return frame;
  }

  addSubframe(url) {
    const frame = this.createFrame(url);
    this.mainFrame.framesInSubtree.push(frame);
    return frame;
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
  window: null,
  layerShows: [],
  layerHides: [],
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
  nextPreviewPrepareDeferred: null,
  describe: async () => descriptorFor('notes/readme.md', 'text'),
  readText: async (_file, adapterId) => ({
    workspaceId: 'workspace-id',
    relativePath: 'notes/readme.md',
    text: adapterId,
    encoding: 'utf-8',
    size: adapterId.length
  }),
  assertOpenedFileCurrent: async () => undefined,
  authorizeProjectItem: async ({ relativePath }) => ({
    relativePath,
    nodeKind: 'file',
    size: 3,
    modifiedAt: 1
  }),
  projectAuthorizations: [],
  textReadCalls: [],
  assetIssues: [],
  assetRevocations: 0,
  assetSelectionRevocations: [],
  documentRevocations: 0,
  documentRevisionRevocations: [],
  assetUrlsRevoked: [],
  findBinds: [],
  findUnbinds: [],
  previewBinds: [],
  officeBinds: [],
  officePrepares: [],
  officeCancels: [],
  nextOfficePrepareDeferred: null,
  previewPrepares: [],
  previewCancels: [],
  framesById: new Map(),
  nextFrameRoutingId: 1,
  activeViewAttachNotifications: 0,
  openTraceRecords: []
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
  getPreviewAuthorityItemRef: (_hostToken, fileRef) => ({
    workspaceId: fileRef.workspaceId,
    workspaceGeneration: fileRef.workspaceId === 'external-workspace-id' ? 1 : 17,
    relativePath: fileRef.relativePath,
    rootPath: fileRef.workspaceId === 'external-workspace-id' ? '/external/private' : '/workspace'
  }),
  getProjectAuthorityItemRef: (_hostToken, fileRef) => ({
    workspaceId: fileRef.workspaceId,
    workspaceGeneration: 23,
    relativePath: fileRef.relativePath
  }),
  getOfficeReadBootstrap: (_hostToken, fileRef) => ({
    workspaceId: fileRef.workspaceId,
    relativePath: fileRef.relativePath,
    rootPath: '/workspace'
  }),
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
  issue: (hostToken, selection, mimeType, options) => {
    state.assetIssues.push({ hostToken, file: selection, mimeType, options });
    return `bitterless-preview://asset/${'a'.repeat(64)}/${options.selectionRevision}-${selection.relativePath}`;
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
  issue: (_hostToken, selection, revision) => {
    const url = `bitterless-preview://document/${'d'.repeat(64)}/${revision}.html`;
    state.nextDocumentIssueDeferred?.started.resolve({ revision, url, selection });
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
    electron: {
      BaseWindow: class {},
      WebContentsView: FakeChromeView,
      webFrameMain: {
        fromId: (processId, routingId) => state.framesById.get(`${processId}:${routingId}`)
      }
    },
    '@shared/onlypreview/onlyPreview.contract': {
      OnlyPreviewContractError: ContractError
    },
    './onlyPreviewViewLayer.service': {
      onlyPreviewViewLayerService: {
        show: (layer, owner, view) => {
          state.layerShows.push({ layer, owner, name: view?.name ?? null });
          // The window is the real one in this harness, so the sort's own attach is reproduced here
          // to keep the child-order assertions meaningful.
          state.window?.contentView.addChildView(view);
          return true;
        },
        hide: (layer, owner) => {
          state.layerHides.push({ layer, owner });
        },
        resort: () => undefined
      }
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

class FakePreviewReadBrokerService {
  setPreviewAuthority(brokerCapability, prepared) {
    this.previewAuthority = { brokerCapability, prepared };
  }
  setOfficeAuthority(authority) {
    this.officeAuthority = authority;
  }
  hasOfficeSelection(selectionRevision) {
    return this.officeAuthority?.selectionRevision === selectionRevision;
  }
  revokeOfficeReadAuthority() {
    const authority = this.officeAuthority;
    this.officeAuthority = null;
    state.officeCancels.push(
      authority
        ? {
            grantId: authority.grantId,
            runtimeId: authority.runtimeId,
            selectionRevision: authority.selectionRevision
          }
        : {}
    );
  }
  revokePreviewReadAuthority() {
    const authority = this.previewAuthority;
    this.previewAuthority = null;
    if (authority) {
      state.previewCancels.push({
        grantId: authority.prepared.grantId,
        selectionRevision: authority.prepared.selectionRevision
      });
    }
  }
  revokeAll() {
    this.revokePreviewReadAuthority();
    this.revokeOfficeReadAuthority();
  }
  async waitForOfficeCancellation() {
    return undefined;
  }
  async cancelPreparedOffice(grantId, runtimeId, selectionRevision) {
    state.officeCancels.push({ grantId, runtimeId, selectionRevision });
  }
  async prepareOfficeSelection(params) {
    const grant = {
      grantId: 'office-grant-for-tests',
      runtimeId: params.runtimeId,
      selectionRevision: params.selectionRevision,
      kind: params.kind,
      workspaceId: params.fileRef.workspaceId,
      relativePath: params.fileRef.relativePath,
      maxBytes: 25 * 1024 * 1024
    };
    state.officePrepares.push(grant);
    const pending = state.nextOfficePrepareDeferred;
    state.nextOfficePrepareDeferred = null;
    pending?.started.resolve(grant);
    if (pending) await pending.completion.promise;
    const extension = `.${params.kind}`;
    const descriptorKind =
      params.kind === 'xlsx' ? 'sheet' : params.kind === 'docx' ? 'document' : 'presentation';
    return {
      adapterId: `ooxml-${params.kind}`,
      grantId: grant.grantId,
      descriptor: {
        ...descriptorFor(params.fileRef.relativePath, descriptorKind),
        workspaceId: params.fileRef.workspaceId,
        extension
      }
    };
  }
}

const selectedFileIdentityModule = loadTypeScriptModule(
  'src/main/onlypreview/views/onlyPreviewSelectedFileIdentity.service.ts',
  {
    '@main/fileSearch/fileSearchWindow.service': {
      fileSearchWindowService: {
        authorizeProjectItem: async (request) => {
          state.projectAuthorizations.push(request);
          return await state.authorizeProjectItem(request);
        }
      }
    },
    '@main/onlypreview/onlyPreviewWorkspace.registry': {
      onlyPreviewWorkspaceRegistry: workspaceRegistry
    },
    '@shared/onlypreview/onlyPreview.types': {}
  }
);
const regionModule = loadTypeScriptModule(
  'src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts',
  {
    '@main/onlypreview/onlyPreviewOpenDiagnostics.runtime': {
      onlyPreviewOpenDiagnostics: {
        trace: (_flow, fields) => {
          const record = { fields, marks: [], terminals: [] };
          state.openTraceRecords.push(record);
          return {
            tag: `p${state.openTraceRecords.length}`,
            mark: (value) => (record.marks.push(value), true),
            end: (value) => (record.terminals.push(value), true)
          };
        }
      }
    },
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
    '@shared/onlypreview/onlyPreviewOfficeReadRuntime.types': {
      ONLY_PREVIEW_OFFICE_READ_MAX_BYTES: 25 * 1024 * 1024,
      getOnlyPreviewOfficePackageKind: (relativePath) => {
        const extension = relativePath.slice(relativePath.lastIndexOf('.')).toLowerCase();
        if (extension === '.xlsx' || extension === '.xlsm') return 'xlsx';
        if (extension === '.docx') return 'docx';
        if (extension === '.pptx') return 'pptx';
        return null;
      }
    },
    '@main/fileSearch/fileSearchWindow.service': {
      fileSearchWindowService: {
        bindPreviewReadWorkspace: async (request) => state.previewBinds.push(request),
        preparePreviewRead: async (grant) => {
          state.previewPrepares.push(grant);
          await state.assertOpenedFileCurrent();
          const descriptor = await state.describe();
          const pending = state.nextPreviewPrepareDeferred;
          state.nextPreviewPrepareDeferred = null;
          pending?.started.resolve(grant);
          if (pending) await pending.completion.promise;
          return {
            ...grant,
            runtimeInstanceId: 'preview-runtime-for-tests',
            descriptor
          };
        },
        cancelPreviewRead: async (request) => state.previewCancels.push(request),
        bindOfficeWorkspace: async (request) => state.officeBinds.push(request),
        prepareOfficeRead: async (grant) => {
          state.officePrepares.push(grant);
          const pending = state.nextOfficePrepareDeferred;
          state.nextOfficePrepareDeferred = null;
          pending?.started.resolve(grant);
          if (pending) await pending.completion.promise;
          return {
            grantId: grant.grantId,
            runtimeId: grant.runtimeId,
            selectionRevision: grant.selectionRevision,
            kind: grant.kind,
            size: 3,
            modifiedAt: 1
          };
        },
        openOfficeRead: async () => {
          throw new ContractError('OPERATION_FAILED', 'Office reader was not configured.');
        },
        readNextOfficeChunk: async () => {
          throw new ContractError('OPERATION_FAILED', 'Office reader was not configured.');
        },
        cancelOfficeRead: async (request) => state.officeCancels.push(request)
      }
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
    '@main/onlypreview/onlyPreviewProjectIndexState.service': {
      onlyPreviewProjectIndexStateService: {
        get: (workspaceId) => state.projectIndexState?.[workspaceId] ?? null
      }
    },
    '@main/onlypreview/onlyPreviewHost.registry': {
      onlyPreviewHostRegistry: hostRegistry
    },
    '@main/onlypreview/onlyPreviewWorkspace.registry': {
      onlyPreviewWorkspaceRegistry: workspaceRegistry
    },
    './onlyPreviewFind.service': { OnlyPreviewFindService: FakeFindService },
    './onlyPreviewPreviewAdapter.service': previewAdapterModule,
    './onlyPreviewPreviewView.service': viewModule,
    './onlyPreviewPreviewReadBroker.service': {
      OnlyPreviewPreviewReadBrokerService: FakePreviewReadBrokerService
    },
    './onlyPreviewSelectedFileIdentity.service': selectedFileIdentityModule,
    './onlyPreviewSelectionDelivery.service': {
      issueOnlyPreviewSelectionDelivery: ({ hostToken, selectionRevision, prepared, adapter }) => {
        let descriptor = prepared.descriptor;
        let navigationUrl = null;
        let assetIssued = false;
        if (adapter.adapterId === 'html-page') {
          navigationUrl = documentRegistry.issue(hostToken, prepared, selectionRevision);
          descriptor = { ...descriptor, assetUrl: navigationUrl };
        } else if (adapter.adapterId === 'chromium-pdf') {
          const limit = 100 * 1024 * 1024;
          navigationUrl = assetRegistry.issue(hostToken, prepared, descriptor.mimeType, {
            selectionRevision,
            maxBytes: Math.min(descriptor.size, limit)
          });
          descriptor = { ...descriptor, assetUrl: navigationUrl };
          assetIssued = true;
        } else if (adapter.adapterId === 'drawio-viewer') {
          descriptor = {
            ...descriptor,
            assetUrl: assetRegistry.issue(hostToken, prepared, descriptor.mimeType, {
              selectionRevision,
              maxBytes: Math.min(descriptor.size, 20 * 1024 * 1024)
            })
          };
          assetIssued = true;
        } else if (
          adapter.adapterId === 'image' ||
          adapter.adapterId === 'audio' ||
          adapter.adapterId === 'video'
        ) {
          const limit = {
            image: 100 * 1024 * 1024,
            audio: null,
            video: null
          }[adapter.adapterId];
          descriptor = {
            ...descriptor,
            assetUrl: assetRegistry.issue(hostToken, prepared, descriptor.mimeType, {
              selectionRevision,
              maxBytes: Math.min(descriptor.size, limit ?? descriptor.size),
              lifetime: 'selection'
            })
          };
          assetIssued = true;
        }
        return { descriptor, navigationUrl, assetIssued };
      }
    }
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
  // The layer service stub attaches through this window, so its sort is observable in `children`.
  state.window = window;
  const runtime = {
    window,
    host,
    createVuePreviewView: (previewRuntimeToken, officeBrokerCapability) => {
      const view = new FakeView('vue');
      view.previewRuntimeToken = previewRuntimeToken;
      view.officeBrokerCapability = officeBrokerCapability;
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
    },
    onActiveViewAttached: () => {
      state.activeViewAttachNotifications += 1;
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
