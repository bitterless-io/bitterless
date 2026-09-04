import { dialog, Menu, shell, type BaseWindow, type MenuItemConstructorOptions } from 'electron';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import type {
  OnlyPreviewFileRef,
  OnlyPreviewHostRequest,
  OnlyPreviewProjectEntry
} from '@shared/onlypreview/onlyPreview.types';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import { i18nHelper } from '@main/i18n/i18n.helper';
import {
  onlyPreviewClipboardService,
  type OnlyPreviewClipboardCopyKind
} from './onlyPreviewClipboard.service';
import {
  ONLY_PREVIEW_UNTITLED_FOLDER_MAX_INDEX,
  onlyPreviewUntitledFolderName
} from '@shared/onlypreview/onlyPreviewEntryName.shared';
import { onlyPreviewSelectionCoordinator } from './onlyPreviewSelectionCoordinator.service';
import {
  onlyPreviewWorkspaceRegistry,
  type OnlyPreviewProjectAuthorityRef
} from './onlyPreviewWorkspace.registry';
import { onlyPreviewPreviewRegionService } from './views/onlyPreviewPreviewRegion.service';
import {
  ONLY_PREVIEW_PROJECT_NEW_FOLDER_EVENT,
  ONLY_PREVIEW_PROJECT_RENAME_EVENT,
  ONLY_PREVIEW_SELECTION_CHANGED_EVENT
} from '@shared/onlypreview/onlyPreview.types';
import { presentOnlyPreviewNewFolderDialog } from './onlyPreviewNewFolderDialog.service';
import { presentOnlyPreviewDeleteDialog } from './onlyPreviewDeleteDialog.service';
import type { OnlyPreviewDeleteEntry } from '@shared/onlypreview/onlyPreviewDeleteSelection.shared';
import { xpcMain } from 'electron-xpc/main';

type ProjectItemRequest = OnlyPreviewHostRequest & OnlyPreviewFileRef;

// A selection larger than this is not a menu target: the plan is refused before the confirmation.
const MAX_MENU_SELECTION = 1_000;

const fillLabel = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/gu, (match, key: string) => values[key] ?? match);

/**
 * What the menu's Delete acts on.
 *
 * The right-clicked row decides, the way every file manager does: inside the current selection the
 * action covers the whole selection, outside it the selection collapses to that row first. So a
 * right-click never acts on rows the owner cannot see are selected.
 */
const resolveMenuSelection = (
  selection: unknown,
  item: { relativePath: string; nodeKind: 'file' | 'directory' | 'symlink' }
): OnlyPreviewDeleteEntry[] => {
  const clicked: OnlyPreviewDeleteEntry = {
    relativePath: item.relativePath,
    nodeKind: item.nodeKind === 'directory' ? 'directory' : 'file'
  };
  if (!Array.isArray(selection) || selection.length > MAX_MENU_SELECTION) return [clicked];
  const entries: OnlyPreviewDeleteEntry[] = [];
  for (const value of selection) {
    // The selection arrives from the visible renderer, so it is re-validated here. Every path is
    // re-authorized again per entry before any syscall; this only decides what the menu offers.
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [clicked];
    const record = value as { relativePath?: unknown; nodeKind?: unknown };
    if (typeof record.relativePath !== 'string' || !record.relativePath) return [clicked];
    if (record.nodeKind !== 'file' && record.nodeKind !== 'directory') return [clicked];
    entries.push({ relativePath: record.relativePath, nodeKind: record.nodeKind });
  }
  if (!entries.some((entry) => entry.relativePath === item.relativePath)) return [clicked];
  return entries;
};
type ProjectItemRequestInput = {
  hostToken?: unknown;
  workspaceId?: unknown;
  relativePath?: unknown;
  selection?: unknown;
};
type ProjectRootRequest = { hostToken: string; workspaceId: string };

interface ProjectItemMenuActions {
  preview(request: ProjectItemRequest): void;
  openExternally(request: ProjectItemRequest): void;
  revealInFolder(request: ProjectItemRequest): void;
}

const sameAuthority = (
  current: OnlyPreviewProjectAuthorityRef,
  expected: OnlyPreviewProjectAuthorityRef
): boolean =>
  current.host.hostToken === expected.host.hostToken &&
  current.host.hostId === expected.host.hostId &&
  current.workspaceId === expected.workspaceId &&
  current.workspaceGeneration === expected.workspaceGeneration &&
  current.relativePath === expected.relativePath;

export class OnlyPreviewProjectNativeActionService {
  async showFileContextMenu(
    window: BaseWindow,
    request: ProjectItemRequestInput,
    actions: ProjectItemMenuActions
  ): Promise<void> {
    const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(
      request.hostToken,
      request
    );
    const item = await fileSearchWindowService.authorizeProjectItem({
      workspaceId: authority.workspaceId,
      workspaceGeneration: authority.workspaceGeneration,
      relativePath: authority.relativePath
    });
    this.requireCurrentItem(authority);
    const currentRequest: ProjectItemRequest = {
      hostToken: authority.host.hostToken,
      workspaceId: authority.workspaceId,
      relativePath: item.relativePath
    };
    const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
    const menuSelection = resolveMenuSelection(request.selection, item);
    const template: MenuItemConstructorOptions[] = [];
    if (item.nodeKind === 'file') {
      template.push({
        id: 'onlypreview-preview',
        label: labels.preview,
        click: () => actions.preview(currentRequest)
      });
      template.push({ type: 'separator' });
      template.push({
        id: 'onlypreview-open-externally',
        label: labels.openExternally,
        click: () => actions.openExternally(currentRequest)
      });
    }
    template.push({
      id: 'onlypreview-reveal-in-folder',
      label: labels.revealInFolder,
      click: () => actions.revealInFolder(currentRequest)
    });
    template.push({ type: 'separator' });
    // New Folder is deliberately absent from a file row (owner decision 2026-09-02): creating
    // "inside" a file has no meaning, and the folder and root menus already cover every location.
    if (item.nodeKind === 'directory') {
      template.push({
        id: 'onlypreview-new-folder',
        label: labels.newFolder,
        click: () =>
          this.requestNewFolder(authority.host.hostId, currentRequest, {
            parentRelativePath: item.relativePath,
            destinationName: item.name
          })
      });
    }
    // Rename covers files as well as folders, so the menu does not offer an action that silently
    // applies to only half the rows.
    template.push({
      id: 'onlypreview-rename',
      label: labels.rename,
      click: () =>
        this.requestRename(authority.host.hostId, currentRequest.workspaceId, item.relativePath)
    });
    template.push(
      { type: 'separator' },
      {
        id: 'onlypreview-copy-item',
        label: item.nodeKind === 'file' ? labels.copyFile : labels.copyFolder,
        accelerator: 'CommandOrControl+C',
        click: () =>
          void this.copyProjectItemFromUi(window, currentRequest, 'item', menuSelection)
      },
      {
        id: 'onlypreview-copy-path',
        label: labels.copyPath,
        accelerator: 'CommandOrControl+Shift+C',
        click: () =>
          void this.copyProjectItemFromUi(window, currentRequest, 'absolute-path', menuSelection)
      },
      {
        id: 'onlypreview-copy-relative-path',
        label: labels.copyRelativePath,
        click: () =>
          void this.copyProjectItemFromUi(window, currentRequest, 'relative-path', menuSelection)
      },
      {
        id: 'onlypreview-copy-name',
        label: labels.copyName,
        accelerator: 'CommandOrControl+Alt+C',
        click: () =>
          void this.copyProjectItemFromUi(window, currentRequest, 'name', menuSelection)
      }
    );
    // Delete now covers folders as well as files, and it acts on the whole tree selection when the
    // right-clicked row is part of it — a menu that says `Delete…` over a fourteen-row selection is
    // a trap, so the label carries the count.
    template.push(
      { type: 'separator' },
      {
        id: 'onlypreview-delete',
        label:
          menuSelection.length > 1
            ? fillLabel(labels.deleteManyMenu, { count: String(deleteSelection.length) })
            : labels.delete,
        click: () => void this.deleteProjectSelectionFromMenu(currentRequest, menuSelection)
      }
    );
    this.requireCurrentItem(authority);
    Menu.buildFromTemplate(template).popup({ window });
  }

  async showProjectRootContextMenu(window: BaseWindow, request: ProjectRootRequest): Promise<void> {
    const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityRootRef(
      request.hostToken,
      request.workspaceId
    );
    await fileSearchWindowService.authorizeProjectRoot({
      workspaceId: authority.workspaceId,
      workspaceGeneration: authority.workspaceGeneration
    });
    this.requireCurrentRoot(authority);
    const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
    const template: MenuItemConstructorOptions[] = [
      {
        id: 'onlypreview-reveal-project-root',
        label: labels.revealInFolder,
        click: () => void this.revealProjectRootFromUi(request)
      },
      { type: 'separator' },
      {
        id: 'onlypreview-new-folder-project-root',
        label: labels.newFolder,
        click: () =>
          this.requestNewFolder(authority.host.hostId, request, {
            parentRelativePath: '',
            destinationName: ''
          })
      },
      { type: 'separator' },
      {
        id: 'onlypreview-copy-project-root',
        label: labels.copyFolder,
        accelerator: 'CommandOrControl+C',
        click: () => void this.copyProjectRootFromUi(window, request, 'item')
      },
      {
        id: 'onlypreview-copy-project-root-path',
        label: labels.copyPath,
        accelerator: 'CommandOrControl+Shift+C',
        click: () => void this.copyProjectRootFromUi(window, request, 'absolute-path')
      },
      {
        id: 'onlypreview-copy-project-root-relative-path',
        label: labels.copyRelativePath,
        click: () => void this.copyProjectRootFromUi(window, request, 'relative-path')
      },
      {
        id: 'onlypreview-copy-project-root-name',
        label: labels.copyName,
        accelerator: 'CommandOrControl+Alt+C',
        click: () => void this.copyProjectRootFromUi(window, request, 'name')
      }
    ];
    this.requireCurrentRoot(authority);
    Menu.buildFromTemplate(template).popup({ window });
  }

  async copyProjectItemFromUi(
    window: BaseWindow,
    request: ProjectItemRequest,
    copyKind: OnlyPreviewClipboardCopyKind,
    // The whole tree selection when the clicked row is part of it, so a copy covers what a delete
    // would. Absent for the keyboard shortcuts, which act on the focused row.
    selection?: readonly OnlyPreviewDeleteEntry[]
  ): Promise<void> {
    try {
      const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(
        request.hostToken,
        request
      );
      const item = await fileSearchWindowService.authorizeProjectItem({
        workspaceId: authority.workspaceId,
        workspaceGeneration: authority.workspaceGeneration,
        relativePath: authority.relativePath
      });
      this.requireCurrentItem(authority);
      const items = [
        { realPath: item.canonicalPath, relativePath: item.relativePath, name: item.name }
      ];
      // Every other entry in the selection is authorized the same way before it reaches the
      // clipboard; the clicked row is already resolved above.
      for (const entry of selection ?? []) {
        if (entry.relativePath === item.relativePath) continue;
        const extra = await this.authorizeCopyItem(request.hostToken, request.workspaceId, entry);
        items.push(extra);
      }
      await onlyPreviewClipboardService.copyProjectItems(items, copyKind);
    } catch {
      await this.showCopyFailure(window).catch(() => undefined);
    }
  }

  private async authorizeCopyItem(
    hostToken: string,
    workspaceId: string,
    entry: OnlyPreviewDeleteEntry
  ): Promise<{ realPath: string; relativePath: string; name: string }> {
    const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(hostToken, {
      workspaceId,
      relativePath: entry.relativePath
    });
    const item = await fileSearchWindowService.authorizeProjectItem({
      workspaceId: authority.workspaceId,
      workspaceGeneration: authority.workspaceGeneration,
      relativePath: authority.relativePath
    });
    this.requireCurrentItem(authority);
    return { realPath: item.canonicalPath, relativePath: item.relativePath, name: item.name };
  }

  async copyProjectRootFromUi(
    window: BaseWindow,
    request: ProjectRootRequest,
    copyKind: OnlyPreviewClipboardCopyKind
  ): Promise<void> {
    try {
      const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityRootRef(
        request.hostToken,
        request.workspaceId
      );
      const root = await fileSearchWindowService.authorizeProjectRoot({
        workspaceId: authority.workspaceId,
        workspaceGeneration: authority.workspaceGeneration
      });
      this.requireCurrentRoot(authority);
      await onlyPreviewClipboardService.copyProjectItem(
        {
          realPath: root.canonicalPath,
          relativePath: root.relativePath,
          name: root.name
        },
        copyKind
      );
    } catch {
      await this.showCopyFailure(window).catch(() => undefined);
    }
  }

  /**
   * Create `untitled folder`, or the first free `untitled folder N`.
   *
   * The sequence is driven by `mkdir` failing with NAME_EXISTS rather than by listing the directory
   * first: `mkdir` without `recursive` is atomic, so it cannot hand the same name to two attempts
   * the way a pre-scan can. Only a collision advances the index — any other failure stops, so one
   * refused click cannot become a thousand round trips.
   */
  async createUntitledProjectFolder(request: {
    hostToken: string;
    workspaceId: string;
    parentRelativePath: string;
  }): Promise<OnlyPreviewProjectEntry> {
    let lastError: unknown = null;
    for (let index = 1; index <= ONLY_PREVIEW_UNTITLED_FOLDER_MAX_INDEX; index += 1) {
      try {
        return await this.createProjectFolder({
          ...request,
          name: onlyPreviewUntitledFolderName(index)
        });
      } catch (error) {
        if (!(error instanceof OnlyPreviewContractError) || error.code !== 'NAME_EXISTS') throw error;
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new OnlyPreviewContractError('NAME_EXISTS', 'Too many untitled folders already exist here.');
  }

  async createProjectFolder(request: {
    hostToken: string;
    workspaceId: string;
    parentRelativePath: string;
    name: string;
  }): Promise<OnlyPreviewProjectEntry> {
    // The parent is authorized as an item, or as the root when the path is empty. Both fences are
    // re-checked after the authority call so a workspace swap mid-flight cannot land the folder in
    // a Project the owner is no longer looking at.
    const authority = request.parentRelativePath
      ? onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(request.hostToken, {
          workspaceId: request.workspaceId,
          relativePath: request.parentRelativePath
        })
      : onlyPreviewWorkspaceRegistry.getProjectAuthorityRootRef(
          request.hostToken,
          request.workspaceId
        );
    this.requireCurrentAuthority(authority);
    const created = await fileSearchWindowService.createProjectDirectory({
      workspaceId: authority.workspaceId,
      workspaceGeneration: authority.workspaceGeneration,
      parentRelativePath: authority.relativePath,
      name: request.name
    });
    this.requireCurrentAuthority(authority);
    return {
      relativePath: created.relativePath,
      name: created.name,
      nodeKind: created.nodeKind
    };
  }

  // The owner asked for a dialog on a duplicate name, and every other Project failure in this menu
  // is already a native message box, so the dialog belongs here rather than in the renderer. The
  // error is rethrown so the tree still reverts the row to its previous name.
  async renameProjectItemFromUi(
    window: BaseWindow,
    request: {
      hostToken: string;
      workspaceId: string;
      relativePath: string;
      name: string;
    }
  ): Promise<OnlyPreviewProjectEntry> {
    try {
      return await this.renameProjectItem(request);
    } catch (error) {
      await this.showRenameFailure(window, error).catch(() => undefined);
      throw error;
    }
  }

  async renameProjectItem(request: {
    hostToken: string;
    workspaceId: string;
    relativePath: string;
    name: string;
  }): Promise<OnlyPreviewProjectEntry> {
    const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(request.hostToken, {
      workspaceId: request.workspaceId,
      relativePath: request.relativePath
    });
    this.requireCurrentItem(authority);
    const renamed = await fileSearchWindowService.renameProjectEntry({
      workspaceId: authority.workspaceId,
      workspaceGeneration: authority.workspaceGeneration,
      relativePath: authority.relativePath,
      name: request.name
    });
    this.requireCurrentItem(authority);
    this.followRenamedSelection(authority, renamed.relativePath, renamed.nodeKind);
    return {
      relativePath: renamed.relativePath,
      name: renamed.name,
      nodeKind: renamed.nodeKind
    };
  }

  /**
   * Keep the preview honest across a rename.
   *
   * Renaming the previewed file must re-point the preview at the new path, and renaming any ancestor
   * of it must clear the preview — the old path no longer exists on disk, and a preview showing a
   * path that is gone is worse than an empty one. Both are decided from the selection Main already
   * holds, so neither needs a filesystem read.
   */
  private followRenamedSelection(
    authority: OnlyPreviewProjectAuthorityRef,
    newRelativePath: string,
    nodeKind: 'file' | 'directory'
  ): void {
    const hostToken = authority.host.hostToken;
    const selected = onlyPreviewWorkspaceRegistry.restore(hostToken)?.selectedRelativePath;
    const renamedFile = nodeKind === 'file' && selected === authority.relativePath;
    const renamedAncestor = selected?.startsWith(`${authority.relativePath}/`) ?? false;
    if (!renamedFile && !renamedAncestor) return;
    onlyPreviewSelectionCoordinator.invalidatePendingSelection(hostToken, {
      workspaceId: authority.workspaceId,
      relativePath: authority.relativePath
    });
    if (renamedFile) {
      onlyPreviewWorkspaceRegistry.select(hostToken, {
        workspaceId: authority.workspaceId,
        relativePath: newRelativePath
      });
      void onlyPreviewPreviewRegionService
        .present(hostToken, { workspaceId: authority.workspaceId, relativePath: newRelativePath })
        .catch(() => undefined);
    } else {
      // The previewed file moved with its folder; its indexed path is stale either way, so the
      // preview is cleared rather than guessed at.
      onlyPreviewWorkspaceRegistry.clearProjectSelection(hostToken);
      onlyPreviewPreviewRegionService.clearWorkspace(hostToken, authority.workspaceId);
    }
    xpcMain.broadcast(ONLY_PREVIEW_SELECTION_CHANGED_EVENT, { hostId: authority.host.hostId });
  }

  async openExternally(request: ProjectItemRequestInput): Promise<void> {
    const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(
      request.hostToken,
      request
    );
    const file = await fileSearchWindowService.authorizeProjectItem({
      workspaceId: authority.workspaceId,
      workspaceGeneration: authority.workspaceGeneration,
      relativePath: authority.relativePath
    });
    this.requireCurrentItem(authority);
    if (file.nodeKind !== 'file') {
      throw new OnlyPreviewContractError(
        'PATH_NOT_REGULAR_FILE',
        'Directories cannot be opened as files.'
      );
    }
    this.requireCurrentItem(authority);
    const failure = await shell.openPath(file.canonicalPath);
    if (failure) throw new Error('The operating system could not open this file.');
  }

  async revealInFolder(request: ProjectItemRequestInput): Promise<void> {
    const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(
      request.hostToken,
      request
    );
    const item = await fileSearchWindowService.authorizeProjectItem({
      workspaceId: authority.workspaceId,
      workspaceGeneration: authority.workspaceGeneration,
      relativePath: authority.relativePath
    });
    this.requireCurrentItem(authority);
    shell.showItemInFolder(item.canonicalPath);
  }

  private async revealProjectRootFromUi(request: ProjectRootRequest): Promise<void> {
    try {
      const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityRootRef(
        request.hostToken,
        request.workspaceId
      );
      const root = await fileSearchWindowService.authorizeProjectRoot({
        workspaceId: authority.workspaceId,
        workspaceGeneration: authority.workspaceGeneration
      });
      this.requireCurrentRoot(authority);
      shell.showItemInFolder(root.canonicalPath);
    } catch {
      // Native menu actions can outlive a closing or replaced workspace.
    }
  }

  /**
   * Delete, driven by the alert-layer confirmation.
   *
   * The native message box is gone: one dialog surface now covers every delete, it renders above the
   * preview including a PDF, and it can list a whole plan instead of naming one file.
   */
  async deleteProjectSelectionFromMenu(
    request: ProjectItemRequest,
    selection: readonly OnlyPreviewDeleteEntry[]
  ): Promise<void> {
    await presentOnlyPreviewDeleteDialog(
      { hostToken: request.hostToken, selection, platform: process.platform },
      {
        removeEntry: async (entry) =>
          await this.removeProjectEntry(request.hostToken, request.workspaceId, entry)
      }
    ).catch(() => undefined);
  }

  // One entry, through the same two-phase grant the single-file delete has always used. A prepared
  // grant is always released: cancelled on failure, consumed on success.
  private async removeProjectEntry(
    hostToken: string,
    workspaceId: string,
    entry: OnlyPreviewDeleteEntry
  ): Promise<void> {
    const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(hostToken, {
      workspaceId,
      relativePath: entry.relativePath
    });
    const prepared = await fileSearchWindowService.prepareProjectDelete({
      workspaceId: authority.workspaceId,
      workspaceGeneration: authority.workspaceGeneration,
      relativePath: authority.relativePath
    });
    try {
      this.requireCurrentItem(authority);
      const deleted = await fileSearchWindowService.commitProjectDelete({
        workspaceId: authority.workspaceId,
        workspaceGeneration: authority.workspaceGeneration,
        grantId: prepared.grantId,
        relativePath: authority.relativePath
      });
      if (deleted.relativePath !== authority.relativePath) {
        throw new OnlyPreviewContractError('PROTOCOL_ERROR', 'Delete result is invalid.');
      }
    } catch (error) {
      await this.cancelDelete(authority, prepared.grantId);
      throw error;
    }
    this.followDeletedSelection(authority, entry.nodeKind);
  }

  // The delete counterpart of `followRenamedSelection`. A previewed file inside a removed folder is
  // as gone as the folder, so subtree containment counts, not just the exact path.
  private followDeletedSelection(
    authority: OnlyPreviewProjectAuthorityRef,
    nodeKind: 'file' | 'directory'
  ): void {
    const hostToken = authority.host.hostToken;
    try {
      this.requireCurrentItem(authority);
    } catch {
      return;
    }
    onlyPreviewSelectionCoordinator.invalidatePendingSelection(hostToken, {
      workspaceId: authority.workspaceId,
      relativePath: authority.relativePath
    });
    const selected = onlyPreviewWorkspaceRegistry.restore(hostToken)?.selectedRelativePath;
    const deletedFile = nodeKind === 'file' && selected === authority.relativePath;
    const deletedAncestor = selected?.startsWith(`${authority.relativePath}/`) ?? false;
    if (!deletedFile && !deletedAncestor) return;
    onlyPreviewWorkspaceRegistry.clearProjectSelection(hostToken);
    onlyPreviewPreviewRegionService.clearWorkspace(hostToken, authority.workspaceId);
    xpcMain.broadcast(ONLY_PREVIEW_SELECTION_CHANGED_EVENT, { hostId: authority.host.hostId });
  }

  private requireCurrentItem(expected: OnlyPreviewProjectAuthorityRef): void {
    const current = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(
      expected.host.hostToken,
      {
        workspaceId: expected.workspaceId,
        relativePath: expected.relativePath
      }
    );
    if (!sameAuthority(current, expected)) this.throwAuthorityChanged();
  }

  // No longer an intent for the renderer to start an inline edit: the name is collected by the
  // alert-layer dialog, in Main, and only the finished folder reaches the tree.
  private requestNewFolder(
    hostId: string,
    request: { hostToken: string; workspaceId: string },
    params: { parentRelativePath: string; destinationName: string }
  ): void {
    void presentOnlyPreviewNewFolderDialog({
      hostId,
      hostToken: request.hostToken,
      workspaceId: request.workspaceId,
      parentRelativePath: params.parentRelativePath,
      destinationName: params.destinationName
    }, {
      createUntitled: async (target) => await this.createUntitledProjectFolder(target),
      createNamed: async (target) => await this.createProjectFolder(target)
    }).catch(() => {
      // A revoked host or a closed window simply gets no dialog; nothing has been written.
    });
  }

  private requestRename(hostId: string, workspaceId: string, relativePath: string): void {
    xpcMain.broadcast(ONLY_PREVIEW_PROJECT_RENAME_EVENT, { hostId, workspaceId, relativePath });
  }

  private requireCurrentAuthority(expected: OnlyPreviewProjectAuthorityRef): void {
    if (expected.relativePath) this.requireCurrentItem(expected);
    else this.requireCurrentRoot(expected);
  }

  private requireCurrentRoot(expected: OnlyPreviewProjectAuthorityRef): void {
    const current = onlyPreviewWorkspaceRegistry.getProjectAuthorityRootRef(
      expected.host.hostToken,
      expected.workspaceId
    );
    if (!sameAuthority(current, expected)) this.throwAuthorityChanged();
  }

  private throwAuthorityChanged(): never {
    throw new OnlyPreviewContractError(
      'WORKSPACE_ACCESS_DENIED',
      'Project authority changed before the native action.'
    );
  }

  private async cancelDelete(
    authority: OnlyPreviewProjectAuthorityRef,
    grantId: string
  ): Promise<void> {
    await fileSearchWindowService
      .cancelProjectDelete({
        workspaceId: authority.workspaceId,
        workspaceGeneration: authority.workspaceGeneration,
        grantId,
        relativePath: authority.relativePath
      })
      .catch(() => undefined);
  }

  private async showRenameFailure(window: BaseWindow, error: unknown): Promise<void> {
    const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
    const code = error instanceof OnlyPreviewContractError ? error.code : null;
    await dialog.showMessageBox(window, {
      type: 'error',
      title: labels.renameFailureTitle,
      message:
        code === 'NAME_EXISTS'
          ? labels.renameExistsMessage
          : code === 'NAME_INVALID'
            ? labels.renameInvalidMessage
            : labels.renameFailureMessage,
      buttons: [labels.renameFailureOk],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
  }

  private async showCopyFailure(window: BaseWindow): Promise<void> {
    const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
    await dialog.showMessageBox(window, {
      type: 'error',
      title: labels.copyFailureTitle,
      message: labels.copyFailureMessage,
      buttons: [labels.copyFailureOk],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
  }
}

export const onlyPreviewProjectNativeActionService = new OnlyPreviewProjectNativeActionService();
