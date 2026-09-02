import { app, BaseWindow, WebContentsView, screen, session, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { is } from '@electron-toolkit/utils';
import { throttle } from 'es-toolkit';
import {
  OMNI_LAYOUT_RECOVERY_STATE_EVENT,
  OMNI_LAYOUT_SNAPSHOT_EVENT,
  OMNI_CONTROL_VISIBILITY_EVENT,
  OMNI_MINI_APP_DISPLAY_URLS,
  OMNI_MINI_APP_LOAD_STATE_EVENT,
  createDefaultOmniLayoutTree,
  parseOmniLayoutConfig,
  parseOmniPaneTree,
} from '@shared/omni/omni.types';
import {
  OMNI_BROWSER_HEADER_HEIGHT,
  OmniLayoutCommitQueue,
  flattenOmniPaneTreePixels,
  resolveOmniCellViewBounds,
} from '@shared/omni/omniLayout.service';
import type {
  OmniCellLayout,
  OmniContentMode,
  OmniLayoutConfig,
  OmniLayoutRecoveryState,
  OmniMiniAppLoadState,
  OmniMiniAppId,
  OmniPaneNode,
} from '@shared/omni/omni.types';
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type { WindowLayout } from '@shared/window/window.types';
import {
  windowStateService,
  type WindowStateController,
} from './windowState.service';
import {
  OmniGenerationReadyCollector,
  OmniOpenCoordinator,
  OMNI_OPEN_READY_TIMEOUT_MS,
  OmniOpenTimeoutError,
} from './omniOpenCoordinator.service';
import { OMNI_MINI_APP_RUNTIME } from './omniMiniAppRuntime.service';
import { createOmniOpenDiagnostics } from '@shared/omni/omniOpenDiagnostics.mjs';
import { createOmniDeferredStartupRegistry } from '@shared/omni/omniDeferredStartup.scheduler.mjs';
import { createOmniExactOnceResource } from '@shared/omni/omniExactOnceResource.mjs';
import type {
  OmniNavigationTrace,
  OmniOpenTrace,
  OmniRendererBootstrapPhase,
  OmniRendererDiagnosticPhase,
  OmniRendererDiagnosticRole,
  OmniRendererTrace,
} from '@shared/omni/omniOpenDiagnostics.mjs';

const LAYOUT_KEY = 'omni_layout';
const WINDOW_LAYOUT_KEY = 'window_layout';
const WINDOW_LAYOUT_SUB_KEY = 'omni';
const settingEmitter = createXpcMainEmitter<SettingDao>('SettingDao');

class Semaphore {
  private _capacity: number;
  private _count: number;
  private _queue: Array<() => void> = [];
  constructor(capacity: number) { this._capacity = capacity; this._count = capacity; }
  acquire(): Promise<void> {
    if (this._count > 0) { this._count--; return Promise.resolve(); }
    return new Promise<void>((resolve) => { this._queue.push(resolve); });
  }
  release(): void {
    if (this._queue.length > 0) {
      this._queue.shift()!();
    } else {
      this._count++;
    }
  }
  /** Flush all pending waiters and reset to full capacity — call on cleanup to unblock queued loadURLs */
  drain(): void {
    const pending = this._queue.splice(0);
    for (const resolve of pending) resolve();
    this._count = this._capacity;
  }
}

const MENUBAR_HEIGHT = 32;
const OMNI_PARTITION = 'persist:omni';
const OMNI_GOOGLE_PARTITION = 'persist:omni-google';
const OMNI_BROWSER_PARTITIONS = [OMNI_PARTITION, OMNI_GOOGLE_PARTITION] as const;
const GOOGLE_PROFILE_HOSTNAMES = ['google.com', 'youtube.com', 'youtu.be'] as const;

type OmniBrowserProfile = 'default' | 'google';
type OmniCellActiveFrameRegion =
  | 'browser-menubar'
  | 'browser-content'
  | 'miniapp-content';

const OMNI_ACTIVE_FRAME_ELEMENT_ID = 'bitterless-omni-active-cell-frame';
const OMNI_RENDERER_BOOTSTRAP_PHASES = new Set<OmniRendererOpenStagePhase>([
  'renderer-script',
  'renderer-language',
  'renderer-import',
  'renderer-mount',
  'layout-ready',
]);

const createOmniCellActiveFrameArguments = (
  cellId: string,
  region: OmniCellActiveFrameRegion,
): string[] => [
  `--omni-cell-id=${encodeURIComponent(cellId)}`,
  `--omni-cell-frame-region=${region}`,
];

const resolveOmniBrowserProfile = (url: string): OmniBrowserProfile | null => {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const isGoogleProfile = GOOGLE_PROFILE_HOSTNAMES.some(
    (candidate) => hostname === candidate || hostname.endsWith(`.${candidate}`),
  );
  return isGoogleProfile ? 'google' : 'default';
};

interface OmniMiniAppRendererTarget {
  filePath: string | null;
  url: string;
}

interface ResolvedOmniMiniAppRuntime {
  preloadPath: string;
  rendererTarget: OmniMiniAppRendererTarget;
  sandbox: boolean;
}

const getCellDisplayUrl = (cell: Pick<
  OmniCellLayout,
  'contentMode' | 'miniAppId' | 'url'
>): string => {
  if (cell.contentMode === 'browser') return cell.url;
  return OMNI_MINI_APP_DISPLAY_URLS[cell.miniAppId];
};

const extractTreeLeaves = (node: OmniPaneNode): Array<Pick<
  OmniCellLayout,
  'id' | 'url' | 'contentMode' | 'miniAppId'
>> => {
  if (node.type === 'leaf') {
    return [{
      id: node.id,
      url: node.url!,
      contentMode: node.contentMode!,
      miniAppId: node.miniAppId!,
    }];
  }
  const results: Array<Pick<
    OmniCellLayout,
    'id' | 'url' | 'contentMode' | 'miniAppId'
  >> = [];
  for (const child of node.children || []) {
    results.push(...extractTreeLeaves(child));
  }
  return results;
};

interface CellViewPair {
  id: string;
  menubar: WebContentsView | null;
  content: WebContentsView;
  contentMode: OmniContentMode;
  miniAppId: OmniMiniAppId;
  browserProfile: OmniBrowserProfile | null;
  lastUrl: string;
}

type OmniViewLoadResult =
  | { ok: true }
  | { ok: false; error: Error };

export type OmniRendererReadyRole = 'window' | 'browser-cell' | 'control';

export type OmniRendererOpenStagePhase = OmniRendererBootstrapPhase;

export interface OmniRendererMountedReadyParams {
  token: string;
  generation: number;
  role: OmniRendererReadyRole;
  cellId: string | null;
}

export interface OmniRendererMountedReadyResult {
  accepted: boolean;
}

export interface OmniRendererOpenStageParams extends OmniRendererMountedReadyParams {
  phase: OmniRendererOpenStagePhase;
  outcome: 'success' | 'failure';
}

interface OmniRendererReadyFence extends OmniRendererMountedReadyParams {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  settled: boolean;
  view: WebContentsView | null;
  loadPending: boolean;
  mountPending: boolean;
  lifecycleDisposer: (() => void) | null;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  diagnosticTrace: OmniRendererTrace;
  reportedStages: Set<string>;
}

type OmniOpenFailureReason =
  | 'none'
  | 'create-fail'
  | 'load-fail'
  | 'unresponsive'
  | 'process-gone'
  | 'renderer-fail'
  | 'closed'
  | 'invalidated'
  | 'diagnostic-timeout';

type OmniRendererFailureReason =
  | 'load-fail'
  | 'unresponsive'
  | 'process-gone'
  | 'renderer-fail'
  | 'invalidated'
  | 'diagnostic-timeout';

interface OmniOpenDiagnosticState {
  trace: OmniOpenTrace;
  firstVisible: boolean;
  failureReason: OmniOpenFailureReason;
}

interface OmniDeferredNavigation {
  trace: OmniNavigationTrace;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  dispose: (() => void) | null;
}

export class OmniWindowHelper {
  baseWindow: BaseWindow | null = null;
  private menubarView: WebContentsView | null = null;
  private controlView: WebContentsView | null = null;
  private controlVisible = false;
  private activeCellId: string | null = null;
  private cells: CellViewPair[] = [];
  private miniAppLoadFailures = new Map<string, OmniMiniAppId>();
  private recoveredFromInvalidLayout = false;
  private currentLayout: OmniCellLayout[] = [];
  private currentLayoutTree: OmniPaneNode | null = null;
  private _throttledApplyLayoutFn: (() => void) | null = null;
  private _throttledSaveLayoutToDaoFn: (() => void) | null = null;
  private readonly layoutCommitQueue = new OmniLayoutCommitQueue();
  private readonly viewLoadResults = new WeakMap<WebContentsView, Promise<OmniViewLoadResult>>();
  private readonly rendererReadyFences = new Map<string, OmniRendererReadyFence>();
  private readonly rendererReceiptOutcomes = new Map<string, 'accepted' | 'rejected'>();
  private readonly initialRendererReadyCollector = new OmniGenerationReadyCollector();
  private readonly deferredInitialContent = new Map<number, Array<() => void>>();
  private readonly deferredStartupRegistry = createOmniDeferredStartupRegistry();
  private readonly openDiagnostics = createOmniOpenDiagnostics();
  private readonly openDiagnosticStates = new Map<number, OmniOpenDiagnosticState>();
  private readonly deferredNavigationDiagnostics = new Set<OmniDeferredNavigation>();
  private readonly browserLoadResources = new Set<
    ReturnType<typeof createOmniExactOnceResource>
  >();
  private _loadSemaphore = new Semaphore(3);
  private _abortTokens = new Set<{ abort: () => void }>();
  private windowStateController: WindowStateController | null = null;
  private readonly openCoordinator = new OmniOpenCoordinator<BaseWindow>({
    getReady: () => {
      const window = this.baseWindow;
      return window && !window.isDestroyed() ? window : null;
    },
    create: (generation) => {
      this.beginOpenDiagnostic(generation, 'cold');
      this.cleanupAllViews();
      return this.createWindow(generation);
    },
    present: (window, generation) => {
      const state = this.openDiagnosticStates.get(generation) ??
        this.beginOpenDiagnostic(generation, 'existing');
      this.assertCreationActive(generation, window);
      this.show();
      this.assertCreationActive(generation, window);
      this.markOpenFirstVisible(state, window);
      state.trace.mark({
        phase: 'interactive',
        ...this.getRestoredCounts(),
        visible: window.isVisible(),
        focused: window.isFocused(),
      });
      this.startDeferredInitialContent(generation, state.trace.tag);
      state.trace.mark({
        phase: 'ready',
        ...this.getRestoredCounts(),
        visible: window.isVisible(),
        focused: window.isFocused(),
      });
      this.finishOpenDiagnostic(generation, 'success', 'none');
    },
    cleanupIncomplete: (generation, error) => {
      const timeout = error instanceof OmniOpenTimeoutError;
      this.finishOpenDiagnostic(
        generation,
        timeout ? 'timeout' : 'failure',
        timeout ? 'diagnostic-timeout' : this.getOpenFailureReason(generation),
      );
      console.error('[OmniWindowHelper] open failed');
      this.cleanupAllViews();
    },
    onInvalidate: (generation) => {
      this.finishOpenDiagnostic(generation, 'superseded', 'invalidated');
    },
  });

  /** Whether any surviving cell currently renders this mini app, regardless of which one asks. */
  hasLiveMiniApp(miniAppId: OmniMiniAppId): boolean {
    const window = this.baseWindow;
    if (!window || window.isDestroyed()) return false;
    return this.cells.some((cell) =>
      cell.contentMode === 'miniapp' &&
      cell.miniAppId === miniAppId &&
      this.isWebContentsAlive(cell.content.webContents));
  }

  isLiveMiniAppWebContents(miniAppId: OmniMiniAppId, sender: Electron.WebContents): boolean {
    const window = this.baseWindow;
    if (!window || window.isDestroyed() || sender.isDestroyed()) return false;
    return this.cells.some((cell) =>
      cell.contentMode === 'miniapp' &&
      cell.miniAppId === miniAppId &&
      cell.content.webContents === sender &&
      this.isWebContentsAlive(cell.content.webContents));
  }

  show(): void {
    const window = this.baseWindow;
    if (!window || window.isDestroyed()) return;
    if (this.windowStateController) {
      this.windowStateController.show();
    } else {
      if (window.isMinimized()) window.restore();
      window.show();
    }
    window.focus();
  }

  private beginOpenDiagnostic(
    generation: number,
    mode: 'cold' | 'existing',
  ): OmniOpenDiagnosticState {
    const existing = this.openDiagnosticStates.get(generation);
    if (existing) return existing;
    const state: OmniOpenDiagnosticState = {
      trace: this.openDiagnostics.trace('open', {
        route: 'api',
        mode,
        generation,
      }),
      firstVisible: false,
      failureReason: 'none',
    };
    this.openDiagnosticStates.set(generation, state);
    return state;
  }

  private getRestoredCounts(): {
    totalCount: number;
    browserCount: number;
    miniAppCount: number;
  } {
    let browserCount = 0;
    let miniAppCount = 0;
    for (const cell of this.currentLayout) {
      if (cell.contentMode === 'browser') browserCount += 1;
      else miniAppCount += 1;
    }
    return {
      totalCount: this.currentLayout.length,
      browserCount,
      miniAppCount,
    };
  }

  private markOpenFirstVisible(
    state: OmniOpenDiagnosticState,
    window: BaseWindow,
  ): void {
    if (state.firstVisible) return;
    state.firstVisible = true;
    state.trace.mark({
      phase: 'first-visible',
      ...this.getRestoredCounts(),
      visible: window.isVisible(),
      focused: window.isFocused(),
    });
  }

  private markOpenFailure(
    generation: number,
    reason: Exclude<OmniOpenFailureReason, 'none'>,
  ): void {
    const state = this.openDiagnosticStates.get(generation);
    if (state && state.failureReason === 'none') state.failureReason = reason;
  }

  private getOpenFailureReason(generation: number): OmniOpenFailureReason {
    const reason = this.openDiagnosticStates.get(generation)?.failureReason;
    return reason && reason !== 'none' ? reason : 'create-fail';
  }

  private getPendingRendererCounts(generation: number): {
    pendingTopLoad: number;
    pendingTopMount: number;
    pendingBrowserLoad: number;
    pendingBrowserMount: number;
  } {
    let pendingTopLoad = 0;
    let pendingTopMount = 0;
    let pendingBrowserLoad = 0;
    let pendingBrowserMount = 0;
    for (const fence of this.rendererReadyFences.values()) {
      if (fence.generation !== generation || fence.settled) continue;
      if (fence.role === 'window') {
        if (fence.loadPending) pendingTopLoad += 1;
        if (fence.mountPending) pendingTopMount += 1;
      } else if (fence.role === 'browser-cell') {
        if (fence.loadPending) pendingBrowserLoad += 1;
        if (fence.mountPending) pendingBrowserMount += 1;
      }
    }
    return {
      pendingTopLoad,
      pendingTopMount,
      pendingBrowserLoad,
      pendingBrowserMount,
    };
  }

  private finishOpenDiagnostic(
    generation: number,
    outcome: 'success' | 'failure' | 'timeout' | 'superseded',
    reason: OmniOpenFailureReason,
  ): void {
    const state = this.openDiagnosticStates.get(generation);
    if (!state) return;
    state.trace.end({
      outcome,
      reason,
      ...this.getPendingRendererCounts(generation),
    });
    this.openDiagnosticStates.delete(generation);
  }

  private throttledApplyLayout(): void {
    if (!this._throttledApplyLayoutFn) {
      this._throttledApplyLayoutFn = throttle(() => {
        this.applyLayoutInternal();
      }, 16, { trailing: true });
    }
    this._throttledApplyLayoutFn();
  }

  private throttledSaveLayoutToDao(): void {
    if (!this._throttledSaveLayoutToDaoFn) {
      this._throttledSaveLayoutToDaoFn = throttle(() => {
        this.saveLayoutToDao();
      }, 500, { trailing: true });
    }
    this._throttledSaveLayoutToDaoFn();
  }

  private isWebContentsAlive(wc: Electron.WebContents): boolean {
    return !wc.isDestroyed() && !wc.isCrashed();
  }

  private closeWebContentsView(view: WebContentsView | null): void {
    if (!view) return;
    try {
      if (!view.webContents.isDestroyed()) {
        view.webContents.close();
      }
    } catch {
      // already destroyed
    }
  }

  private detachWebContentsView(view: WebContentsView | null): void {
    if (!view || !this.baseWindow || this.baseWindow.isDestroyed()) return;
    try {
      this.baseWindow.contentView.removeChildView(view);
    } catch {
      // The view may already be detached or disposed after a renderer failure.
    }
  }

  private disposeWebContentsView(view: WebContentsView | null): void {
    this.detachWebContentsView(view);
    this.closeWebContentsView(view);
  }

  private cleanupAllViews(): void {
    this.rejectRendererReadyFences(new Error('[OmniWindowHelper] Renderer readiness cancelled'));
    this.initialRendererReadyCollector.invalidate();
    this.deferredInitialContent.clear();
    this.deferredStartupRegistry.cancelAll();
    for (const navigation of [...this.deferredNavigationDiagnostics]) {
      this.finishDeferredNavigationDiagnostic(navigation, 'superseded');
    }
    for (const resource of [...this.browserLoadResources]) resource.close();
    this.browserLoadResources.clear();

    // Abort all pending loadURL acquire() calls and flush the semaphore queue
    for (const token of this._abortTokens) token.abort();
    this._abortTokens.clear();
    this._loadSemaphore.drain();

    // Detach controlView from baseWindow before destroying (preserve singleton)
    if (this.controlView && this.baseWindow && !this.baseWindow.isDestroyed()) {
      try {
        if (this.controlVisible) {
          this.baseWindow.contentView.removeChildView(this.controlView);
        }
      } catch {
        // The control view may already be detached during window teardown.
      }
    }
    this.controlVisible = false;
    this.broadcastActiveCell(null);

    const cells = this.cells;
    this.cells = [];
    this.miniAppLoadFailures.clear();
    for (const cell of cells) {
      this.disposeWebContentsView(cell.menubar);
      this.disposeWebContentsView(cell.content);
    }
    this.disposeWebContentsView(this.menubarView);
    this.menubarView = null;
    this.currentLayout = [];
    this.currentLayoutTree = null;

    const windowToDestroy = this.baseWindow;
    const stateController = this.windowStateController;
    this.baseWindow = null;
    this.windowStateController = null;
    if (windowToDestroy && !windowToDestroy.isDestroyed()) {
      stateController?.flushAndDispose();
      windowToDestroy.destroy();
    }

    // Clear ServiceWorkers so a stuck SW from either browser session doesn't survive into the next open
    for (const partition of OMNI_BROWSER_PARTITIONS) {
      session.fromPartition(partition)
        .clearStorageData({ storages: ['serviceworkers'] })
        .catch((err) => console.warn(`[OmniWindowHelper] Failed to clear SW for ${partition}:`, err));
    }
  }

  private createRendererReadyFence(params: {
    generation: number;
    role: OmniRendererReadyRole;
    cellId: string | null;
    parentTag?: string;
  }): OmniRendererReadyFence {
    const token = randomUUID();
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    // A synchronous constructor failure can invalidate the fence before createWindow reaches
    // Promise.all. Mark it handled while preserving its rejection for the eventual await.
    void promise.catch(() => {});
    const diagnosticRole: OmniRendererDiagnosticRole = params.role === 'window'
      ? 'top'
      : params.role === 'browser-cell'
        ? 'browser'
        : 'control';
    const fence: OmniRendererReadyFence = {
      ...params,
      token,
      promise,
      resolve,
      reject,
      settled: false,
      view: null,
      loadPending: true,
      mountPending: true,
      lifecycleDisposer: null,
      timeoutHandle: null,
      diagnosticTrace: this.openDiagnostics.trace('renderer', {
        parentTag: params.parentTag ??
          this.openDiagnosticStates.get(params.generation)?.trace.tag,
        role: diagnosticRole,
        generation: params.generation,
      }, 'r'),
      reportedStages: new Set<string>(),
    };
    this.rendererReadyFences.set(token, fence);
    return fence;
  }

  private getRendererReadyArguments(fence: OmniRendererReadyFence): string[] {
    return [
      `--omni-ready-token=${encodeURIComponent(fence.token)}`,
      `--omni-ready-generation=${fence.generation}`,
      `--omni-ready-role=${fence.role}`,
    ];
  }

  private getRendererDiagnosticRole(
    role: OmniRendererReadyRole,
  ): OmniRendererDiagnosticRole {
    if (role === 'window') return 'top';
    if (role === 'browser-cell') return 'browser';
    return 'control';
  }

  private markRendererDiagnosticStage(
    fence: OmniRendererReadyFence,
    phase: OmniRendererDiagnosticPhase,
    outcome: 'success' | 'failure' = 'success',
    backgroundThrottling?: boolean,
  ): void {
    if (fence.settled) return;
    const stageKey = `${phase}:${outcome}`;
    if (fence.reportedStages.has(stageKey)) return;
    fence.reportedStages.add(stageKey);
    fence.diagnosticTrace.mark({
      role: this.getRendererDiagnosticRole(fence.role),
      phase,
      outcome,
      backgroundThrottling,
    });
  }

  private disposeRendererReadyFenceLifecycle(fence: OmniRendererReadyFence): void {
    const dispose = fence.lifecycleDisposer;
    fence.lifecycleDisposer = null;
    dispose?.();
  }

  private clearRendererReadyFenceTimeout(fence: OmniRendererReadyFence): void {
    if (fence.timeoutHandle === null) return;
    clearTimeout(fence.timeoutHandle);
    fence.timeoutHandle = null;
  }

  private rejectRendererReadyFence(
    fence: OmniRendererReadyFence,
    error: Error,
    reason: OmniRendererFailureReason = 'renderer-fail',
  ): void {
    if (fence.settled) return;
    fence.settled = true;
    this.markOpenFailure(fence.generation, reason);
    this.clearRendererReadyFenceTimeout(fence);
    this.disposeRendererReadyFenceLifecycle(fence);
    this.rendererReadyFences.delete(fence.token);
    if (fence.view && this.isWebContentsAlive(fence.view.webContents)) {
      fence.view.webContents.setBackgroundThrottling(true);
    }
    fence.diagnosticTrace.end({
      role: this.getRendererDiagnosticRole(fence.role),
      outcome: reason === 'invalidated'
        ? 'superseded'
        : reason === 'diagnostic-timeout'
          ? 'timeout'
          : 'failure',
      reason,
    });
    fence.reject(error);
  }

  private rejectRendererReadyFences(
    error: Error,
    reason: OmniRendererFailureReason = 'invalidated',
  ): void {
    for (const fence of [...this.rendererReadyFences.values()]) {
      this.rejectRendererReadyFence(fence, error, reason);
    }
  }

  private bindRendererReadyFenceView(fence: OmniRendererReadyFence, view: WebContentsView): void {
    fence.view = view;
    const isCurrent = (): boolean =>
      fence.view === view &&
      !fence.settled &&
      this.isRendererReadyFenceCurrent(fence);
    const failCurrent = (
      phase: 'load-fail' | 'unresponsive' | 'process-gone',
      reason: 'load-fail' | 'unresponsive' | 'process-gone',
    ): void => {
      if (!isCurrent()) return;
      if (phase === 'load-fail') fence.loadPending = false;
      this.markRendererDiagnosticStage(fence, phase, 'failure');
      this.rejectRendererReadyFence(
        fence,
        new Error('[OmniWindowHelper] Local renderer failed'),
        reason,
      );
    };
    const onDomReady = (): void => {
      if (!isCurrent()) return;
      this.markRendererDiagnosticStage(fence, 'dom-ready');
    };
    const onDidFinishLoad = (): void => {
      if (!isCurrent()) return;
      fence.loadPending = false;
      this.markRendererDiagnosticStage(fence, 'load-finish');
      this.settleRendererReadyFenceIfReady(fence);
    };
    const onDidFailLoad = (): void => failCurrent('load-fail', 'load-fail');
    const onUnresponsive = (): void => failCurrent('unresponsive', 'unresponsive');
    const onResponsive = (): void => {
      if (!isCurrent()) return;
      this.markRendererDiagnosticStage(fence, 'responsive');
    };
    const onRenderProcessGone = (): void => failCurrent('process-gone', 'process-gone');
    view.webContents.on('dom-ready', onDomReady);
    view.webContents.on('did-finish-load', onDidFinishLoad);
    view.webContents.on('did-fail-load', onDidFailLoad);
    view.webContents.on('unresponsive', onUnresponsive);
    view.webContents.on('responsive', onResponsive);
    view.webContents.on('render-process-gone', onRenderProcessGone);
    fence.lifecycleDisposer = () => {
      if (view.webContents.isDestroyed()) return;
      view.webContents.removeListener('dom-ready', onDomReady);
      view.webContents.removeListener('did-finish-load', onDidFinishLoad);
      view.webContents.removeListener('did-fail-load', onDidFailLoad);
      view.webContents.removeListener('unresponsive', onUnresponsive);
      view.webContents.removeListener('responsive', onResponsive);
      view.webContents.removeListener('render-process-gone', onRenderProcessGone);
    };
    this.markRendererDiagnosticStage(
      fence,
      'create',
      'success',
      view.webContents.getBackgroundThrottling(),
    );
  }

  private isRendererReadyFenceCurrent(fence: OmniRendererReadyFence): boolean {
    if (
      fence.settled ||
      !this.isCreationActive(fence.generation) ||
      !fence.view ||
      !this.isWebContentsAlive(fence.view.webContents)
    ) {
      return false;
    }
    if (fence.role === 'window') return this.menubarView === fence.view;
    if (fence.role === 'control') return this.controlView === fence.view;
    return this.cells.some((cell) =>
      cell.id === fence.cellId &&
      cell.contentMode === 'browser' &&
      cell.menubar === fence.view
    );
  }

  private settleRendererReadyFenceIfReady(fence: OmniRendererReadyFence): boolean {
    if (
      fence.settled ||
      fence.loadPending ||
      fence.mountPending ||
      !this.isRendererReadyFenceCurrent(fence) ||
      !fence.view
    ) {
      return false;
    }
    fence.settled = true;
    this.clearRendererReadyFenceTimeout(fence);
    this.disposeRendererReadyFenceLifecycle(fence);
    this.rendererReadyFences.delete(fence.token);
    fence.view.webContents.setBackgroundThrottling(true);
    fence.diagnosticTrace.end({
      role: this.getRendererDiagnosticRole(fence.role),
      outcome: 'ready',
      reason: 'none',
    });
    fence.resolve();
    return true;
  }

  markRendererOpenStage(
    params: OmniRendererOpenStageParams,
  ): OmniRendererMountedReadyResult {
    const fence = typeof params?.token === 'string'
      ? this.rendererReadyFences.get(params.token)
      : null;
    if (
      !fence ||
      !Number.isSafeInteger(params.generation) ||
      params.generation !== fence.generation ||
      params.role !== fence.role ||
      params.cellId !== fence.cellId ||
      !OMNI_RENDERER_BOOTSTRAP_PHASES.has(params.phase) ||
      (params.outcome !== 'success' && params.outcome !== 'failure') ||
      !this.isRendererReadyFenceCurrent(fence)
    ) {
      return { accepted: false };
    }
    const outcome = params.outcome === 'failure' ? 'failure' : 'success';
    this.markRendererDiagnosticStage(fence, params.phase, outcome);
    if (outcome === 'failure') {
      this.rejectRendererReadyFence(
        fence,
        new Error('[OmniWindowHelper] Renderer bootstrap failed'),
        'renderer-fail',
      );
    }
    return { accepted: true };
  }

  markRendererMountedReady(
    params: OmniRendererMountedReadyParams,
  ): OmniRendererMountedReadyResult {
    const fence = typeof params?.token === 'string'
      ? this.rendererReadyFences.get(params.token)
      : null;
    const accepted = Boolean(
      fence &&
      Number.isSafeInteger(params.generation) &&
      params.generation === fence.generation &&
      params.role === fence.role &&
      params.cellId === fence.cellId &&
      this.isRendererReadyFenceCurrent(fence),
    );
    const receiptKey = typeof params?.token === 'string' ? params.token : '';
    if (receiptKey && !this.rendererReceiptOutcomes.has(receiptKey)) {
      const outcome = accepted ? 'accepted' : 'rejected';
      this.rendererReceiptOutcomes.set(receiptKey, outcome);
      if (this.rendererReceiptOutcomes.size > 256) {
        const oldest = this.rendererReceiptOutcomes.keys().next().value;
        if (oldest) this.rendererReceiptOutcomes.delete(oldest);
      }
      this.openDiagnostics.receipt({
        parentTag: fence?.diagnosticTrace.tag,
        role: fence ? this.getRendererDiagnosticRole(fence.role) : 'unknown',
        outcome,
      });
    }
    if (!accepted || !fence) {
      return { accepted: false };
    }
    fence.mountPending = false;
    this.settleRendererReadyFenceIfReady(fence);
    return { accepted: true };
  }

  private async loadWindowLayout(): Promise<WindowLayout | null> {
    try {
      const layout = await settingEmitter.get<WindowLayout>({
        key: WINDOW_LAYOUT_KEY,
        sub_key: WINDOW_LAYOUT_SUB_KEY,
      });
      return layout;
    } catch (err) {
      console.error('[OmniWindowHelper] Failed to load window layout:', err);
      return null;
    }
  }

  create(): Promise<BaseWindow> {
    return this.openCoordinator.open();
  }

  private async createWindow(creationGeneration: number): Promise<BaseWindow> {
    console.log('[OmniWindowHelper] create() called');

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    const defaultWidth = Math.floor(screenWidth * 0.7);
    const defaultHeight = Math.floor(screenHeight * 0.7);

    if (!windowStateService.has('omni')) {
      const legacyLayout = await this.loadWindowLayout();
      this.assertCreationActive(creationGeneration);
      if (legacyLayout) windowStateService.importLegacy('omni', legacyLayout);
    }
    const restored = windowStateService.resolve('omni');

    const windowOptions: any = {
      width: restored?.bounds.width ?? defaultWidth,
      height: restored?.bounds.height ?? defaultHeight,
      minWidth: 800,
      minHeight: 600,
      title: 'Omni Browser',
      show: false,
      ...(process.platform === 'darwin'
        ? {
            acceptFirstMouse: true,
            titleBarStyle: 'hiddenInset',
            trafficLightPosition: { x: 12, y: 8 },
          }
        : { frame: false }),
    };

    if (restored) {
      windowOptions.x = restored.bounds.x;
      windowOptions.y = restored.bounds.y;
    }

    const createdWindow = new BaseWindow(windowOptions);
    this.baseWindow = createdWindow;
    const stateController = windowStateService.register('omni', createdWindow);
    this.windowStateController = stateController;
    this.openDiagnosticStates.get(creationGeneration)?.trace.mark({
      phase: 'native',
      ...this.getRestoredCounts(),
      visible: createdWindow.isVisible(),
      focused: createdWindow.isFocused(),
    });

    // Create top menubar view. Loading its HTML is not enough: the renderer explicitly reports
    // after language initialization, dynamic import, Vue mount, and nextTick.
    const topRendererReady = this.createRendererReadyFence({
      generation: creationGeneration,
      role: 'window',
      cellId: null,
    });
    const menubarView = this.createWebContentsView(
      'omniWindow',
      this.getRendererReadyArguments(topRendererReady),
      true,
      topRendererReady,
    );
    this.menubarView = menubarView;
    createdWindow.contentView.addChildView(menubarView);
    console.log('[OmniWindowHelper] menubarView added');

    // BaseWindow does not emit 'ready-to-show' (that is a BrowserWindow event).
    // The complete initial browser chrome gate below owns the first show.
    menubarView.webContents.on('did-finish-load', () => {
      if (!this.isCreationActive(creationGeneration, createdWindow)) return;
      console.log('[OmniWindowHelper] top menubar did-finish-load');
    });

    createdWindow.on('closed' as any, () => {
      console.log('[OmniWindowHelper] baseWindow closed, cleaning up');
      if (this.baseWindow === createdWindow) {
        this.finishOpenDiagnostic(creationGeneration, 'failure', 'closed');
        this.openCoordinator.invalidate();
        this.cleanupAllViews();
      }
    });

    createdWindow.on('resize' as any, () => {
      if (this.baseWindow !== createdWindow) return;
      this.throttledApplyLayout();
      this.updateMenubarBounds();
      this.updateControlBounds();
    });

    this.updateMenubarBounds();
    this.updateControlBounds();

    const shouldOpenDevTools =
      process.env.BITTERLESS_E2E !== '1' && import.meta.env.VITE_MODE === 'debug';
    if (shouldOpenDevTools) {
      menubarView.webContents.openDevTools({ mode: 'detach' });
    }

    // Permission handler: deny notifications for specific domains (e.g. larksuite.com),
    // allow for all others so the executeJavaScript override can intercept them instead.
    const NOTIFICATION_BLOCKED_DOMAINS = ['larksuite.com'];
    for (const partition of OMNI_BROWSER_PARTITIONS) {
      session.fromPartition(partition).setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'notifications') {
          try {
            const hostname = new URL(webContents.getURL()).hostname;
            const blocked = NOTIFICATION_BLOCKED_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
            if (blocked) {
              console.log(`[OmniWindowHelper] Notification permission denied for ${hostname}`);
              callback(false);
              return;
            }
          } catch {
            callback(false);
            return;
          }
        }
        callback(true);
      });
    }

    // Restore saved cell layout so cells appear immediately on window open. Only browser chrome
    // created during this initial restore participates in the cold-open readiness gate.
    const initialRendererReadyBatch = this.initialRendererReadyCollector.begin(
      creationGeneration,
    );
    this.deferredInitialContent.set(creationGeneration, []);
    try {
      await this.restoreSavedLayout(creationGeneration);
    } finally {
      this.initialRendererReadyCollector.finish(initialRendererReadyBatch);
    }
    this.assertCreationActive(creationGeneration, createdWindow);
    this.openDiagnosticStates.get(creationGeneration)?.trace.mark({
      phase: 'restore',
      ...this.getRestoredCounts(),
      visible: createdWindow.isVisible(),
      focused: createdWindow.isFocused(),
    });
    const initialBrowserRendererReady = initialRendererReadyBatch.promises;

    const initialBrowserMenubars = this.currentLayout
      .filter((cell) => cell.contentMode === 'browser')
      .map((layoutCell) => {
        const cell = this.cells.find((candidate) => candidate.id === layoutCell.id);
        if (!cell?.menubar) {
          throw new Error(
            `[OmniWindowHelper] Initial browser chrome is missing for cell ${layoutCell.id}`,
          );
        }
        return this.requireViewLoad(cell.menubar, `browser cell ${layoutCell.id}`);
      });
    console.log(
      '[OmniWindowHelper] waiting for initial mounted chrome, browser cells:',
      initialBrowserMenubars.length,
    );
    await Promise.all([
      this.requireViewLoad(menubarView, 'top menubar'),
      ...initialBrowserMenubars,
      topRendererReady.promise,
      ...initialBrowserRendererReady,
    ]);
    this.assertCreationActive(creationGeneration, createdWindow);

    return createdWindow;
  }

  private async requireViewLoad(view: WebContentsView, label: string): Promise<void> {
    const resultPromise = this.viewLoadResults.get(view);
    if (!resultPromise) {
      throw new Error(`[OmniWindowHelper] No load readiness exists for ${label}`);
    }
    const result = await resultPromise;
    if (!result.ok) {
      throw new Error(`[OmniWindowHelper] ${label} failed to load: ${result.error.message}`);
    }
  }

  private setControlVisible(visible: boolean): void {
    if (!this.baseWindow || this.baseWindow.isDestroyed() || !this.controlView) return;

    if (this.controlVisible === visible) {
      xpcMain.broadcast(OMNI_CONTROL_VISIBILITY_EVENT, { visible });
      return;
    }

    this.controlVisible = visible;
    if (this.controlVisible) {
      this.baseWindow.contentView.addChildView(this.controlView);
      this.controlView.setVisible(true);
      this.updateControlBounds();
      this.replayControlState();
    } else {
      this.controlView.setVisible(false);
      this.baseWindow.contentView.removeChildView(this.controlView);
    }
    xpcMain.broadcast(OMNI_CONTROL_VISIBILITY_EVENT, { visible: this.controlVisible });
  }

  toggleControl(): void {
    if (!this.controlView || !this.isWebContentsAlive(this.controlView.webContents)) {
      this.createControlView();
    }
    this.setControlVisible(!this.controlVisible);
  }

  private createControlView(startupGeneration?: number, parentTag?: string): void {
    const rendererReadyFence = startupGeneration !== undefined &&
      this.openCoordinator.isCurrent(startupGeneration)
      ? this.createRendererReadyFence({
          generation: startupGeneration,
          role: 'control',
          cellId: null,
          parentTag,
        })
      : null;
    let controlView: WebContentsView;
    try {
      controlView = this.createWebContentsView(
        'omniControl',
        rendererReadyFence ? this.getRendererReadyArguments(rendererReadyFence) : [],
        Boolean(rendererReadyFence),
        rendererReadyFence ?? undefined,
      );
    } catch (error) {
      if (rendererReadyFence) {
        this.rejectRendererReadyFence(
          rendererReadyFence,
          error instanceof Error ? error : new Error(String(error)),
          'renderer-fail',
        );
      }
      throw error;
    }
    this.controlView = controlView;
    if (rendererReadyFence && !rendererReadyFence.settled) {
      rendererReadyFence.timeoutHandle = setTimeout(() => {
        if (
          rendererReadyFence.settled ||
          this.rendererReadyFences.get(rendererReadyFence.token) !== rendererReadyFence
        ) return;
        this.rejectRendererReadyFence(
          rendererReadyFence,
          new Error('[OmniWindowHelper] Control renderer readiness timed out'),
          'diagnostic-timeout',
        );
      }, OMNI_OPEN_READY_TIMEOUT_MS);
    }
    controlView.setBackgroundColor('#00000000');
    controlView.webContents.on('did-finish-load', () => this.replayControlState());
    controlView.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.key !== 'Escape') return;
      event.preventDefault();
      this.setControlVisible(false);
    });
    this.updateControlBounds();
  }

  private startDeferredInitialContent(generation: number, parentTag: string): void {
    if (!this.openCoordinator.isCurrent(generation)) return;
    const tasks = this.deferredInitialContent.get(generation) ?? [];
    const scheduled = this.deferredStartupRegistry.schedule(generation, () => {
      if (!this.openCoordinator.isCurrent(generation)) return;
      for (const task of tasks) {
        try {
          task();
        } catch {
          console.error('[OmniWindowHelper] deferred initial content failed');
        }
      }
      if (!this.controlView || !this.isWebContentsAlive(this.controlView.webContents)) {
        try {
          this.createControlView(generation, parentTag);
        } catch {
          console.error('[OmniWindowHelper] deferred control creation failed');
        }
      }
    });
    if (scheduled) this.deferredInitialContent.delete(generation);
  }

  private beginDeferredNavigationDiagnostic(
    generation: number,
  ): OmniDeferredNavigation {
    const navigation: OmniDeferredNavigation = {
      trace: this.openDiagnostics.trace('navigation', {
        parentTag: this.openDiagnosticStates.get(generation)?.trace.tag,
        generation,
      }, 'n'),
      timeoutHandle: null,
      dispose: null,
    };
    this.deferredNavigationDiagnostics.add(navigation);
    navigation.trace.mark({ phase: 'scheduled' });
    return navigation;
  }

  private startDeferredNavigationDiagnostic(navigation: OmniDeferredNavigation | null): void {
    if (!navigation || !this.deferredNavigationDiagnostics.has(navigation)) return;
    navigation.trace.mark({ phase: 'start' });
  }

  private armDeferredNavigationTimeout(navigation: OmniDeferredNavigation | null): void {
    if (!navigation || !this.deferredNavigationDiagnostics.has(navigation)) return;
    navigation.timeoutHandle = setTimeout(() => {
      this.finishDeferredNavigationDiagnostic(navigation, 'timeout');
    }, 30_000);
  }

  private finishDeferredNavigationDiagnostic(
    navigation: OmniDeferredNavigation | null,
    outcome: 'success' | 'failure' | 'timeout' | 'superseded',
  ): void {
    if (!navigation || !this.deferredNavigationDiagnostics.delete(navigation)) return;
    if (navigation.timeoutHandle) clearTimeout(navigation.timeoutHandle);
    navigation.timeoutHandle = null;
    navigation.dispose?.();
    navigation.dispose = null;
    navigation.trace.end({ outcome });
  }

  getLayoutConfig(): OmniLayoutConfig | null {
    if (!this.currentLayoutTree) return null;
    return { tree: parseOmniPaneTree(this.currentLayoutTree) };
  }

  async commitLayout(tree: OmniPaneNode): Promise<void> {
    const committedTree = parseOmniPaneTree(tree);
    await this.layoutCommitQueue.enqueue(async () => {
      this.updateLayout(committedTree);
      await this.persistLayoutToDao();
    });
  }

  updateLayout(tree: OmniPaneNode): void {
    const normalizedTree = parseOmniPaneTree(tree);
    const normalizedCells: OmniCellLayout[] = extractTreeLeaves(normalizedTree).map((leaf) => ({
      ...leaf,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    }));
    this.currentLayout = normalizedCells;
    this.currentLayoutTree = normalizedTree;

    const nextCellsById = new Map(normalizedCells.map((cell) => [cell.id, cell]));
    for (const [cellId, failedMiniAppId] of this.miniAppLoadFailures) {
      const nextCell = nextCellsById.get(cellId);
      if (
        !nextCell ||
        nextCell.contentMode !== 'miniapp' ||
        nextCell.miniAppId !== failedMiniAppId
      ) this.miniAppLoadFailures.delete(cellId);
    }

    // Remove deleted cells and recreate only cells whose content runtime changed.
    const toRemove = this.cells.filter((cell) => {
      const next = normalizedCells.find((candidate) => candidate.id === cell.id);
      return !next ||
        next.contentMode !== cell.contentMode ||
        next.miniAppId !== cell.miniAppId;
    });
    this.cells = this.cells.filter((cell) => !toRemove.includes(cell));
    for (const cell of toRemove) {
      this.removeCellViews(cell);
    }
    if (this.activeCellId && !nextCellsById.has(this.activeCellId)) {
      this.broadcastActiveCell(null);
    }

    // Add new cells
    for (const layoutCell of normalizedCells) {
      if (!this.cells.some((cell) => cell.id === layoutCell.id)) {
        this.addCell(layoutCell);
      }
    }

    this.applyLayoutInternal();
  }

  navigateCell(cellId: string, url: string): void {
    const cell = this.cells.find((c) => c.id === cellId);
    if (
      !cell ||
      cell.contentMode !== 'browser' ||
      !this.isWebContentsAlive(cell.content.webContents)
    ) return;
    const nextProfile = resolveOmniBrowserProfile(url);
    if (!nextProfile) {
      cell.content.webContents.loadURL(url).catch(() => {});
      return;
    }
    if (cell.browserProfile !== nextProfile) {
      this.replaceBrowserCellContentView(cell, url, nextProfile);
      return;
    }
    cell.content.webContents.loadURL(url).catch(() => {});
  }

  cellGoBack(cellId: string): void {
    const cell = this.cells.find((c) => c.id === cellId);
    if (
      cell?.contentMode === 'browser' &&
      this.isWebContentsAlive(cell.content.webContents) &&
      cell.content.webContents.canGoBack()
    ) {
      cell.content.webContents.goBack();
    }
  }

  cellGoForward(cellId: string): void {
    const cell = this.cells.find((c) => c.id === cellId);
    if (
      cell?.contentMode === 'browser' &&
      this.isWebContentsAlive(cell.content.webContents) &&
      cell.content.webContents.canGoForward()
    ) {
      cell.content.webContents.goForward();
    }
  }

  cellRefresh(cellId: string): void {
    const cell = this.cells.find((c) => c.id === cellId);
    if (cell && this.isWebContentsAlive(cell.content.webContents)) {
      cell.content.webContents.reload();
    }
  }

  closeCell(cellId: string): void {
    const cell = this.cells.find((c) => c.id === cellId);
    if (cell) {
      this.cells = this.cells.filter((c) => c.id !== cellId);
      this.miniAppLoadFailures.delete(cellId);
      this.removeCellViews(cell);
      if (this.activeCellId === cellId) this.broadcastActiveCell(null);
    }
  }

  destroy(): void {
    this.openCoordinator.invalidate();
    this.cleanupAllViews();
    // Destroy the singleton controlView only on full destroy (app quit)
    this.closeWebContentsView(this.controlView);
    this.controlView = null;
  }

  private createBrowserCellContentView(
    profile: OmniBrowserProfile,
    cellId: string,
  ): WebContentsView {
    const partition = profile === 'google' ? OMNI_GOOGLE_PARTITION : OMNI_PARTITION;
    const browserSession = session.fromPartition(partition);
    // Both profiles keep Electron's native network and JavaScript identity. The Google profile
    // remains separate solely to preserve its existing cookie jar.
    return new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/omniCellContent.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: true,
        session: browserSession,
        additionalArguments: createOmniCellActiveFrameArguments(cellId, 'browser-content'),
      },
    });
  }

  private createMiniAppCellContentView(
    runtime: ResolvedOmniMiniAppRuntime,
    cellId: string,
  ): WebContentsView {
    return new WebContentsView({
      webPreferences: {
        preload: runtime.preloadPath,
        sandbox: runtime.sandbox,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
        allowRunningInsecureContent: false,
        backgroundThrottling: true,
        additionalArguments: [
          '--mode=omni',
          ...createOmniCellActiveFrameArguments(cellId, 'miniapp-content'),
        ],
      },
    });
  }

  private getMiniAppRendererTarget(miniAppId: OmniMiniAppId): OmniMiniAppRendererTarget {
    const { rendererName } = OMNI_MINI_APP_RUNTIME[miniAppId];
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      const rendererBaseUrl = process.env['ELECTRON_RENDERER_URL'].replace(/\/+$/, '');
      return {
        filePath: null,
        url: `${rendererBaseUrl}/${rendererName}/index.html`,
      };
    }
    const filePath = join(app.getAppPath(), 'out', 'renderer', rendererName, 'index.html');
    return {
      filePath,
      url: pathToFileURL(filePath).href,
    };
  }

  private resolveMiniAppRuntime(miniAppId: OmniMiniAppId): ResolvedOmniMiniAppRuntime {
    const runtime = OMNI_MINI_APP_RUNTIME[miniAppId];
    const preloadPath = join(app.getAppPath(), 'out', 'preload', runtime.preloadFile);
    if (!existsSync(preloadPath)) {
      throw new Error(`expected preload does not exist: ${preloadPath}`);
    }

    const rendererTarget = this.getMiniAppRendererTarget(miniAppId);
    if (rendererTarget.filePath && !existsSync(rendererTarget.filePath)) {
      throw new Error(`expected renderer does not exist: ${rendererTarget.filePath}`);
    }

    return { preloadPath, rendererTarget, sandbox: runtime.sandbox };
  }

  private broadcastMiniAppLoadState(params: OmniMiniAppLoadState): void {
    if (params.status === 'failed') {
      this.miniAppLoadFailures.set(params.cellId, params.miniAppId);
    } else {
      this.miniAppLoadFailures.delete(params.cellId);
    }
    try {
      xpcMain.broadcast(OMNI_MINI_APP_LOAD_STATE_EVENT, params);
    } catch (error) {
      console.warn('[OmniWindowHelper] Failed to broadcast mini-app load state:', error);
    }
  }

  private replayMiniAppLoadFailures(): void {
    for (const [cellId, miniAppId] of this.miniAppLoadFailures) {
      xpcMain.broadcast(OMNI_MINI_APP_LOAD_STATE_EVENT, {
        cellId,
        miniAppId,
        status: 'failed',
      } satisfies OmniMiniAppLoadState);
    }
  }

  private broadcastLayoutRecoveryState(): void {
    xpcMain.broadcast(OMNI_LAYOUT_RECOVERY_STATE_EVENT, {
      recoveredFromInvalidLayout: this.recoveredFromInvalidLayout,
    } satisfies OmniLayoutRecoveryState);
  }

  private replayControlState(): void {
    this.replayMiniAppLoadFailures();
    this.broadcastLayoutRecoveryState();
    const config = this.getLayoutConfig();
    if (config) xpcMain.broadcast(OMNI_LAYOUT_SNAPSHOT_EVENT, config);
    this.broadcastActiveCell(this.activeCellId);
  }

  private setLayoutRecoveryState(recoveredFromInvalidLayout: boolean): void {
    this.recoveredFromInvalidLayout = recoveredFromInvalidLayout;
    this.broadcastLayoutRecoveryState();
  }

  private reportMiniAppLoadFailure(params: {
    cellId: string;
    miniAppId: OmniMiniAppId;
    stage: 'target-validation' | 'renderer-load' | 'renderer-process';
    expectedTarget: string;
    error: unknown;
  }): void {
    this.clearActiveCellIfMatching(params.cellId);
    const detail = params.error instanceof Error ? params.error.message : 'unknown error';
    console.error(
      `[OmniWindowHelper] Mini app ${params.miniAppId} ${params.stage} failed; expected ${params.expectedTarget}: ${detail}`,
    );
    this.broadcastMiniAppLoadState({
      cellId: params.cellId,
      miniAppId: params.miniAppId,
      status: 'failed',
    });
  }

  private loadMiniAppCellContent(
    content: WebContentsView,
    params: {
      cellId: string;
      miniAppId: OmniMiniAppId;
      target: OmniMiniAppRendererTarget;
    },
    onTerminal?: (outcome: 'success' | 'failure') => void,
  ): void {
    const { cellId, miniAppId, target } = params;
    let loadPromise: Promise<void>;
    try {
      loadPromise = target.filePath
        ? content.webContents.loadFile(target.filePath)
        : content.webContents.loadURL(target.url);
    } catch (error) {
      onTerminal?.('failure');
      const cell = this.cells.find(
        (candidate) => candidate.id === cellId && candidate.content === content,
      );
      if (cell) {
        this.cells = this.cells.filter((candidate) => candidate !== cell);
        this.removeCellViews(cell);
      }
      this.reportMiniAppLoadFailure({
        cellId,
        miniAppId,
        stage: 'renderer-load',
        expectedTarget: target.url,
        error,
      });
      return;
    }
    loadPromise.then(() => {
      onTerminal?.('success');
      const cell = this.cells.find(
        (candidate) => candidate.id === cellId && candidate.content === content,
      );
      if (!cell) return;
      this.broadcastMiniAppLoadState({ cellId, miniAppId, status: 'ready' });
    }).catch((error) => {
      onTerminal?.('failure');
      const cell = this.cells.find(
        (candidate) => candidate.id === cellId && candidate.content === content,
      );
      if (!cell) return;
      this.cells = this.cells.filter((candidate) => candidate !== cell);
      this.removeCellViews(cell);
      this.reportMiniAppLoadFailure({
        cellId,
        miniAppId,
        stage: 'renderer-load',
        expectedTarget: target.url,
        error,
      });
    });
  }

  private addCell(layoutCell: OmniCellLayout): void {
    if (!this.baseWindow) return;

    const { id, url, contentMode, miniAppId } = layoutCell;
    const initialRendererReadyBatch = this.initialRendererReadyCollector.active;
    const rendererReadyFence = contentMode === 'browser' &&
      initialRendererReadyBatch !== null &&
      this.isCreationActive(initialRendererReadyBatch.generation)
      ? this.createRendererReadyFence({
          generation: initialRendererReadyBatch.generation,
          role: 'browser-cell',
          cellId: id,
        })
      : null;
    if (rendererReadyFence && initialRendererReadyBatch) {
      initialRendererReadyBatch.promises.push(rendererReadyFence.promise);
    }
    const displayUrl = getCellDisplayUrl(layoutCell);
    const browserProfile = contentMode === 'browser'
      ? resolveOmniBrowserProfile(url) ?? 'default'
      : null;
    let miniAppRuntime: ResolvedOmniMiniAppRuntime | null = null;

    if (contentMode === 'miniapp') {
      try {
        miniAppRuntime = this.resolveMiniAppRuntime(miniAppId);
      } catch (error) {
        this.reportMiniAppLoadFailure({
          cellId: id,
          miniAppId,
          stage: 'target-validation',
          expectedTarget: join(app.getAppPath(), 'out'),
          error,
        });
        return;
      }
    }

    let menubar: WebContentsView | null = null;
    try {
      menubar = contentMode === 'browser'
        ? this.createWebContentsView('omniCell', [
          `--cellId=${id}`,
          `--initialUrl=${displayUrl}`,
          `--contentMode=${contentMode}`,
          ...createOmniCellActiveFrameArguments(id, 'browser-menubar'),
          ...(rendererReadyFence ? this.getRendererReadyArguments(rendererReadyFence) : []),
        ], true, rendererReadyFence ?? undefined)
        : null;
      if (menubar) {
        this.bindCellActiveFrameLifecycle(id, menubar);
        this.baseWindow.contentView.addChildView(menubar);
      }
    } catch (error) {
      if (rendererReadyFence) {
        this.rejectRendererReadyFence(
          rendererReadyFence,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      this.disposeWebContentsView(menubar);
      this.clearActiveCellIfMatching(id);
      console.error(`[OmniWindowHelper] Cell ${id} browser chrome creation failed:`, error);
      return;
    }

    let content: WebContentsView;
    try {
      content = contentMode === 'browser'
        ? this.createBrowserCellContentView(browserProfile!, id)
        : this.createMiniAppCellContentView(miniAppRuntime!, id);
    } catch (error) {
      if (rendererReadyFence) {
        this.rejectRendererReadyFence(
          rendererReadyFence,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      this.disposeWebContentsView(menubar);
      this.reportMiniAppLoadFailure({
        cellId: id,
        miniAppId,
        stage: 'target-validation',
        expectedTarget: miniAppRuntime?.rendererTarget.url ?? url,
        error,
      });
      return;
    }
    try {
      this.baseWindow.contentView.addChildView(content);
    } catch (error) {
      if (rendererReadyFence) {
        this.rejectRendererReadyFence(
          rendererReadyFence,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      this.disposeWebContentsView(menubar);
      this.disposeWebContentsView(content);
      this.reportMiniAppLoadFailure({
        cellId: id,
        miniAppId,
        stage: 'target-validation',
        expectedTarget: miniAppRuntime?.rendererTarget.url ?? url,
        error,
      });
      return;
    }
    this.bindCellActiveFrameLifecycle(id, content);

    if (contentMode === 'browser') {
      this.configureBrowserCellContentView(id, content);
    } else {
      // Mini-app cells have privileged first-party preloads. Never allow one to become a browser.
      const expectedRendererUrl = miniAppRuntime!.rendererTarget.url;
      content.webContents.setWindowOpenHandler((details) => {
        if (/^https?:\/\//i.test(details.url)) shell.openExternal(details.url);
        return { action: 'deny' };
      });
      const fenceMiniAppNavigation = (event: Electron.Event, navigationUrl: string): void => {
        if (navigationUrl === expectedRendererUrl) return;
        event.preventDefault();
        if (/^https?:\/\//i.test(navigationUrl)) shell.openExternal(navigationUrl);
      };
      content.webContents.on('will-navigate', fenceMiniAppNavigation);
      content.webContents.on('will-redirect', fenceMiniAppNavigation);
    }

    // Browser-only chrome may mount after the page has already navigated.
    if (menubar) {
      menubar.webContents.on('did-finish-load', () => {
        const currentContent = this.cells.find((candidate) => candidate.id === id)?.content
          ?? content;
        if (!this.isWebContentsAlive(menubar.webContents)) return;
        if (!this.isWebContentsAlive(currentContent.webContents)) return;
        const currentUrl = currentContent.webContents.getURL();
        xpcMain.broadcast('omniCell/urlChanged', { cellId: id, url: currentUrl || url });
        this.notifyControlUrlChanged(id, currentUrl || url);
      });
    }

    if (menubar) {
      menubar.webContents.on('focus' as any, () => {
        if (!this.isWebContentsAlive(menubar.webContents)) return;
        this.broadcastActiveCell(id);
      });
    }

    const cell: CellViewPair = {
      id,
      menubar,
      content,
      contentMode,
      miniAppId,
      browserProfile,
      lastUrl: url || '',
    };

    this.bindCellContentLifecycle(cell, content, miniAppRuntime);

    this.cells.push(cell);
    this.applyActiveCellFrameState();

    const hasInitialNavigation = contentMode === 'miniapp' ? Boolean(miniAppRuntime) : Boolean(url);
    const deferredNavigation = hasInitialNavigation && initialRendererReadyBatch
      ? this.beginDeferredNavigationDiagnostic(initialRendererReadyBatch.generation)
      : null;
    const startContent = (): void => {
    if (contentMode === 'miniapp' && miniAppRuntime) {
      this.startDeferredNavigationDiagnostic(deferredNavigation);
      this.armDeferredNavigationTimeout(deferredNavigation);
      this.loadMiniAppCellContent(content, {
        cellId: id,
        miniAppId,
        target: miniAppRuntime.rendererTarget,
      }, (outcome) => {
        this.finishDeferredNavigationDiagnostic(deferredNavigation, outcome);
      });
    } else if (url) {
      // Semaphore (capacity 3): stagger concurrent URL loads to avoid overwhelming the shared session.
      // aborted is set to true by drain() path — checked after acquire() resolves to skip destroyed views.
      let aborted = false;
      const abortToken = { abort: () => { aborted = true; } };
      this._abortTokens.add(abortToken);

      this._loadSemaphore.acquire().then(() => {
        this._abortTokens.delete(abortToken);
        if (aborted) {
          this.finishDeferredNavigationDiagnostic(deferredNavigation, 'superseded');
          return;
        }
        if (!this.isWebContentsAlive(content.webContents)) {
          this._loadSemaphore.release();
          this.finishDeferredNavigationDiagnostic(deferredNavigation, 'superseded');
          return;
        }
        const resources = createOmniExactOnceResource();
        this.browserLoadResources.add(resources);
        resources.add(() => this.browserLoadResources.delete(resources));
        resources.add(() => this._loadSemaphore.release());
        const finishLoad = (
          outcome: 'success' | 'failure' | 'timeout' | 'superseded',
        ): void => {
          resources.close();
          this.finishDeferredNavigationDiagnostic(deferredNavigation, outcome);
        };
        const timeoutId = setTimeout(() => finishLoad('timeout'), 30_000);
        resources.add(() => clearTimeout(timeoutId));
        const listeners = [
          ['did-finish-load', () => finishLoad('success')],
          ['did-fail-load', () => finishLoad('failure')],
          ['did-fail-provisional-load', () => finishLoad('failure')],
          ['render-process-gone', () => finishLoad('failure')],
        ] as const;
        for (const [event, listener] of listeners) {
          content.webContents.on(event, listener);
          resources.add(() => {
            if (!content.webContents.isDestroyed()) {
              content.webContents.removeListener(event, listener);
            }
          });
        }
        if (deferredNavigation) deferredNavigation.dispose = () => resources.close();
        let loadPromise: Promise<void>;
        try {
          this.startDeferredNavigationDiagnostic(deferredNavigation);
          loadPromise = content.webContents.loadURL(url);
        } catch {
          finishLoad('failure');
          return;
        }
        loadPromise.catch(() => {
          finishLoad('failure');
          const currentCell = this.cells.find((candidate) => candidate.id === id);
          if (currentCell?.content !== content) return;
          this.clearActiveCellIfMatching(id);
        });
      });
    }
    };
    const deferred = initialRendererReadyBatch
      ? this.deferredInitialContent.get(initialRendererReadyBatch.generation)
      : null;
    if (deferred) deferred.push(startContent);
    else startContent();

    // Ensure control overlay stays on top
    if (this.controlVisible && this.controlView) {
      this.baseWindow.contentView.removeChildView(this.controlView);
      this.baseWindow.contentView.addChildView(this.controlView);
    }
  }

  private configureBrowserCellContentView(id: string, content: WebContentsView): void {
    content.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url);
      return { action: 'deny' };
    });

    content.webContents.on('did-navigate', (_e, navUrl) => {
      const cell = this.cells.find((candidate) => candidate.id === id);
      if (cell?.content !== content) return;
      if (!this.isWebContentsAlive(content.webContents)) return;
      this.notifyCellUrl(id, navUrl);
    });
    content.webContents.on('did-navigate-in-page', (_e, navUrl) => {
      const cell = this.cells.find((candidate) => candidate.id === id);
      if (cell?.content !== content) return;
      if (!this.isWebContentsAlive(content.webContents)) return;
      this.notifyCellUrl(id, navUrl);
    });

    // Block remote pages from setting app badge (e.g. Telegram Web)
    // Also override Notification in the main world (executeJavaScript runs in main world,
    // bypassing contextIsolation — preload-level assignment only affects the isolated world).
    content.webContents.on('dom-ready', () => {
      if (!this.isWebContentsAlive(content.webContents)) return;
      content.webContents.executeJavaScript(`
      if ('setAppBadge' in navigator) {
        navigator.setAppBadge = () => Promise.resolve();
      }
      if ('clearAppBadge' in navigator) {
        navigator.clearAppBadge = () => Promise.resolve();
      }

      // Layer 1: override window.Notification in main world
      window.Notification = class InterceptedNotification {
        static permission = 'granted';
        static requestPermission() { return Promise.resolve('granted'); }
        constructor(title, options) {
          console.log('[OmniCell] Notification intercepted:', { title, body: options && options.body, tag: options && options.tag, time: new Date().toISOString() });
        }
        addEventListener() {} removeEventListener() {} dispatchEvent() { return false; } close() {}
      };

      // Layer 2: override ServiceWorker showNotification (handles SW-triggered notifications)
      function patchSWRegistration(reg) {
        reg.showNotification = function(title, options) {
          console.log('[OmniCell] SW showNotification intercepted:', { title, body: options && options.body, tag: options && options.tag, time: new Date().toISOString() });
          return Promise.resolve();
        };
      }
      if (navigator.serviceWorker) {
        navigator.serviceWorker.ready.then(patchSWRegistration).catch(function(){});
        var _origRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
        navigator.serviceWorker.register = function() {
          return _origRegister.apply(null, arguments).then(function(reg) {
            patchSWRegistration(reg);
            return reg;
          });
        };
      }
      `).catch(() => {});
    });
  }

  private bindCellContentLifecycle(
    cell: CellViewPair,
    content: WebContentsView,
    miniAppRuntime: ResolvedOmniMiniAppRuntime | null,
  ): void {
    content.webContents.on('focus' as any, () => {
      if (cell.content !== content) return;
      if (!this.isWebContentsAlive(content.webContents)) return;
      this.broadcastActiveCell(cell.id);
    });

    content.webContents.on('render-process-gone', (_e, details) => {
      if (!this.cells.includes(cell) || cell.content !== content) return;
      this.cells = this.cells.filter((candidate) => candidate !== cell);
      this.removeCellViews(cell);
      if (cell.contentMode === 'miniapp' && miniAppRuntime) {
        this.reportMiniAppLoadFailure({
          cellId: cell.id,
          miniAppId: cell.miniAppId,
          stage: 'renderer-process',
          expectedTarget: miniAppRuntime.rendererTarget.url,
          error: new Error(details.reason),
        });
      } else {
        this.clearActiveCellIfMatching(cell.id);
        console.warn(`[OmniWindowHelper] Cell ${cell.id} renderer crashed:`, details.reason);
      }
    });
  }

  private replaceBrowserCellContentView(
    cell: CellViewPair,
    url: string,
    profile: OmniBrowserProfile,
  ): void {
    if (!this.baseWindow || this.baseWindow.isDestroyed()) return;

    const previousContent = cell.content;
    let content: WebContentsView | null = null;
    try {
      content = this.createBrowserCellContentView(profile, cell.id);
      this.bindCellActiveFrameLifecycle(cell.id, content);
      this.configureBrowserCellContentView(cell.id, content);
      this.bindCellContentLifecycle(cell, content, null);
      this.baseWindow.contentView.addChildView(content);
    } catch (error) {
      this.disposeWebContentsView(content);
      this.clearActiveCellIfMatching(cell.id);
      console.error(`[OmniWindowHelper] Cell ${cell.id} browser replacement failed:`, error);
      return;
    }
    cell.content = content;
    cell.browserProfile = profile;
    this.disposeWebContentsView(previousContent);
    this.applyLayoutInternal();

    if (this.controlVisible && this.controlView) {
      this.baseWindow.contentView.removeChildView(this.controlView);
      this.baseWindow.contentView.addChildView(this.controlView);
    }

    let loadPromise: Promise<void>;
    try {
      loadPromise = content.webContents.loadURL(url);
    } catch (error) {
      this.clearActiveCellIfMatching(cell.id);
      console.error(`[OmniWindowHelper] Cell ${cell.id} browser replacement load failed:`, error);
      return;
    }
    loadPromise.catch((error) => {
      if (cell.content !== content) return;
      this.clearActiveCellIfMatching(cell.id);
      console.error(`[OmniWindowHelper] Cell ${cell.id} browser replacement load failed:`, error);
    });
  }

  private removeCellViews(cell: CellViewPair): void {
    this.disposeWebContentsView(cell.menubar);
    this.disposeWebContentsView(cell.content);
  }

  private notifyCellUrl(cellId: string, url: string): void {
    const cell = this.cells.find((c) => c.id === cellId);
    if (!cell) return;
    // Skip if URL unchanged — SPA replaceState may fire did-navigate-in-page with the same URL
    if (cell.lastUrl === url) return;
    cell.lastUrl = url;

    xpcMain.broadcast('omniCell/urlChanged', { cellId, url });
    this.notifyControlUrlChanged(cellId, url);

    // Update tree and save to SettingDao (throttled to avoid excessive writes from SPA navigations)
    if (this.updateTreeUrl(this.currentLayoutTree, cellId, url)) {
      this.throttledSaveLayoutToDao();
    }
  }

  private broadcastActiveCell(activeCellId: string | null): void {
    this.activeCellId = activeCellId;
    this.applyActiveCellFrameState();
    xpcMain.broadcast('omniCell/activeChanged', { activeCellId });
  }

  private clearActiveCellIfMatching(cellId: string): void {
    if (this.activeCellId !== cellId) return;
    this.broadcastActiveCell(null);
  }

  private applyActiveCellFrameState(): void {
    for (const cell of this.cells) {
      const active = cell.id === this.activeCellId;
      this.setCellViewActiveFrame(cell.menubar, active);
      this.setCellViewActiveFrame(cell.content, active);
    }
  }

  private bindCellActiveFrameLifecycle(cellId: string, view: WebContentsView): void {
    const replayActiveFrame = () => {
      if (!this.isWebContentsAlive(view.webContents)) return;
      this.setCellViewActiveFrame(view, this.activeCellId === cellId);
    };
    view.webContents.on('dom-ready', replayActiveFrame);
    view.webContents.on('did-finish-load', replayActiveFrame);
  }

  private setCellViewActiveFrame(view: WebContentsView | null, active: boolean): void {
    if (!view || !this.isWebContentsAlive(view.webContents)) return;
    const activeValue = active ? 'true' : 'false';
    const displayValue = active ? 'block' : 'none';
    view.webContents.executeJavaScript(`
      (() => {
        const frame = document.getElementById('${OMNI_ACTIVE_FRAME_ELEMENT_ID}');
        if (!frame || frame.dataset.omniActiveCellFrame !== 'true') return false;
        frame.dataset.active = '${activeValue}';
        frame.style.setProperty('display', '${displayValue}', 'important');
        return true;
      })()
    `).catch(() => {});
  }

  private notifyControlUrlChanged(cellId: string, url: string): void {
    xpcMain.broadcast('omniControl/cellUrlChanged', { cellId, url });
  }

  private updateTreeUrl(tree: OmniPaneNode | null, cellId: string, url: string): boolean {
    if (!tree) return false;
    if (tree.type === 'leaf' && tree.id === cellId) {
      tree.url = url;
      return true;
    }
    if (tree.children) {
      for (const child of tree.children) {
        if (this.updateTreeUrl(child, cellId, url)) return true;
      }
    }
    return false;
  }

  private async restoreSavedLayout(creationGeneration: number): Promise<void> {
    try {
      const persistedValue = await settingEmitter.get<unknown>({ key: LAYOUT_KEY });
      if (!this.isCreationActive(creationGeneration)) return;
      if (persistedValue === null || persistedValue === undefined) {
        this.restoreDefaultBrowserLayout();
        this.setLayoutRecoveryState(false);
        return;
      }
      const config = parseOmniLayoutConfig(persistedValue);
      const leaves = extractTreeLeaves(config.tree);
      this.updateLayout(config.tree);
      this.setLayoutRecoveryState(false);
      console.log('[OmniWindowHelper] Restored saved layout with', leaves.length, 'cells');
    } catch (err) {
      console.error('[OmniWindowHelper] Failed to restore saved layout:', err);
      if (!this.isCreationActive(creationGeneration)) return;
      this.restoreDefaultBrowserLayout();
      this.setLayoutRecoveryState(true);
    }
  }

  private restoreDefaultBrowserLayout(): void {
    const tree = createDefaultOmniLayoutTree();
    this.updateLayout(tree);
  }

  private isCreationActive(
    creationGeneration: number,
    createdWindow?: BaseWindow,
  ): boolean {
    return this.openCoordinator.isCurrent(creationGeneration) &&
      (!createdWindow || (
        this.baseWindow === createdWindow &&
        !createdWindow.isDestroyed()
      ));
  }

  private assertCreationActive(
    creationGeneration: number,
    createdWindow?: BaseWindow,
  ): void {
    if (!this.isCreationActive(creationGeneration, createdWindow)) {
      throw new Error('[OmniWindowHelper] Window creation was cancelled');
    }
  }

  async saveLayoutToDao(): Promise<void> {
    try {
      await this.persistLayoutToDao();
    } catch (err) {
      console.error('[OmniWindowHelper] Failed to save layout:', err);
    }
  }

  private async persistLayoutToDao(): Promise<void> {
    if (!this.currentLayoutTree) return;
    const config = parseOmniLayoutConfig({ tree: this.currentLayoutTree });
    this.currentLayoutTree = config.tree;
    await settingEmitter.upsert({ key: LAYOUT_KEY, value: config });
    console.log('[OmniWindowHelper] Layout saved to SettingDao');
  }

  private setCellBounds(
    cell: CellViewPair,
    bounds: { x: number; y: number; width: number; height: number },
  ): void {
    const viewBounds = resolveOmniCellViewBounds(
      bounds,
      cell.menubar ? OMNI_BROWSER_HEADER_HEIGHT : 0,
    );
    if (cell.menubar && viewBounds.header) cell.menubar.setBounds(viewBounds.header);
    cell.content.setBounds(viewBounds.content);
  }

  private applyLayoutInternal(): void {
    if (!this.baseWindow) return;
    const [contentWidth, contentHeight] = this.baseWindow.getContentSize();
    const areaTop = MENUBAR_HEIGHT;
    const areaWidth = contentWidth;
    const areaHeight = contentHeight - MENUBAR_HEIGHT;

    if (this.currentLayoutTree) {
      const pixelCells = flattenOmniPaneTreePixels(this.currentLayoutTree, {
        x: 0,
        y: areaTop,
        width: areaWidth,
        height: areaHeight,
      });
      for (const layoutCell of pixelCells) {
        const cell = this.cells.find((c) => c.id === layoutCell.id);
        if (!cell) continue;
        const { x, y, width: w, height: h } = layoutCell;
        this.setCellBounds(cell, { x, y, width: w, height: h });
      }
      return;
    }

    // Fallback: percentage-based (before tree is available)
    for (const layoutCell of this.currentLayout) {
      const cell = this.cells.find((c) => c.id === layoutCell.id);
      if (!cell) continue;
      const x = Math.round(areaWidth * (layoutCell.x / 100));
      const y = Math.round(areaTop + areaHeight * (layoutCell.y / 100));
      const w = Math.round(areaWidth * (layoutCell.width / 100));
      const h = Math.round(areaHeight * (layoutCell.height / 100));
      this.setCellBounds(cell, { x, y, width: w, height: h });
    }
  }

  private updateMenubarBounds(): void {
    if (!this.baseWindow || !this.menubarView) return;
    const [contentWidth] = this.baseWindow.getContentSize();
    this.menubarView.setBounds({
      x: 0,
      y: 0,
      width: contentWidth,
      height: MENUBAR_HEIGHT,
    });
  }

  private updateControlBounds(): void {
    if (!this.baseWindow || !this.controlView || !this.controlVisible) return;
    const [contentWidth, contentHeight] = this.baseWindow.getContentSize();
    this.controlView.setBounds({
      x: 0,
      y: MENUBAR_HEIGHT,
      width: contentWidth,
      height: Math.max(contentHeight - MENUBAR_HEIGHT, 0),
    });
  }

  private createWebContentsView(
    rendererName: string,
    additionalArguments: string[] = [],
    startupUnthrottled = false,
    rendererReadyFence?: OmniRendererReadyFence,
  ): WebContentsView {
    let view: WebContentsView;
    try {
      view = new WebContentsView({
        webPreferences: {
          preload: join(__dirname, '../preload/omni.js'),
          sandbox: false,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: !startupUnthrottled,
          additionalArguments,
        },
      });
    } catch (error) {
      if (rendererReadyFence) {
        this.markOpenFailure(rendererReadyFence.generation, 'create-fail');
        this.markRendererDiagnosticStage(rendererReadyFence, 'create', 'failure');
        this.rejectRendererReadyFence(
          rendererReadyFence,
          error instanceof Error ? error : new Error(String(error)),
          'renderer-fail',
        );
      }
      throw error;
    }
    if (rendererReadyFence) {
      this.bindRendererReadyFenceView(rendererReadyFence, view);
      this.markRendererDiagnosticStage(
        rendererReadyFence,
        'load-start',
        'success',
        view.webContents.getBackgroundThrottling(),
      );
    }

    const rendererPath = `omni/${rendererName}/index.html`;

    let loadPromise: Promise<void>;
    try {
      loadPromise = is.dev && process.env['ELECTRON_RENDERER_URL']
        ? view.webContents.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${rendererPath}`)
        : view.webContents.loadFile(join(__dirname, `../renderer/${rendererPath}`));
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (rendererReadyFence) {
        rendererReadyFence.loadPending = false;
        this.markRendererDiagnosticStage(rendererReadyFence, 'load-fail', 'failure');
        this.rejectRendererReadyFence(rendererReadyFence, normalized, 'load-fail');
      }
      this.viewLoadResults.set(view, Promise.resolve({ ok: false, error: normalized }));
      return view;
    }
    this.viewLoadResults.set(
      view,
      loadPromise.then<OmniViewLoadResult, OmniViewLoadResult>(
        () => {
          if (rendererReadyFence && !rendererReadyFence.settled) {
            rendererReadyFence.loadPending = false;
            this.markRendererDiagnosticStage(rendererReadyFence, 'load-finish');
            this.settleRendererReadyFenceIfReady(rendererReadyFence);
          }
          return { ok: true };
        },
        (error) => {
          const normalized = error instanceof Error ? error : new Error(String(error));
          if (rendererReadyFence && !rendererReadyFence.settled) {
            rendererReadyFence.loadPending = false;
            this.markRendererDiagnosticStage(rendererReadyFence, 'load-fail', 'failure');
            this.rejectRendererReadyFence(rendererReadyFence, normalized, 'load-fail');
          }
          return { ok: false, error: normalized };
        },
      ),
    );

    return view;
  }
}

export const omniWindowHelper = new OmniWindowHelper();
