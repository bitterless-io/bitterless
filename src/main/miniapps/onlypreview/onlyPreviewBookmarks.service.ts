import { OnlyPreviewContractError, parseOnlyPreviewFileRef, parseOnlyPreviewBookmarksReorderRequest } from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewBookmarkRequest, OnlyPreviewBookmarksReorderRequest, OnlyPreviewBookmarksRequest, OnlyPreviewBookmarksSnapshot } from '@shared/onlypreview/onlyPreviewBookmarks.type';
import type { OnlyPreviewBookmarkStorage, OnlyPreviewBookmarkStorageRequest } from '@shared/onlypreview/onlyPreviewBookmarkStorage.type';
import type { OnlyPreviewWorkspaceRegistry, OnlyPreviewProjectAuthorityRef } from './onlyPreviewWorkspace.registry';

type Scope = Omit<ReturnType<OnlyPreviewWorkspaceRegistry['getProjectAuthorityRootRef']>, 'relativePath'>;

export class OnlyPreviewBookmarksService {
  private storage: OnlyPreviewBookmarkStorage | null = null;
  private settleReady!: (ready: boolean) => void;
  private readonly ready = new Promise<boolean>((resolve) => { this.settleReady = resolve; });
  private operations: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly workspaces: OnlyPreviewWorkspaceRegistry,
    private readonly authorize: (authority: OnlyPreviewProjectAuthorityRef) => Promise<{ nodeKind: string }>,
    private readonly changed: (hostId: string, snapshot: OnlyPreviewBookmarksSnapshot) => void = () => undefined
  ) {}

  configureStorage(storage: OnlyPreviewBookmarkStorage): void { this.storage ??= storage; }
  markStorageReady(): void { this.settleReady(true); }
  markStorageFailed(): void { this.settleReady(false); }

  private scope(request: OnlyPreviewBookmarksRequest): Scope {
    return this.workspaces.getProjectAuthorityRootRef(request?.hostToken, request?.workspaceId);
  }
  private requireCurrent(scope: Scope): void {
    const current = this.scope({ hostToken: scope.host.hostToken, workspaceId: scope.workspaceId });
    if (current.workspaceGeneration !== scope.workspaceGeneration) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Bookmark Project changed.');
    }
  }

  async snapshot(request: OnlyPreviewBookmarksRequest): Promise<OnlyPreviewBookmarksSnapshot> {
    const scope = this.scope(request);
    return this.run(scope, () => ({ rootRealPath: scope.workspace.rootRealPath, action: 'snapshot' }));
  }

  async add(request: OnlyPreviewBookmarkRequest): Promise<OnlyPreviewBookmarksSnapshot> {
    const authority = this.workspaces.getProjectAuthorityItemRef(request?.hostToken, request);
    return this.run(authority, async () => {
      const item = await this.authorize(authority);
      if (item.nodeKind !== 'file' && item.nodeKind !== 'directory') {
        throw new OnlyPreviewContractError('INVALID_INPUT', 'Only files and folders can be bookmarked.');
      }
      return { rootRealPath: authority.workspace.rootRealPath, action: 'add',
        entry: { relativePath: authority.relativePath, nodeKind: item.nodeKind } };
    });
  }

  async remove(request: OnlyPreviewBookmarkRequest): Promise<OnlyPreviewBookmarksSnapshot> {
    const scope = this.scope(request);
    const { relativePath } = parseOnlyPreviewFileRef(request);
    // Removal intentionally does not inspect a target that may no longer exist.
    return this.run(scope, () => ({ rootRealPath: scope.workspace.rootRealPath, action: 'remove', relativePath }));
  }

  async reorder(request: OnlyPreviewBookmarksReorderRequest): Promise<OnlyPreviewBookmarksSnapshot> {
    const parsed = parseOnlyPreviewBookmarksReorderRequest(request);
    const scope = this.scope(parsed);
    return this.run(scope, () => ({ rootRealPath: scope.workspace.rootRealPath,
      action: 'reorder', relativePaths: parsed.relativePaths }));
  }

  private run(
    scope: Scope,
    operation: () => OnlyPreviewBookmarkStorageRequest | Promise<OnlyPreviewBookmarkStorageRequest>
  ): Promise<OnlyPreviewBookmarksSnapshot> {
    const task = this.operations.then(async () => {
      if (!(await this.ready) || !this.storage) throw new OnlyPreviewContractError('OPERATION_FAILED', 'Bookmarks storage is unavailable.');
      this.requireCurrent(scope);
      const request = await operation();
      this.requireCurrent(scope);
      const state = await this.storage.execute(request);
      this.requireCurrent(scope);
      const snapshot = { workspaceId: scope.workspaceId, revision: state.revision,
        entries: state.entries.map((entry) => ({ ...entry, name: entry.relativePath.split('/').at(-1)! })) };
      if (request.action !== 'snapshot' && (request.action !== 'reorder' || state.changed)) {
        this.changed(scope.host.hostId, snapshot);
      }
      return snapshot;
    });
    this.operations = task.catch(() => undefined);
    return task;
  }
}
