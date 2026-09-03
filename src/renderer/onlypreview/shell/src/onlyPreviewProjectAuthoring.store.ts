import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  ONLY_PREVIEW_COPY_PROJECT_ITEM_EVENT,
  ONLY_PREVIEW_PROJECT_NEW_FOLDER_EVENT,
  ONLY_PREVIEW_PROJECT_RENAME_EVENT,
  type OnlyPreviewCopyProjectItemEvent,
  type OnlyPreviewProjectNewFolderEvent,
  type OnlyPreviewProjectRenameEvent
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewProjectEntry } from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import {
  resolveOnlyPreviewAuthoringFailure,
  resolveOnlyPreviewEditCommit,
  type OnlyPreviewEditState
} from './onlyPreviewProjectAuthoring.service';
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
  errorMessage: string;
  refreshIndex(): Promise<void>;
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

  async beginNewFolder(parentRelativePath: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      // Main allocates the name: it owns the untitled sequence, because only the atomic `mkdir`
      // behind it can decide which index is actually free.
      const created = await this.createFolder(parentRelativePath);
      if (parentRelativePath) this.host.expandedPaths.add(parentRelativePath);
      await this.settle(created);
      this.begin(created.relativePath, created.name);
    } catch (error) {
      const failure = resolveOnlyPreviewAuthoringFailure(error);
      this.host.errorMessage =
        failure === 'exists'
          ? onlyPreviewI18n.project.newFolderExhausted
          : failure === 'invalid'
            ? onlyPreviewI18n.project.nameInvalid
            : onlyPreviewI18n.errors.OPERATION_FAILED;
    } finally {
      this.busy = false;
    }
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

  private async createFolder(parentRelativePath: string): Promise<OnlyPreviewProjectEntry> {
    const hostToken = onlyPreviewEnv.hostToken;
    const workspaceId = this.host.workspace?.workspaceId;
    if (!hostToken || !workspaceId) throw new Error('OnlyPreview has no active Project.');
    return unwrapOnlyPreviewResult(
      await onlyPreviewClient.createProjectFolder({ hostToken, workspaceId, parentRelativePath })
    );
  }

  private async renameItem(relativePath: string, name: string): Promise<OnlyPreviewProjectEntry> {
    const hostToken = onlyPreviewEnv.hostToken;
    const workspaceId = this.host.workspace?.workspaceId;
    if (!hostToken || !workspaceId) throw new Error('OnlyPreview has no active Project item.');
    return unwrapOnlyPreviewResult(
      await onlyPreviewClient.renameProjectItem({ hostToken, workspaceId, relativePath, name })
    );
  }

  private async settle(entry: OnlyPreviewProjectEntry): Promise<void> {
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
    if (!isHostEvent(event) || typeof event.parentRelativePath !== 'string') return;
    void onlyPreviewProjectAuthoring.beginNewFolder(event.parentRelativePath);
  });
  xpcRenderer.subscribe(ONLY_PREVIEW_PROJECT_RENAME_EVENT, ({ params }) => {
    const event = params as OnlyPreviewProjectRenameEvent;
    if (!isHostEvent(event) || !event.relativePath) return;
    onlyPreviewProjectAuthoring.beginRename(event.relativePath);
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
