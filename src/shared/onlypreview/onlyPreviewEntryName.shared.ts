// One name-rule authority for both the Project renderer (immediate feedback) and the hidden preload
// (the actual contract before the syscall). The rules are the UNION of Windows and macOS
// restrictions applied on every platform, so a folder created here stays valid if the same tree is
// opened on the other operating system.

export const ONLY_PREVIEW_ENTRY_NAME_MAX_UTF16 = 255;
export const ONLY_PREVIEW_ENTRY_NAME_MAX_BYTES = 255;
export const ONLY_PREVIEW_UNTITLED_FOLDER_BASE = 'untitled folder';
export const ONLY_PREVIEW_UNTITLED_FOLDER_MAX_INDEX = 1_000;

export type OnlyPreviewEntryNameRejection =
  | 'empty'
  | 'dot'
  | 'reserved-character'
  | 'control-character'
  | 'trailing-dot'
  | 'device-name'
  | 'too-long';

export type OnlyPreviewEntryNameResult =
  | { ok: true; name: string }
  | { ok: false; reason: OnlyPreviewEntryNameRejection };

// `/` and NUL are the only bytes POSIX forbids, but `< > : " \ | ? *` are all rejected by Windows and
// `:` is still a path separator in macOS user-facing APIs.
const RESERVED_CHARACTERS = /[<>:"/\\|?*]/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const DEVICE_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_value, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_value, index) => `LPT${index + 1}`)
]);

const utf8Length = (value: string): number => {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x80) bytes += 1;
    else if (codePoint < 0x800) bytes += 2;
    else if (codePoint < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
};

// Windows reserves the device name with or without an extension, case-insensitively, so `nul.txt`
// is refused as well as `NUL`.
const isDeviceName = (value: string): boolean => {
  const stem = value.includes('.') ? value.slice(0, value.indexOf('.')) : value;
  return DEVICE_NAMES.has(stem.toUpperCase());
};

export const validateOnlyPreviewEntryName = (value: unknown): OnlyPreviewEntryNameResult => {
  if (typeof value !== 'string') return { ok: false, reason: 'empty' };
  const name = value.trim();
  if (!name) return { ok: false, reason: 'empty' };
  if (name === '.' || name === '..') return { ok: false, reason: 'dot' };
  if (CONTROL_CHARACTERS.test(name)) return { ok: false, reason: 'control-character' };
  if (RESERVED_CHARACTERS.test(name)) return { ok: false, reason: 'reserved-character' };
  // A trailing space cannot survive the leading trim, so only the dot needs its own rule.
  if (name.endsWith('.')) return { ok: false, reason: 'trailing-dot' };
  if (isDeviceName(name)) return { ok: false, reason: 'device-name' };
  if (
    name.length > ONLY_PREVIEW_ENTRY_NAME_MAX_UTF16 ||
    utf8Length(name) > ONLY_PREVIEW_ENTRY_NAME_MAX_BYTES
  ) {
    return { ok: false, reason: 'too-long' };
  }
  return { ok: true, name };
};

export const onlyPreviewUntitledFolderName = (index: number): string =>
  index <= 1
    ? ONLY_PREVIEW_UNTITLED_FOLDER_BASE
    : `${ONLY_PREVIEW_UNTITLED_FOLDER_BASE} ${Math.trunc(index)}`;
