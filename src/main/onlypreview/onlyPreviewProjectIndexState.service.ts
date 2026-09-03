import { xpcMain } from 'electron-xpc/main';
import {
  ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT,
  type OnlyPreviewProjectIndexState,
  type OnlyPreviewProjectRootRequest
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewHostRegistry } from './onlyPreviewHost.registry';
import { onlyPreviewWorkspaceRegistry } from './onlyPreviewWorkspace.registry';

/**
 * Whether the Project index is still being built, as Main sees it.
 *
 * Main is the only process that can answer this without guessing. The shell knows its own index
 * calls, but the preview surface is a different renderer; inferring the state there from a progress
 * event that has not arrived yet is what would flash "Select a file" before flipping to "Loading
 * project". Main instead marks a workspace `building` the moment it is bound — by definition before
 * its index exists — and then only ever reports what actually happened to it.
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
export class OnlyPreviewProjectIndexStateService {
  private current: {
    hostId: string;
    workspaceId: string;
    state: OnlyPreviewProjectIndexState;
  } | null = null;

  markBound(hostId: string, workspaceId: string): void {
    this.publish({ hostId, workspaceId, state: 'building' });
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
    this.publish({ hostId, workspaceId, state });
  }

  /** The index build is renderer-driven, so its failure is the renderer's to report. */
  markFailed(hostId: string, workspaceId: string): void {
    const current = this.current;
    if (current?.workspaceId !== workspaceId || current.hostId !== hostId) return;
    if (current.state === 'ready' || current.state === 'failed') return;
    this.publish({ hostId, workspaceId, state: 'failed' });
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
    this.current = null;
  }

  private publish(next: {
    hostId: string;
    workspaceId: string;
    state: OnlyPreviewProjectIndexState;
  }): void {
    this.current = next;
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
