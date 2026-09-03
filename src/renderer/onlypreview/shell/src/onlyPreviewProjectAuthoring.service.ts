import type { OnlyPreviewErrorCode } from '@shared/onlypreview/onlyPreview.types';
import {
  ONLY_PREVIEW_UNTITLED_FOLDER_MAX_INDEX,
  onlyPreviewUntitledFolderName,
  validateOnlyPreviewEntryName
} from '@shared/onlypreview/onlyPreviewEntryName.shared';

export type OnlyPreviewAuthoringFailure = 'exists' | 'invalid' | 'other';

export const onlyPreviewUntitledFolderNames = (): string[] =>
  Array.from({ length: ONLY_PREVIEW_UNTITLED_FOLDER_MAX_INDEX }, (_value, index) =>
    onlyPreviewUntitledFolderName(index + 1)
  );

export const resolveOnlyPreviewAuthoringFailure = (error: unknown): OnlyPreviewAuthoringFailure => {
  const code = (error as { code?: OnlyPreviewErrorCode } | null)?.code;
  if (code === 'NAME_EXISTS') return 'exists';
  if (code === 'NAME_INVALID') return 'invalid';
  return 'other';
};

export interface OnlyPreviewEditState {
  relativePath: string;
  draft: string;
  originalName: string;
}

/**
 * The commit decision, kept out of the store so it can be exercised without a renderer.
 *
 * A draft equal to the current name is not a rename — committing it would still round-trip to the
 * filesystem, and on a case-insensitive volume a no-op rename is indistinguishable from a real one.
 * An invalid draft is rejected here so the owner sees the same rule the authority will apply,
 * without waiting for the round trip.
 */
export const resolveOnlyPreviewEditCommit = (
  state: OnlyPreviewEditState
): { kind: 'unchanged' } | { kind: 'invalid' } | { kind: 'rename'; name: string } => {
  const result = validateOnlyPreviewEntryName(state.draft);
  if (!result.ok) return { kind: 'invalid' };
  if (result.name === state.originalName) return { kind: 'unchanged' };
  return { kind: 'rename', name: result.name };
};

// The input tracks its content instead of filling the row, which is what the owner asked for. The
// measurement is in `ch` so it does not depend on a canvas or on the font having loaded.
export const onlyPreviewEditInputWidthCh = (draft: string): number => {
  let width = 0;
  for (const character of draft) {
    const codePoint = character.codePointAt(0) ?? 0;
    // CJK and full-width forms occupy two columns; everything else one.
    width +=
      (codePoint >= 0x1100 && codePoint <= 0x115f) ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6)
        ? 2
        : 1;
  }
  return Math.min(48, Math.max(6, width + 1));
};
