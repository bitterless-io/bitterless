import { reactive } from 'vue';
import type { OnlyPreviewDeleteEntry } from '@shared/onlypreview/onlyPreviewDeleteSelection.shared';
import {
  resolveOnlyPreviewSelection,
  retainOnlyPreviewSelection,
  type OnlyPreviewSelectionIntent
} from './onlyPreviewTreeSelection.service';
import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { getOnlyPreviewErrorMessage } from '../../common/onlyPreviewI18n';
import { onlyPreviewShellStore } from './onlyPreviewShell.store';

export interface OnlyPreviewTreeSelectionHost {
  visibleRows: readonly { entry: { relativePath: string; nodeKind: string } }[];
  treeSelectedRelativePath: string | null;
  selectedRelativePath: string;
}

/**
 * The Project tree's selection, beside the shell store rather than inside it.
 *
 * The shell store is at its 800-line budget, and this is a self-contained concern: the store keeps
 * owning the anchor (`treeSelectedRelativePath`, which is what the preview follows), and this owns
 * the set of rows an action applies to.
 */
export class OnlyPreviewTreeSelectionController {
  paths: string[] = [];
  /**
   * The row a Shift range runs from.
   *
   * Its own field, not the tree's `treeSelectedRelativePath`: a Cmd click moves the anchor without
   * moving the tree highlight or the preview, and `treeSelectedRelativePath` also decides where New
   * Folder lands. Conflating them would move the create destination on every Cmd click.
   */
  anchorPath: string | null = null;

  // A getter, not the store itself: the shell store imports this module for `withTreeSelection`, so
  // reading `onlyPreviewShellStore` at construction time would hit its temporal dead zone whenever
  // the shell store happens to be the module that evaluates first.
  constructor(private readonly resolveHost: () => OnlyPreviewTreeSelectionHost) {}

  private get host(): OnlyPreviewTreeSelectionHost {
    return this.resolveHost();
  }

  private get rows(): string[] {
    return this.host.visibleRows.map((row) => row.entry.relativePath);
  }

  // With nothing clicked yet, a range starts from whatever the tree already highlights, which is the
  // row the owner is looking at.
  private get anchor(): string | null {
    return this.anchorPath ?? this.host.treeSelectedRelativePath;
  }

  isSelected(relativePath: string): boolean {
    if (this.paths.includes(relativePath)) return true;
    // With no explicit multi-selection, the anchor alone is the selection, so the tree keeps looking
    // exactly as it did before multi-select existed.
    return this.paths.length === 0 && this.anchor === relativePath;
  }

  isAnchor(relativePath: string): boolean {
    return this.anchor === relativePath;
  }

  // The row whose document the preview is showing. With several rows selected this is the only way
  // to tell which one the content came from.
  isPreviewed(relativePath: string): boolean {
    return !!relativePath && this.host.selectedRelativePath === relativePath;
  }

  get count(): number {
    return this.paths.length || (this.anchor === null ? 0 : 1);
  }

  /**
   * Apply one selection gesture.
   *
   * Returns whether the preview should follow, so the caller keeps owning activation — a
   * multi-select gesture must not load a document.
   */
  apply(intent: OnlyPreviewSelectionIntent, relativePath: string | null): boolean {
    const current = this.paths.length ? this.paths : this.anchor === null ? [] : [this.anchor];
    const result = resolveOnlyPreviewSelection(
      intent,
      { paths: current, anchor: this.anchor },
      relativePath,
      this.rows
    );
    this.paths = result.previews ? [] : result.paths;
    this.anchorPath = result.anchor;
    return result.previews;
  }

  clear(): void {
    this.paths = [];
    this.anchorPath = null;
  }

  // Called after the tree's rows change, so an action can never target a row that is gone.
  retain(): void {
    if (!this.paths.length) return;
    const next = retainOnlyPreviewSelection({ paths: this.paths, anchor: this.anchor }, this.rows);
    if (next.paths.length !== this.paths.length) this.paths = [...next.paths];
  }

  /**
   * The selection as Main needs it, for the row the context menu was opened on.
   *
   * A right-click outside the selection collapses to that row — resolved in Main, which re-validates
   * every entry anyway; this only reports what the tree currently holds.
   */
  entries(): OnlyPreviewDeleteEntry[] {
    const kinds = new Map<string, string>();
    for (const row of this.host.visibleRows) kinds.set(row.entry.relativePath, row.entry.nodeKind);
    const paths = this.paths.length
      ? this.paths
      : this.anchor === null || this.anchor === ''
        ? []
        : [this.anchor];
    const entries: OnlyPreviewDeleteEntry[] = [];
    for (const relativePath of paths) {
      const nodeKind = kinds.get(relativePath);
      // A symlink is never a delete target, and a row that is no longer listed has no kind.
      if (nodeKind !== 'file' && nodeKind !== 'directory') continue;
      entries.push({ relativePath, nodeKind });
    }
    return entries;
  }
}

export const onlyPreviewTreeSelection = reactive(
  new OnlyPreviewTreeSelectionController(() => onlyPreviewShellStore)
);

/**
 * Open the Project row menu, carrying the selection.
 *
 * It lives here rather than in the shell store for two reasons: the store is at its 800-line budget,
 * and the selection this request carries is this module's. The root row keeps the store's own menu,
 * which has no selection to carry.
 */
export const showOnlyPreviewTreeContextMenu = async (entry: {
  relativePath: string;
  nodeKind: string;
}): Promise<void> => {
  if (entry.nodeKind === 'symlink') return;
  if (entry.relativePath === '') {
    await onlyPreviewShellStore.showFileContextMenu(entry.relativePath);
    return;
  }
  const hostToken = onlyPreviewEnv.hostToken;
  const workspaceId = onlyPreviewShellStore.workspace?.workspaceId;
  if (!hostToken || !workspaceId) return;
  try {
    unwrapOnlyPreviewResult(
      await onlyPreviewClient.showFileContextMenu({
        hostToken,
        workspaceId,
        relativePath: entry.relativePath,
        selection: onlyPreviewTreeSelection.entries()
      })
    );
  } catch (error) {
    onlyPreviewShellStore.errorMessage = getOnlyPreviewErrorMessage(error);
  }
};
