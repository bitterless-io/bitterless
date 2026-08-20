import { randomUUID } from 'node:crypto';
import { BaseWindow, WebContentsView, type Rectangle, type Session } from 'electron';
import { xpcMain } from 'electron-xpc/main';
import {
  OnlyPreviewContractError,
  parseOnlyPreviewFileRef,
  toOnlyPreviewErrorPayload
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_MAX_IMAGE_BYTES,
  ONLY_PREVIEW_MAX_PDF_BYTES,
  ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT,
  type OnlyPreviewDescriptor,
  type OnlyPreviewErrorCode,
  type OnlyPreviewFileRef,
  type OnlyPreviewPreviewAdapterId,
  type OnlyPreviewPreviewPresentation,
  type OnlyPreviewPreviewSurface,
  type OnlyPreviewTextContent,
  type OnlyPreviewTextReadRequest
} from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewSearchWatchCommit } from '@shared/onlypreview/onlyPreviewSearch.type';
import { onlyPreviewAssetRegistry } from '@main/onlypreview/onlyPreviewAsset.registry';
import { onlyPreviewClassifierService } from '@main/onlypreview/onlyPreviewClassifier.service';
import { onlyPreviewDocumentRegistry } from '@main/onlypreview/onlyPreviewDocument.registry';
import {
  onlyPreviewHostRegistry,
  type OnlyPreviewHostCapability
} from '@main/onlypreview/onlyPreviewHost.registry';
import { installOnlyPreviewSessionProtocol } from '@main/onlypreview/onlyPreviewProtocol.service';
import { onlyPreviewWorkspaceRegistry } from '@main/onlypreview/onlyPreviewWorkspace.registry';

interface OnlyPreviewPreviewRegionRuntime {
  window: BaseWindow;
  host: OnlyPreviewHostCapability;
  createVuePreviewView: (previewRuntimeToken: string) => WebContentsView;
  loadVuePreviewView: (view: WebContentsView) => Promise<void>;
  bindChromeShortcuts: (webContents: Electron.WebContents) => void;
}

const emptyPresentation = (
  hostId: string,
  selectionRevision: number
): OnlyPreviewPreviewPresentation => ({
  hostId,
  workspaceId: null,
  selectionRevision,
  surface: 'vue',
  adapterId: 'unsupported',
  status: 'empty',
  fileRef: null,
  descriptor: null,
  error: null,
  selectedTextAvailable: false
});

const adapterForDescriptor = (
  descriptor: OnlyPreviewDescriptor
): { surface: OnlyPreviewPreviewSurface; adapterId: OnlyPreviewPreviewAdapterId } => {
  if (descriptor.previewError) return { surface: 'vue', adapterId: 'unsupported' };
  if (descriptor.extension === '.html' || descriptor.extension === '.htm') {
    return { surface: 'chrome', adapterId: 'html-page' };
  }
  if (descriptor.kind === 'pdf') {
    return { surface: 'chrome', adapterId: 'chromium-pdf' };
  }
  if (descriptor.kind === 'text') {
    return descriptor.extension === '.md'
      ? { surface: 'vue', adapterId: 'markdown-dom' }
      : { surface: 'vue', adapterId: 'monaco' };
  }
  if (descriptor.kind === 'image') return { surface: 'vue', adapterId: 'image' };
  if (descriptor.kind === 'audio') return { surface: 'vue', adapterId: 'audio' };
  if (descriptor.kind === 'video') return { surface: 'vue', adapterId: 'video' };
  return { surface: 'vue', adapterId: 'unsupported' };
};

const adapterProvidesSelectedText = (adapterId: OnlyPreviewPreviewAdapterId): boolean =>
  adapterId === 'monaco' || adapterId === 'markdown-dom';

const descriptorErrorPayload = (
  descriptor: OnlyPreviewDescriptor
): OnlyPreviewPreviewPresentation['error'] => {
  if (!descriptor.previewError) return null;
  return {
    code:
      descriptor.previewError.code === 'UNSUPPORTED_CODEC'
        ? 'OPERATION_FAILED'
        : descriptor.previewError.code,
    message: descriptor.previewError.message
  };
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

export class OnlyPreviewPreviewRegionService {
  private runtime: OnlyPreviewPreviewRegionRuntime | null = null;
  private vuePreviewView: WebContentsView | null = null;
  private vueRuntimeToken: string | null = null;
  private chromePreviewView: WebContentsView | null = null;
  private attachedView: WebContentsView | null = null;
  private chromeProtocolCleanup: (() => void) | null = null;
  private chromeSession: Session | null = null;
  private pendingChromeMount: {
    runtime: OnlyPreviewPreviewRegionRuntime;
    revision: number;
    navigationUrl: string;
  } | null = null;
  private contentBounds: Rectangle | null = null;
  private selectionRevision = 0;
  private activePreviewSurface: OnlyPreviewPreviewSurface | null = 'vue';
  private vueResetAcknowledgedRevision: number | null = null;
  private activeFileIdentity: {
    workspaceId: string;
    relativePath: string;
    realPath: string;
    size: number;
    deviceId: bigint;
    inode: bigint;
    modifiedTimeNanoseconds: bigint;
  } | null = null;
  private presentation: OnlyPreviewPreviewPresentation = emptyPresentation('', 0);

  start(runtime: OnlyPreviewPreviewRegionRuntime): void {
    this.destroy();
    this.runtime = runtime;
    this.activePreviewSurface = 'vue';
    this.vueResetAcknowledgedRevision = null;
    this.presentation = emptyPresentation(runtime.host.hostId, this.selectionRevision);
  }

  getVuePreviewView(): WebContentsView | null {
    return this.vuePreviewView;
  }

  getBounds(): Rectangle | null {
    return this.contentBounds ? { ...this.contentBounds } : null;
  }

  updateBounds(hostToken: string, bounds: Rectangle): void {
    this.requireRuntime(hostToken);
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
  }

  async present(hostToken: string, value: unknown): Promise<void> {
    const runtime = this.requireRuntime(hostToken);
    const fileRef = parseOnlyPreviewFileRef(value);
    const revision = this.beginTransition(fileRef);
    let opened: Awaited<ReturnType<typeof onlyPreviewWorkspaceRegistry.openFile>> | null = null;
    let descriptor: OnlyPreviewDescriptor | null = null;
    try {
      opened = await onlyPreviewWorkspaceRegistry.openFile(runtime.host.hostToken, fileRef);
      if (!this.isCurrent(runtime, revision)) return;
      descriptor = await onlyPreviewClassifierService.describe(opened);
      if (!this.isCurrent(runtime, revision)) {
        return;
      }
      await onlyPreviewWorkspaceRegistry.assertOpenedFileCurrent(opened);
      if (!this.isCurrent(runtime, revision)) return;
      const adapter = adapterForDescriptor(descriptor);
      let navigationUrl: string | null = null;
      if (adapter.adapterId === 'html-page') {
        navigationUrl = await onlyPreviewDocumentRegistry.issue(opened, revision);
        if (!this.isCurrent(runtime, revision)) {
          onlyPreviewDocumentRegistry.revokeSelection(runtime.host.hostToken, revision);
          return;
        }
        descriptor = { ...descriptor, assetUrl: navigationUrl };
      } else if (adapter.adapterId === 'chromium-pdf') {
        navigationUrl = onlyPreviewAssetRegistry.issue(opened, descriptor.mimeType, {
          selectionRevision: revision,
          maxBytes: Math.min(opened.size, ONLY_PREVIEW_MAX_PDF_BYTES)
        });
        descriptor = { ...descriptor, assetUrl: navigationUrl };
      } else if (
        adapter.adapterId === 'image' ||
        adapter.adapterId === 'audio' ||
        adapter.adapterId === 'video'
      ) {
        const maxBytes =
          adapter.adapterId === 'image'
            ? Math.min(opened.size, ONLY_PREVIEW_MAX_IMAGE_BYTES)
            : opened.size;
        descriptor = {
          ...descriptor,
          assetUrl: onlyPreviewAssetRegistry.issue(opened, descriptor.mimeType, {
            selectionRevision: revision,
            maxBytes
          })
        };
      }

      await onlyPreviewWorkspaceRegistry.assertOpenedFileCurrent(opened);
      if (!this.isCurrent(runtime, revision)) return;

      this.activeFileIdentity = {
        workspaceId: opened.workspace.workspaceId,
        relativePath: opened.relativePath,
        realPath: opened.realPath,
        size: opened.size,
        deviceId: opened.deviceId,
        inode: opened.inode,
        modifiedTimeNanoseconds: opened.modifiedTimeNanoseconds
      };

      this.activePreviewSurface = adapter.surface;
      this.presentation = {
        hostId: runtime.host.hostId,
        workspaceId: fileRef.workspaceId,
        selectionRevision: revision,
        surface: adapter.surface,
        adapterId: adapter.adapterId,
        status: 'loading',
        fileRef,
        descriptor,
        error: descriptorErrorPayload(descriptor),
        selectedTextAvailable: adapterProvidesSelectedText(adapter.adapterId)
      };
      this.publishPresentation();

      if (adapter.surface === 'chrome' && navigationUrl) {
        if (this.contentBounds) {
          await this.mountChromeSelection(runtime, revision, navigationUrl);
        } else {
          this.pendingChromeMount = { runtime, revision, navigationUrl };
        }
      } else {
        this.attachActiveView();
      }
    } catch (error) {
      if (!this.isCurrent(runtime, revision)) return;
      this.revokeCurrentAuthority();
      this.activeFileIdentity = null;
      this.detachActiveView();
      this.destroyChromePreviewView();
      this.activePreviewSurface = 'vue';
      this.presentation = {
        hostId: runtime.host.hostId,
        workspaceId: fileRef.workspaceId,
        selectionRevision: revision,
        surface: 'vue',
        adapterId: 'unsupported',
        status: 'unavailable',
        fileRef,
        descriptor,
        error: toOnlyPreviewErrorPayload(error),
        selectedTextAvailable: false
      };
      this.publishPresentation();
      this.attachActiveView();
    } finally {
      await opened?.fileHandle.close().catch(() => undefined);
    }
  }

  async refresh(hostToken: string): Promise<void> {
    const runtime = this.requireRuntime(hostToken);
    const fileRef = this.presentation.fileRef;
    if (!fileRef) return;
    await this.present(runtime.host.hostToken, fileRef);
  }

  async handleWatchCommit(hostToken: string, commit: OnlyPreviewSearchWatchCommit): Promise<void> {
    const runtime = this.requireRuntime(hostToken);
    const fileRef = this.presentation.fileRef;
    if (!fileRef || fileRef.workspaceId !== commit.workspaceId) return;
    if (
      !commit.full &&
      !commit.changedRelativePaths.some(
        (relativePath) =>
          relativePath === fileRef.relativePath ||
          fileRef.relativePath.startsWith(`${relativePath}/`)
      )
    ) {
      return;
    }
    await this.present(runtime.host.hostToken, fileRef);
  }

  clearWorkspace(hostToken: string, workspaceId: string | null = null): void {
    const runtime = this.requireRuntime(hostToken);
    this.beginTransition(null);
    this.activePreviewSurface = 'vue';
    this.presentation = {
      ...emptyPresentation(runtime.host.hostId, this.selectionRevision),
      workspaceId
    };
    this.publishPresentation();
    this.attachActiveView();
  }

  snapshot(hostToken: string): OnlyPreviewPreviewPresentation {
    this.requireRuntime(hostToken);
    return this.snapshotInternal();
  }

  snapshotForVue(hostToken: string, previewRuntimeToken: string): OnlyPreviewPreviewPresentation {
    this.requireVueRuntime(hostToken, previewRuntimeToken);
    return this.snapshotInternal(true);
  }

  async readText(
    hostToken: string,
    request: Omit<OnlyPreviewTextReadRequest, 'hostToken'>
  ): Promise<OnlyPreviewTextContent> {
    const runtime = this.requireRuntime(hostToken);
    this.requireCurrentVueRevision(
      hostToken,
      request.selectionRevision,
      request.previewRuntimeToken
    );
    const fileRef = this.presentation.fileRef;
    if (
      !fileRef ||
      fileRef.workspaceId !== request.workspaceId ||
      fileRef.relativePath !== request.relativePath ||
      this.presentation.adapterId !== request.adapterId ||
      this.presentation.descriptor?.kind !== 'text' ||
      this.presentation.status !== 'loading'
    ) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'Preview text request does not match the current selection.'
      );
    }

    const opened = await onlyPreviewWorkspaceRegistry.openFile(runtime.host.hostToken, fileRef);
    try {
      if (!this.isCurrent(runtime, request.selectionRevision) || !this.matchesActiveFile(opened)) {
        throw new OnlyPreviewContractError(
          'PATH_NOT_FOUND',
          'The selected file changed before its text could be read.'
        );
      }
      const result = await onlyPreviewClassifierService.readText(opened, request.adapterId);
      this.requireCurrentVueRevision(
        hostToken,
        request.selectionRevision,
        request.previewRuntimeToken
      );
      if (!this.matchesActiveFile(opened)) {
        throw new OnlyPreviewContractError(
          'PATH_NOT_FOUND',
          'The selected file changed while its text was being read.'
        );
      }
      return result;
    } finally {
      await opened.fileHandle.close().catch(() => undefined);
    }
  }

  reportVueReset(hostToken: string, selectionRevision: number, previewRuntimeToken: string): void {
    this.requireCurrentVueRevision(hostToken, selectionRevision, previewRuntimeToken, false);
    this.vueResetAcknowledgedRevision = selectionRevision;
    this.attachActiveView();
  }

  reportVueReady(hostToken: string, selectionRevision: number, previewRuntimeToken: string): void {
    this.requireCurrentVueRevision(hostToken, selectionRevision, previewRuntimeToken);
    this.presentation = { ...this.presentation, status: 'ready', error: null };
    this.publishPresentation();
  }

  reportVueError(
    hostToken: string,
    selectionRevision: number,
    previewRuntimeToken: string,
    errorCode: OnlyPreviewErrorCode
  ): void {
    this.requireCurrentVueRevision(hostToken, selectionRevision, previewRuntimeToken);
    this.presentation = {
      ...this.presentation,
      status: 'unavailable',
      error: toOnlyPreviewErrorPayload(
        new OnlyPreviewContractError(errorCode, 'The selected file could not be rendered.')
      ),
      selectedTextAvailable: false
    };
    this.publishPresentation();
  }

  destroy(): void {
    const runtime = this.runtime;
    this.revokeCurrentAuthority();
    this.detachActiveView();
    this.destroyChromePreviewView();
    closeContentView(this.vuePreviewView);
    this.vuePreviewView = null;
    this.vueRuntimeToken = null;
    this.vueResetAcknowledgedRevision = null;
    this.activeFileIdentity = null;
    this.pendingChromeMount = null;
    this.runtime = null;
    this.contentBounds = null;
    this.activePreviewSurface = null;
    if (runtime) {
      this.presentation = emptyPresentation(runtime.host.hostId, this.selectionRevision);
    }
  }

  private beginTransition(fileRef: OnlyPreviewFileRef | null): number {
    const runtime = this.runtime;
    if (!runtime) throw new Error('OnlyPreview Preview Region is not running.');
    this.selectionRevision += 1;
    this.revokeCurrentAuthority();
    this.detachActiveView();
    this.destroyChromePreviewView();
    this.pendingChromeMount = null;
    this.activePreviewSurface = null;
    this.vueResetAcknowledgedRevision = null;
    this.activeFileIdentity = null;
    this.presentation = {
      ...emptyPresentation(runtime.host.hostId, this.selectionRevision),
      workspaceId: fileRef?.workspaceId ?? null,
      status: fileRef ? 'loading' : 'empty',
      fileRef
    };
    this.publishPresentation();
    return this.selectionRevision;
  }

  private revokeCurrentAuthority(): void {
    const hostToken = this.runtime?.host.hostToken;
    if (!hostToken) return;
    onlyPreviewDocumentRegistry.revokeSelection(hostToken);
    onlyPreviewAssetRegistry.revokeSelection(hostToken);
  }

  private ensureVuePreviewView(): WebContentsView | null {
    const runtime = this.runtime;
    if (!runtime) return null;
    if (this.vuePreviewView && !this.vuePreviewView.webContents.isDestroyed()) {
      return this.vuePreviewView;
    }
    const previewRuntimeToken = randomUUID();
    const view = runtime.createVuePreviewView(previewRuntimeToken);
    this.vuePreviewView = view;
    this.vueRuntimeToken = previewRuntimeToken;
    view.webContents.once('render-process-gone', (_event, details) => {
      this.markVueUnavailable(
        runtime,
        view,
        new Error(`The Preview renderer exited (${details.reason}).`),
        true
      );
    });
    void runtime.loadVuePreviewView(view).catch((error) => {
      this.markVueUnavailable(runtime, view, error, false);
    });
    return view;
  }

  private markVueUnavailable(
    runtime: OnlyPreviewPreviewRegionRuntime,
    view: WebContentsView,
    error: unknown,
    recreate: boolean
  ): void {
    if (this.vuePreviewView !== view || this.runtime !== runtime) return;
    this.detachView(view);
    closeContentView(view);
    this.vuePreviewView = null;
    this.vueRuntimeToken = null;
    this.vueResetAcknowledgedRevision = null;
    if (this.activePreviewSurface !== 'vue') return;
    this.selectionRevision += 1;
    this.revokeCurrentAuthority();
    this.presentation = {
      ...this.presentation,
      selectionRevision: this.selectionRevision,
      status: 'unavailable',
      error: toOnlyPreviewErrorPayload(error),
      selectedTextAvailable: false
    };
    this.publishPresentation();
    if (!recreate) return;
    try {
      this.ensureVuePreviewView();
      this.attachActiveView();
    } catch {
      // Keep the published unavailable state if the replacement view cannot be created.
    }
  }

  private async mountChromeSelection(
    runtime: OnlyPreviewPreviewRegionRuntime,
    revision: number,
    navigationUrl: string
  ): Promise<void> {
    let view: WebContentsView | null = null;
    let targetSession: Session | null = null;
    let localProtocolCleanup: (() => void) | null = null;
    try {
      if (!this.contentBounds || !this.isCurrent(runtime, revision)) return;
      view = this.createChromePreviewView(runtime, revision);
      targetSession = view.webContents.session;
      this.chromePreviewView = view;
      this.chromeSession = targetSession;
      await this.configureChromeSession(targetSession);
      if (this.chromePreviewView !== view || !this.isCurrent(runtime, revision)) {
        this.cleanupChromeResources(view, targetSession, null);
        return;
      }
      localProtocolCleanup = installOnlyPreviewSessionProtocol(targetSession, navigationUrl);
      if (this.chromePreviewView !== view || !this.isCurrent(runtime, revision)) {
        this.cleanupChromeResources(view, targetSession, localProtocolCleanup);
        return;
      }
      this.chromeProtocolCleanup = localProtocolCleanup;
      localProtocolCleanup = null;
      this.configureChromeNavigation(view, runtime, revision, navigationUrl);
      this.attachActiveView();
      await view.webContents.loadURL(navigationUrl);
    } catch (error) {
      if (view && targetSession && this.chromePreviewView !== view) {
        this.cleanupChromeResources(view, targetSession, localProtocolCleanup);
      } else {
        localProtocolCleanup?.();
      }
      if (!this.isCurrent(runtime, revision)) return;
      this.markChromeUnavailable(error);
    }
  }

  private mountPendingChromeSelection(): void {
    const pending = this.pendingChromeMount;
    if (!pending || !this.contentBounds || !this.isCurrent(pending.runtime, pending.revision)) {
      return;
    }
    this.pendingChromeMount = null;
    void this.mountChromeSelection(pending.runtime, pending.revision, pending.navigationUrl);
  }

  private createChromePreviewView(
    runtime: OnlyPreviewPreviewRegionRuntime,
    revision: number
  ): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        partition: `onlypreview-chrome-${runtime.host.hostId}-${revision}-${randomUUID()}`,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        plugins: true
      }
    });
    view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    runtime.bindChromeShortcuts(view.webContents);
    return view;
  }

  private async configureChromeSession(targetSession: Session): Promise<void> {
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
    targetSession.on('will-download', preventOnlyPreviewDownload);
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
    navigationUrl: string
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
      if (this.chromePreviewView !== view || !this.isCurrent(runtime, revision)) return;
      this.presentation = { ...this.presentation, status: 'ready', error: null };
      this.publishPresentation();
    });
    webContents.once('render-process-gone', (_event, details) => {
      if (this.chromePreviewView !== view || !this.isCurrent(runtime, revision)) return;
      this.markChromeUnavailable(new Error(`The raw Preview renderer exited (${details.reason}).`));
    });
  }

  private markChromeUnavailable(error: unknown): void {
    const runtime = this.runtime;
    if (!runtime) return;
    this.selectionRevision += 1;
    this.pendingChromeMount = null;
    this.revokeCurrentAuthority();
    this.detachActiveView();
    this.destroyChromePreviewView();
    this.activePreviewSurface = 'vue';
    this.vueResetAcknowledgedRevision = null;
    this.presentation = {
      ...this.presentation,
      selectionRevision: this.selectionRevision,
      surface: 'vue',
      adapterId: 'unsupported',
      status: 'unavailable',
      error: toOnlyPreviewErrorPayload(error),
      selectedTextAvailable: false
    };
    this.publishPresentation();
    this.attachActiveView();
  }

  private attachActiveView(): void {
    const runtime = this.runtime;
    if (!runtime || !this.contentBounds || !this.activePreviewSurface) return;
    const view =
      this.activePreviewSurface === 'chrome' ? this.chromePreviewView : this.ensureVuePreviewView();
    if (!view || view.webContents.isDestroyed()) return;
    if (
      this.activePreviewSurface === 'vue' &&
      this.vueResetAcknowledgedRevision !== this.selectionRevision
    ) {
      return;
    }
    if (this.attachedView !== view) {
      this.detachActiveView();
      runtime.window.contentView.addChildView(view);
      this.attachedView = view;
    }
    view.setBounds({ ...this.contentBounds });
  }

  private detachActiveView(): void {
    if (this.attachedView) this.detachView(this.attachedView);
    this.attachedView = null;
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

  private destroyChromePreviewView(): void {
    const view = this.chromePreviewView;
    const targetSession = this.chromeSession;
    const protocolCleanup = this.chromeProtocolCleanup;
    this.chromePreviewView = null;
    this.chromeSession = null;
    this.chromeProtocolCleanup = null;
    this.cleanupChromeResources(view, targetSession, protocolCleanup);
  }

  private cleanupChromeResources(
    view: WebContentsView | null,
    targetSession: Session | null,
    protocolCleanup: (() => void) | null
  ): void {
    protocolCleanup?.();
    if (view) this.detachView(view);
    closeContentView(view);
    if (targetSession) {
      targetSession.removeListener('will-download', preventOnlyPreviewDownload);
      targetSession.webRequest.onBeforeRequest(null);
      targetSession.setPermissionCheckHandler(null);
      targetSession.setPermissionRequestHandler(null);
      void targetSession.closeAllConnections().catch(() => undefined);
      void targetSession.clearStorageData().catch(() => undefined);
      void targetSession.clearCache().catch(() => undefined);
    }
  }

  private publishPresentation(): void {
    if (!this.runtime) return;
    xpcMain.broadcast(ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT, {
      hostId: this.runtime.host.hostId
    });
  }

  private snapshotInternal(includeVueAsset = false): OnlyPreviewPreviewPresentation {
    const descriptor = this.presentation.descriptor ? { ...this.presentation.descriptor } : null;
    if (
      descriptor?.assetUrl &&
      (!includeVueAsset ||
        this.presentation.surface !== 'vue' ||
        descriptor.kind === 'pdf' ||
        descriptor.extension === '.html' ||
        descriptor.extension === '.htm')
    ) {
      delete descriptor.assetUrl;
    }
    return {
      ...this.presentation,
      fileRef: this.presentation.fileRef ? { ...this.presentation.fileRef } : null,
      descriptor,
      error: this.presentation.error ? { ...this.presentation.error } : null
    };
  }

  private requireRuntime(hostToken: string): OnlyPreviewPreviewRegionRuntime {
    const host = onlyPreviewHostRegistry.require(hostToken, ['content']);
    const runtime = this.runtime;
    if (
      !runtime ||
      runtime.host.hostToken !== host.hostToken ||
      runtime.host.kind !== 'standalone' ||
      runtime.window.isDestroyed()
    ) {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'OnlyPreview request does not belong to the active Preview Region.'
      );
    }
    return runtime;
  }

  private requireCurrentVueRevision(
    hostToken: string,
    selectionRevision: number,
    previewRuntimeToken: string,
    requireResetAcknowledgement = true
  ): void {
    this.requireVueRuntime(hostToken, previewRuntimeToken);
    if (
      !Number.isSafeInteger(selectionRevision) ||
      selectionRevision !== this.selectionRevision ||
      this.activePreviewSurface !== 'vue' ||
      (requireResetAcknowledgement && this.vueResetAcknowledgedRevision !== selectionRevision)
    ) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'Preview renderer observation belongs to a stale selection.'
      );
    }
  }

  private requireVueRuntime(hostToken: string, previewRuntimeToken: string): void {
    this.requireRuntime(hostToken);
    if (
      !this.vuePreviewView ||
      this.vuePreviewView.webContents.isDestroyed() ||
      previewRuntimeToken !== this.vueRuntimeToken
    ) {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'Preview renderer observation belongs to an inactive Vue runtime.'
      );
    }
  }

  private isCurrent(runtime: OnlyPreviewPreviewRegionRuntime, revision: number): boolean {
    return this.runtime === runtime && this.selectionRevision === revision;
  }

  private matchesActiveFile(
    file: Awaited<ReturnType<typeof onlyPreviewWorkspaceRegistry.openFile>>
  ): boolean {
    const identity = this.activeFileIdentity;
    return Boolean(
      identity &&
      file.workspace.workspaceId === identity.workspaceId &&
      file.relativePath === identity.relativePath &&
      file.realPath === identity.realPath &&
      file.size === identity.size &&
      file.deviceId === identity.deviceId &&
      file.inode === identity.inode &&
      file.modifiedTimeNanoseconds === identity.modifiedTimeNanoseconds
    );
  }
}

export const onlyPreviewPreviewRegionService = new OnlyPreviewPreviewRegionService();
