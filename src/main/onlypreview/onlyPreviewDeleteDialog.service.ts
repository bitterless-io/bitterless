import {
  collapseOnlyPreviewDeleteSelection,
  type OnlyPreviewDeleteEntry
} from '@shared/onlypreview/onlyPreviewDeleteSelection.shared';
import { ONLY_PREVIEW_ALERT_MAX_LISTED_ENTRIES } from '@shared/onlypreview/onlyPreviewAlert.types';
import { onlyPreviewAlertWindowService } from '@main/onlypreview/views/onlyPreviewAlertWindow.service';
import { i18nHelper } from '@main/i18n/i18n.helper';

// A permanent recursive delete has no undo, so the run is bounded: a select-all on a large tree is
// refused with a count rather than started.
export const ONLY_PREVIEW_MAX_DELETE_ENTRIES = 200;
// How long a delete may run before it says so. Under this, the run is over before a dialog would be
// worth reading; over it, the owner is waiting with no feedback at all.
export const ONLY_PREVIEW_DELETE_PROGRESS_DELAY_MS = 250;

type DeleteLabels = ReturnType<typeof i18nHelper.getMessages>['app']['onlyPreviewFileMenu'];

export interface OnlyPreviewDeleteDialogRequest {
  hostToken: string;
  // The rows the owner selected, in tree order. Collapsing them is this service's job.
  selection: readonly OnlyPreviewDeleteEntry[];
  platform: NodeJS.Platform;
}

export interface OnlyPreviewDeleteExecutor {
  // Removes exactly one entry, or throws. Injected so the whole flow is testable without Main and so
  // this service never imports the native action service back into a cycle.
  removeEntry: (entry: OnlyPreviewDeleteEntry) => Promise<void>;
}

export interface OnlyPreviewDeleteOutcome {
  confirmed: boolean;
  removed: OnlyPreviewDeleteEntry[];
  failed: OnlyPreviewDeleteEntry | null;
}

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/gu, (match, key: string) => values[key] ?? match);

const nameOf = (relativePath: string): string => relativePath.split('/').at(-1) ?? relativePath;

export const describeOnlyPreviewDeletePlan = (
  entries: readonly OnlyPreviewDeleteEntry[],
  labels: DeleteLabels,
  platform: NodeJS.Platform
): {
  title: string;
  message: string;
  entries: OnlyPreviewDeleteEntry[];
  moreLabel: string;
  folderTag: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmHint: string;
  destructive: boolean;
} => {
  const listed = entries.slice(0, ONLY_PREVIEW_ALERT_MAX_LISTED_ENTRIES);
  const hidden = entries.length - listed.length;
  const single = entries.length === 1 ? entries[0] : null;
  return {
    title: single
      ? fill(
          single.nodeKind === 'directory'
            ? labels.deleteConfirmFolderTitle
            : labels.deleteConfirmFileTitle,
          { name: nameOf(single.relativePath) }
        )
      : fill(labels.deleteConfirmManyTitle, { count: String(entries.length) }),
    message: single ? labels.deleteConfirmSingleMessage : labels.deleteConfirmManyMessage,
    // A single entry is already named in the title, so listing it again says nothing.
    entries: single ? [] : listed.map((entry) => ({ ...entry })),
    moreLabel: hidden > 0 ? fill(labels.deleteMoreLabel, { count: String(hidden) }) : '',
    folderTag: labels.deleteFolderTag,
    confirmLabel: labels.deleteConfirmButton,
    cancelLabel: labels.deleteCancelButton,
    confirmHint: platform === 'darwin' ? labels.deleteConfirmHintMac : labels.deleteConfirmHint,
    destructive: true
  };
};

/**
 * Delete, from the selection to the last syscall.
 *
 * The selection is collapsed first — an entry inside another selected folder is dropped, because
 * removing the folder already removes it and removing the child first would race the recursive
 * removal. Then one confirmation covers the whole plan, and the entries are removed one at a time so
 * a failure can name exactly where the run stopped.
 */
export const presentOnlyPreviewDeleteDialog = async (
  request: OnlyPreviewDeleteDialogRequest,
  executor: OnlyPreviewDeleteExecutor
): Promise<OnlyPreviewDeleteOutcome> => {
  const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
  const empty: OnlyPreviewDeleteOutcome = { confirmed: false, removed: [], failed: null };
  const plan = collapseOnlyPreviewDeleteSelection(request.selection);
  if (!plan.ok) {
    if (plan.reason === 'root-selected') {
      await onlyPreviewAlertWindowService.showError(request.hostToken, {
        title: labels.deleteRootRefusedTitle,
        message: labels.deleteRootRefusedMessage,
        confirmLabel: labels.alertOk
      });
    }
    return empty;
  }
  if (plan.entries.length > ONLY_PREVIEW_MAX_DELETE_ENTRIES) {
    await onlyPreviewAlertWindowService.showError(request.hostToken, {
      title: labels.deleteTooManyTitle,
      message: fill(labels.deleteTooManyMessage, {
        limit: String(ONLY_PREVIEW_MAX_DELETE_ENTRIES)
      }),
      confirmLabel: labels.alertOk
    });
    return empty;
  }
  const confirmed = await onlyPreviewAlertWindowService.requestConfirm(
    request.hostToken,
    describeOnlyPreviewDeletePlan(plan.entries, labels, request.platform)
  );
  if (!confirmed) return empty;

  const removed: OnlyPreviewDeleteEntry[] = [];
  // Nothing is shown for a delete that finishes quickly: a dialog that appears and disappears inside
  // a frame reads as a glitch, not as feedback. A recursive folder removal is what this is for, and
  // that never returns inside the delay — docs/features/onlypreview-delete-progress.md #2.
  let progressId = '';
  const progressTimer = setTimeout(() => {
    try {
      progressId = onlyPreviewAlertWindowService.showProgress(request.hostToken, {
        title: labels.deleteProgressTitle,
        message: labels.deleteProgressMessage,
        total: plan.entries.length,
        countLabel: labels.deleteProgressCount
      });
      onlyPreviewAlertWindowService.updateProgress(progressId, removed.length);
    } catch {
      // The slot was taken or the window went away. A missing progress dialog must never stop the
      // delete that is already under way.
    }
  }, ONLY_PREVIEW_DELETE_PROGRESS_DELAY_MS);
  const settleProgress = (): void => {
    clearTimeout(progressTimer);
    if (progressId) onlyPreviewAlertWindowService.closeProgress(progressId);
    progressId = '';
  };

  try {
    for (const entry of plan.entries) {
      try {
        await executor.removeEntry(entry);
        removed.push(entry);
        if (progressId) onlyPreviewAlertWindowService.updateProgress(progressId, removed.length);
      } catch {
        // The run stops at the first failure and says what was actually removed. Continuing would
        // leave the owner with a partial delete reported as a success.
        // Closed before the error, so the report is the only thing on screen rather than a message
        // stacked over a bar that stopped moving.
        settleProgress();
        await onlyPreviewAlertWindowService
          .showError(request.hostToken, {
            title:
              plan.entries.length === 1 ? labels.deleteFailureTitle : labels.deletePartialTitle,
            message:
              plan.entries.length === 1
                ? labels.deleteFailureMessage
                : fill(labels.deletePartialMessage, {
                    done: String(removed.length),
                    total: String(plan.entries.length),
                    name: nameOf(entry.relativePath)
                  }),
            confirmLabel: labels.alertOk
          })
          .catch(() => undefined);
        return { confirmed: true, removed, failed: entry };
      }
    }
    return { confirmed: true, removed, failed: null };
  } finally {
    // Also covers a throw from the executor path itself — a dialog nobody can dismiss must not
    // outlive the work it describes.
    settleProgress();
  }
};
