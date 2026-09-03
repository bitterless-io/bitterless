import { dialog, Menu, shell, type BaseWindow, type MenuItemConstructorOptions } from 'electron';
import { basename } from 'node:path';
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
import { xpcMain } from 'electron-xpc/main';

type ProjectItemRequest = OnlyPreviewHostRequest & OnlyPreviewFileRef;
type ProjectItemRequestInput = {
  hostToken?: unknown;
  workspaceId?: unknown;
  relativePath?: unknown;
};
type ProjectRootRequest = { hostToken: string; workspaceId: string };

interface ProjectItemMenuActions {
  preview(request: ProjectItemRequest): void;
  openExternally(request: ProjectItemRequest): void;
  revealInFolder(request: ProjectItemRequest): void;
}

const displayFileName = (relativePath: string): string =>
  Array.from(basename(relativePath), (character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? '�' : character;
  }).join('');

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
          this.requestNewFolder(authority.host.hostId, currentRequest.workspaceId, {
            parentRelativePath: item.relativePath
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
        click: () => void this.copyProjectItemFromUi(window, currentRequest, 'item')
      },
      {
        id: 'onlypreview-copy-path',
        label: labels.copyPath,
        accelerator: 'CommandOrControl+Shift+C',
        click: () => void this.copyProjectItemFromUi(window, currentRequest, 'absolute-path')
      },
      {
        id: 'onlypreview-copy-relative-path',
        label: labels.copyRelativePath,
        click: () => void this.copyProjectItemFromUi(window, currentRequest, 'relative-path')
      },
      {
        id: 'onlypreview-copy-name',
        label: labels.copyName,
        accelerator: 'CommandOrControl+Alt+C',
        click: () => void this.copyProjectItemFromUi(window, currentRequest, 'name')
      }
    );
    if (item.nodeKind === 'file') {
      template.push(
        { type: 'separator' },
        {
          id: 'onlypreview-delete',
          label: labels.delete,
          click: () => void this.deleteFileFromMenu(window, currentRequest)
        }
      );
    }
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
          this.requestNewFolder(authority.host.hostId, request.workspaceId, {
            parentRelativePath: ''
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
    copyKind: OnlyPreviewClipboardCopyKind
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
      await onlyPreviewClipboardService.copyProjectItem(
        {
          realPath: item.canonicalPath,
          relativePath: item.relativePath,
          name: item.name
        },
        copyKind
      );
    } catch {
      await this.showCopyFailure(window).catch(() => undefined);
    }
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

  private async deleteFileFromMenu(window: BaseWindow, request: ProjectItemRequest): Promise<void> {
    const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
    let authority: OnlyPreviewProjectAuthorityRef | null = null;
    let prepared: Awaited<ReturnType<typeof fileSearchWindowService.prepareProjectDelete>> | null =
      null;
    try {
      authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(
        request.hostToken,
        request
      );
      prepared = await fileSearchWindowService.prepareProjectDelete({
        workspaceId: authority.workspaceId,
        workspaceGeneration: authority.workspaceGeneration,
        relativePath: authority.relativePath
      });
      this.requireCurrentItem(authority);
      const confirmation = await dialog.showMessageBox(window, {
        type: 'warning',
        title: labels.deleteConfirmTitle,
        message: labels.deleteConfirmMessage,
        detail: `${displayFileName(prepared.name)}\n\n${labels.deleteConfirmDetail}`,
        buttons: [labels.deleteCancelButton, labels.deleteConfirmButton],
        defaultId: 0,
        cancelId: 0,
        destructiveId: 1,
        noLink: true
      });
      if (confirmation.response !== 1) {
        await this.cancelDelete(authority, prepared.grantId);
        return;
      }
    } catch {
      if (authority && prepared) await this.cancelDelete(authority, prepared.grantId);
      await this.showDeleteFailure(window).catch(() => undefined);
      return;
    }

    if (!authority || !prepared) return;
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
      try {
        this.requireCurrentItem(authority);
      } catch {
        return;
      }
      onlyPreviewSelectionCoordinator.invalidatePendingSelection(authority.host.hostToken, {
        workspaceId: authority.workspaceId,
        relativePath: deleted.relativePath
      });
      const cleared = onlyPreviewWorkspaceRegistry.clearSelection(authority.host.hostToken, {
        workspaceId: authority.workspaceId,
        relativePath: deleted.relativePath
      });
      if (!cleared) return;
      onlyPreviewPreviewRegionService.clearWorkspace(
        authority.host.hostToken,
        authority.workspaceId
      );
      xpcMain.broadcast(ONLY_PREVIEW_SELECTION_CHANGED_EVENT, {
        hostId: authority.host.hostId
      });
    } catch {
      await this.cancelDelete(authority, prepared.grantId);
      await this.showDeleteFailure(window).catch(() => undefined);
    }
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

  // The menu click cannot create the folder or open the editor itself: the row that has to become
  // editable only exists in the shell renderer's tree, so Main delivers the intent and the renderer
  // performs the create and the inline edit against the row it owns.
  private requestNewFolder(
    hostId: string,
    workspaceId: string,
    params: { parentRelativePath: string }
  ): void {
    xpcMain.broadcast(ONLY_PREVIEW_PROJECT_NEW_FOLDER_EVENT, {
      hostId,
      workspaceId,
      parentRelativePath: params.parentRelativePath
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

  private async showDeleteFailure(window: BaseWindow): Promise<void> {
    const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
    await dialog.showMessageBox(window, {
      type: 'error',
      title: labels.deleteFailureTitle,
      message: labels.deleteFailureMessage,
      buttons: [labels.deleteFailureOk],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
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
