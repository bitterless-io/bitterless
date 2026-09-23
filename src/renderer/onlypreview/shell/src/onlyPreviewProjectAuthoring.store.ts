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
import { describeOnlyPreviewError } from './onlyPreviewErrorDetail.store';
import {
  resolveOnlyPreviewEditCommit,
  type OnlyPreviewEditState
} from './onlyPreviewProjectAuthoring.service';
import { isOnlyPreviewPathRemoved } from '@shared/onlypreview/onlyPreviewDeleteSelection.shared';
import { getOnlyPreviewParentPath } from './onlyPreviewTree.service';
import { onlyPreviewShellStore } from './onlyPreviewShell.store';
import { copyOnlyPreviewTreeSelection } from './onlyPreviewTreeSelection.store';
import type { OnlyPreviewBrowseProjectionResult } from './onlyPreviewBrowseProjection.service';

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
  collapseTreeSelection(): void;
  errorMessage: string;
  refreshIndex(): Promise<void>;
  /**
   * The tree is drawn from this projection, so a delete has to reach it directly. The work is done
   * here rather than behind a store method because the shell store sits on its 800-line budget.
   */
  browseProjection: {
    reloadParentListings(
      relativePaths: readonly string[],
      workspaceId: string,
      expandedPaths: Set<string>
    ): Promise<OnlyPreviewBrowseProjectionResult>;
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
  private revealRevision = 0;

  constructor(private readonly host: OnlyPreviewProjectAuthoringHost) {}

  /**
   * A folder Main has already created.
   *
   * The name is now collected by the alert-layer dialog, and nothing is written until that dialog is
   * confirmed, so by the time this runs the folder exists on disk. All that is left is to make its
   * row appear and select it — there is no editor to open and no failure to report here.
   */
  async revealCreatedFolder(relativePath: string, workspaceId: string): Promise<void> {
    await this.revealCreatedEntries([
      { relativePath, name: relativePath.split('/').at(-1) ?? relativePath, nodeKind: 'directory' }
    ], workspaceId);
  }

  /**
   * Paste's reveal. Same row-finding as `revealCreatedEntries`, minus the preview.
   *
   * Owner, 2026-09-18: 「不用打开预览哦」. `selectedRelativePath` *is* the previewed file, so the
   * difference between the two methods is exactly that one assignment — New Folder wants the new
   * folder opened, paste wants the pasted file found. Returns the paths that actually landed in the
   * index so the caller can scroll to and flash them; a path that is not there has no row to act on.
   */
  async revealPastedEntries(
    entries: OnlyPreviewProjectEntry[],
    workspaceId: string
  ): Promise<string[]> {
    return await this.revealEntries(entries, workspaceId, { preview: false });
  }

  async revealCreatedEntries(entries: OnlyPreviewProjectEntry[], workspaceId: string): Promise<void> {
    await this.revealEntries(entries, workspaceId, { preview: true });
  }

  private async revealEntries(
    entries: OnlyPreviewProjectEntry[],
    workspaceId: string,
    options: { preview: boolean }
  ): Promise<string[]> {
    const workspace = this.host.workspace;
    if (!workspace || workspace.workspaceId !== workspaceId || !entries.length) return [];
    const revision = ++this.revealRevision;
    const isCurrent = (): boolean => this.host.workspace === workspace;
    try {
      const result = await this.host.browseProjection.reloadParentListings(
        entries.map((entry) => entry.relativePath), workspaceId, this.host.expandedPaths
      );
      if (!isCurrent()) return [];
      if (result.changed) this.host.index = result.index;
      if (result.error) throw result.error;
      if (!result.loaded || revision !== this.revealRevision) return [];
      for (const entry of entries) {
        let parent = getOnlyPreviewParentPath(entry.relativePath);
        while (parent) {
          this.host.expandedPaths.add(parent);
          parent = getOnlyPreviewParentPath(parent);
        }
      }
      const landed = entries
        .map(({ relativePath }) => relativePath)
        .filter((relativePath) =>
          this.host.index?.entries.some((item) => item.relativePath === relativePath)
        );
      const entry = landed[0];
      if (entry === undefined) return [];
      this.host.collapseTreeSelection();
      this.host.treeSelectedRelativePath = entry;
      // The previewed file. Paste leaves it alone.
      if (options.preview) this.host.selectedRelativePath = entry;
      this.host.focusedRelativePath = entry;
      return landed;
    } catch (error) {
      if (isCurrent() && revision === this.revealRevision) {
        this.host.errorMessage = describeOnlyPreviewError(error);
      }
      return [];
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
    // 校正一次,但**不再 `refreshIndex()`** —— 那是 `xpc:search.refresh` → 引擎 `refresh()`,
    // 也就是整个工作区重新计数 + 重建索引(真机一轮 10–13 秒)。删除时索引已经由
    // `finishDeleteTask` 精确清过(连子孙),所以这里只要把受影响的父目录重新列一次,
    // 用权威的列表校正刚才那次就地摘除即可。
    // 见 areas/agent-runtime/preview/menu-processes.html #5 与 deleting-process.html。
    await this.reloadAffectedParents(removed);
  }

  /**
   * 把受影响的父目录重新列一次 —— 树画的是 browse projection,这就是它的权威来源。
   *
   * 失败**不抛**:调用方都是"事情已经做完了"的收尾路径(删除已落盘、改名已落盘),
   * 一次列目录失败不该把一次成功的操作报成失败;下一次 watcher 的浏览刷新会补上。
   */
  private async reloadAffectedParents(relativePaths: readonly string[]): Promise<void> {
    const workspaceId = this.host.workspace?.workspaceId;
    if (!workspaceId || !relativePaths.length) return;
    try {
      const result = await this.host.browseProjection.reloadParentListings(
        relativePaths,
        workspaceId,
        this.host.expandedPaths
      );
      if (result.changed) this.host.index = result.index;
    } catch {
      // 见上:收尾路径不因列目录失败而失败。
    }
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
      await this.settle(renamed, editing.relativePath);
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

  /**
   * 改名之后的收尾。
   *
   * 原来这里调的是 `refreshIndex()` —— 那是**整个工作区重新计数 + 重建索引**,真机一轮 10–13 秒,
   * 于是"保存一个名字"看起来就是卡住了(Ral 2026-09-22:「保存文件名时也会卡住被阻塞」)。
   * 树画的是 browse projection,重建搜索索引对它没有任何帮助 —— 删除那条路径早就记过这一课
   * (docs/issues/onlypreview-delete-refreshes-the-wrong-index.md),改名这一支没跟上。
   *
   * 现在只重新列一次受影响的父目录(新旧两个路径同父,`reloadParentListings` 自己去重),
   * 搜索索引交给 watcher 的增量 —— 它本来就会收到这两条 rename 事件。
   */
  private async settle(
    entry: { relativePath: string; name: string },
    previousRelativePath: string
  ): Promise<void> {
    await this.reloadAffectedParents([previousRelativePath, entry.relativePath]);
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
  (value as { hostId: string }).hostId === onlyPreviewEnv.hostId &&
  (value as { workspaceId: string }).workspaceId === onlyPreviewShellStore.workspace?.workspaceId;

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
    void onlyPreviewProjectAuthoring.revealCreatedFolder(event.relativePath, event.workspaceId);
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
    void copyOnlyPreviewTreeSelection(event.copyKind);
  });
};
