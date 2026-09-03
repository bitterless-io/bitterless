import {
  validateOnlyPreviewEntryName,
  type OnlyPreviewEntryNameRejection
} from '@shared/onlypreview/onlyPreviewEntryName.shared';
import type { OnlyPreviewAlertSnapshot } from '@shared/onlypreview/onlyPreviewAlert.types';

// Which dialog owns the keyboard. The error surface sits above whatever raised it, so while it is up
// it owns every key — a stacked dialog that let the one underneath act on Enter would answer the
// wrong question.
export type OnlyPreviewAlertKeyboardLayer = 'none' | 'error' | 'new-folder' | 'confirm';

export type OnlyPreviewAlertKeyAction = 'none' | 'dismiss-error' | 'confirm' | 'cancel';

export interface OnlyPreviewAlertKeyInput {
  key: string;
  meta: boolean;
  control: boolean;
  alt: boolean;
  composing: boolean;
}

export const resolveOnlyPreviewAlertKeyboardLayer = (
  snapshot: OnlyPreviewAlertSnapshot
): OnlyPreviewAlertKeyboardLayer => {
  if (snapshot.error) return 'error';
  if (!snapshot.dialog) return 'none';
  return snapshot.dialog.kind === 'new-folder' ? 'new-folder' : 'confirm';
};

export const resolveOnlyPreviewAlertKey = (
  layer: OnlyPreviewAlertKeyboardLayer,
  input: OnlyPreviewAlertKeyInput
): OnlyPreviewAlertKeyAction => {
  if (layer === 'none') return 'none';
  const escape = input.key === 'Escape' || input.key === 'Esc';
  // A commit must never fire mid-composition: an IME's Enter closes the candidate window, and the
  // owner types CJK folder names.
  const enter = (input.key === 'Enter' || input.key === 'Return') && !input.composing;
  if (layer === 'error') {
    // The owner's rule: 「回车 esc 点确定都能关闭」. One button means one outcome, so every dismissal
    // gesture reaches it.
    return escape || enter ? 'dismiss-error' : 'none';
  }
  if (escape) return 'cancel';
  if (!enter) return 'none';
  if (layer === 'new-folder') return input.meta || input.control || input.alt ? 'none' : 'confirm';
  // A destructive confirmation keeps Cancel as the default, so plain Enter cancels and the confirm
  // gesture is the explicit Cmd/Ctrl+Enter shown on the button.
  return input.meta || input.control ? 'confirm' : 'cancel';
};

export type OnlyPreviewAlertNameState =
  | { ok: true; name: string }
  | { ok: false; reason: OnlyPreviewEntryNameRejection };

export const resolveOnlyPreviewAlertName = (draft: string): OnlyPreviewAlertNameState => {
  const result = validateOnlyPreviewEntryName(draft);
  return result.ok ? { ok: true, name: result.name } : { ok: false, reason: result.reason };
};
