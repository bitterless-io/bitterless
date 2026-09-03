import {
  ONLY_PREVIEW_ALERT_MAX_LABEL_LENGTH,
  ONLY_PREVIEW_ALERT_MAX_LISTED_ENTRIES,
  ONLY_PREVIEW_ALERT_MAX_TEXT_LENGTH,
  type OnlyPreviewAlertConfirmDialog,
  type OnlyPreviewAlertDialog,
  type OnlyPreviewAlertErrorDialog,
  type OnlyPreviewAlertListedEntry,
  type OnlyPreviewAlertNewFolderDialog,
  type OnlyPreviewAlertResolution,
  type OnlyPreviewAlertSnapshot,
  type OnlyPreviewAlertSnapshotRequest
} from './onlyPreviewAlert.types';
import { OnlyPreviewContractError } from './onlyPreview.contract';

const expectRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OnlyPreviewContractError('INVALID_INPUT', `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const expectExactKeys = (
  record: Record<string, unknown>,
  keys: readonly string[],
  label: string
): void => {
  const present = Object.keys(record);
  if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
    throw new OnlyPreviewContractError('INVALID_INPUT', `${label} has unexpected fields.`);
  }
};

const expectToken = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length < 8 || value.length > 512) {
    throw new OnlyPreviewContractError('INVALID_INPUT', `${label} is invalid.`);
  }
  return value;
};

// Every dialog string crosses from Main to the alert renderer, and the renderer prints it as text.
// Bounding it here keeps a malformed caller from handing the dialog an unbounded body, and the
// renderer never interprets it as markup.
export const boundOnlyPreviewAlertText = (value: unknown, label: string): string => {
  if (typeof value !== 'string') {
    throw new OnlyPreviewContractError('INVALID_INPUT', `${label} must be text.`);
  }
  const normalized = value.replace(/\s+$/u, '');
  if (!normalized || normalized.length > ONLY_PREVIEW_ALERT_MAX_TEXT_LENGTH) {
    throw new OnlyPreviewContractError('INVALID_INPUT', `${label} is out of range.`);
  }
  return normalized;
};

export const boundOnlyPreviewAlertLabel = (value: unknown, label: string): string => {
  if (typeof value !== 'string') {
    throw new OnlyPreviewContractError('INVALID_INPUT', `${label} must be text.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > ONLY_PREVIEW_ALERT_MAX_LABEL_LENGTH) {
    throw new OnlyPreviewContractError('INVALID_INPUT', `${label} is out of range.`);
  }
  return normalized;
};

// An optional label — a hint or a destination that a caller may legitimately leave empty — keeps its
// bound but is allowed to be blank.
export const boundOnlyPreviewAlertOptionalLabel = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length > ONLY_PREVIEW_ALERT_MAX_LABEL_LENGTH) {
    throw new OnlyPreviewContractError('INVALID_INPUT', `${label} is out of range.`);
  }
  return value.trim();
};

export const parseOnlyPreviewAlertSnapshotRequest = (
  value: unknown
): OnlyPreviewAlertSnapshotRequest => {
  const record = expectRecord(value, 'Alert snapshot request');
  expectExactKeys(record, ['hostToken'], 'Alert snapshot request');
  return { hostToken: expectToken(record.hostToken, 'Host capability') };
};

export const parseOnlyPreviewAlertResolution = (value: unknown): OnlyPreviewAlertResolution => {
  const record = expectRecord(value, 'Alert resolution');
  expectExactKeys(record, ['hostToken', 'dialogId', 'outcome', 'value'], 'Alert resolution');
  if (record.outcome !== 'confirm' && record.outcome !== 'cancel') {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Alert outcome is invalid.');
  }
  // The dialog id is Main's, so a renderer that answers a dialog Main has already replaced cannot
  // resolve the current one by accident.
  const dialogId = expectToken(record.dialogId, 'Alert dialog');
  if (typeof record.value !== 'string' || record.value.length > ONLY_PREVIEW_ALERT_MAX_TEXT_LENGTH) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Alert value is out of range.');
  }
  return {
    hostToken: expectToken(record.hostToken, 'Host capability'),
    dialogId,
    outcome: record.outcome,
    value: record.value
  };
};

const expectSafeCount = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new OnlyPreviewContractError('INVALID_INPUT', `${label} is invalid.`);
  }
  return value as number;
};

const parseListedEntry = (value: unknown): OnlyPreviewAlertListedEntry => {
  const record = expectRecord(value, 'Alert entry');
  expectExactKeys(record, ['relativePath', 'nodeKind'], 'Alert entry');
  if (record.nodeKind !== 'file' && record.nodeKind !== 'directory') {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Alert entry kind is invalid.');
  }
  return {
    relativePath: boundOnlyPreviewAlertText(record.relativePath, 'Alert entry path'),
    nodeKind: record.nodeKind
  };
};

const parseNewFolderDialog = (
  record: Record<string, unknown>
): OnlyPreviewAlertNewFolderDialog => {
  expectExactKeys(
    record,
    [
      'kind',
      'dialogId',
      'title',
      'destinationLabel',
      'nameLabel',
      'suggestedName',
      'invalidNameMessage',
      'confirmLabel',
      'cancelLabel'
    ],
    'New Folder dialog'
  );
  return {
    kind: 'new-folder',
    dialogId: expectToken(record.dialogId, 'Alert dialog'),
    title: boundOnlyPreviewAlertLabel(record.title, 'Alert title'),
    destinationLabel: boundOnlyPreviewAlertOptionalLabel(
      record.destinationLabel,
      'Alert destination'
    ),
    nameLabel: boundOnlyPreviewAlertLabel(record.nameLabel, 'Alert field label'),
    suggestedName: boundOnlyPreviewAlertOptionalLabel(record.suggestedName, 'Suggested name'),
    invalidNameMessage: boundOnlyPreviewAlertText(record.invalidNameMessage, 'Alert name message'),
    confirmLabel: boundOnlyPreviewAlertLabel(record.confirmLabel, 'Alert confirm label'),
    cancelLabel: boundOnlyPreviewAlertLabel(record.cancelLabel, 'Alert cancel label')
  };
};

const parseConfirmDialog = (record: Record<string, unknown>): OnlyPreviewAlertConfirmDialog => {
  expectExactKeys(
    record,
    [
      'kind',
      'dialogId',
      'title',
      'message',
      'entries',
      'moreLabel',
      'folderTag',
      'confirmLabel',
      'cancelLabel',
      'confirmHint',
      'destructive'
    ],
    'Confirm dialog'
  );
  if (!Array.isArray(record.entries) || record.entries.length > ONLY_PREVIEW_ALERT_MAX_LISTED_ENTRIES) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Alert entries are out of range.');
  }
  if (typeof record.destructive !== 'boolean') {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Alert destructive flag is invalid.');
  }
  return {
    kind: 'confirm',
    dialogId: expectToken(record.dialogId, 'Alert dialog'),
    title: boundOnlyPreviewAlertLabel(record.title, 'Alert title'),
    message: boundOnlyPreviewAlertText(record.message, 'Alert message'),
    entries: record.entries.map(parseListedEntry),
    moreLabel: boundOnlyPreviewAlertOptionalLabel(record.moreLabel, 'Alert more label'),
    folderTag: boundOnlyPreviewAlertOptionalLabel(record.folderTag, 'Alert folder tag'),
    confirmLabel: boundOnlyPreviewAlertLabel(record.confirmLabel, 'Alert confirm label'),
    cancelLabel: boundOnlyPreviewAlertLabel(record.cancelLabel, 'Alert cancel label'),
    confirmHint: boundOnlyPreviewAlertOptionalLabel(record.confirmHint, 'Alert confirm hint'),
    destructive: record.destructive
  };
};

const parseErrorDialog = (value: unknown): OnlyPreviewAlertErrorDialog => {
  const record = expectRecord(value, 'Error dialog');
  expectExactKeys(record, ['kind', 'dialogId', 'title', 'message', 'confirmLabel'], 'Error dialog');
  if (record.kind !== 'error') {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Alert dialog kind is invalid.');
  }
  return {
    kind: 'error',
    dialogId: expectToken(record.dialogId, 'Alert dialog'),
    title: boundOnlyPreviewAlertLabel(record.title, 'Alert title'),
    message: boundOnlyPreviewAlertText(record.message, 'Alert message'),
    confirmLabel: boundOnlyPreviewAlertLabel(record.confirmLabel, 'Alert confirm label')
  };
};

// The renderer re-parses what Main sends it, like every other OnlyPreview surface: a snapshot is the
// only thing that decides what the dialog shows, so an unexpected shape must fail loudly rather than
// render half a dialog.
export const parseOnlyPreviewAlertSnapshot = (value: unknown): OnlyPreviewAlertSnapshot => {
  const record = expectRecord(value, 'Alert snapshot');
  expectExactKeys(record, ['revision', 'dialog', 'error'], 'Alert snapshot');
  const revision = expectSafeCount(record.revision, 'Alert revision');
  let dialog: OnlyPreviewAlertDialog | null = null;
  if (record.dialog !== null) {
    const dialogRecord = expectRecord(record.dialog, 'Alert dialog');
    if (dialogRecord.kind === 'new-folder') dialog = parseNewFolderDialog(dialogRecord);
    else if (dialogRecord.kind === 'confirm') dialog = parseConfirmDialog(dialogRecord);
    else throw new OnlyPreviewContractError('INVALID_INPUT', 'Alert dialog kind is invalid.');
  }
  return {
    revision,
    dialog,
    error: record.error === null ? null : parseErrorDialog(record.error)
  };
};
