import { xpcMain } from 'electron-xpc/main';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import { ONLY_PREVIEW_PROJECT_NEW_FOLDER_EVENT } from '@shared/onlypreview/onlyPreview.types';
import { ONLY_PREVIEW_UNTITLED_FOLDER_BASE } from '@shared/onlypreview/onlyPreviewEntryName.shared';
import type { OnlyPreviewAlertCommitOutcome } from '@main/onlypreview/views/onlyPreviewAlertView.service';
import { onlyPreviewAlertWindowService } from '@main/onlypreview/views/onlyPreviewAlertWindow.service';
import { i18nHelper } from '@main/i18n/i18n.helper';

export interface OnlyPreviewNewFolderTarget {
  hostToken: string;
  workspaceId: string;
  parentRelativePath: string;
}

export interface OnlyPreviewCreatedFolder {
  relativePath: string;
}

// Injected rather than imported: the native action service owns both creators and calls this, so
// importing it back would close a cycle — and a double makes the whole flow testable without Main.
export interface OnlyPreviewNewFolderDialogCreators {
  createUntitled: (target: OnlyPreviewNewFolderTarget) => Promise<OnlyPreviewCreatedFolder>;
  createNamed: (
    target: OnlyPreviewNewFolderTarget & { name: string }
  ) => Promise<OnlyPreviewCreatedFolder>;
}

export interface OnlyPreviewNewFolderDialogRequest {
  hostId: string;
  hostToken: string;
  workspaceId: string;
  parentRelativePath: string;
  // Display name of the destination folder, or empty for the Project root.
  destinationName: string;
}

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/gu, (match, key: string) => values[key] ?? match);

/**
 * New Folder, start to finish in Main.
 *
 * Replaces the create-then-edit row: the folder used to be created with an allocated name *before*
 * the owner had typed anything, so cancelling left an `untitled folder` on disk. Now nothing is
 * written until the dialog is confirmed.
 */
export const presentOnlyPreviewNewFolderDialog = async (
  request: OnlyPreviewNewFolderDialogRequest,
  creators: OnlyPreviewNewFolderDialogCreators
): Promise<void> => {
  const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
  const suggestion = ONLY_PREVIEW_UNTITLED_FOLDER_BASE;
  await onlyPreviewAlertWindowService.requestNewFolder(
    request.hostToken,
    {
      title: labels.newFolderTitle,
      destinationLabel: request.destinationName
        ? fill(labels.newFolderDestination, { name: request.destinationName })
        : '',
      nameLabel: labels.newFolderNameLabel,
      suggestedName: suggestion,
      invalidNameMessage: labels.renameInvalidMessage,
      confirmLabel: labels.newFolderConfirm,
      cancelLabel: labels.newFolderCancel
    },
    async (name) => await commitNewFolder(request, creators, name, name === suggestion)
  );
};

const commitNewFolder = async (
  request: OnlyPreviewNewFolderDialogRequest,
  creators: OnlyPreviewNewFolderDialogCreators,
  name: string,
  // True while the field still holds Main's own suggestion. Confirming an untouched suggestion runs
  // the untitled sequence — `untitled folder`, `untitled folder 2`, … — so Enter always creates
  // something. A name the owner actually typed is created verbatim and its collision is reported,
  // because silently creating "untitled folder 2" instead of what was typed would be worse.
  untouched: boolean
): Promise<OnlyPreviewAlertCommitOutcome> => {
  const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
  const target = {
    hostToken: request.hostToken,
    workspaceId: request.workspaceId,
    parentRelativePath: request.parentRelativePath
  };
  try {
    const created = untouched
      ? await creators.createUntitled(target)
      : await creators.createNamed({ ...target, name });
    // The tree refreshes and selects the created row through the same intent the menu used to send
    // to start an inline edit; it now carries the finished folder instead.
    xpcMain.broadcast(ONLY_PREVIEW_PROJECT_NEW_FOLDER_EVENT, {
      hostId: request.hostId,
      workspaceId: request.workspaceId,
      relativePath: created.relativePath
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeFailure(error, request, name, labels) };
  }
};

const describeFailure = (
  error: unknown,
  request: OnlyPreviewNewFolderDialogRequest,
  name: string,
  labels: ReturnType<typeof i18nHelper.getMessages>['app']['onlyPreviewFileMenu']
): { title: string; message: string; confirmLabel: string } => {
  const code = error instanceof OnlyPreviewContractError ? error.code : null;
  if (code === 'NAME_EXISTS') {
    return {
      title: labels.newFolderExistsTitle,
      message: request.destinationName
        ? fill(labels.newFolderExistsMessage, { name, parent: request.destinationName })
        : fill(labels.newFolderExistsRootMessage, { name }),
      confirmLabel: labels.alertOk
    };
  }
  if (code === 'NAME_INVALID') {
    return {
      title: labels.newFolderInvalidTitle,
      message: labels.renameInvalidMessage,
      confirmLabel: labels.alertOk
    };
  }
  // No path and no raw system text: this string reaches a renderer.
  return {
    title: labels.newFolderFailureTitle,
    message: labels.newFolderFailureMessage,
    confirmLabel: labels.alertOk
  };
};
