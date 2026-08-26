import { randomUUID } from 'node:crypto';
import { WebContentsView, type BaseWindow, type Rectangle, type Session } from 'electron';
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
  createVuePreviewView: (previewRuntimeToken: string) => WebContentsView;
  loadVuePreviewView: (view: WebContentsView) => Promise<void>;
  bindChromeShortcuts: (webContents: Electron.WebContents) => void;
}

interface OnlyPreviewPreviewViewCallbacks {
  getActiveSurface: () => OnlyPreviewPreviewSurface | null;
  canAttachVue: () => boolean;
  getDocumentLoadingRevision: () => number | null;
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

/** The PDF viewer's document frame must appear before a Chrome preview may be called ready. */
const DOCUMENT_FRAME_POLL_INTERVAL_MS = 150;
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
const SHEET_RENDER_ERRORS: ReadonlySet<OnlyPreviewErrorCode> = new Set([
  'INVALID_INPUT',
  'TEXT_TOO_LARGE',
  'SIGNATURE_MISMATCH',
  'OOXML_ARCHIVE_LIMIT',
  'OOXML_ENCRYPTED',
  'OOXML_ARCHIVE_INVALID',
  'SHEET_PARSE_FAILED',
  'SHEET_EMPTY',
  'SHEET_RENDER_TIMEOUT',
  'OPERATION_FAILED'
]);
const DOCUMENT_RENDER_ERRORS: ReadonlySet<OnlyPreviewErrorCode> = new Set([
  'INVALID_INPUT',
  'TEXT_TOO_LARGE',
  'SIGNATURE_MISMATCH',
  'OOXML_ARCHIVE_LIMIT',
  'OOXML_ENCRYPTED',
  'OOXML_ARCHIVE_INVALID',
  'DOCUMENT_PARSE_FAILED',
  'DOCUMENT_EMPTY',
  'DOCUMENT_SANITIZE_FAILED',
  'DOCUMENT_RENDER_TIMEOUT',
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
    case 'xlsx-grid':
      return SHEET_RENDER_ERRORS.has(errorCode);
    case 'docx-dom':
      return DOCUMENT_RENDER_ERRORS.has(errorCode);
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

  focusActiveContent(): void {
    const view =
      this.callbacks.getActiveSurface() === 'chrome' ? this.chromePreviewView : this.vuePreviewView;
    if (!view || view.webContents.isDestroyed()) return;
    view.webContents.focus();
  }

  ensureVuePreviewView(): WebContentsView | null {
    const runtime = this.runtime;
    if (!runtime) return null;
    if (this.vuePreviewView && !this.vuePreviewView.webContents.isDestroyed()) {
      this.armDocumentWatchdogIfEligible();
      return this.vuePreviewView;
    }
    const previewRuntimeToken = randomUUID();
    const view = runtime.createVuePreviewView(previewRuntimeToken);
    this.vuePreviewView = view;
    this.vueRuntimeToken = previewRuntimeToken;
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
      this.invalidateVuePreviewView(
        watchdog.view,
        new OnlyPreviewContractError(
          isDiagram ? 'DIAGRAM_RENDER_TIMEOUT' : 'DOCUMENT_RENDER_TIMEOUT',
          isDiagram
            ? 'Draw.io preview exceeded its rendering deadline.'
            : 'Document preview exceeded its rendering deadline.'
        ),
        true
      );
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
    webContents.once('did-finish-load', () => {
      if (this.chromePreviewView !== view || !this.callbacks.isCurrent(runtime, revision)) return;
      if (!requireDocumentFrame) {
        this.callbacks.onChromeReady(runtime, view, revision);
        return;
      }
      this.awaitDocumentFrame(view, runtime, revision, navigationUrl);
    });
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
   * A blank PDF viewer still fires `did-finish-load`, so readiness for the Chromium PDF adapter
   * waits for the viewer's own document frame instead of trusting the navigation alone.
   */
  private awaitDocumentFrame(
    view: WebContentsView,
    runtime: OnlyPreviewPreviewRegionRuntime,
    revision: number,
    navigationUrl: string,
    waitedMs = 0
  ): void {
    if (this.chromePreviewView !== view || !this.callbacks.isCurrent(runtime, revision)) {
      this.clearDocumentFrameWatch();
      return;
    }
    if (this.hasDocumentFrame(view, navigationUrl)) {
      this.clearDocumentFrameWatch();
      this.callbacks.onChromeReady(runtime, view, revision);
      return;
    }
    if (waitedMs >= DOCUMENT_FRAME_DEADLINE_MS) {
      this.clearDocumentFrameWatch();
      this.callbacks.onChromeUnavailable(
        runtime,
        view,
        revision,
        new OnlyPreviewContractError(
          'PDF_VIEWER_UNAVAILABLE',
          'The built-in PDF viewer did not create a document frame for this file.'
        )
      );
      return;
    }
    this.clearDocumentFrameWatch();
    const timer = setTimeout(() => {
      if (this.documentFrameWatch?.timer !== timer) return;
      this.documentFrameWatch = null;
      this.awaitDocumentFrame(
        view,
        runtime,
        revision,
        navigationUrl,
        waitedMs + DOCUMENT_FRAME_POLL_INTERVAL_MS
      );
    }, DOCUMENT_FRAME_POLL_INTERVAL_MS);
    this.documentFrameWatch = { view, timer };
  }

  private hasDocumentFrame(view: WebContentsView, navigationUrl: string): boolean {
    const webContents = view.webContents;
    if (webContents.isDestroyed()) return false;
    const mainFrame = webContents.mainFrame;
    if (!mainFrame) return false;
    return mainFrame.framesInSubtree.some(
      (frame) => frame !== mainFrame && frame.url === navigationUrl
    );
  }

  private clearDocumentFrameWatch(): void {
    if (!this.documentFrameWatch) return;
    clearTimeout(this.documentFrameWatch.timer);
    this.documentFrameWatch = null;
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
