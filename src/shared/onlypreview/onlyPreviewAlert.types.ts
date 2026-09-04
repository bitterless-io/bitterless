import type { OnlyPreviewResult } from './onlyPreview.types';

// The alert layer's contract. One view holds a stack of at most two dialogs — a base dialog and an
// error above it — because the layer manager allows a single occupant per layer and the owner asked
// for the error surface to sit 「也是 alert内但是 z-index 更高」.

export const ONLY_PREVIEW_ALERT_MAX_TEXT_LENGTH = 2_000;
export const ONLY_PREVIEW_ALERT_MAX_LABEL_LENGTH = 120;
// A confirmation lists what it will act on, but a selection can be thousands of rows. Ten named
// entries plus a count is enough to recognize the target without turning the dialog into a scroller.
export const ONLY_PREVIEW_ALERT_MAX_LISTED_ENTRIES = 10;

export type OnlyPreviewAlertNodeKind = 'file' | 'directory';

export interface OnlyPreviewAlertListedEntry {
  relativePath: string;
  nodeKind: OnlyPreviewAlertNodeKind;
}

export interface OnlyPreviewAlertNewFolderDialog {
  kind: 'new-folder';
  dialogId: string;
  title: string;
  // Names where the folder will be created. New Folder is reachable from a folder row and from the
  // Project root, and without this the two are indistinguishable.
  destinationLabel: string;
  nameLabel: string;
  suggestedName: string;
  // Shown under the input while the typed name breaks the shared name rules. The renderer knows the
  // rejection reason but owns no strings, so the one message it can show comes with the dialog.
  invalidNameMessage: string;
  confirmLabel: string;
  cancelLabel: string;
}

export interface OnlyPreviewAlertConfirmDialog {
  kind: 'confirm';
  dialogId: string;
  title: string;
  message: string;
  entries: OnlyPreviewAlertListedEntry[];
  // Already carries its count, because the renderer owns no wording. Empty when the list is whole.
  moreLabel: string;
  folderTag: string;
  confirmLabel: string;
  cancelLabel: string;
  // Shown on the confirm button. A destructive dialog keeps focus on Cancel, so the confirm gesture
  // has to be discoverable.
  confirmHint: string;
  destructive: boolean;
}

export interface OnlyPreviewAlertErrorDialog {
  kind: 'error';
  dialogId: string;
  title: string;
  message: string;
  confirmLabel: string;
}

/**
 * Work in flight, with no answer to give.
 *
 * Every other dialog here exists to collect a decision; this one only reports. It carries no button
 * labels because it has no buttons — see `docs/features/onlypreview-delete-progress.md` #3, which is
 * also why `resolve()` refuses its id rather than trusting the renderer not to send one.
 *
 * `completed`/`total` are counted in SELECTION ENTRIES, the only unit the delete loop steps through.
 * A single recursive folder removal is one entry, so `total === 1` means we cannot see inside the
 * work and the renderer shows an indeterminate bar rather than inventing a percentage (#1).
 */
export interface OnlyPreviewAlertProgressDialog {
  kind: 'progress';
  dialogId: string;
  title: string;
  message: string;
  completed: number;
  total: number;
  // Already filled in by Main, because the renderer owns no wording — the same rule the confirm
  // dialog's `moreLabel` follows. Empty when `total` is 1: there is no honest count to show.
  countLabel: string;
}

export type OnlyPreviewAlertDialog =
  | OnlyPreviewAlertNewFolderDialog
  | OnlyPreviewAlertConfirmDialog
  | OnlyPreviewAlertProgressDialog;

export interface OnlyPreviewAlertSnapshot {
  revision: number;
  dialog: OnlyPreviewAlertDialog | null;
  error: OnlyPreviewAlertErrorDialog | null;
}

export interface OnlyPreviewAlertSnapshotRequest {
  hostToken: string;
}

export interface OnlyPreviewAlertResolution {
  hostToken: string;
  dialogId: string;
  outcome: 'confirm' | 'cancel';
  // Empty for every dialog that collects nothing. Kept required so the payload has one exact shape.
  value: string;
}

export interface OnlyPreviewAlertNewFolderRequest {
  title: string;
  destinationLabel: string;
  nameLabel: string;
  suggestedName: string;
  invalidNameMessage: string;
  confirmLabel: string;
  cancelLabel: string;
}

export interface OnlyPreviewAlertConfirmRequest {
  title: string;
  message: string;
  entries: OnlyPreviewAlertListedEntry[];
  moreLabel: string;
  folderTag: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmHint: string;
  destructive: boolean;
}

export interface OnlyPreviewAlertProgressRequest {
  title: string;
  message: string;
  total: number;
  // A template with `{done}` and `{total}`; the service refills it on every update.
  countLabel: string;
}

export interface OnlyPreviewAlertErrorRequest {
  title: string;
  message: string;
  confirmLabel: string;
}

export interface OnlyPreviewAlertApi {
  getAlertSnapshot(
    params: OnlyPreviewAlertSnapshotRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewAlertSnapshot>>;
  resolveAlert(params: OnlyPreviewAlertResolution): Promise<OnlyPreviewResult<void>>;
}
