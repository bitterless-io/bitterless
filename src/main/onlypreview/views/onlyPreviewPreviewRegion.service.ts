import type { Rectangle, WebContentsView } from 'electron';
import { xpcMain } from 'electron-xpc/main';
import {
  cloneOnlyPreviewDescriptor,
  OnlyPreviewContractError,
  parseOnlyPreviewFileRef,
  toOnlyPreviewErrorPayload
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT,
  getOnlyPreviewFileSizeLimit,
  type OnlyPreviewDescriptor,
  type OnlyPreviewErrorCode,
  type OnlyPreviewFileRef,
  type OnlyPreviewFindCoverage,
  type OnlyPreviewFindIntent,
  type OnlyPreviewFindResult,
  type OnlyPreviewFindSnapshot,
  type OnlyPreviewPreviewPresentation,
  type OnlyPreviewPreviewSurface,
  type OnlyPreviewTextContent,
  type OnlyPreviewTextReadRequest
} from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewSearchWatchCommit } from '@shared/onlypreview/onlyPreviewSearch.type';
import { onlyPreviewAssetRegistry } from '@main/onlypreview/onlyPreviewAsset.registry';
import { onlyPreviewClassifierService } from '@main/onlypreview/onlyPreviewClassifier.service';
import { onlyPreviewDocumentRegistry } from '@main/onlypreview/onlyPreviewDocument.registry';
import { onlyPreviewHostRegistry } from '@main/onlypreview/onlyPreviewHost.registry';
import { onlyPreviewWorkspaceRegistry } from '@main/onlypreview/onlyPreviewWorkspace.registry';
import { getOnlyPreviewAdapterSpec } from '@shared/onlypreview/onlyPreviewFind.registry';
import { OnlyPreviewFindService } from './onlyPreviewFind.service';
import {
  ONLY_PREVIEW_DIAGRAM_REBUILD_ERRORS,
  ONLY_PREVIEW_DOCUMENT_REBUILD_ERRORS,
  createEmptyOnlyPreviewPresentation,
  getOnlyPreviewDescriptorAdapter,
  getOnlyPreviewDescriptorErrorPayload,
  onlyPreviewAdapterProvidesSelectedText,
  onlyPreviewAdapterUsesOneShotAsset,
  onlyPreviewAdapterUsesVueAsset
} from './onlyPreviewPreviewAdapter.service';
import {
  OnlyPreviewPreviewViewService,
  presentationAllowsRendererError,
  type OnlyPreviewPreviewRegionRuntime
} from './onlyPreviewPreviewView.service';

export class OnlyPreviewPreviewRegionService {
  private readonly findService = new OnlyPreviewFindService();
  private readonly viewService = new OnlyPreviewPreviewViewService({
    getActiveSurface: () => this.activePreviewSurface,
    canAttachVue: () => this.vueResetAcknowledgedRevision === this.selectionRevision,
    getDocumentLoadingRevision: () =>
      this.activePreviewSurface === 'vue' &&
      this.presentation.adapterId === 'docx-dom' &&
      this.presentation.status === 'loading'
        ? this.selectionRevision
        : null,
    getDiagramLoadingRevision: () =>
      this.activePreviewSurface === 'vue' &&
      this.presentation.adapterId === 'drawio-viewer' &&
      this.presentation.status === 'loading'
        ? this.selectionRevision
        : null,
    isCurrent: (runtime, revision) => this.isCurrent(runtime, revision),
    bindFindWebContents: (surface, webContents, generation) =>
      this.findService.bindWebContents(surface, webContents, generation),
    unbindFindWebContents: (surface, webContents) =>
      this.findService.unbindWebContents(surface, webContents),
    onVueUnavailable: (runtime, error, recreate) =>
      this.handleVueUnavailable(runtime, error, recreate),
    onChromeReady: (runtime, view, revision) => this.handleChromeReady(runtime, view, revision),
    onChromeUnavailable: (runtime, view, revision, error) =>
      this.markChromeUnavailable(runtime, view, revision, error)
  });
  private runtime: OnlyPreviewPreviewRegionRuntime | null = null;
  private selectionRevision = 0;
  private readyFindCoverage: OnlyPreviewFindCoverage | null = null;
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
  private presentation: OnlyPreviewPreviewPresentation = createEmptyOnlyPreviewPresentation('', 0);

  start(runtime: OnlyPreviewPreviewRegionRuntime): void {
    this.destroy();
    this.runtime = runtime;
    this.viewService.start(runtime);
    this.activePreviewSurface = 'vue';
    this.vueResetAcknowledgedRevision = null;
    this.presentation = createEmptyOnlyPreviewPresentation(
      runtime.host.hostId,
      this.selectionRevision
    );
    this.findService.reset(this.presentation);
  }

  getVuePreviewView(): WebContentsView | null {
    return this.viewService.getVuePreviewView();
  }

  getBounds(): Rectangle | null {
    return this.viewService.getBounds();
  }

  updateBounds(hostToken: string, bounds: Rectangle): void {
    this.requireRuntime(hostToken);
    this.viewService.updateBounds(bounds);
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
      const adapter = getOnlyPreviewDescriptorAdapter(descriptor);
      let navigationUrl: string | null = null;
      let assetIssued = false;
      if (adapter.adapterId === 'html-page') {
        navigationUrl = await onlyPreviewDocumentRegistry.issue(opened, revision);
        if (!this.isCurrent(runtime, revision)) {
          onlyPreviewDocumentRegistry.revokeSelection(runtime.host.hostToken, revision);
          return;
        }
        descriptor = { ...descriptor, assetUrl: navigationUrl };
      } else if (adapter.adapterId === 'chromium-pdf') {
        const maxBytes = getOnlyPreviewFileSizeLimit(adapter.adapterId);
        navigationUrl = onlyPreviewAssetRegistry.issue(opened, descriptor.mimeType, {
          selectionRevision: revision,
          maxBytes: Math.min(opened.size, maxBytes ?? opened.size),
          delivery: 'network'
        });
        assetIssued = true;
        descriptor = { ...descriptor, assetUrl: navigationUrl };
      } else if (adapter.adapterId === 'xlsx-grid') {
        const maxBytes = getOnlyPreviewFileSizeLimit(adapter.adapterId);
        descriptor = {
          ...descriptor,
          assetUrl: onlyPreviewAssetRegistry.issue(opened, descriptor.mimeType, {
            selectionRevision: revision,
            maxBytes: Math.min(opened.size, maxBytes ?? opened.size)
          })
        };
        assetIssued = true;
      } else if (adapter.adapterId === 'docx-dom') {
        const maxBytes = getOnlyPreviewFileSizeLimit(adapter.adapterId);
        descriptor = {
          ...descriptor,
          assetUrl: onlyPreviewAssetRegistry.issue(opened, descriptor.mimeType, {
            selectionRevision: revision,
            maxBytes: Math.min(opened.size, maxBytes ?? opened.size)
          })
        };
        assetIssued = true;
      } else if (adapter.adapterId === 'drawio-viewer') {
        const maxBytes = getOnlyPreviewFileSizeLimit(adapter.adapterId);
        descriptor = {
          ...descriptor,
          assetUrl: onlyPreviewAssetRegistry.issue(opened, descriptor.mimeType, {
            selectionRevision: revision,
            maxBytes: Math.min(opened.size, maxBytes ?? opened.size)
          })
        };
        assetIssued = true;
      } else if (
        adapter.adapterId === 'image' ||
        adapter.adapterId === 'audio' ||
        adapter.adapterId === 'video'
      ) {
        const adapterLimit = getOnlyPreviewFileSizeLimit(adapter.adapterId);
        const maxBytes = Math.min(opened.size, adapterLimit ?? opened.size);
        descriptor = {
          ...descriptor,
          assetUrl: onlyPreviewAssetRegistry.issue(opened, descriptor.mimeType, {
            selectionRevision: revision,
            maxBytes,
            lifetime:
              adapter.adapterId === 'audio' || adapter.adapterId === 'video' ? 'selection' : 'ttl'
          })
        };
        assetIssued = true;
      }

      if (assetIssued && !this.isCurrent(runtime, revision)) {
        onlyPreviewAssetRegistry.revokeSelection(runtime.host.hostToken, revision);
        return;
      }

      await onlyPreviewWorkspaceRegistry.assertOpenedFileCurrent(opened);
      if (!this.isCurrent(runtime, revision)) {
        if (assetIssued) {
          onlyPreviewAssetRegistry.revokeSelection(runtime.host.hostToken, revision);
        }
        return;
      }

      this.activeFileIdentity = {
        workspaceId: opened.workspace.workspaceId,
        relativePath: opened.relativePath,
        realPath: opened.realPath,
        size: opened.size,
        deviceId: opened.deviceId,
        inode: opened.inode,
        modifiedTimeNanoseconds: opened.modifiedTimeNanoseconds
      };

      descriptor = cloneOnlyPreviewDescriptor(descriptor);
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
        error: getOnlyPreviewDescriptorErrorPayload(descriptor),
        selectedTextAvailable: onlyPreviewAdapterProvidesSelectedText(adapter.adapterId)
      };
      this.publishPresentation();
      this.viewService.armDocumentWatchdogIfEligible();

      if (adapter.surface === 'chrome' && navigationUrl) {
        await this.viewService.stageChromeSelection(
          runtime,
          revision,
          navigationUrl,
          adapter.adapterId === 'chromium-pdf'
        );
      } else {
        this.viewService.attachActiveView();
      }
    } catch (error) {
      if (!this.isCurrent(runtime, revision)) return;
      this.revokeCurrentAuthority();
      this.activeFileIdentity = null;
      this.viewService.detachActiveView();
      this.viewService.destroyChromePreviewView();
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
      this.viewService.attachActiveView();
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
      ...createEmptyOnlyPreviewPresentation(runtime.host.hostId, this.selectionRevision),
      workspaceId
    };
    this.publishPresentation();
    this.viewService.attachActiveView();
  }

  snapshot(hostToken: string): OnlyPreviewPreviewPresentation {
    this.requireRuntime(hostToken);
    return this.snapshotInternal();
  }

  snapshotForVue(hostToken: string, previewRuntimeToken: string): OnlyPreviewPreviewPresentation {
    this.requireVueRuntime(hostToken, previewRuntimeToken);
    return this.snapshotInternal(true);
  }

  findSnapshot(hostToken: string): OnlyPreviewFindSnapshot {
    this.requireRuntime(hostToken);
    return this.findService.snapshot();
  }

  openFind(hostToken: string): boolean {
    this.requireRuntime(hostToken);
    return this.findService.open();
  }

  submitFind(hostToken: string, intent: Omit<OnlyPreviewFindIntent, 'hostToken'>): void {
    this.requireRuntime(hostToken);
    this.findService.submit(intent);
  }

  closeFind(hostToken: string): void {
    this.requireRuntime(hostToken);
    this.findService.close();
  }

  isFindOpen(hostToken: string): boolean {
    this.requireRuntime(hostToken);
    return this.findService.isOpen();
  }

  focusActiveContent(hostToken: string): void {
    this.requireRuntime(hostToken);
    this.viewService.focusActiveContent();
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
    this.viewService.attachActiveView();
  }

  reportVueReady(
    hostToken: string,
    selectionRevision: number,
    previewRuntimeToken: string,
    findCoverage?: OnlyPreviewFindCoverage,
    findAdapter?: 'monaco' | 'sheet'
  ): void {
    this.requireCurrentVueRevision(hostToken, selectionRevision, previewRuntimeToken);
    if (this.presentation.status !== 'loading') return;
    if (this.presentation.adapterId === 'xlsx-grid' && !findCoverage) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'Workbook Preview readiness requires its accepted model coverage.'
      );
    }
    if (this.presentation.adapterId !== 'xlsx-grid' && findCoverage?.kind === 'partial') {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'Partial find coverage belongs only to a workbook Preview.'
      );
    }
    const expectedFind = getOnlyPreviewAdapterSpec(this.presentation.adapterId).find;
    if (
      (expectedFind.mode === 'content-adapter' && findAdapter !== expectedFind.adapter) ||
      (expectedFind.mode !== 'content-adapter' && findAdapter !== undefined)
    ) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'Preview readiness does not match the registered find adapter.'
      );
    }
    this.readyFindCoverage = findCoverage ?? { kind: 'complete' };
    this.viewService.clearDocumentWatchdog();
    if (onlyPreviewAdapterUsesOneShotAsset(this.presentation.adapterId)) {
      onlyPreviewAssetRegistry.revokeSelection(hostToken, selectionRevision);
    }
    const descriptor = this.presentation.descriptor
      ? { ...this.presentation.descriptor }
      : this.presentation.descriptor;
    if (descriptor && onlyPreviewAdapterUsesOneShotAsset(this.presentation.adapterId)) {
      delete descriptor.assetUrl;
    }
    this.presentation = { ...this.presentation, descriptor, status: 'ready', error: null };
    this.publishPresentation();
  }

  reportVueError(
    hostToken: string,
    selectionRevision: number,
    previewRuntimeToken: string,
    errorCode: OnlyPreviewErrorCode
  ): void {
    this.requireCurrentVueRevision(hostToken, selectionRevision, previewRuntimeToken);
    if (!presentationAllowsRendererError(this.presentation, errorCode)) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'Preview error does not belong to the current adapter.'
      );
    }
    if (this.presentation.status !== 'loading' && this.presentation.status !== 'ready') return;
    const runtime = this.runtime;
    const view = this.viewService.getVuePreviewView();
    if (
      runtime &&
      view &&
      ((this.presentation.adapterId === 'docx-dom' &&
        ONLY_PREVIEW_DOCUMENT_REBUILD_ERRORS.has(errorCode)) ||
        (this.presentation.adapterId === 'drawio-viewer' &&
          ONLY_PREVIEW_DIAGRAM_REBUILD_ERRORS.has(errorCode)))
    ) {
      this.viewService.clearDocumentWatchdog();
      this.viewService.invalidateVuePreviewView(
        view,
        new OnlyPreviewContractError(errorCode, 'The selected document could not be rendered.'),
        true
      );
      return;
    }
    this.findService.beginTransition();
    this.viewService.clearDocumentWatchdog();
    onlyPreviewAssetRegistry.revokeSelection(hostToken, selectionRevision);
    const descriptor = this.presentation.descriptor
      ? { ...this.presentation.descriptor }
      : this.presentation.descriptor;
    if (descriptor && onlyPreviewAdapterUsesVueAsset(this.presentation.adapterId)) {
      delete descriptor.assetUrl;
    }
    this.presentation = {
      ...this.presentation,
      descriptor,
      status: 'unavailable',
      error: toOnlyPreviewErrorPayload(
        new OnlyPreviewContractError(errorCode, 'The selected file could not be rendered.')
      ),
      selectedTextAvailable: false
    };
    this.publishPresentation();
  }

  reportVueFindResult(
    hostToken: string,
    previewRuntimeToken: string,
    result: OnlyPreviewFindResult
  ): void {
    this.requireCurrentVueRevision(hostToken, result.selectionRevision, previewRuntimeToken);
    this.findService.reportContentResult(result);
  }

  destroy(): void {
    const runtime = this.runtime;
    this.findService.beginTransition();
    this.viewService.clearDocumentWatchdog();
    this.revokeCurrentAuthority();
    this.viewService.destroy();
    this.vueResetAcknowledgedRevision = null;
    this.activeFileIdentity = null;
    this.runtime = null;
    this.activePreviewSurface = null;
    if (runtime) {
      this.presentation = createEmptyOnlyPreviewPresentation(
        runtime.host.hostId,
        this.selectionRevision
      );
    }
  }

  private beginTransition(fileRef: OnlyPreviewFileRef | null): number {
    const runtime = this.runtime;
    if (!runtime) throw new Error('OnlyPreview Preview Region is not running.');
    const pendingDocumentView =
      this.activePreviewSurface === 'vue' &&
      (this.presentation.adapterId === 'docx-dom' ||
        this.presentation.adapterId === 'drawio-viewer') &&
      (this.presentation.status === 'loading' || this.presentation.adapterId === 'drawio-viewer')
        ? this.viewService.getVuePreviewView()
        : null;
    this.findService.beginTransition();
    this.selectionRevision += 1;
    this.readyFindCoverage = null;
    this.viewService.clearDocumentWatchdog();
    this.revokeCurrentAuthority();
    this.viewService.detachActiveView();
    if (pendingDocumentView && this.viewService.getVuePreviewView() === pendingDocumentView) {
      this.viewService.destroyVuePreviewView(pendingDocumentView);
      this.vueResetAcknowledgedRevision = null;
    }
    this.viewService.destroyChromePreviewView();
    this.viewService.clearPendingChromeSelection();
    this.activePreviewSurface = null;
    this.vueResetAcknowledgedRevision = null;
    this.activeFileIdentity = null;
    this.presentation = {
      ...createEmptyOnlyPreviewPresentation(runtime.host.hostId, this.selectionRevision),
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

  private handleVueUnavailable(
    runtime: OnlyPreviewPreviewRegionRuntime,
    error: unknown,
    recreate: boolean
  ): void {
    if (this.runtime !== runtime) return;
    this.viewService.clearDocumentWatchdog();
    this.vueResetAcknowledgedRevision = null;
    if (this.activePreviewSurface !== 'vue') return;
    this.findService.beginTransition();
    this.selectionRevision += 1;
    this.readyFindCoverage = null;
    this.revokeCurrentAuthority();
    const descriptor = this.presentation.descriptor
      ? { ...this.presentation.descriptor }
      : this.presentation.descriptor;
    if (descriptor && onlyPreviewAdapterUsesVueAsset(this.presentation.adapterId)) {
      delete descriptor.assetUrl;
    }
    this.presentation = {
      ...this.presentation,
      descriptor,
      selectionRevision: this.selectionRevision,
      status: 'unavailable',
      error: toOnlyPreviewErrorPayload(error),
      selectedTextAvailable: false
    };
    this.publishPresentation();
    if (!recreate) return;
    try {
      this.viewService.ensureVuePreviewView();
      this.viewService.armDocumentWatchdogIfEligible();
      this.viewService.attachActiveView();
    } catch {
      // Keep the published unavailable state if the replacement view cannot be created.
    }
  }

  private handleChromeReady(
    runtime: OnlyPreviewPreviewRegionRuntime,
    view: WebContentsView,
    revision: number
  ): void {
    if (this.viewService.getChromePreviewView() !== view || !this.isCurrent(runtime, revision)) {
      return;
    }
    this.readyFindCoverage = { kind: 'complete' };
    this.presentation = { ...this.presentation, status: 'ready', error: null };
    this.publishPresentation();
  }

  private markChromeUnavailable(
    runtime: OnlyPreviewPreviewRegionRuntime,
    view: WebContentsView | null,
    revision: number,
    error: unknown
  ): void {
    if (
      !this.isCurrent(runtime, revision) ||
      (view !== null && this.viewService.getChromePreviewView() !== view)
    ) {
      return;
    }
    this.findService.beginTransition();
    this.selectionRevision += 1;
    this.readyFindCoverage = null;
    this.viewService.clearPendingChromeSelection();
    this.revokeCurrentAuthority();
    this.viewService.detachActiveView();
    this.viewService.destroyChromePreviewView();
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
    this.viewService.attachActiveView();
  }

  private publishPresentation(): void {
    if (!this.runtime) return;
    this.findService.syncPresentation(this.presentation, this.readyFindCoverage ?? undefined);
    xpcMain.broadcast(ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT, {
      hostId: this.runtime.host.hostId
    });
  }

  private snapshotInternal(includeVueAsset = false): OnlyPreviewPreviewPresentation {
    const sourceDescriptor = this.presentation.descriptor;
    const includeDescriptorAsset =
      includeVueAsset &&
      this.presentation.surface === 'vue' &&
      sourceDescriptor?.kind !== 'pdf' &&
      sourceDescriptor?.extension !== '.html' &&
      sourceDescriptor?.extension !== '.htm';
    const descriptor = sourceDescriptor
      ? cloneOnlyPreviewDescriptor(sourceDescriptor, { includeAsset: includeDescriptorAsset })
      : null;
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
    const vuePreviewView = this.viewService.getVuePreviewView();
    if (
      !vuePreviewView ||
      vuePreviewView.webContents.isDestroyed() ||
      previewRuntimeToken !== this.viewService.getVueRuntimeToken()
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
