import { randomBytes, randomUUID } from 'node:crypto';
import {
  WebContentsView,
  webFrameMain,
  type BaseWindow,
  type Rectangle,
  type Session
} from 'electron';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import type {
  OnlyPreviewErrorCode,
  OnlyPreviewPreviewPresentation,
  OnlyPreviewPreviewSurface
} from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewHostCapability } from '@main/onlypreview/onlyPreviewHost.registry';
import { installOnlyPreviewSessionProtocol } from '@main/onlypreview/onlyPreviewProtocol.service';

export interface OnlyPreviewPreviewRegionRuntime {
  window: BaseWindow;
  host: OnlyPreviewHostCapability;
  createVuePreviewView: (
    previewRuntimeToken: string,
    officeBrokerCapability: string,
    previewReadBrokerCapability: string
  ) => WebContentsView;
  loadVuePreviewView: (view: WebContentsView) => Promise<void>;
  bindChromeShortcuts: (webContents: Electron.WebContents) => void;
  onActiveViewAttached?: () => void;
}

interface OnlyPreviewPreviewViewCallbacks {
  getActiveSurface: () => OnlyPreviewPreviewSurface | null;
  canAttachVue: () => boolean;
  getDocumentLoadingRevision: () => number | null;
  getDocumentLoadingError?: () => OnlyPreviewContractError;
  getDiagramLoadingRevision?: () => number | null;
  isCurrent: (runtime: OnlyPreviewPreviewRegionRuntime, revision: number) => boolean;
  bindFindWebContents: (
    surface: OnlyPreviewPreviewSurface,
    webContents: Electron.WebContents,
    generation: number
  ) => void;
  unbindFindWebContents: (
    surface: OnlyPreviewPreviewSurface,
    webContents: Electron.WebContents
  ) => void;
  onVueUnavailable: (
    runtime: OnlyPreviewPreviewRegionRuntime,
    error: unknown,
    recreate: boolean
  ) => void;
  onChromeReady: (
    runtime: OnlyPreviewPreviewRegionRuntime,
    view: WebContentsView,
    revision: number
  ) => void;
  onChromeUnavailable: (
    runtime: OnlyPreviewPreviewRegionRuntime,
    view: WebContentsView | null,
    revision: number,
    error: unknown
  ) => void;
  onActiveViewAttached: () => void;
}

interface PendingChromeMount {
  runtime: OnlyPreviewPreviewRegionRuntime;
  revision: number;
  navigationUrl: string;
  requireDocumentFrame: boolean;
}

/**
 * Chromium renders PDFs through its PDF viewer component extension, which creates a separate
 * document frame for the file. In an in-memory (non-`persist:`) session that document frame is
 * never created, so the viewer paints nothing while HTML — which needs no extension — renders
 * normally. The partition is therefore a constant: every distinct `persist:` name would leave its
 * own `userData/Partitions/<name>` directory behind, so a per-selection name cannot be persisted.
 * Per-selection isolation comes from the one-shot token, the session-scoped protocol handler, and
 * the storage/cache clear performed when no Chrome view is mounted.
 */
const ONLY_PREVIEW_CHROME_PARTITION = 'persist:onlypreview-chrome';

/** The exact PDF document frame must finish loading before a Chrome preview may be called ready. */
const DOCUMENT_FRAME_DEADLINE_MS = 8_000;

/** Session-level hardening outlives a single selection now that the session is shared. */
const hardenedChromeSessions = new WeakSet<Session>();

const IMAGE_RENDER_ERRORS: ReadonlySet<OnlyPreviewErrorCode> = new Set([
  'IMAGE_EMPTY',
  'IMAGE_READ_FAILED',
  'IMAGE_DECODE_FAILED'
]);
const MEDIA_RENDER_ERRORS: ReadonlySet<OnlyPreviewErrorCode> = new Set([
  'MEDIA_EMPTY',
  'MEDIA_READ_FAILED',
  'MEDIA_ABORTED',
  'MEDIA_NETWORK_FAILED',
  'MEDIA_DECODE_FAILED',
  'MEDIA_SOURCE_UNSUPPORTED'
]);
const TEXT_RENDER_ERRORS: ReadonlySet<OnlyPreviewErrorCode> = new Set([
  'INVALID_INPUT',
  'HOST_NOT_FOUND',
  'HOST_ROLE_DENIED',
  'WORKSPACE_NOT_FOUND',
  'WORKSPACE_ACCESS_DENIED',
  'PATH_NOT_FOUND',
  'PATH_PERMISSION_DENIED',
  'PATH_OUTSIDE_WORKSPACE',
  'PATH_NOT_REGULAR_FILE',
  'PATH_UNSUPPORTED_DEVICE',
  'TEXT_TOO_LARGE',
  'OPERATION_FAILED',
  'PROTOCOL_ERROR'
]);
const OFFICE_READ_ERRORS: readonly OnlyPreviewErrorCode[] = [
  'HOST_NOT_FOUND',
  'HOST_ROLE_DENIED',
  'WORKSPACE_NOT_FOUND',
  'WORKSPACE_ACCESS_DENIED',
  'PATH_NOT_FOUND',
  'PATH_PERMISSION_DENIED',
  'PATH_OUTSIDE_WORKSPACE',
  'PATH_NOT_REGULAR_FILE',
  'PATH_UNSUPPORTED_DEVICE',
  'PROTOCOL_ERROR'
];
const SHEET_RENDER_ERRORS: ReadonlySet<OnlyPreviewErrorCode> = new Set([
  ...OFFICE_READ_ERRORS,
  'INVALID_INPUT',
  'TEXT_TOO_LARGE',
  'SIGNATURE_MISMATCH',
  'OOXML_ARCHIVE_LIMIT',
  'OOXML_ENCRYPTED',
  'OOXML_ARCHIVE_INVALID',
  'SHEET_PARSE_FAILED',
  'SHEET_RENDER_FAILED',
  'SHEET_EMPTY',
  'SHEET_RENDER_TIMEOUT',
  'OPERATION_FAILED'
]);
const DOCUMENT_RENDER_ERRORS: ReadonlySet<OnlyPreviewErrorCode> = new Set([
  ...OFFICE_READ_ERRORS,
  'INVALID_INPUT',
  'TEXT_TOO_LARGE',
  'SIGNATURE_MISMATCH',
  'OOXML_ARCHIVE_LIMIT',
  'OOXML_ENCRYPTED',
  'OOXML_ARCHIVE_INVALID',
  'DOCUMENT_PARSE_FAILED',
  'DOCUMENT_RENDER_FAILED',
  'DOCUMENT_EMPTY',
  'DOCUMENT_SANITIZE_FAILED',
  'DOCUMENT_RENDER_TIMEOUT',
  'OPERATION_FAILED'
]);
const PRESENTATION_RENDER_ERRORS: ReadonlySet<OnlyPreviewErrorCode> = new Set([
  ...OFFICE_READ_ERRORS,
  'INVALID_INPUT',
  'TEXT_TOO_LARGE',
  'SIGNATURE_MISMATCH',
  'OOXML_ARCHIVE_LIMIT',
  'OOXML_ENCRYPTED',
  'OOXML_ARCHIVE_INVALID',
  'PRESENTATION_PARSE_FAILED',
  'PRESENTATION_RENDER_FAILED',
  'PRESENTATION_EMPTY',
  'PRESENTATION_RENDER_TIMEOUT',
  'OPERATION_FAILED'
]);
const DIAGRAM_RENDER_ERRORS: ReadonlySet<OnlyPreviewErrorCode> = new Set([
  'INVALID_INPUT',
  'TEXT_TOO_LARGE',
  'DIAGRAM_PARSE_FAILED',
  'DIAGRAM_EMPTY',
  'DIAGRAM_LIMIT',
  'DIAGRAM_RENDER_TIMEOUT',
  'OPERATION_FAILED',
  'PROTOCOL_ERROR'
]);

const effectiveDescriptorErrorCode = (
  presentation: OnlyPreviewPreviewPresentation
): OnlyPreviewErrorCode | null => {
  const errorCode = presentation.descriptor?.previewError?.code;
  if (!errorCode) return null;
  return errorCode === 'UNSUPPORTED_CODEC' ? 'OPERATION_FAILED' : errorCode;
};

export const presentationAllowsRendererError = (
  presentation: OnlyPreviewPreviewPresentation,
  errorCode: OnlyPreviewErrorCode
): boolean => {
  const adapterId = presentation.adapterId;
  switch (adapterId) {
    case 'monaco':
    case 'markdown-dom':
      return TEXT_RENDER_ERRORS.has(errorCode);
    case 'ooxml-xlsx':
      return SHEET_RENDER_ERRORS.has(errorCode);
    case 'ooxml-docx':
      return DOCUMENT_RENDER_ERRORS.has(errorCode);
    case 'ooxml-pptx':
      return PRESENTATION_RENDER_ERRORS.has(errorCode);
    case 'drawio-viewer':
      return DIAGRAM_RENDER_ERRORS.has(errorCode);
    case 'image':
      return IMAGE_RENDER_ERRORS.has(errorCode);
    case 'audio':
    case 'video':
      return MEDIA_RENDER_ERRORS.has(errorCode);
    case 'unsupported':
      return effectiveDescriptorErrorCode(presentation) === errorCode;
    case 'html-page':
    case 'chromium-pdf':
      return false;
  }
  const unreachableAdapter: never = adapterId;
  throw new OnlyPreviewContractError(
    'INVALID_INPUT',
    `Unknown Preview adapter ${String(unreachableAdapter)}.`
  );
};

const closeContentView = (view: WebContentsView | null): void => {
  if (!view || view.webContents.isDestroyed()) return;
  try {
    view.webContents.close();
  } catch {
    // The owner window may already have torn down the WebContents.
  }
};

const preventOnlyPreviewDownload = (event: Electron.Event, item: Electron.DownloadItem): void => {
  event.preventDefault();
  item.cancel();
};

export class OnlyPreviewPreviewViewService {
  private runtime: OnlyPreviewPreviewRegionRuntime | null = null;
  private vuePreviewView: WebContentsView | null = null;
  private vueRuntimeToken: string | null = null;
  private officeBrokerCapability: string | null = null;
  private previewReadBrokerCapability: string | null = null;
  private chromePreviewView: WebContentsView | null = null;
  private attachedView: WebContentsView | null = null;
  private chromeProtocolCleanup: (() => void) | null = null;
  private chromeSession: Session | null = null;
  private pendingChromeMount: PendingChromeMount | null = null;
  private contentBounds: Rectangle | null = null;
  private vueViewGeneration = 0;
  private chromeViewGeneration = 0;
  private documentWatchdog: {
    runtime: OnlyPreviewPreviewRegionRuntime;
    view: WebContentsView;
    runtimeToken: string;
    revision: number;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private documentFrameWatch: {
    view: WebContentsView;
    timer: ReturnType<typeof setTimeout>;
    listener: (
      event: Electron.Event,
      isMainFrame: boolean,
      frameProcessId: number,
      frameRoutingId: number
    ) => void;
  } | null = null;

  constructor(private readonly callbacks: OnlyPreviewPreviewViewCallbacks) {}

  start(runtime: OnlyPreviewPreviewRegionRuntime): void {
    this.destroy();
    this.runtime = runtime;
  }

  getVuePreviewView(): WebContentsView | null {
    return this.vuePreviewView;
  }

  getVueRuntimeToken(): string | null {
    return this.vueRuntimeToken;
  }

  getOfficeBrokerCapability(): string | null {
    return this.officeBrokerCapability;
  }

  getPreviewReadBrokerCapability(): string | null {
    return this.previewReadBrokerCapability;
  }

  getChromePreviewView(): WebContentsView | null {
    return this.chromePreviewView;
  }

  getBounds(): Rectangle | null {
    return this.contentBounds ? { ...this.contentBounds } : null;
  }

  updateBounds(bounds: Rectangle): void {
    if (
      !Number.isFinite(bounds.x) ||
      !Number.isFinite(bounds.y) ||
      !Number.isFinite(bounds.width) ||
      !Number.isFinite(bounds.height) ||
      bounds.x < 0 ||
      bounds.y < 0 ||
      bounds.width < 0 ||
      bounds.height < 0
    ) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview bounds are invalid.');
    }
    this.contentBounds = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height)
    };
    this.attachActiveView();
    this.mountPendingChromeSelection();
    this.armDocumentWatchdogIfEligible();
  }

  focusActiveContent(): boolean {
    const view =
      this.callbacks.getActiveSurface() === 'chrome' ? this.chromePreviewView : this.vuePreviewView;
    if (!view || view.webContents.isDestroyed()) return false;
    view.webContents.focus();
    return true;
  }

  ensureVuePreviewView(): WebContentsView | null {
    const runtime = this.runtime;
    if (!runtime) return null;
    if (this.vuePreviewView && !this.vuePreviewView.webContents.isDestroyed()) {
      this.armDocumentWatchdogIfEligible();
      return this.vuePreviewView;
    }
    const previewRuntimeToken = randomUUID();
    const officeBrokerCapability = randomBytes(32).toString('base64url');
    const previewReadBrokerCapability = randomBytes(32).toString('base64url');
    const view = runtime.createVuePreviewView(
      previewRuntimeToken,
      officeBrokerCapability,
      previewReadBrokerCapability
    );
    this.vuePreviewView = view;
    this.vueRuntimeToken = previewRuntimeToken;
    this.officeBrokerCapability = officeBrokerCapability;
    this.previewReadBrokerCapability = previewReadBrokerCapability;
    this.vueViewGeneration += 1;
    this.callbacks.bindFindWebContents('vue', view.webContents, this.vueViewGeneration);
    view.webContents.once('render-process-gone', (_event, details) => {
      this.invalidateVuePreviewView(
        view,
        new Error(`The Preview renderer exited (${details.reason}).`),
        true
      );
    });
    void runtime.loadVuePreviewView(view).catch((error) => {
      this.invalidateVuePreviewView(view, error, false);
    });
    this.armDocumentWatchdogIfEligible();
    return view;
  }

  invalidateVuePreviewView(view: WebContentsView, error: unknown, recreate: boolean): void {
    const runtime = this.runtime;
    if (!runtime || this.vuePreviewView !== view) return;
    this.clearDocumentWatchdog();
    this.detachView(view);
    this.callbacks.unbindFindWebContents('vue', view.webContents);
    closeContentView(view);
    this.vuePreviewView = null;
    this.vueRuntimeToken = null;
    this.officeBrokerCapability = null;
    this.previewReadBrokerCapability = null;
    this.callbacks.onVueUnavailable(runtime, error, recreate);
  }

  destroyVuePreviewView(view: WebContentsView | null = this.vuePreviewView): void {
    if (!view || this.vuePreviewView !== view) return;
    this.clearDocumentWatchdog();
    this.detachView(view);
    this.callbacks.unbindFindWebContents('vue', view.webContents);
    closeContentView(view);
    this.vuePreviewView = null;
    this.vueRuntimeToken = null;
    this.officeBrokerCapability = null;
    this.previewReadBrokerCapability = null;
  }

  async stageChromeSelection(
    runtime: OnlyPreviewPreviewRegionRuntime,
    revision: number,
    navigationUrl: string,
    requireDocumentFrame = false
  ): Promise<void> {
    if (!this.contentBounds) {
      this.pendingChromeMount = { runtime, revision, navigationUrl, requireDocumentFrame };
      return;
    }
    await this.mountChromeSelection(runtime, revision, navigationUrl, requireDocumentFrame);
  }

  clearPendingChromeSelection(): void {
    this.pendingChromeMount = null;
  }

  armDocumentWatchdogIfEligible(): void {
    const runtime = this.runtime;
    const view = this.vuePreviewView;
    const runtimeToken = this.vueRuntimeToken;
    const documentRevision = this.callbacks.getDocumentLoadingRevision();
    const diagramRevision = this.callbacks.getDiagramLoadingRevision?.() ?? null;
    const revision = diagramRevision ?? documentRevision;
    if (!runtime || !view || !runtimeToken || view.webContents.isDestroyed() || revision === null) {
      return;
    }
    if (
      this.documentWatchdog?.runtime === runtime &&
      this.documentWatchdog.view === view &&
      this.documentWatchdog.runtimeToken === runtimeToken &&
      this.documentWatchdog.revision === revision
    ) {
      return;
    }
    this.clearDocumentWatchdog();
    const timer = setTimeout(() => {
      const watchdog = this.documentWatchdog;
      const activeDiagramRevision = this.callbacks.getDiagramLoadingRevision?.() ?? null;
      const activeDocumentRevision = this.callbacks.getDocumentLoadingRevision();
      if (
        !watchdog ||
        watchdog.timer !== timer ||
        watchdog.runtime !== this.runtime ||
        watchdog.view !== this.vuePreviewView ||
        watchdog.runtimeToken !== this.vueRuntimeToken ||
        watchdog.revision !== (activeDiagramRevision ?? activeDocumentRevision)
      ) {
        return;
      }
      this.documentWatchdog = null;
      const isDiagram = watchdog.revision === activeDiagramRevision;
      const timeoutError = isDiagram
        ? new OnlyPreviewContractError(
            'DIAGRAM_RENDER_TIMEOUT',
            'Draw.io preview exceeded its rendering deadline.'
          )
        : (this.callbacks.getDocumentLoadingError?.() ??
          new OnlyPreviewContractError(
            'DOCUMENT_RENDER_TIMEOUT',
            'Document preview exceeded its rendering deadline.'
          ));
      this.invalidateVuePreviewView(watchdog.view, timeoutError, true);
    }, 30_000);
    this.documentWatchdog = { runtime, view, runtimeToken, revision, timer };
  }

  clearDocumentWatchdog(): void {
    if (!this.documentWatchdog) return;
    clearTimeout(this.documentWatchdog.timer);
    this.documentWatchdog = null;
  }

  attachActiveView(): void {
    const runtime = this.runtime;
    const activeSurface = this.callbacks.getActiveSurface();
    if (!runtime || !this.contentBounds || !activeSurface) return;
    const view = activeSurface === 'chrome' ? this.chromePreviewView : this.ensureVuePreviewView();
    if (!view || view.webContents.isDestroyed()) return;
    if (activeSurface === 'vue' && !this.callbacks.canAttachVue()) return;
    if (this.attachedView !== view) {
      this.detachActiveView();
      runtime.window.contentView.addChildView(view);
      this.attachedView = view;
      this.callbacks.onActiveViewAttached();
    }
    view.setBounds({ ...this.contentBounds });
  }

  detachActiveView(): void {
    if (this.attachedView) this.detachView(this.attachedView);
    this.attachedView = null;
  }

  destroyChromePreviewView(): void {
    const view = this.chromePreviewView;
    const targetSession = this.chromeSession;
    const protocolCleanup = this.chromeProtocolCleanup;
    this.chromePreviewView = null;
    this.chromeSession = null;
    this.chromeProtocolCleanup = null;
    this.clearDocumentFrameWatch();
    this.cleanupChromeResources(view, targetSession, protocolCleanup);
  }

  destroy(): void {
    this.clearDocumentWatchdog();
    this.detachActiveView();
    this.destroyChromePreviewView();
    this.destroyVuePreviewView();
    this.pendingChromeMount = null;
    this.runtime = null;
    this.contentBounds = null;
  }

  private async mountChromeSelection(
    runtime: OnlyPreviewPreviewRegionRuntime,
    revision: number,
    navigationUrl: string,
    requireDocumentFrame: boolean
  ): Promise<void> {
    let view: WebContentsView | null = null;
    let targetSession: Session | null = null;
    let localProtocolCleanup: (() => void) | null = null;
    try {
      if (!this.contentBounds || !this.callbacks.isCurrent(runtime, revision)) return;
      view = this.createChromePreviewView(runtime);
      targetSession = view.webContents.session;
      this.chromePreviewView = view;
      this.chromeSession = targetSession;
      await this.configureChromeSession(targetSession);
      if (this.chromePreviewView !== view || !this.callbacks.isCurrent(runtime, revision)) {
        this.cleanupChromeResources(view, targetSession, null);
        return;
      }
      localProtocolCleanup = installOnlyPreviewSessionProtocol(targetSession, navigationUrl);
      if (this.chromePreviewView !== view || !this.callbacks.isCurrent(runtime, revision)) {
        this.cleanupChromeResources(view, targetSession, localProtocolCleanup);
        return;
      }
      this.chromeProtocolCleanup = localProtocolCleanup;
      localProtocolCleanup = null;
      this.configureChromeNavigation(view, runtime, revision, navigationUrl, requireDocumentFrame);
      this.attachActiveView();
      await view.webContents.loadURL(navigationUrl);
    } catch (error) {
      if (view && targetSession && this.chromePreviewView !== view) {
        this.cleanupChromeResources(view, targetSession, localProtocolCleanup);
      } else {
        localProtocolCleanup?.();
      }
      if (!this.callbacks.isCurrent(runtime, revision)) return;
      this.callbacks.onChromeUnavailable(runtime, view, revision, error);
    }
  }

  private mountPendingChromeSelection(): void {
    const pending = this.pendingChromeMount;
    if (
      !pending ||
      !this.contentBounds ||
      !this.callbacks.isCurrent(pending.runtime, pending.revision)
    ) {
      return;
    }
    this.pendingChromeMount = null;
    void this.mountChromeSelection(
      pending.runtime,
      pending.revision,
      pending.navigationUrl,
      pending.requireDocumentFrame
    );
  }

  private createChromePreviewView(runtime: OnlyPreviewPreviewRegionRuntime): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        partition: ONLY_PREVIEW_CHROME_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        plugins: true
      }
    });
    view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    this.chromeViewGeneration += 1;
    this.callbacks.bindFindWebContents('chrome', view.webContents, this.chromeViewGeneration);
    runtime.bindChromeShortcuts(view.webContents);
    return view;
  }

  /**
   * The Chrome preview session is shared and persistent, so its hardening is installed once and is
   * never removed by a per-selection teardown: an out-of-order cleanup would otherwise leave the
   * next view running on an unhardened session.
   */
  private async configureChromeSession(targetSession: Session): Promise<void> {
    if (hardenedChromeSessions.has(targetSession)) return;
    hardenedChromeSessions.add(targetSession);
    targetSession.on('will-download', preventOnlyPreviewDownload);
    targetSession.setPermissionCheckHandler(() => false);
    targetSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false)
    );
    targetSession.webRequest.onBeforeRequest(
      {
        urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*', 'file://*/*']
      },
      (_details, callback) => callback({ cancel: true })
    );
    await targetSession.setProxy({
      mode: 'fixed_servers',
      proxyRules: 'http=127.0.0.1:9;https=127.0.0.1:9;socks=127.0.0.1:9',
      proxyBypassRules: '<-loopback>'
    });
  }

  private configureChromeNavigation(
    view: WebContentsView,
    runtime: OnlyPreviewPreviewRegionRuntime,
    revision: number,
    navigationUrl: string,
    requireDocumentFrame: boolean
  ): void {
    const webContents = view.webContents;
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const fenceNavigation = (event: Electron.Event, url: string): void => {
      if (url === navigationUrl) return;
      event.preventDefault();
    };
    webContents.on('will-navigate', fenceNavigation);
    webContents.on('will-redirect', fenceNavigation);
    webContents.on('will-frame-navigate', (event) => {
      if (event.isMainFrame && event.url === navigationUrl) return;
      event.preventDefault();
    });
    if (requireDocumentFrame) {
      this.awaitDocumentFrameFinish(view, runtime, revision, navigationUrl);
    } else {
      webContents.once('did-finish-load', () => {
        if (this.chromePreviewView !== view || !this.callbacks.isCurrent(runtime, revision)) return;
        this.callbacks.onChromeReady(runtime, view, revision);
      });
    }
    webContents.once('render-process-gone', (_event, details) => {
      if (this.chromePreviewView !== view || !this.callbacks.isCurrent(runtime, revision)) return;
      this.callbacks.onChromeUnavailable(
        runtime,
        view,
        revision,
        new Error(`The raw Preview renderer exited (${details.reason}).`)
      );
    });
  }

  /**
   * A blank PDF viewer still fires the main-frame `did-finish-load`, and a matching document frame
   * can exist before PDFium has loaded its page model. Readiness therefore requires the exact
   * current non-main frame's own `did-frame-finish-load` event.
   */
  private awaitDocumentFrameFinish(
    view: WebContentsView,
    runtime: OnlyPreviewPreviewRegionRuntime,
    revision: number,
    navigationUrl: string
  ): void {
    this.clearDocumentFrameWatch();
    const webContents = view.webContents;
    const listener = (
      _event: Electron.Event,
      isMainFrame: boolean,
      frameProcessId: number,
      frameRoutingId: number
    ): void => {
      if (this.documentFrameWatch?.listener !== listener) return;
      if (this.chromePreviewView !== view || !this.callbacks.isCurrent(runtime, revision)) {
        this.clearDocumentFrameWatch();
        return;
      }
      if (isMainFrame) return;
      const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
      if (
        !frame ||
        frame.isDestroyed() ||
        frame === webContents.mainFrame ||
        frame.url !== navigationUrl
      ) {
        return;
      }
      this.clearDocumentFrameWatch();
      this.callbacks.onChromeReady(runtime, view, revision);
      this.callbacks.onActiveViewAttached();
    };
    const timer = setTimeout(() => {
      if (this.documentFrameWatch?.timer !== timer) return;
      if (this.chromePreviewView !== view || !this.callbacks.isCurrent(runtime, revision)) {
        this.clearDocumentFrameWatch();
        return;
      }
      this.clearDocumentFrameWatch();
      this.callbacks.onChromeUnavailable(
        runtime,
        view,
        revision,
        new OnlyPreviewContractError(
          'PDF_VIEWER_UNAVAILABLE',
          'The built-in PDF viewer document frame did not finish loading for this file.'
        )
      );
    }, DOCUMENT_FRAME_DEADLINE_MS);
    this.documentFrameWatch = { view, timer, listener };
    webContents.on('did-frame-finish-load', listener);
  }

  private clearDocumentFrameWatch(): void {
    const watch = this.documentFrameWatch;
    if (!watch) return;
    this.documentFrameWatch = null;
    clearTimeout(watch.timer);
    if (!watch.view.webContents.isDestroyed()) {
      watch.view.webContents.removeListener('did-frame-finish-load', watch.listener);
    }
  }

  private detachView(view: WebContentsView): void {
    const window = this.runtime?.window;
    if (!window || window.isDestroyed()) return;
    try {
      window.contentView.removeChildView(view);
    } catch {
      // Electron may already have detached child views while the parent is closing.
    }
    if (this.attachedView === view) this.attachedView = null;
  }

  private cleanupChromeResources(
    view: WebContentsView | null,
    targetSession: Session | null,
    protocolCleanup: (() => void) | null
  ): void {
    protocolCleanup?.();
    if (view) this.detachView(view);
    if (view) this.callbacks.unbindFindWebContents('chrome', view.webContents);
    closeContentView(view);
    // The session is shared and stays hardened for its lifetime; only the data of the selection that
    // just ended is discarded, and only while no other Chrome view is mounted on it.
    if (targetSession && !this.chromePreviewView) {
      void targetSession.closeAllConnections().catch(() => undefined);
      void targetSession.clearStorageData().catch(() => undefined);
      void targetSession.clearCache().catch(() => undefined);
    }
  }
}
