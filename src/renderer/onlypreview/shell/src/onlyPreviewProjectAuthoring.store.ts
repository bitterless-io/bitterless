import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  ONLY_PREVIEW_COPY_PROJECT_ITEM_EVENT,
  ONLY_PREVIEW_PROJECT_DELETE_EVENT,
  ONLY_PREVIEW_PROJECT_NEW_FOLDER_EVENT,
  ONLY_PREVIEW_PROJECT_RENAME_EVENT,
  type OnlyPreviewCopyProjectItemEvent,
  type OnlyPreviewProjectDeleteEvent,
  type OnlyPreviewProjectNewFolderEvent,
  type OnlyPreviewProjectRenameEvent
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import type {
  OnlyPreviewIndex,
  OnlyPreviewProjectEntry
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import {
  resolveOnlyPreviewEditCommit,
  type OnlyPreviewEditState
} from './onlyPreviewProjectAuthoring.service';
import { isOnlyPreviewPathRemoved } from '@shared/onlypreview/onlyPreviewDeleteSelection.shared';
import { getOnlyPreviewParentPath } from './onlyPreviewTree.service';
import { onlyPreviewShellStore } from './onlyPreviewShell.store';

/**
 * The slice of the shell store this controller needs.
 *
 * It is written back through, so the host must be the reactive store proxy and not the raw
 * instance: a write to the raw instance never reaches the proxy, and the tree would keep rendering
 * the old name after a successful rename.
 */
export interface OnlyPreviewProjectAuthoringHost {
  workspace: { workspaceId: string } | null;
  index: { entries: readonly { relativePath: string; name: string }[] } | null;
  expandedPaths: Set<string>;
  selectedRelativePath: string;
  focusedRelativePath: string;
  treeSelectedRelativePath: string | null;
  errorMessage: string;
  refreshIndex(): Promise<void>;
  /**
   * The tree is drawn from this projection, so a delete has to reach it directly. The work is done
   * here rather than behind a store method because the shell store sits on its 800-line budget.
   */
  browseProjection: {
    removeDeletedPaths(
      relativePaths: readonly string[],
      workspaceId: string,
      expandedPaths: Set<string>
    ): { changed: boolean; index: OnlyPreviewIndex | null };
  };
}

/**
 * New Folder and Rename, kept out of the store.
 *
 * Both end in the same place — one tree row with an open editor — so they share the state rather
 * than duplicating it. Failure always closes the editor: Main owns the duplicate-name dialog, and
 * leaving a half-committed editor open after a rejected rename would misrepresent what is on disk.
 */
export class OnlyPreviewProjectAuthoringController {
  editing: OnlyPreviewEditState | null = null;
  busy = false;

  constructor(private readonly host: OnlyPreviewProjectAuthoringHost) {}

  /**
   * A folder Main has already created.
   *
   * The name is now collected by the alert-layer dialog, and nothing is written until that dialog is
   * confirmed, so by the time this runs the folder exists on disk. All that is left is to make its
   * row appear and select it — there is no editor to open and no failure to report here.
   */
  async revealCreatedFolder(relativePath: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const parentRelativePath = getOnlyPreviewParentPath(relativePath);
      if (parentRelativePath) this.host.expandedPaths.add(parentRelativePath);
      await this.settle({ relativePath, name: relativePath.split('/').at(-1) ?? relativePath });
    } finally {
      this.busy = false;
    }
  }

  /**
   * Rows Main has already removed from disk.
   *
   * The tree itself is re-read rather than patched, but the paths still matter: anything pointing
   * *into* a removed folder has to go first, or the refresh renders a frame that still selects or
   * expands a row that no longer exists. The multi-selection prunes itself — it is retained against
   * the visible rows whenever their count changes.
   */
  async settleDeletedEntries(relativePaths: readonly string[]): Promise<void> {
    const removed = relativePaths.filter((relativePath) => relativePath.length > 0);
    if (!removed.length) return;
    const isRemoved = (relativePath: string): boolean =>
      isOnlyPreviewPathRemoved(removed, relativePath);
    for (const expanded of [...this.host.expandedPaths]) {
      if (isRemoved(expanded)) this.host.expandedPaths.delete(expanded);
    }
    if (isRemoved(this.host.selectedRelativePath)) this.host.selectedRelativePath = '';
    if (isRemoved(this.host.focusedRelativePath)) this.host.focusedRelativePath = '';
    const treeSelected = this.host.treeSelectedRelativePath;
    if (treeSelected && isRemoved(treeSelected)) this.host.treeSelectedRelativePath = null;
    // The rows go NOW, from the paths we were handed. `refreshIndex` cannot do this job: it is a
    // full workspace re-index, so a folder kept its row for as long as that rescan took, and every
    // click on it failed against a path that was gone
    // (docs/issues/onlypreview-delete-refreshes-the-wrong-index.md).
    this.dropDeletedRows(removed);
    // Still reconciled afterwards — the search index has to learn about this too, and a refresh
    // repairs the projection if the local removal was somehow wrong.
    await this.host.refreshIndex();
  }

  /**
   * Rows Main has already removed, taken off the tree now.
   *
   * `refreshIndex()` cannot do this: it re-indexes the whole workspace
   * (`search-engine.mjs` `refreshInternal` counts and rebuilds the entire root), and the tree is
   * drawn from the browse projection, which a search refresh never writes. A deleted FOLDER
   * therefore kept its row until the watcher caught up much later, and every click on it failed
   * with PATH_NOT_FOUND — docs/issues/onlypreview-delete-refreshes-the-wrong-index.md.
   */
  private dropDeletedRows(removed: readonly string[]): void {
    const workspaceId = this.host.workspace?.workspaceId;
    if (!workspaceId) return;
    const dropped = this.host.browseProjection.removeDeletedPaths(
      removed,
      workspaceId,
      this.host.expandedPaths
    );
    if (dropped.changed) this.host.index = dropped.index;
  }

  beginRename(relativePath: string): boolean {
    const name = this.host.index?.entries.find(
      (entry) => entry.relativePath === relativePath
    )?.name;
    if (!name) return false;
    this.host.selectedRelativePath = relativePath;
    this.host.focusedRelativePath = relativePath;
    this.begin(relativePath, name);
    return true;
  }

  begin(relativePath: string, name: string): void {
    this.editing = { relativePath, draft: name, originalName: name };
  }

  updateDraft(draft: string): void {
    if (this.editing) this.editing.draft = draft;
  }

  cancel(): void {
    this.editing = null;
  }

  async commit(): Promise<void> {
    const editing = this.editing;
    if (!editing || this.busy) return;
    const decision = resolveOnlyPreviewEditCommit(editing);
    if (decision.kind !== 'rename') {
      this.editing = null;
      // An invalid name never reaches Main — the request parser refuses it before the dialog could
      // be shown — so it is reported inline instead of through a call that cannot surface.
      if (decision.kind === 'invalid') this.host.errorMessage = onlyPreviewI18n.project.nameInvalid;
      return;
    }
    this.busy = true;
    try {
      const renamed = await this.renameItem(editing.relativePath, decision.name);
      this.editing = null;
      await this.settle(renamed);
    } catch {
      // Main already showed the dialog for a duplicate or refused name; the row reverts.
      this.editing = null;
    } finally {
      this.busy = false;
    }
  }

  private async renameItem(relativePath: string, name: string): Promise<OnlyPreviewProjectEntry> {
    const hostToken = onlyPreviewEnv.hostToken;
    const workspaceId = this.host.workspace?.workspaceId;
    if (!hostToken || !workspaceId) throw new Error('OnlyPreview has no active Project item.');
    return unwrapOnlyPreviewResult(
      await onlyPreviewClient.renameProjectItem({ hostToken, workspaceId, relativePath, name })
    );
  }

  private async settle(entry: { relativePath: string; name: string }): Promise<void> {
    await this.host.refreshIndex();
    this.host.selectedRelativePath = entry.relativePath;
    this.host.focusedRelativePath = entry.relativePath;
  }
}

// Built from the proxy, never the raw instance: the controller writes tree selection and the error
// banner back into the shell store, and a write to the raw instance would never reach the view.
export const onlyPreviewProjectAuthoring = reactive(
  new OnlyPreviewProjectAuthoringController(onlyPreviewShellStore)
);

const isCopyIntent = (value: unknown): value is OnlyPreviewCopyProjectItemEvent => {
  const event = value as OnlyPreviewCopyProjectItemEvent | null;
  return (
    !!event &&
    typeof event === 'object' &&
    event.hostId === onlyPreviewEnv.hostId &&
    (event.copyKind === 'absolute-path' || event.copyKind === 'name')
  );
};

const isHostEvent = (value: unknown): value is { hostId: string; workspaceId: string } =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as { hostId?: unknown }).hostId === 'string' &&
  typeof (value as { workspaceId?: unknown }).workspaceId === 'string' &&
  (value as { hostId: string }).hostId === onlyPreviewEnv.hostId;

/**
 * Project intents that originate in Main.
 *
 * The native context menu and the window-wide shortcuts both live in Main, but only the shell knows
 * which row is selected and which row can host an editor, so each of them arrives here as an intent
 * and this module performs the work.
 */
export const subscribeOnlyPreviewProjectIntents = (): void => {
  xpcRenderer.subscribe(ONLY_PREVIEW_PROJECT_NEW_FOLDER_EVENT, ({ params }) => {
    const event = params as OnlyPreviewProjectNewFolderEvent;
    if (!isHostEvent(event) || !event.relativePath) return;
    void onlyPreviewProjectAuthoring.revealCreatedFolder(event.relativePath);
  });
  xpcRenderer.subscribe(ONLY_PREVIEW_PROJECT_RENAME_EVENT, ({ params }) => {
    const event = params as OnlyPreviewProjectRenameEvent;
    if (!isHostEvent(event) || !event.relativePath) return;
    onlyPreviewProjectAuthoring.beginRename(event.relativePath);
  });
  xpcRenderer.subscribe(ONLY_PREVIEW_PROJECT_DELETE_EVENT, ({ params }) => {
    const event = params as OnlyPreviewProjectDeleteEvent;
    if (!isHostEvent(event) || !Array.isArray(event.relativePaths)) return;
    void onlyPreviewProjectAuthoring.settleDeletedEntries(event.relativePaths);
  });
  xpcRenderer.subscribe(ONLY_PREVIEW_COPY_PROJECT_ITEM_EVENT, ({ params }) => {
    const event = params as OnlyPreviewCopyProjectItemEvent;
    if (!isCopyIntent(event)) return;
    // The tree selection is what the shortcut has always acted on; the root row is the empty path.
    void onlyPreviewShellStore.copyProjectItem(
      onlyPreviewShellStore.treeSelectedRelativePath ?? onlyPreviewShellStore.selectedRelativePath,
      event.copyKind
    );
  });
};
