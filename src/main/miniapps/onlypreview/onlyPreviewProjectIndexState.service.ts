import { xpcMain } from 'electron-xpc/main';
import {
  ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT,
  type OnlyPreviewProjectBrowseState,
  type OnlyPreviewProjectIndexState,
  type OnlyPreviewProjectRootRequest
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewHostRegistry } from './onlyPreviewHost.registry';
import { onlyPreviewWorkspaceRegistry } from './onlyPreviewWorkspace.registry';

/**
 * Independent Project root-listing readiness and index state, as Main sees them.
 *
 * Main is the only process that can answer this without guessing. The shell knows its own index
 * calls, but the preview surface is a different renderer; inferring the state there from a progress
 * event that has not arrived yet would flash the wrong placeholder. A bind starts the listing at
 * `pending` and the index at `building`. Only a validated root listing ends the listing wait; search
 * snapshots never impersonate listing readiness. The Project rail keeps its own index progress.
 *
 * The value is delivered by re-publishing the preview presentation rather than by an event of its
 * own. A broadcast is fire-and-forget with no replay, and the Vue preview view is created lazily:
 * an event sent at bind time is simply missed by a renderer that has not subscribed yet, which
 * would leave the pane on "Select a file" for the entire build — the exact case this exists for.
 * The presentation is pulled, so a late renderer still sees it.
 *
 * One workspace at a time: the standalone window holds exactly one Project, and a report for any
 * other workspace is a stale generation that must not overwrite the current one.
 */
export type OnlyPreviewProjectIndexTrace = (
  event: string,
  fields: Record<string, unknown>
) => void;

export class OnlyPreviewProjectIndexStateService {
  private current: {
    hostId: string;
    workspaceId: string;
    state: OnlyPreviewProjectIndexState;
    browseState: OnlyPreviewProjectBrowseState;
  } | null = null;
  // Injected rather than imported so this service stays free of the Electron log runtime and can be
  // bundled for pure-Node tests. A missed wiring degrades to today's silence, never to a crash.
  private trace: OnlyPreviewProjectIndexTrace = () => {};

  /**
   * Record every transition.
   *
   * `ready` latches, so a Project whose index never reports it keeps answering `building` for the
   * whole session — and until 2026-09-04 that was invisible in every record we keep, because the
   * pane only surfaces the state when nothing else is selected. Diagnosing it meant re-reading the
   * source instead of reading the log
   * ([`onlypreview-preview-stuck-loading-after-delete`](../../../docs/issues/onlypreview-preview-stuck-loading-after-delete.md)).
   */
  setTrace(trace: OnlyPreviewProjectIndexTrace): void {
    this.trace = trace;
  }

  markBound(hostId: string, workspaceId: string): void {
    this.publish({ hostId, workspaceId, state: 'building', browseState: 'pending' });
  }

  /** Called only for a validated, current-generation root listing, including an empty root. */
  markBrowseReady(hostId: string, workspaceId: string): void {
    const current = this.current;
    if (current?.workspaceId !== workspaceId || current.hostId !== hostId) return;
    if (current.browseState === 'ready') return;
    this.publish({ ...current, browseState: 'ready' });
  }

  /**
   * Record an observed search-engine state.
   *
   * Ready latches. The engine re-enters `building`/`reconciling` on every watch-driven refresh, so
   * forwarding raw state would re-show "Loading project" on an ordinary file save once the Project
   * was already usable. Only a fresh bind starts a new build as far as this pane is concerned.
   */
  markObserved(hostId: string, workspaceId: string, state: OnlyPreviewProjectIndexState): void {
    const current = this.current;
    if (current?.workspaceId !== workspaceId || current.hostId !== hostId) return;
    if (current.state === 'ready' && state !== 'ready') return;
    if (current.state === state) return;
    this.publish({ ...current, state });
  }

  /** The index build is renderer-driven, so its failure is the renderer's to report. */
  markFailed(hostId: string, workspaceId: string): void {
    const current = this.current;
    if (current?.workspaceId !== workspaceId || current.hostId !== hostId) return;
    const browseState = current.browseState === 'pending' ? 'failed' : current.browseState;
    const state = current.state === 'ready' ? 'ready' : 'failed';
    if (current.state === state && current.browseState === browseState) return;
    this.publish({ ...current, state, browseState });
  }

  /**
   * 运行时没了 —— 替它落一个终止态。
   *
   * 这个服务只在**收到事件**时改状态,而进度/快照事件是隐藏的 file-search renderer 发的。
   * 2026-09-20 那次它被内存压力打死(`freeMem=241MB(1%)`)之后,事件源直接消失,于是索引进度条
   * 永远停在原地 —— 不是"还在跑",是"再也不会有人来说它结束了"。重建失败之后由 helper 调这里。
   *
   * 不收 `workspaceId`:当前绑定的那一个就是唯一会受影响的,而调用方(窗口 helper)手上只有
   * `hostId`;让它去猜工作区只会引入一个可能对不上的参数。
   */
  markRuntimeGone(hostId: string): void {
    const current = this.current;
    if (current?.hostId !== hostId) return;
    this.markFailed(hostId, current.workspaceId);
  }

  getBrowseState(workspaceId: string | null): OnlyPreviewProjectBrowseState | null {
    if (!workspaceId || this.current?.workspaceId !== workspaceId) return null;
    return this.current.browseState;
  }

  get(workspaceId: string | null): OnlyPreviewProjectIndexState | null {
    if (!workspaceId || this.current?.workspaceId !== workspaceId) return null;
    return this.current.state;
  }

  /**
   * A bind that was abandoned after succeeding — a superseded generation, a non-canonical directory,
   * a revoked host — leaves no Project current. Without this the abandoned `building` would outlive
   * it and the pane would animate over an empty tree.
   */
  clear(workspaceId?: string): void {
    if (workspaceId && this.current?.workspaceId !== workspaceId) return;
    const previous = this.current;
    this.current = null;
    if (previous) {
      this.trace('project-index', {
        workspaceId: previous.workspaceId,
        from: previous.state,
        to: 'cleared'
      });
    }
  }

  private publish(next: {
    hostId: string;
    workspaceId: string;
    state: OnlyPreviewProjectIndexState;
    browseState: OnlyPreviewProjectBrowseState;
  }): void {
    const previous = this.current;
    this.current = next;
    if (previous?.workspaceId !== next.workspaceId || previous.state !== next.state) {
      this.trace('project-index', {
        workspaceId: next.workspaceId,
        from: previous?.workspaceId === next.workspaceId ? previous.state : 'none',
        to: next.state
      });
    }
    if (previous?.workspaceId === next.workspaceId && previous.browseState !== next.browseState) {
      this.trace('project-browse', {
        workspaceId: next.workspaceId,
        from: previous.browseState,
        to: next.browseState
      });
    }
    xpcMain.broadcast(ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT, { hostId: next.hostId });
  }
}

export const onlyPreviewProjectIndexStateService = new OnlyPreviewProjectIndexStateService();

/**
 * A bind can succeed and then be abandoned — a superseded generation, a non-canonical directory, a
 * revoked host — without the presentation ever naming that workspace, so the presentation-scoped
 * teardown never runs. Without this, that abandoned `building` outlives its Project and the preview
 * pane animates over an empty tree.
 */
onlyPreviewWorkspaceRegistry.onRevoke((workspace) => {
  onlyPreviewProjectIndexStateService.clear(workspace.workspaceId);
});

/**
 * A freshly bound Project has no index yet by definition, so the state is known at bind time without
 * waiting for a first progress event to arrive.
 */
export const markOnlyPreviewProjectBound = (hostToken: string, workspaceId: string): void => {
  const host = onlyPreviewHostRegistry.require(hostToken, ['content']);
  onlyPreviewProjectIndexStateService.markBound(host.hostId, workspaceId);
};

/**
 * Report a Project index build that failed before producing an index.
 *
 * Authority-checked here rather than trusted: the request comes from a renderer, so it may only
 * mark a Project the caller actually holds. The service then additionally ignores any workspace
 * that is not the current one.
 */
export const reportOnlyPreviewProjectIndexFailure = (request: OnlyPreviewProjectRootRequest): void => {
  const host = onlyPreviewHostRegistry.require(request.hostToken, ['content']);
  onlyPreviewWorkspaceRegistry.getProjectAuthorityRootRef(request.hostToken, request.workspaceId);
  onlyPreviewProjectIndexStateService.markFailed(host.hostId, request.workspaceId);
};
