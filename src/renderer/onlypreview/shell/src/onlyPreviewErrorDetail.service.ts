import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';

// What the banner can hand back when the owner asks for the detail behind it. The banner itself
// shows one localized sentence, which is right for reading and useless for reporting.
export interface OnlyPreviewErrorDetail {
  code: string;
  name: string;
  message: string;
  stack: string;
}

const MAX_STACK_LINES = 12;
const MAX_FIELD_LENGTH = 2_000;

const bound = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.length > MAX_FIELD_LENGTH ? `${value.slice(0, MAX_FIELD_LENGTH)}…` : value;
};

export const describeOnlyPreviewErrorDetail = (error: unknown): OnlyPreviewErrorDetail => {
  if (error instanceof OnlyPreviewContractError) {
    return { code: error.code, name: error.name, message: bound(error.message), stack: '' };
  }
  if (error instanceof Error) {
    // A plain Error is where a renderer bug shows up — a `ReferenceError` from a bad rename reads as
    // "could not complete this action" in the banner and says nothing at all without its stack.
    const stack = bound(error.stack ?? '')
      .split('\n')
      .slice(0, MAX_STACK_LINES)
      .join('\n');
    return { code: '', name: error.name, message: bound(error.message), stack };
  }
  return { code: '', name: '', message: bound(typeof error === 'string' ? error : ''), stack: '' };
};

// Plain text, because it goes to the clipboard and then into a message to whoever is fixing it.
export const formatOnlyPreviewErrorDetail = (
  detail: OnlyPreviewErrorDetail,
  at: string
): string => {
  const lines = [`OnlyPreview error${at ? ` · ${at}` : ''}`];
  if (detail.code) lines.push(`code: ${detail.code}`);
  if (detail.name) lines.push(`name: ${detail.name}`);
  if (detail.message) lines.push(`message: ${detail.message}`);
  if (detail.stack) lines.push('stack:', detail.stack);
  return lines.join('\n');
};

export const isEmptyOnlyPreviewErrorDetail = (detail: OnlyPreviewErrorDetail | null): boolean =>
  !detail || (!detail.code && !detail.name && !detail.message && !detail.stack);
