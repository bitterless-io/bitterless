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

let state;

class FakeSession extends EventEmitter {
  constructor() {
    super();
    this.protocol = { handle: async () => {}, unhandle: () => {} };
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
    return undefined;
  }
  async clearStorageData() {
    return undefined;
  }
  async clearCache() {
    return undefined;
  }
}

class FakeWebContents extends EventEmitter {
  constructor(kind) {
    super();
    this.kind = kind;
    this.session = new FakeSession();
    this.destroyed = false;
    this.loadedUrls = [];
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
  constructor(kind) {
    this.kind = kind;
    this.webContents = new FakeWebContents(kind);
    this.bounds = null;
  }

  setBounds(bounds) {
    this.bounds = { ...bounds };
  }
}

class FakeChromeView extends FakeView {
  constructor(options) {
    super('chrome');
    this.options = options;
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
          : extension === '.html'
            ? 'text/html; charset=utf-8'
            : 'text/plain; charset=utf-8',
    size: 3,
    modifiedAt: 1,
    language: kind === 'text' ? 'markdown' : null,
    previewError: null,
    ...(assetUrl ? { assetUrl } : {})
  };
};

const createState = () => ({
  broadcasts: [],
  vueViews: [],
  vueLoads: [],
  chromeViews: [],
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
  documentRevocations: 0,
  documentRevisionRevocations: [],
  assetUrlsRevoked: []
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
  revokeSelection: () => {
    state.assetRevocations += 1;
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
      OnlyPreviewContractError: ContractError,
      parseOnlyPreviewFileRef: (value) => value,
      toOnlyPreviewErrorPayload: (error) => ({
        code: error?.code ?? 'OPERATION_FAILED',
        message: error instanceof Error ? error.message : 'failed'
      })
    },
    '@shared/onlypreview/onlyPreview.types': {
      ONLY_PREVIEW_MAX_PDF_BYTES: 100 * 1024 * 1024,
      ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT: 'onlypreview/previewPresentation'
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
    '@main/onlypreview/onlyPreviewProtocol.service': {
      installOnlyPreviewSessionProtocol: (session, url) => {
        if (state.protocolError) throw state.protocolError;
        state.protocolInstalls.push({ session, url });
        return () => {
          state.protocolCleanups += 1;
        };
      }
    },
    '@main/onlypreview/onlyPreviewWorkspace.registry': {
      onlyPreviewWorkspaceRegistry: workspaceRegistry
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

test('first valid bounds creates Vue detached and exact reset acknowledgement attaches it', () => {
  const { service, children, additions } = createHarness();
  assert.equal(state.vueViews.length, 0);
  assert.equal(children.size, 0);

  service.updateBounds(host.hostToken, bounds);
  assert.equal(state.vueViews.length, 1);
  assert.equal(state.vueLoads.length, 1);
  assert.equal(children.size, 0);
  assert.equal(additions.length, 0);
  assert.throws(
    () => service.reportVueReady(host.hostToken, 0, state.vueViews[0].previewRuntimeToken),
    (error) => error.code === 'INVALID_INPUT'
  );

  const vue = acknowledgeCurrentVue(service);
  assert.equal(children.has(vue), true);
  assert.equal(additions.length, 1);
  assert.deepEqual(state.vueViews[0].bounds, bounds);
});

test('presentation broadcasts are host-only nudges and reject forged renderer state', () => {
  assert.equal(presentationModule.isOnlyPreviewPresentationNudge({ hostId: host.hostId }), true);
  assert.equal(
    presentationModule.isOnlyPreviewPresentationNudge({
      hostId: host.hostId,
      selectionRevision: Number.MAX_SAFE_INTEGER,
      status: 'ready'
    }),
    false
  );
  const region = source('src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts');
  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const vueStore = source('src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts');
  assert.match(region, /broadcast\(ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT, \{\s*hostId:/);
  assert.match(shellStore, /previewPresentation:\s*\(\) => void this\.syncPreviewPresentation\(\)/);
  assert.match(shellStore, /previewPresentationFetchGeneration/);
  assert.match(vueStore, /presentationFetchGeneration/);
  assert.doesNotMatch(vueStore, /expectedRevision/);
});

test('bounds updates during describe cannot reattach the stale Vue surface', async () => {
  const { service, children, additions } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const oldVue = acknowledgeCurrentVue(service);
  const pendingDescribe = deferred();
  state.describe = async () => pendingDescribe.promise;

  const presentation = service.present(host.hostToken, fileRef('notes/readme.md'));
  await tick();
  assert.equal(children.has(oldVue), false);
  const additionsBeforeResize = additions.length;
  service.updateBounds(host.hostToken, { ...bounds, width: 680 });
  assert.equal(additions.length, additionsBeforeResize);

  pendingDescribe.resolve(descriptorFor('notes/readme.md', 'text'));
  await presentation;
  assert.equal(children.has(oldVue), false);
  assert.equal(service.snapshot(host.hostToken).selectionRevision, 1);
  assert.throws(
    () => service.reportVueReset(host.hostToken, 0, oldVue.previewRuntimeToken),
    (error) => error.code === 'INVALID_INPUT'
  );
  acknowledgeCurrentVue(service);
  assert.equal(children.has(oldVue), true);
});

test('presentation revalidates the opened identity before installing any descriptor authority', async () => {
  const { service } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  state.describe = async () => descriptorFor('replaced.txt', 'text');
  state.assertOpenedFileCurrent = async () => {
    throw new ContractError('PATH_NOT_FOUND', 'replaced before presentation');
  };

  await service.present(host.hostToken, fileRef('replaced.txt'));

  const snapshot = service.snapshot(host.hostToken);
  assert.equal(snapshot.status, 'unavailable');
  assert.equal(snapshot.surface, 'vue');
  assert.equal(snapshot.error.code, 'PATH_NOT_FOUND');
  assert.equal(state.assetIssues.length, 0);
  assert.ok(state.documentRevocations > 0);
});

test('late HTML document issuance is revoked and cannot overwrite a newer Vue selection', async () => {
  const { service, children } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const vue = acknowledgeCurrentVue(service);
  const issue = { started: deferred(), completion: deferred() };
  state.nextDocumentIssueDeferred = issue;
  state.describe = async () => descriptorFor('stale.html', 'text');
  const stalePresentation = service.present(host.hostToken, fileRef('stale.html'));
  const issued = await issue.started.promise;

  state.describe = async () => descriptorFor('current.md', 'text');
  await service.present(host.hostToken, fileRef('current.md'));
  assert.equal(children.has(vue), false);
  assert.equal(service.snapshot(host.hostToken).fileRef.relativePath, 'current.md');
  assert.equal(service.snapshot(host.hostToken).selectionRevision, 2);

  issue.completion.resolve();
  await stalePresentation;
  assert.equal(service.snapshot(host.hostToken).fileRef.relativePath, 'current.md');
  assert.equal(state.chromeViews.length, 0);
  assert.equal(state.protocolInstalls.length, 0);
  assert.deepEqual(state.documentRevisionRevocations.at(-1), {
    hostToken: host.hostToken,
    revision: issued.revision
  });
  acknowledgeCurrentVue(service);
  assert.equal(children.has(vue), true);
});

test('Vue file transitions and workspace clear stay detached until the exact reset ack', async () => {
  const { service, children, additions } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const vue = acknowledgeCurrentVue(service);

  state.describe = async () => descriptorFor('first.md', 'text');
  await service.present(host.hostToken, fileRef('first.md'));
  vue.renderedRevision = 1;
  assert.equal(children.has(vue), false);
  acknowledgeCurrentVue(service);
  assert.equal(children.has(vue), true);

  state.describe = async () => descriptorFor('second.md', 'text');
  await service.present(host.hostToken, fileRef('second.md'));
  assert.equal(service.snapshot(host.hostToken).selectionRevision, 2);
  assert.equal(vue.renderedRevision, 1);
  assert.equal(children.has(vue), false);
  assert.throws(
    () => service.reportVueReset(host.hostToken, 1, vue.previewRuntimeToken),
    (error) => error.code === 'INVALID_INPUT'
  );
  assert.equal(children.has(vue), false);
  vue.renderedRevision = 2;
  acknowledgeCurrentVue(service);
  assert.equal(children.has(vue), true);

  service.clearWorkspace(host.hostToken, 'workspace-id');
  assert.equal(service.snapshot(host.hostToken).selectionRevision, 3);
  assert.equal(children.has(vue), false);
  assert.throws(
    () => service.reportVueReset(host.hostToken, 2, vue.previewRuntimeToken),
    (error) => error.code === 'INVALID_INPUT'
  );
  assert.equal(children.has(vue), false);
  vue.renderedRevision = 3;
  acknowledgeCurrentVue(service);
  assert.equal(children.has(vue), true);
  assert.equal(additions.at(-1), vue);
});

test('public presentation strips capabilities while the current Vue runtime receives media only', async () => {
  const { service } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const vueToken = state.vueViews[0].previewRuntimeToken;
  state.describe = async () => descriptorFor('image.png', 'image');
  await service.present(host.hostToken, fileRef('image.png'));
  const mediaUrl =
    state.assetIssues.at(-1) && `bitterless-preview://asset/${'a'.repeat(64)}/1-image.png`;

  assert.equal(service.snapshot(host.hostToken).descriptor.assetUrl, undefined);
  assert.equal(service.snapshotForVue(host.hostToken, vueToken).descriptor.assetUrl, mediaUrl);

  state.describe = async () => descriptorFor('page.html', 'text');
  await service.present(host.hostToken, fileRef('page.html'));
  assert.equal(service.snapshot(host.hostToken).descriptor.assetUrl, undefined);
  assert.equal(service.snapshotForVue(host.hostToken, vueToken).descriptor.assetUrl, undefined);
});

test('Vue text reads require the exact runtime, revision, file ref, and adapter and reject late bodies', async () => {
  const { service } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  state.describe = async () => descriptorFor('notes/readme.md', 'text');
  await service.present(host.hostToken, fileRef('notes/readme.md'));
  const vue = acknowledgeCurrentVue(service);
  const current = service.snapshot(host.hostToken);
  const request = {
    previewRuntimeToken: vue.previewRuntimeToken,
    selectionRevision: current.selectionRevision,
    ...current.fileRef,
    adapterId: 'markdown-dom'
  };

  assert.equal((await service.readText(host.hostToken, request)).text, 'markdown-dom');
  assert.equal(state.textReadCalls.length, 1);
  for (const forged of [
    { ...request, previewRuntimeToken: 'forged-runtime-token' },
    { ...request, selectionRevision: request.selectionRevision + 1 },
    { ...request, relativePath: 'other.md' },
    { ...request, adapterId: 'monaco' }
  ]) {
    await assert.rejects(
      service.readText(host.hostToken, forged),
      (error) => error.code === 'INVALID_INPUT' || error.code === 'HOST_ROLE_DENIED'
    );
  }
  assert.equal(state.textReadCalls.length, 1);

  const pending = deferred();
  state.readText = async () => await pending.promise;
  const staleRead = service.readText(host.hostToken, request);
  await tick();
  state.describe = async () => descriptorFor('next.md', 'text');
  await service.present(host.hostToken, fileRef('next.md'));
  pending.resolve({
    workspaceId: 'workspace-id',
    relativePath: 'notes/readme.md',
    text: 'stale',
    encoding: 'utf-8',
    size: 5
  });
  await assert.rejects(staleRead, (error) => error.code === 'INVALID_INPUT');
});

test('Chrome setup failure revokes authority and falls back to a truthful Vue error', async () => {
  const { service, children } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  state.describe = async () => descriptorFor('page.html', 'text');
  state.protocolError = new Error('protocol setup failed');

  await service.present(host.hostToken, fileRef('page.html'));
  const snapshot = service.snapshot(host.hostToken);
  assert.equal(snapshot.surface, 'vue');
  assert.equal(snapshot.status, 'unavailable');
  assert.equal(snapshot.selectionRevision, 2);
  assert.match(snapshot.error.message, /protocol setup failed/);
  assert.equal(state.chromeViews[0].webContents.destroyed, true);
  assert.equal(children.has(state.vueViews[0]), false);
  acknowledgeCurrentVue(service);
  assert.equal(children.has(state.vueViews[0]), true);
  assert.ok(state.assetRevocations > 0);
  assert.ok(state.documentRevocations > 0);
});

test('a delayed proxy setup cannot install stale protocol state after a newer selection', async () => {
  const { service, children } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const proxy = { started: deferred(), completion: deferred() };
  state.nextProxyDeferred = proxy;
  state.describe = async () => descriptorFor('page.html', 'text');
  const stalePresentation = service.present(host.hostToken, fileRef('page.html'));
  await proxy.started.promise;
  const staleChrome = state.chromeViews[0];

  state.describe = async () => descriptorFor('notes/readme.md', 'text');
  await service.present(host.hostToken, fileRef('notes/readme.md'));
  proxy.completion.resolve();
  await stalePresentation;

  assert.equal(state.protocolInstalls.length, 0);
  assert.equal(staleChrome.webContents.destroyed, true);
  assert.equal(service.snapshot(host.hostToken).surface, 'vue');
  assert.equal(service.snapshot(host.hostToken).selectionRevision, 2);
  acknowledgeCurrentVue(service);
  assert.equal(children.has(state.vueViews[0]), true);
});

test('same-kind Chrome transitions and Chrome to Vue keep exactly one view and clean session state', async () => {
  const { service, children } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const present = async (relativePath, kind) => {
    state.describe = async () => descriptorFor(relativePath, kind);
    await service.present(host.hostToken, fileRef(relativePath));
    assert.equal(children.size, 1);
    return state.chromeViews.at(-1);
  };

  const firstHtml = await present('first.html', 'text');
  assert.equal(firstHtml.webContents.session.listenerCount('will-download'), 1);
  const secondHtml = await present('second.html', 'text');
  assert.equal(firstHtml.webContents.destroyed, true);
  assert.equal(firstHtml.webContents.session.listenerCount('will-download'), 0);
  assert.equal(secondHtml.webContents.session.listenerCount('will-download'), 1);
  assert.equal(state.protocolCleanups, 1);

  const firstPdf = await present('first.pdf', 'pdf');
  assert.equal(secondHtml.webContents.destroyed, true);
  assert.equal(secondHtml.webContents.session.listenerCount('will-download'), 0);
  assert.equal(firstPdf.webContents.session.listenerCount('will-download'), 1);
  assert.equal(state.protocolCleanups, 2);

  const secondPdf = await present('second.pdf', 'pdf');
  assert.equal(firstPdf.webContents.destroyed, true);
  assert.equal(firstPdf.webContents.session.listenerCount('will-download'), 0);
  assert.equal(secondPdf.webContents.session.listenerCount('will-download'), 1);
  assert.equal(state.protocolCleanups, 3);

  state.describe = async () => descriptorFor('notes/readme.md', 'text');
  await service.present(host.hostToken, fileRef('notes/readme.md'));
  assert.equal(secondPdf.webContents.destroyed, true);
  assert.equal(secondPdf.webContents.session.listenerCount('will-download'), 0);
  assert.equal(state.protocolCleanups, 4);
  assert.equal(state.protocolInstalls.length, 4);
  assert.equal(children.size, 0);
  acknowledgeCurrentVue(service);
  assert.equal([...children][0].kind, 'vue');
});

test('manual Chrome refresh replaces the raw view and destroy removes protocol and download listeners', async () => {
  const { service, children } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  state.describe = async () => descriptorFor('page.html', 'text');
  await service.present(host.hostToken, fileRef('page.html'));
  const firstChrome = state.chromeViews[0];

  await service.refresh(host.hostToken);
  const refreshedChrome = state.chromeViews[1];
  assert.equal(firstChrome.webContents.destroyed, true);
  assert.equal(firstChrome.webContents.session.listenerCount('will-download'), 0);
  assert.equal(refreshedChrome.webContents.session.listenerCount('will-download'), 1);
  assert.equal(state.protocolCleanups, 1);
  assert.equal(children.size, 1);

  service.destroy();
  assert.equal(refreshedChrome.webContents.destroyed, true);
  assert.equal(refreshedChrome.webContents.session.listenerCount('will-download'), 0);
  assert.equal(state.protocolCleanups, 2);
  assert.equal(state.protocolInstalls.length, 2);
  assert.equal(children.size, 0);
});

test('Chrome crash increments revision, tears down the raw view, and rejects its old revision', async () => {
  const { service, children } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const vueToken = state.vueViews[0].previewRuntimeToken;
  state.describe = async () => descriptorFor('page.html', 'text');
  await service.present(host.hostToken, fileRef('page.html'));
  const chrome = state.chromeViews[0];
  assert.equal(chrome.webContents.webRTCIPHandlingPolicy, 'disable_non_proxied_udp');
  assert.equal(chrome.webContents.session.proxyConfig.proxyBypassRules, '<-loopback>');

  chrome.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  const snapshot = service.snapshot(host.hostToken);
  assert.equal(snapshot.selectionRevision, 2);
  assert.equal(snapshot.surface, 'vue');
  assert.equal(snapshot.status, 'unavailable');
  assert.equal(chrome.webContents.destroyed, true);
  assert.equal(children.has(state.vueViews[0]), false);
  assert.throws(
    () => service.reportVueReady(host.hostToken, 1, vueToken),
    (error) => error.code === 'INVALID_INPUT'
  );
  acknowledgeCurrentVue(service);
  assert.equal(children.has(state.vueViews[0]), true);
});

test('Vue crash rotates runtime capability and revision; same-revision error clears text ability', async () => {
  const { service, children } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const originalVue = state.vueViews[0];
  const originalToken = originalVue.previewRuntimeToken;
  state.describe = async () => descriptorFor('notes/readme.md', 'text');
  await service.present(host.hostToken, fileRef('notes/readme.md'));
  acknowledgeCurrentVue(service);
  service.reportVueReady(host.hostToken, 1, originalToken);
  assert.equal(service.snapshot(host.hostToken).selectedTextAvailable, true);
  service.reportVueError(host.hostToken, 1, originalToken, 'OPERATION_FAILED');
  assert.equal(service.snapshot(host.hostToken).selectedTextAvailable, false);

  originalVue.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  const replacementVue = state.vueViews[1];
  assert.ok(replacementVue);
  assert.notEqual(replacementVue.previewRuntimeToken, originalToken);
  assert.equal(service.snapshot(host.hostToken).selectionRevision, 2);
  assert.equal(children.has(replacementVue), false);
  assert.throws(
    () => service.reportVueReady(host.hostToken, 2, originalToken),
    (error) => error.code === 'HOST_ROLE_DENIED'
  );
  assert.throws(
    () => service.reportVueReady(host.hostToken, 1, replacementVue.previewRuntimeToken),
    (error) => error.code === 'INVALID_INPUT'
  );
  acknowledgeCurrentVue(service);
  assert.equal(children.has(replacementVue), true);
});

test('Vue bundle load failure publishes unavailable without an automatic recreate loop', async () => {
  const { service, children } = createHarness();
  state.nextVueLoadError = new Error('bundle unavailable');
  service.updateBounds(host.hostToken, bounds);
  await tick();

  assert.equal(state.vueViews.length, 1);
  assert.equal(state.vueViews[0].webContents.destroyed, true);
  assert.equal(children.size, 0);
  assert.equal(service.snapshot(host.hostToken).status, 'unavailable');
  assert.match(service.snapshot(host.hostToken).error.message, /bundle unavailable/);

  state.describe = async () => descriptorFor('notes/readme.md', 'text');
  await service.present(host.hostToken, fileRef('notes/readme.md'));
  assert.equal(state.vueViews.length, 2);
  assert.equal(children.has(state.vueViews[1]), false);
  acknowledgeCurrentVue(service);
  assert.equal(children.has(state.vueViews[1]), true);
});

test('raw Chrome source and window helper keep the hardened topology contract', () => {
  const region = source('src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts');
  const helper = source('src/main/windows/onlyPreviewWindow.helper.ts');
  const chromePreferences = region.slice(
    region.indexOf('private createChromePreviewView('),
    region.indexOf('private configureChromeSession(')
  );

  assert.match(chromePreferences, /partition:\s*`onlypreview-chrome-/);
  assert.match(chromePreferences, /sandbox:\s*true/);
  assert.match(chromePreferences, /contextIsolation:\s*true/);
  assert.match(chromePreferences, /nodeIntegration:\s*false/);
  assert.match(chromePreferences, /webSecurity:\s*true/);
  assert.match(chromePreferences, /plugins:\s*true/);
  assert.doesNotMatch(chromePreferences, /preload|additionalArguments/);
  assert.match(region, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(region, /setProxy\(/);
  assert.match(region, /disable_non_proxied_udp/);
  assert.match(region, /closeAllConnections/);
  assert.match(helper, /PREVIEW_TOOLBAR_HEIGHT = 43/);
  assert.match(helper, /MENU_BAR_HEIGHT \+ PREVIEW_TOOLBAR_HEIGHT/);
  assert.match(helper, /onlyPreviewPreviewRegionService\.updateBounds/);
  assert.match(helper, /onlyPreviewPreviewRegionService\.destroy/);
});
