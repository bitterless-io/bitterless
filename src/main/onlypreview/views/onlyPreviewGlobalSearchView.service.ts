import { randomUUID } from 'node:crypto';
import type { BaseWindow, Rectangle, WebContentsView } from 'electron';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_FOCUS_PROJECT_EVENT,
  ONLY_PREVIEW_FOCUS_SEARCH_EVENT,
  ONLY_PREVIEW_GLOBAL_SEARCH_CONTEXT_CHANGED_EVENT,
  ONLY_PREVIEW_GLOBAL_SEARCH_LAYOUT_EVENT,
  ONLY_PREVIEW_GLOBAL_SEARCH_REVEAL_DIRECTORY_EVENT,
  ONLY_PREVIEW_GLOBAL_SEARCH_VISIBILITY_EVENT,
  type OnlyPreviewGlobalSearchContextSnapshot,
  type OnlyPreviewGlobalSearchCloseRequest,
  type OnlyPreviewGlobalSearchDirectoryRevealAction,
  type OnlyPreviewGlobalSearchDirectoryRevealCompletion,
  type OnlyPreviewGlobalSearchDirectoryRevealRequest,
  type OnlyPreviewGlobalSearchFocusOrigin,
  type OnlyPreviewGlobalSearchLayout
} from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewHostCapability } from '@main/onlypreview/onlyPreviewHost.registry';

const DIRECTORY_REVEAL_TIMEOUT_MS = 5_000;

export interface OnlyPreviewGlobalSearchViewRuntime {
  window: BaseWindow;
  host: OnlyPreviewHostCapability;
  createView: () => WebContentsView;
  loadView: (view: WebContentsView) => Promise<void>;
  broadcast: (eventName: string, params: unknown) => void;
  restoreOpener: () => boolean;
  clearOpener: () => void;
  focusProject: () => boolean;
  focusPreview: () => boolean;
}

interface PendingDirectoryReveal {
  action: OnlyPreviewGlobalSearchDirectoryRevealAction;
  resolve: (succeeded: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

const closeContentView = (view: WebContentsView | null): void => {
  if (!view || view.webContents.isDestroyed()) return;
  try {
    view.webContents.close();
  } catch {
    // The owning BaseWindow may already have destroyed the child.
  }
};

const sameRevealIdentity = (
  action: OnlyPreviewGlobalSearchDirectoryRevealAction,
  completion: OnlyPreviewGlobalSearchDirectoryRevealCompletion
): boolean =>
  action.actionId === completion.actionId &&
  action.workspaceId === completion.workspaceId &&
  action.generation === completion.generation &&
  action.relativePath === completion.relativePath;

const sameBounds = (left: Rectangle, right: Rectangle): boolean =>
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height;

const cloneLayout = (
  layout: OnlyPreviewGlobalSearchLayout | null
): OnlyPreviewGlobalSearchLayout | null =>
  layout
    ? {
        viewBounds: { ...layout.viewBounds },
        workspaceBounds: { ...layout.workspaceBounds }
      }
    : null;

export class OnlyPreviewGlobalSearchViewService {
  private runtime: OnlyPreviewGlobalSearchViewRuntime | null = null;
  private view: WebContentsView | null = null;
  private bounds: Rectangle | null = null;
  private loadGeneration = 0;
  private context: OnlyPreviewGlobalSearchContextSnapshot = {
    revision: 0,
    active: false,
    workspace: null,
    layout: null
  };
  private pendingReveal: PendingDirectoryReveal | null = null;

  start(runtime: OnlyPreviewGlobalSearchViewRuntime): void {
    this.destroy();
    this.runtime = runtime;
  }

  isActive(hostToken: string): boolean {
    return this.runtime?.host.hostToken === hostToken && this.context.active;
  }

  getView(): WebContentsView | null {
    return this.view;
  }

  getContext(hostToken: string): OnlyPreviewGlobalSearchContextSnapshot {
    this.requireRuntime(hostToken);
    return {
      revision: this.context.revision,
      active: this.context.active,
      workspace: this.context.workspace ? { ...this.context.workspace } : null,
      layout: cloneLayout(this.context.layout)
    };
  }

  reportContext(
    hostToken: string,
    workspace: OnlyPreviewGlobalSearchContextSnapshot['workspace']
  ): void {
    const runtime = this.requireRuntime(hostToken);
    this.context = {
      revision: this.context.revision + 1,
      active: this.context.active,
      workspace: workspace ? { ...workspace } : null,
      layout: this.context.layout
    };
    runtime.broadcast(ONLY_PREVIEW_GLOBAL_SEARCH_CONTEXT_CHANGED_EVENT, {
      hostId: runtime.host.hostId,
      revision: this.context.revision
    });
    this.broadcastVisibility(runtime);
  }

  updateBounds(hostToken: string, viewBounds: Rectangle, workspaceBounds: Rectangle): void {
    const runtime = this.requireRuntime(hostToken);
    const layoutChanged =
      !this.context.layout ||
      !sameBounds(this.context.layout.viewBounds, viewBounds) ||
      !sameBounds(this.context.layout.workspaceBounds, workspaceBounds);
    this.bounds = { ...viewBounds };
    if (layoutChanged) {
      this.context = {
        ...this.context,
        revision: this.context.revision + 1,
        layout: {
          viewBounds: { ...viewBounds },
          workspaceBounds: { ...workspaceBounds }
        }
      };
      runtime.broadcast(ONLY_PREVIEW_GLOBAL_SEARCH_LAYOUT_EVENT, {
        hostId: runtime.host.hostId,
        revision: this.context.revision,
        layout: cloneLayout(this.context.layout)
      });
    }
    if (this.context.active) this.attachTopmost();
  }

  show(hostToken: string, origin: OnlyPreviewGlobalSearchFocusOrigin): WebContentsView | null {
    const runtime = this.requireRuntime(hostToken);
    this.setActive(true);
    const view = this.ensureView();
    this.attachTopmost();
    if (view && !view.webContents.isDestroyed()) view.webContents.focus();
    runtime.broadcast(ONLY_PREVIEW_FOCUS_SEARCH_EVENT, {
      hostId: runtime.host.hostId,
      origin
    });
    this.broadcastVisibility(runtime);
    return view;
  }

  raiseAfterPreviewAttach(hostToken: string): void {
    this.requireRuntime(hostToken);
    if (this.context.active) this.attachTopmost();
  }

  close(hostToken: string, mode: OnlyPreviewGlobalSearchCloseRequest['mode']): boolean {
    const runtime = this.requireRuntime(hostToken);
    if (!this.context.active) {
      this.broadcastVisibility(runtime);
      return false;
    }
    this.setActive(false);
    this.detachView();
    this.resolvePendingReveal(false);
    this.broadcastVisibility(runtime);
    if (mode === 'discard') {
      runtime.clearOpener();
      return false;
    }
    if (mode === 'preview') {
      runtime.clearOpener();
      return runtime.focusPreview();
    }
    if (mode === 'project') {
      runtime.clearOpener();
      if (!runtime.focusProject()) return false;
      runtime.broadcast(ONLY_PREVIEW_FOCUS_PROJECT_EVENT, { hostId: runtime.host.hostId });
      return true;
    }
    if (runtime.restoreOpener()) return true;
    if (runtime.focusProject()) {
      runtime.broadcast(ONLY_PREVIEW_FOCUS_PROJECT_EVENT, { hostId: runtime.host.hostId });
      return true;
    }
    return runtime.focusPreview();
  }

  requestDirectoryReveal(
    hostToken: string,
    request: OnlyPreviewGlobalSearchDirectoryRevealRequest
  ): Promise<boolean> {
    const runtime = this.requireRuntime(hostToken);
    const context = this.requireMatchingWorkspace(request.workspaceId, request.generation);
    if (!context.ready) return Promise.resolve(false);
    this.resolvePendingReveal(false);
    const action: OnlyPreviewGlobalSearchDirectoryRevealAction = {
      hostId: runtime.host.hostId,
      actionId: randomUUID(),
      workspaceId: request.workspaceId,
      generation: request.generation,
      relativePath: request.relativePath
    };
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingReveal?.action.actionId !== action.actionId) return;
        this.resolvePendingReveal(false);
      }, DIRECTORY_REVEAL_TIMEOUT_MS);
      this.pendingReveal = { action, resolve, timer };
      runtime.broadcast(ONLY_PREVIEW_GLOBAL_SEARCH_REVEAL_DIRECTORY_EVENT, action);
    });
  }

  completeDirectoryReveal(
    hostToken: string,
    completion: OnlyPreviewGlobalSearchDirectoryRevealCompletion
  ): void {
    this.requireRuntime(hostToken);
    const pending = this.pendingReveal;
    if (!pending || !sameRevealIdentity(pending.action, completion)) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'Global Search directory reveal completion is stale.'
      );
    }
    const current = this.context.workspace;
    const succeeded =
      completion.succeeded &&
      current?.workspaceId === completion.workspaceId &&
      current.generation === completion.generation;
    this.resolvePendingReveal(succeeded);
  }

  destroy(): void {
    const runtime = this.runtime;
    const view = this.view;
    this.setActive(false);
    if (runtime) this.broadcastVisibility(runtime);
    this.loadGeneration += 1;
    this.resolvePendingReveal(false);
    this.detachView();
    this.view = null;
    closeContentView(view);
    this.runtime = null;
    this.bounds = null;
    this.context = { revision: 0, active: false, workspace: null, layout: null };
  }

  private ensureView(): WebContentsView | null {
    const runtime = this.runtime;
    if (!runtime) return null;
    if (this.view && !this.view.webContents.isDestroyed()) return this.view;
    const view = runtime.createView();
    const generation = ++this.loadGeneration;
    this.view = view;
    view.webContents.once('render-process-gone', () => {
      if (this.view !== view) return;
      this.failOverlay(view, runtime);
    });
    void runtime.loadView(view).catch(() => {
      if (this.view !== view || generation !== this.loadGeneration) return;
      this.failOverlay(view, runtime);
    });
    return view;
  }

  private attachTopmost(): void {
    const runtime = this.runtime;
    const view = this.view;
    const bounds = this.bounds;
    if (
      !this.context.active ||
      !runtime ||
      runtime.window.isDestroyed() ||
      !view ||
      view.webContents.isDestroyed() ||
      !bounds
    ) {
      return;
    }
    view.setBounds({ ...bounds });
    runtime.window.contentView.addChildView(view);
  }

  private detachView(): void {
    const runtime = this.runtime;
    const view = this.view;
    if (!runtime || runtime.window.isDestroyed() || !view) return;
    try {
      runtime.window.contentView.removeChildView(view);
    } catch {
      // Electron may already have detached the child while closing the BaseWindow.
    }
  }

  private failOverlay(view: WebContentsView, runtime: OnlyPreviewGlobalSearchViewRuntime): void {
    if (this.view !== view || this.runtime !== runtime) return;
    const wasActive = this.context.active;
    this.setActive(false);
    this.detachView();
    this.view = null;
    closeContentView(view);
    this.resolvePendingReveal(false);
    this.broadcastVisibility(runtime);
    if (!wasActive) return;
    runtime.clearOpener();
    if (runtime.focusProject()) {
      runtime.broadcast(ONLY_PREVIEW_FOCUS_PROJECT_EVENT, { hostId: runtime.host.hostId });
    } else {
      runtime.focusPreview();
    }
  }

  private requireRuntime(hostToken: string): OnlyPreviewGlobalSearchViewRuntime {
    const runtime = this.runtime;
    if (!runtime || runtime.host.hostToken !== hostToken) {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'Global Search does not belong to the active OnlyPreview host.'
      );
    }
    return runtime;
  }

  private broadcastVisibility(runtime: OnlyPreviewGlobalSearchViewRuntime): void {
    runtime.broadcast(ONLY_PREVIEW_GLOBAL_SEARCH_VISIBILITY_EVENT, {
      hostId: runtime.host.hostId,
      revision: this.context.revision,
      active: this.context.active
    });
  }

  private setActive(active: boolean): void {
    if (this.context.active === active) return;
    this.context = {
      ...this.context,
      revision: this.context.revision + 1,
      active
    };
  }

  private requireMatchingWorkspace(
    workspaceId: string,
    generation: number
  ): NonNullable<OnlyPreviewGlobalSearchContextSnapshot['workspace']> {
    const workspace = this.context.workspace;
    if (
      !workspace ||
      workspace.workspaceId !== workspaceId ||
      workspace.generation !== generation
    ) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'Global Search workspace context is stale.'
      );
    }
    return workspace;
  }

  private resolvePendingReveal(succeeded: boolean): void {
    const pending = this.pendingReveal;
    if (!pending) return;
    this.pendingReveal = null;
    clearTimeout(pending.timer);
    pending.resolve(succeeded);
  }
}

export const onlyPreviewGlobalSearchViewService = new OnlyPreviewGlobalSearchViewService();
