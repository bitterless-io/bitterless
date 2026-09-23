import type { Rectangle, WebContentsView } from 'electron';
import { notifyOnlyPreviewDisplayUrl } from '@main/miniapps/onlypreview/onlyPreviewDisplayUrl.registry';
import { xpcMain } from 'electron-xpc/main';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
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
import { onlyPreviewAssetRegistry } from '@main/miniapps/onlypreview/onlyPreviewAsset.registry';
import { onlyPreviewDocumentRegistry } from '@main/miniapps/onlypreview/onlyPreviewDocument.registry';
import {
  requireOnlyPreviewPreviewRuntime,
  requireOnlyPreviewVueRuntime
} from './onlyPreviewPreviewRegionGuards.service';
import { onlyPreviewProjectIndexStateService } from '@main/miniapps/onlypreview/onlyPreviewProjectIndexState.service';
import {
  onlyPreviewWorkspaceRegistry,
  type OnlyPreviewPreviewAuthorityRef
} from '@main/miniapps/onlypreview/onlyPreviewWorkspace.registry';
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
  onlyPreviewAdapterUsesVueAsset,
  projectOnlyPreviewPresentation
} from './onlyPreviewPreviewAdapter.service';
import {
  OnlyPreviewPreviewViewService,
  presentationAllowsRendererError,
  type OnlyPreviewPreviewRegionRuntime
} from './onlyPreviewPreviewView.service';
import { OnlyPreviewPreviewReadBrokerService } from './onlyPreviewPreviewReadBroker.service';
import { onlyPreviewSelectedFileChanged } from './onlyPreviewSelectedFileIdentity.service';
import { issueOnlyPreviewSelectionDelivery } from './onlyPreviewSelectionDelivery.service';
import { OnlyPreviewPreviewOpenTraceRegistry } from './onlyPreviewPreviewOpenTrace.service';

export class OnlyPreviewPreviewRegionService {
  private readonly findService = new OnlyPreviewFindService();
  private readonly readBroker = new OnlyPreviewPreviewReadBrokerService({
    requireCurrentVueRevision: (hostToken, selectionRevision, previewRuntimeToken) =>
      this.requireCurrentVueRevision(hostToken, selectionRevision, previewRuntimeToken),
    requireVueRuntime: (hostToken, previewRuntimeToken) =>
      requireOnlyPreviewVueRuntime(hostToken, previewRuntimeToken, this.runtime, this.viewService),
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
  private readonly openTraces = new OnlyPreviewPreviewOpenTraceRegistry();

  start(runtime: OnlyPreviewPreviewRegionRuntime): void {
    this.destroy();
    this.runtime = runtime;
    regionsByHost.set(runtime.host.hostToken, this);
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
    requireOnlyPreviewPreviewRuntime(hostToken, this.runtime);
    this.viewService.updateBounds(bounds);
  }

  // `where` = 「文件里的哪个位置」。`fragment` 和 `line` 是同一个概念的两种写法(锚点 / 行号),
  // 所以合成一个对象而不是再加一个位置参数 —— 四个可选位置参数之后,调用方就得写
  // `present(token, ref, undefined, undefined, line)` 这种数空位的代码。
  async present(
    hostToken: string,
    value: unknown,
    parentOpenTag?: string,
    where?: { fragment?: string; line?: number }
  ): Promise<void> {
    const runtime = requireOnlyPreviewPreviewRuntime(hostToken, this.runtime);
    const fileRef = parseOnlyPreviewFileRef(value);
    const revision = this.beginTransition(fileRef, parentOpenTag);
    let prepared: OnlyPreviewPreviewReadPreparedSelection | null = null;
    let descriptor: OnlyPreviewDescriptor | null = null;
    try {
      const authority = onlyPreviewWorkspaceRegistry.getPreviewAuthorityItemRef(
        runtime.host.hostToken,
        fileRef
      );
      this.openTraces.mark(revision, { phase: 'workspace' });
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
        this.openTraces.finish(revision, 'superseded');
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
        this.openTraces.finish(revision, 'superseded');
        return;
      }
      descriptor = prepared.descriptor;
      const adapter = getOnlyPreviewDescriptorAdapter(descriptor);
      this.openTraces.mark(revision, { phase: 'descriptor', surface: adapter.surface });
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
        this.openTraces.finish(revision, 'superseded');
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
        ...(where?.fragment ? { fragment: where.fragment } : {}),
        // 行号只是**带上**,能不能用由渲染侧按预览器类型决定 —— 图片/PDF 那些没有行的适配器
        // 收到就丢掉。Ral 2026-09-21:「如果有的文件无法进行导航…直接忽略即可,不能报错阻塞。」
        ...(where?.line ? { line: where.line } : {}),
        status: 'loading',
        fileRef,
        descriptor,
        directory: null,
        error: getOnlyPreviewDescriptorErrorPayload(descriptor),
        selectedTextAvailable: onlyPreviewAdapterProvidesSelectedText(adapter.adapterId)
      };
      this.publishPresentation();
      this.openTraces.mark(revision, { phase: 'published' });
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
        this.openTraces.finish(revision, 'superseded');
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
        directory: null,
        error: toOnlyPreviewErrorPayload(error),
        selectedTextAvailable: false
      };
      this.publishPresentation();
      this.viewService.attachActiveView();
      this.openTraces.finish(revision, 'error');
    }
  }

  async refresh(hostToken: string): Promise<void> {
    const runtime = requireOnlyPreviewPreviewRuntime(hostToken, this.runtime);
    const fileRef = this.presentation.fileRef;
    if (!fileRef) return;
    await this.present(runtime.host.hostToken, fileRef);
  }

  async handleWatchCommit(hostToken: string, commit: OnlyPreviewSearchWatchCommit): Promise<void> {
    const runtime = requireOnlyPreviewPreviewRuntime(hostToken, this.runtime);
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
    const runtime = requireOnlyPreviewPreviewRuntime(hostToken, this.runtime);
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
    requireOnlyPreviewPreviewRuntime(hostToken, this.runtime);
    return this.snapshotInternal();
  }

  /** A pending selection must never expose the previous file as currently displayed. */
  displayedFilePath(hostToken: string): string | null {
    requireOnlyPreviewPreviewRuntime(hostToken, this.runtime);
    if (this.presentation.status !== 'ready' ||
        this.presentation.selectionRevision !== this.selectionRevision || !this.presentation.fileRef) return null;
    const fileRef = this.presentation.fileRef;
    const workspace = onlyPreviewWorkspaceRegistry.requireWorkspace(hostToken, fileRef.workspaceId);
    return resolve(workspace.displayPath, fileRef.relativePath);
  }

  snapshotForVue(hostToken: string, previewRuntimeToken: string): OnlyPreviewPreviewPresentation {
    requireOnlyPreviewVueRuntime(hostToken, previewRuntimeToken, this.runtime, this.viewService);
    return this.snapshotInternal(true);
  }

  navigateFragment(hostToken: string, runtimeToken: string, revision: number, fragment: string): void {
    this.requireCurrentVueRevision(hostToken, revision, runtimeToken, false);
    this.presentation = { ...this.presentation, fragment };
    this.publishPresentation();
  }

  findSnapshot(hostToken: string): OnlyPreviewFindSnapshot {
    requireOnlyPreviewPreviewRuntime(hostToken, this.runtime);
    return this.findService.snapshot();
  }

  openFind(hostToken: string): boolean {
    requireOnlyPreviewPreviewRuntime(hostToken, this.runtime);
    return this.findService.open();
  }

  submitFind(hostToken: string, intent: Omit<OnlyPreviewFindIntent, 'hostToken'>): void {
    requireOnlyPreviewPreviewRuntime(hostToken, this.runtime);
    this.findService.submit(intent);
  }

  closeFind(hostToken: string): void {
    requireOnlyPreviewPreviewRuntime(hostToken, this.runtime);
    this.findService.close();
  }

  isFindOpen(hostToken: string): boolean {
    requireOnlyPreviewPreviewRuntime(hostToken, this.runtime);
    return this.findService.isOpen();
  }

  focusActiveContent(hostToken: string): boolean {
    requireOnlyPreviewPreviewRuntime(hostToken, this.runtime);
    return this.viewService.focusActiveContent();
  }

  reportVueReset(hostToken: string, selectionRevision: number, previewRuntimeToken: string): void {
    this.requireCurrentVueRevision(hostToken, selectionRevision, previewRuntimeToken, false);
    this.vueResetAcknowledgedRevision = selectionRevision;
    this.openTraces.mark(selectionRevision, { phase: 'renderer-reset' });
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
    this.openTraces.finish(selectionRevision, 'ready');
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
    this.openTraces.finish(selectionRevision, 'error');
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

  waitForChromeDisposal(): Promise<void> {
    return this.viewService.waitForChromeDisposal();
  }

  destroy(): void {
    const runtime = this.runtime;
    // 只注销**自己**那一条。`start()` 开头就调 `destroy()`,而那时新的 runtime 还没写进来 ——
    // 无条件 `delete(runtime.host.hostToken)` 在"同一个 host 换一份预览区"的路径上会把刚登记的
    // 那一份抹掉。
    if (runtime && regionsByHost.get(runtime.host.hostToken) === this) {
      regionsByHost.delete(runtime.host.hostToken);
    }
    this.findService.beginTransition();
    this.viewService.clearDocumentWatchdog();
    this.revokeCurrentAuthority();
    this.viewService.destroy();
    this.vueResetAcknowledgedRevision = null;
    this.runtime = null;
    this.activePreviewSurface = null;
    this.openTraces.supersedeAll();
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
    this.openTraces.supersedeAll();
    if (fileRef) this.openTraces.begin(this.selectionRevision, parentOpenTag);
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
    this.openTraces.mark(revision, { phase: 'workspace' });
    if (!this.isCurrent(runtime, revision)) {
      this.openTraces.finish(revision, 'superseded');
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
    this.openTraces.mark(revision, { phase: 'descriptor', surface: 'office' });
    if (!this.isCurrent(runtime, revision)) {
      await this.readBroker.cancelPreparedOffice(prepared.grantId, runtimeId, revision);
      this.openTraces.finish(revision, 'superseded');
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
      directory: null,
      error: null,
      selectedTextAvailable: onlyPreviewAdapterProvidesSelectedText(prepared.adapterId)
    };
    this.publishPresentation();
    this.openTraces.mark(revision, { phase: 'published' });
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
    this.openTraces.finish(this.selectionRevision, 'error');
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
    this.openTraces.finish(revision, 'ready');
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
    this.openTraces.finish(revision, 'error');
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
    // 地址栏跟着预览走(Ral 2026-09-10)。这里是每一种"预览变了"的汇合点 —— 逐个调用方各推一次
    // 必然漏掉某一条,而漏掉的后果是地址栏静默停在上一个文件。一格槽的理由见那个模块的注释。
    notifyOnlyPreviewDisplayUrl(this.runtime.host.hostToken);
  }

  private snapshotInternal(includeVueAsset = false): OnlyPreviewPreviewPresentation {
    const fileRef = this.presentation.fileRef;
    const fileDisplayPath = !includeVueAsset && fileRef && this.runtime
      ? resolve(onlyPreviewWorkspaceRegistry.requireWorkspace(
          this.runtime.host.hostToken, fileRef.workspaceId
        ).displayPath, fileRef.relativePath)
      : undefined;
    return {
      ...(fileDisplayPath ? { fileDisplayPath } : {}),
      ...projectOnlyPreviewPresentation(this.presentation, includeVueAsset),
      // Derived here, never read from `this.presentation`: every path that binds a Project clears
      // the presentation immediately afterwards, which would erase a stored value.
      projectIndexState: onlyPreviewProjectIndexStateService.get(this.presentation.workspaceId),
      projectBrowseState: onlyPreviewProjectIndexStateService.getBrowseState(this.presentation.workspaceId)
    };
  }

  private requireCurrentVueRevision(
    hostToken: string,
    selectionRevision: number,
    previewRuntimeToken: string,
    requireResetAcknowledgement = true
  ): void {
    requireOnlyPreviewVueRuntime(hostToken, previewRuntimeToken, this.runtime, this.viewService);
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

  private isCurrent(runtime: OnlyPreviewPreviewRegionRuntime, revision: number): boolean {
    return this.runtime === runtime && this.selectionRevision === revision;
  }
}

/**
 * **一个 host 一个预览区。**
 *
 * 原来这里只有一个进程级实例 —— 那在「整个 app 只有一个 OnlyPreview 面」的前提下是对的。
 * micromeet-cowork 的 `'file'` tab(`docs/features/file-preview-tabs.md` #6)要求同时存在多个预览面、
 * 每个装一个本机文件,所以「用哪个预览区」必须由 **hostToken** 决定,而不是"就那一个"。
 *
 * 这个泛化对本仓也是修正而非负担:`present` / `snapshot` / `findSnapshot` 这些方法**本来就**每一个
 * 都收 `hostToken` 并用 `requireOnlyPreviewPreviewRuntime` 校验它 —— 也就是说"哪个 host"一直是参数,
 * 只有"哪个实例"被写死成了单例。两者不一致时的表现是:第二个 host 的每一次调用都在第一个 host 的
 * 预览区上被拒,而错误码只会说「不是当前 runtime」。
 */
const regionsByHost = new Map<string, OnlyPreviewPreviewRegionService>();

export const onlyPreviewPreviewRegionService = new OnlyPreviewPreviewRegionService();

/**
 * 这个 host 的预览区。查不到时回落到上面那个进程级实例。
 *
 * 回落**不是**兜底逻辑,而是保持既有行为:本仓的 OnlyPreview 用的就是那一份,而它 `start()` 时会把
 * 自己登记进来,所以回落只在「host 已发但 `start()` 还没跑」那个窗口里起作用 —— 那个窗口里的调用
 * 本来也会被 `requireOnlyPreviewPreviewRuntime` 拒掉,回落只是让它拒在同一个地方、报同一个错。
 */
export const resolveOnlyPreviewPreviewRegion = (
  hostToken: unknown
): OnlyPreviewPreviewRegionService =>
  (typeof hostToken === 'string' ? regionsByHost.get(hostToken) : undefined) ??
  onlyPreviewPreviewRegionService;
