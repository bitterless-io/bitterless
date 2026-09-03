import type { Rectangle, WebContentsView } from 'electron';
import { xpcMain } from 'electron-xpc/main';
import { randomUUID } from 'node:crypto';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import {
  cloneOnlyPreviewDescriptor,
  OnlyPreviewContractError,
  parseOnlyPreviewFileRef,
  toOnlyPreviewErrorPayload
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT,
  type OnlyPreviewDescriptor,
  type OnlyPreviewErrorCode,
  type OnlyPreviewFileRef,
  type OnlyPreviewFindCoverage,
  type OnlyPreviewFindIntent,
  type OnlyPreviewFindResult,
  type OnlyPreviewFindSnapshot,
  type OnlyPreviewPreviewPresentation,
  type OnlyPreviewPreviewSurface
} from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewSearchWatchCommit } from '@shared/onlypreview/onlyPreviewSearch.type';
import {
  getOnlyPreviewOfficePackageKind,
  type OnlyPreviewOfficePackageKind
} from '@shared/onlypreview/onlyPreviewOfficeReadRuntime.types';
import type { OnlyPreviewPreviewReadPreparedSelection } from '@shared/onlypreview/onlyPreviewPreviewReadRuntime.types';
import { onlyPreviewAssetRegistry } from '@main/onlypreview/onlyPreviewAsset.registry';
import { onlyPreviewDocumentRegistry } from '@main/onlypreview/onlyPreviewDocument.registry';
import { onlyPreviewHostRegistry } from '@main/onlypreview/onlyPreviewHost.registry';
import { onlyPreviewProjectIndexStateService } from '@main/onlypreview/onlyPreviewProjectIndexState.service';
import {
  onlyPreviewWorkspaceRegistry,
  type OnlyPreviewPreviewAuthorityRef
} from '@main/onlypreview/onlyPreviewWorkspace.registry';
import { getOnlyPreviewAdapterSpec } from '@shared/onlypreview/onlyPreviewFind.registry';
import { OnlyPreviewFindService } from './onlyPreviewFind.service';
import {
  ONLY_PREVIEW_DIAGRAM_REBUILD_ERRORS,
  ONLY_PREVIEW_DOCUMENT_REBUILD_ERRORS,
  ONLY_PREVIEW_PRESENTATION_REBUILD_ERRORS,
  ONLY_PREVIEW_SHEET_REBUILD_ERRORS,
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
import { OnlyPreviewPreviewReadBrokerService } from './onlyPreviewPreviewReadBroker.service';
import { onlyPreviewSelectedFileChanged } from './onlyPreviewSelectedFileIdentity.service';
import { issueOnlyPreviewSelectionDelivery } from './onlyPreviewSelectionDelivery.service';
import type { OnlyPreviewOpenTrace } from '@shared/onlypreview/onlyPreviewOpenDiagnostics.mjs';
import { onlyPreviewOpenDiagnostics } from '@main/onlypreview/onlyPreviewOpenDiagnostics.runtime';

export class OnlyPreviewPreviewRegionService {
  private readonly findService = new OnlyPreviewFindService();
  private readonly readBroker = new OnlyPreviewPreviewReadBrokerService({
    requireCurrentVueRevision: (hostToken, selectionRevision, previewRuntimeToken) =>
      this.requireCurrentVueRevision(hostToken, selectionRevision, previewRuntimeToken),
    requireVueRuntime: (hostToken, previewRuntimeToken) =>
      this.requireVueRuntime(hostToken, previewRuntimeToken),
    getPresentation: () => this.presentation
  });
  private readonly viewService = new OnlyPreviewPreviewViewService({
    getActiveSurface: () => this.activePreviewSurface,
    canAttachVue: () => this.vueResetAcknowledgedRevision === this.selectionRevision,
    getDocumentLoadingRevision: () =>
      this.activePreviewSurface === 'vue' &&
      (this.presentation.adapterId === 'ooxml-xlsx' ||
        this.presentation.adapterId === 'ooxml-docx' ||
        this.presentation.adapterId === 'ooxml-pptx') &&
      this.presentation.status === 'loading'
        ? this.selectionRevision
        : null,
    getDocumentLoadingError: () => {
      if (this.presentation.adapterId === 'ooxml-xlsx') {
        return new OnlyPreviewContractError(
          'SHEET_RENDER_TIMEOUT',
          'Workbook preview exceeded its rendering deadline.'
        );
      }
      if (this.presentation.adapterId === 'ooxml-pptx') {
        return new OnlyPreviewContractError(
          'PRESENTATION_RENDER_TIMEOUT',
          'Presentation preview exceeded its rendering deadline.'
        );
      }
      return new OnlyPreviewContractError(
        'DOCUMENT_RENDER_TIMEOUT',
        'Document preview exceeded its rendering deadline.'
      );
    },
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
      this.markChromeUnavailable(runtime, view, revision, error),
  });
  private runtime: OnlyPreviewPreviewRegionRuntime | null = null;
  private selectionRevision = 0;
  private readyFindCoverage: OnlyPreviewFindCoverage | null = null;
  private activePreviewSurface: OnlyPreviewPreviewSurface | null = 'vue';
  private vueResetAcknowledgedRevision: number | null = null;
  private presentation: OnlyPreviewPreviewPresentation = createEmptyOnlyPreviewPresentation('', 0);
  private readonly openTraces = new Map<
    number,
    { trace: OnlyPreviewOpenTrace; surface: 'vue' | 'chrome' | 'office' | 'unknown' }
  >();

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

  getReadBroker(): OnlyPreviewPreviewReadBrokerService {
    return this.readBroker;
  }

  getBounds(): Rectangle | null {
    return this.viewService.getBounds();
  }

  updateBounds(hostToken: string, bounds: Rectangle): void {
    this.requireRuntime(hostToken);
    this.viewService.updateBounds(bounds);
  }

  async present(hostToken: string, value: unknown, parentOpenTag?: string): Promise<void> {
    const runtime = this.requireRuntime(hostToken);
    const fileRef = parseOnlyPreviewFileRef(value);
    const revision = this.beginTransition(fileRef, parentOpenTag);
    let prepared: OnlyPreviewPreviewReadPreparedSelection | null = null;
    let descriptor: OnlyPreviewDescriptor | null = null;
    try {
      const authority = onlyPreviewWorkspaceRegistry.getPreviewAuthorityItemRef(
        runtime.host.hostToken,
        fileRef
      );
      this.markOpenTrace(revision, { phase: 'workspace' });
      const officeKind = getOnlyPreviewOfficePackageKind(fileRef.relativePath);
      if (officeKind) {
        await this.presentOffice(runtime, fileRef, revision, officeKind, authority);
        return;
      }
      await fileSearchWindowService.bindPreviewReadWorkspace({
        workspaceId: authority.workspaceId,
        workspaceGeneration: authority.workspaceGeneration,
        rootPath: authority.rootPath
      });
      if (!this.isCurrent(runtime, revision)) {
        this.finishOpenTrace(revision, 'superseded');
        return;
      }
      prepared = await fileSearchWindowService.preparePreviewRead({
        grantId: randomUUID(),
        selectionRevision: revision,
        workspaceId: authority.workspaceId,
        workspaceGeneration: authority.workspaceGeneration,
        relativePath: authority.relativePath
      });
      if (!this.isCurrent(runtime, revision)) {
        await this.cancelPreparedPreview(prepared);
        this.finishOpenTrace(revision, 'superseded');
        return;
      }
      descriptor = prepared.descriptor;
      const adapter = getOnlyPreviewDescriptorAdapter(descriptor);
      this.markOpenTrace(revision, { phase: 'descriptor', surface: adapter.surface });
      let brokerCapability: string | null = null;
      if (adapter.surface === 'vue') {
        this.viewService.ensureVuePreviewView();
        if (adapter.adapterId === 'monaco' || adapter.adapterId === 'markdown-dom') {
          brokerCapability = this.viewService.getPreviewReadBrokerCapability();
          if (!brokerCapability) {
            throw new OnlyPreviewContractError(
              'OPERATION_FAILED',
              'Preview Read runtime is unavailable.'
            );
          }
        }
      }
      const delivery = issueOnlyPreviewSelectionDelivery({
        hostToken: runtime.host.hostToken,
        selectionRevision: revision,
        prepared,
        adapter
      });
      descriptor = delivery.descriptor;
      if (!this.isCurrent(runtime, revision)) {
        if (adapter.adapterId === 'html-page') {
          onlyPreviewDocumentRegistry.revokeSelection(runtime.host.hostToken, revision);
        } else if (delivery.assetIssued) {
          onlyPreviewAssetRegistry.revokeSelection(runtime.host.hostToken, revision);
        }
        await this.cancelPreparedPreview(prepared);
        this.finishOpenTrace(revision, 'superseded');
        return;
      }
      this.readBroker.setPreviewAuthority(brokerCapability, prepared);
      prepared = null;

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
      this.markOpenTrace(revision, { phase: 'published' });
      this.viewService.armDocumentWatchdogIfEligible();

      if (adapter.surface === 'chrome' && delivery.navigationUrl) {
        await this.viewService.stageChromeSelection(
          runtime,
          revision,
          delivery.navigationUrl,
          adapter.adapterId === 'chromium-pdf'
        );
      } else {
        this.viewService.attachActiveView();
      }
    } catch (error) {
      if (prepared) await this.cancelPreparedPreview(prepared);
      if (!this.isCurrent(runtime, revision)) {
        this.finishOpenTrace(revision, 'superseded');
        return;
      }
      this.revokeCurrentAuthority();
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
      this.finishOpenTrace(revision, 'error');
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
    const changed = await onlyPreviewSelectedFileChanged(runtime.host.hostToken, this.presentation);
    if (!changed || this.presentation.fileRef !== fileRef) return;
    await this.present(runtime.host.hostToken, fileRef);
  }

  clearWorkspace(hostToken: string, workspaceId: string | null = null): void {
    const runtime = this.requireRuntime(hostToken);
    this.clearPresentation(runtime, workspaceId);
  }

  handleWorkspaceRevoked(hostToken: string, workspaceId: string): void {
    const runtime = this.runtime;
    if (
      !runtime ||
      runtime.host.hostToken !== hostToken ||
      (this.presentation.workspaceId !== workspaceId &&
        this.presentation.fileRef?.workspaceId !== workspaceId)
    ) {
      return;
    }
    this.clearPresentation(runtime, null);
  }

  private clearPresentation(
    runtime: OnlyPreviewPreviewRegionRuntime,
    workspaceId: string | null
  ): void {
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

  focusActiveContent(hostToken: string): boolean {
    this.requireRuntime(hostToken);
    return this.viewService.focusActiveContent();
  }

  reportVueReset(hostToken: string, selectionRevision: number, previewRuntimeToken: string): void {
    this.requireCurrentVueRevision(hostToken, selectionRevision, previewRuntimeToken, false);
    this.vueResetAcknowledgedRevision = selectionRevision;
    this.markOpenTrace(selectionRevision, { phase: 'renderer-reset' });
    this.viewService.attachActiveView();
  }

  reportVueReady(
    hostToken: string,
    selectionRevision: number,
    previewRuntimeToken: string,
    findCoverage?: OnlyPreviewFindCoverage,
    findAdapter?: 'monaco' | 'office'
  ): void {
    this.requireCurrentVueRevision(hostToken, selectionRevision, previewRuntimeToken);
    if (this.presentation.status !== 'loading') return;
    const expectedFind = getOnlyPreviewAdapterSpec(this.presentation.adapterId).find;
    if (expectedFind.mode === 'content-adapter' && !findCoverage) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'Content-backed Preview readiness requires its accepted model coverage.'
      );
    }
    if (findCoverage?.kind === 'partial') {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'The current renderer must report complete Find coverage.'
      );
    }
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
    if (this.readBroker.hasOfficeSelection(selectionRevision)) {
      this.readBroker.revokeOfficeReadAuthority();
    }
    if (onlyPreviewAdapterUsesOneShotAsset(this.presentation.adapterId)) {
      onlyPreviewAssetRegistry.revokeSelection(hostToken, selectionRevision);
    }
    if (
      this.presentation.surface === 'vue' &&
      this.presentation.adapterId !== 'audio' &&
      this.presentation.adapterId !== 'video'
    ) {
      this.readBroker.revokePreviewReadAuthority();
    }
    const descriptor = this.presentation.descriptor
      ? { ...this.presentation.descriptor }
      : this.presentation.descriptor;
    if (descriptor && onlyPreviewAdapterUsesOneShotAsset(this.presentation.adapterId)) {
      delete descriptor.assetUrl;
    }
    this.presentation = { ...this.presentation, descriptor, status: 'ready', error: null };
    this.publishPresentation();
    this.finishOpenTrace(selectionRevision, 'ready');
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
    this.finishOpenTrace(selectionRevision, 'error');
    const runtime = this.runtime;
    const view = this.viewService.getVuePreviewView();
    if (
      runtime &&
      view &&
      ((this.presentation.adapterId === 'ooxml-xlsx' &&
        ONLY_PREVIEW_SHEET_REBUILD_ERRORS.has(errorCode)) ||
        (this.presentation.adapterId === 'ooxml-docx' &&
          ONLY_PREVIEW_DOCUMENT_REBUILD_ERRORS.has(errorCode)) ||
        (this.presentation.adapterId === 'ooxml-pptx' &&
          ONLY_PREVIEW_PRESENTATION_REBUILD_ERRORS.has(errorCode)) ||
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
    this.readBroker.revokeAll();
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
    this.runtime = null;
    this.activePreviewSurface = null;
    for (const [revision] of this.openTraces) this.finishOpenTrace(revision, 'superseded');
    if (runtime) {
      this.presentation = createEmptyOnlyPreviewPresentation(
        runtime.host.hostId,
        this.selectionRevision
      );
    }
  }

  private beginTransition(fileRef: OnlyPreviewFileRef | null, parentOpenTag?: string): number {
    const runtime = this.runtime;
    if (!runtime) throw new Error('OnlyPreview Preview Region is not running.');
    const pendingDocumentView =
      this.activePreviewSurface === 'vue' &&
      (this.presentation.adapterId === 'ooxml-xlsx' ||
        this.presentation.adapterId === 'ooxml-docx' ||
        this.presentation.adapterId === 'ooxml-pptx' ||
        this.presentation.adapterId === 'drawio-viewer') &&
      (this.presentation.status === 'loading' || this.presentation.adapterId === 'drawio-viewer')
        ? this.viewService.getVuePreviewView()
        : null;
    this.findService.beginTransition();
    this.selectionRevision += 1;
    for (const [revision] of this.openTraces) this.finishOpenTrace(revision, 'superseded');
    if (fileRef) {
      this.openTraces.set(this.selectionRevision, {
        trace: onlyPreviewOpenDiagnostics.trace(
          'preview',
          { parentTag: parentOpenTag, revision: this.selectionRevision, surface: 'unknown' },
          'p'
        ),
        surface: 'unknown'
      });
    }
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
    this.readBroker.revokeAll();
  }

  private async cancelPreparedPreview(
    prepared: OnlyPreviewPreviewReadPreparedSelection
  ): Promise<void> {
    await fileSearchWindowService
      .cancelPreviewRead({
        grantId: prepared.grantId,
        selectionRevision: prepared.selectionRevision
      })
      .catch(() => undefined);
  }

  private async presentOffice(
    runtime: OnlyPreviewPreviewRegionRuntime,
    fileRef: OnlyPreviewFileRef,
    revision: number,
    kind: OnlyPreviewOfficePackageKind,
    authority: OnlyPreviewPreviewAuthorityRef
  ): Promise<void> {
    await this.readBroker.waitForOfficeCancellation();
    await fileSearchWindowService.bindOfficeWorkspace({
      workspaceId: authority.workspaceId,
      rootPath: authority.rootPath
    });
    this.markOpenTrace(revision, { phase: 'workspace' });
    if (!this.isCurrent(runtime, revision)) {
      this.finishOpenTrace(revision, 'superseded');
      return;
    }
    this.viewService.ensureVuePreviewView();
    const runtimeId = this.viewService.getVueRuntimeToken();
    const brokerCapability = this.viewService.getOfficeBrokerCapability();
    if (!runtimeId || !brokerCapability) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'Office preview runtime is unavailable.'
      );
    }
    const prepared = await this.readBroker.prepareOfficeSelection({
      hostToken: runtime.host.hostToken,
      fileRef,
      selectionRevision: revision,
      runtimeId,
      kind
    });
    this.markOpenTrace(revision, { phase: 'descriptor', surface: 'office' });
    if (!this.isCurrent(runtime, revision)) {
      await this.readBroker.cancelPreparedOffice(prepared.grantId, runtimeId, revision);
      this.finishOpenTrace(revision, 'superseded');
      return;
    }
    this.readBroker.setOfficeAuthority({
      brokerCapability,
      grantId: prepared.grantId,
      runtimeId,
      selectionRevision: revision,
      kind
    });
    this.activePreviewSurface = 'vue';
    this.presentation = {
      hostId: runtime.host.hostId,
      workspaceId: fileRef.workspaceId,
      selectionRevision: revision,
      surface: 'vue',
      adapterId: prepared.adapterId,
      status: 'loading',
      fileRef,
      descriptor: prepared.descriptor,
      error: null,
      selectedTextAvailable: onlyPreviewAdapterProvidesSelectedText(prepared.adapterId)
    };
    this.publishPresentation();
    this.markOpenTrace(revision, { phase: 'published' });
    this.viewService.armDocumentWatchdogIfEligible();
    this.viewService.attachActiveView();
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
    this.finishOpenTrace(this.selectionRevision, 'error');
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
    this.finishOpenTrace(revision, 'ready');
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
    this.finishOpenTrace(revision, 'error');
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

  private markOpenTrace(revision: number, fields: Record<string, unknown>): void {
    const active = this.openTraces.get(revision);
    if (!active) return;
    if (
      fields.surface === 'vue' ||
      fields.surface === 'chrome' ||
      fields.surface === 'office'
    ) {
      active.surface = fields.surface;
    }
    active.trace.mark({ revision, ...fields });
  }

  private finishOpenTrace(
    revision: number,
    outcome: 'ready' | 'error' | 'superseded'
  ): void {
    const active = this.openTraces.get(revision);
    if (!active) return;
    this.openTraces.delete(revision);
    active.trace.end({ revision, surface: active.surface, outcome });
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
      error: this.presentation.error ? { ...this.presentation.error } : null,
      // Derived here, never read from `this.presentation`: every path that binds a Project clears
      // the presentation immediately afterwards, which would erase a stored value.
      projectIndexState: onlyPreviewProjectIndexStateService.get(this.presentation.workspaceId)
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
}

export const onlyPreviewPreviewRegionService = new OnlyPreviewPreviewRegionService();
