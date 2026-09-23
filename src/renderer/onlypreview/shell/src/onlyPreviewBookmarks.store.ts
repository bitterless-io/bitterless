import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  ONLY_PREVIEW_BOOKMARK_ADD_EVENT,
  ONLY_PREVIEW_BOOKMARKS_CHANGED_EVENT
} from '@shared/onlypreview/onlyPreviewBookmarks.type';
import { ONLY_PREVIEW_PROJECT_DELETE_EVENT } from '@shared/onlypreview/onlyPreview.types';
import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewBookmark, OnlyPreviewBookmarksSnapshot } from '@shared/onlypreview/onlyPreviewBookmarks.type';
import type {
  OnlyPreviewBookmarksClient,
  OnlyPreviewBookmarksHost,
  OnlyPreviewBookmarksPersistence
} from './onlyPreviewBookmarks.type';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { describeOnlyPreviewError } from './onlyPreviewErrorDetail.store';
import { onlyPreviewShellStore } from './onlyPreviewShell.store';
import { onlyPreviewBookmarksPersistence } from './onlyPreviewBookmarksPersistence.service';

export class OnlyPreviewBookmarksStore {
  expanded: boolean;
  reordering = false;
  private reorderGeneration = 0;
  entries: OnlyPreviewBookmark[] = [];
  errorMessage = '';
  private generation = 0;
  private actionGeneration = 0;
  private workspaceGeneration = 0;
  private revision = -1;
  private active = false;
  private subscribed = false;
  constructor(
    private readonly client: OnlyPreviewBookmarksClient,
    private readonly host: OnlyPreviewBookmarksHost,
    private readonly persistence: OnlyPreviewBookmarksPersistence = onlyPreviewBookmarksPersistence
  ) {
    this.expanded = persistence.restore();
  }

  toggleExpanded(): void {
    this.expanded = !this.expanded;
    this.persistence.save(this.expanded);
  }

  initialize(): void {
    this.active = true;
    if (!this.subscribed) {
      this.subscribed = true;
      xpcRenderer.subscribe(ONLY_PREVIEW_BOOKMARK_ADD_EVENT, ({ params }) =>
        this.receive(params, true)
      );
      xpcRenderer.subscribe(ONLY_PREVIEW_BOOKMARKS_CHANGED_EVENT, ({ params }) =>
        this.receive(params)
      );
      // 删掉的文件/目录,书签要跟着走(Ral 2026-09-20)。
      //
      // **复用删除那条已有的广播,不新增任何事件。** `announceDeletedEntries` 本来就是一次批量
      // 广播(一条消息带 `relativePaths[]`,删 1000 行也只有一条),再加一条书签专用事件等于把
      // 同一件事的消息量翻倍。
      xpcRenderer.subscribe(ONLY_PREVIEW_PROJECT_DELETE_EVENT, ({ params }) =>
        void this.pruneDeleted(params)
      );
    }
    this.resetWorkspace();
  }
  dispose(): void {
    this.active = false;
    this.reorderGeneration += 1;
    this.reordering = false;
    this.generation += 1;
    this.actionGeneration += 1;
  }
  resetWorkspace(): void {
    this.reorderGeneration += 1;
    this.reordering = false;
    this.entries = [];
    this.errorMessage = '';
    this.generation += 1;
    this.actionGeneration += 1;
    this.workspaceGeneration += 1;
    this.revision = -1;
    void this.refresh();
  }
  async refresh(): Promise<void> {
    const { hostToken } = this.host;
    const workspaceId = this.host.workspaceId();
    const generation = ++this.generation;
    const revision = this.revision;
    if (!this.active || !hostToken || !workspaceId) return;
    try {
      const snapshot = unwrapOnlyPreviewResult(
        await this.client.getBookmarks({ hostToken, workspaceId })
      );
      if (!this.active || generation !== this.generation || workspaceId !== this.host.workspaceId())
        return;
      if (snapshot.workspaceId !== workspaceId) return;
      this.apply(snapshot);
      this.errorMessage = '';
    } catch (error) {
      if (
        this.active &&
        generation === this.generation && revision === this.revision &&
        workspaceId === this.host.workspaceId()
      ) {
        this.errorMessage = describeOnlyPreviewError(error);
      }
    }
  }
  async reorder(relativePaths: string[]): Promise<void> {
    const { hostToken } = this.host;
    const workspaceId = this.host.workspaceId();
    if (!this.active || this.reordering || !hostToken || !workspaceId) return;
    const previous = this.entries;
    const byPath = new Map(previous.map((entry) => [entry.relativePath, entry]));
    if (relativePaths.length !== previous.length || new Set(relativePaths).size !== previous.length ||
      relativePaths.some((path) => !byPath.has(path))) return;
    if (relativePaths.every((path, index) => path === previous[index].relativePath)) return;
    const generation = ++this.reorderGeneration;
    const revision = this.revision;
    const isCurrent = (): boolean => this.active && generation === this.reorderGeneration &&
      workspaceId === this.host.workspaceId();
    this.entries = relativePaths.map((path) => byPath.get(path)!);
    this.reordering = true;
    this.errorMessage = '';
    try {
      const snapshot = unwrapOnlyPreviewResult(
        await this.client.reorderBookmarks({ hostToken, workspaceId, relativePaths })
      );
      if (isCurrent()) this.apply(snapshot);
    } catch (error) {
      if (isCurrent()) {
        if (this.revision === revision) this.entries = previous;
        await this.refresh();
        if (isCurrent()) this.errorMessage = describeOnlyPreviewError(error);
      }
    } finally {
      if (isCurrent()) this.reordering = false;
    }
  }

  async add(relativePath: string): Promise<void> {
    if (relativePath) await this.runAction('addBookmark', relativePath);
  }
  async remove(relativePath: string): Promise<void> {
    if (relativePath) await this.runAction('removeBookmark', relativePath);
  }
  /**
   * 删除落地之后,把指向已删路径的书签一并去掉。
   *
   * **先本地算命中,再只为命中的发调用。** 代价因此与"删了多少文件"无关,只与"有多少书签真的
   * 指向被删路径"有关 —— 删一整棵没被收藏的树时,这里一次 IPC 都不发;最坏情况也只受书签总数
   * 约束(几个到几十个),不会被删除规模放大。
   *
   * 目录要连**子孙**一起剪:以 `path + '/'` 为前缀判断,而不是子串 —— 否则删 `a/b` 会把
   * `a/bc` 的书签也带走。被删路径自身用等值判断。
   *
   * 只在事件属于当前工作区时动手(与 `refresh()` 同一条围栏):删除事件来自 Main 广播,而广播
   * 没有重放,换了 Project 之后迟到的那一条不该剪掉新工作区的书签。
   */
  private async pruneDeleted(params: unknown): Promise<void> {
    if (!this.active || !params || typeof params !== 'object') return;
    const event = params as { workspaceId?: unknown; relativePaths?: unknown };
    const workspaceId = this.host.workspaceId();
    if (!workspaceId || event.workspaceId !== workspaceId) return;
    if (!Array.isArray(event.relativePaths)) return;
    const removed = event.relativePaths.filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    );
    if (!removed.length) return;
    const matched = this.entries
      .filter((entry) =>
        removed.some(
          (path) => entry.relativePath === path || entry.relativePath.startsWith(`${path}/`)
        )
      )
      .map((entry) => entry.relativePath);
    for (const relativePath of matched) {
      if (!this.active || workspaceId !== this.host.workspaceId()) return;
      await this.remove(relativePath);
    }
  }

  async showMenu(relativePath: string): Promise<void> {
    if (this.entries.some((entry) => entry.relativePath === relativePath)) {
      await this.runAction('showBookmarkContextMenu', relativePath);
    }
  }
  receive(event: unknown, add = false): void {
    if (!this.active || !event || typeof event !== 'object') return;
    const params = event as OnlyPreviewBookmarksSnapshot & { hostId?: unknown; relativePath?: unknown };
    if (params.hostId !== this.host.hostId || params.workspaceId !== this.host.workspaceId())
      return;
    if (add) {
      if (typeof params.relativePath === 'string') void this.add(params.relativePath);
    } else {
      this.apply(params);
    }
  }
  private apply(snapshot: OnlyPreviewBookmarksSnapshot): void {
    if (snapshot.workspaceId !== this.host.workspaceId() || !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision <= this.revision || !Array.isArray(snapshot.entries)) return;
    this.entries = snapshot.entries;
    this.revision = snapshot.revision;
    this.errorMessage = '';
  }
  private async runAction(
    action: 'addBookmark' | 'removeBookmark' | 'showBookmarkContextMenu',
    relativePath: string
  ): Promise<void> {
    const { hostToken } = this.host;
    const workspaceId = this.host.workspaceId();
    if (!this.active || !hostToken || !workspaceId) return;
    const generation = ++this.actionGeneration;
    const workspaceGeneration = this.workspaceGeneration;
    this.errorMessage = '';
    try {
      const snapshot = unwrapOnlyPreviewResult(await this.client[action]({ hostToken, workspaceId, relativePath }));
      if (
        this.active &&
        workspaceGeneration === this.workspaceGeneration &&
        workspaceId === this.host.workspaceId()
      ) {
        if (snapshot) this.apply(snapshot);
      }
    } catch (error) {
      if (
        this.active &&
        generation === this.actionGeneration &&
        workspaceId === this.host.workspaceId()
      ) {
        this.errorMessage = describeOnlyPreviewError(error);
      }
    }
  }
}
export const onlyPreviewBookmarksStore = reactive(
  new OnlyPreviewBookmarksStore(onlyPreviewClient, {
    hostToken: onlyPreviewEnv.hostToken,
    hostId: onlyPreviewEnv.hostId,
    workspaceId: () => onlyPreviewShellStore.workspace?.workspaceId ?? null
  })
);
