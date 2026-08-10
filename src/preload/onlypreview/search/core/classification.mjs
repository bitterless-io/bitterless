import { extname } from 'node:path';

import { MAX_TEXT_BYTES, SENSITIVE_FILE_PATTERNS } from './constants.mjs';
import { filenameFromPath } from './normalization.mjs';

const SAMPLE_BYTES = 8192;

const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cfg', '.conf', '.cpp', '.cs', '.css', '.csv', '.env', '.go',
  '.graphql', '.h', '.hpp', '.htm', '.html', '.ini', '.java', '.js', '.json',
  '.json5', '.jsx', '.less', '.log', '.lua', '.md', '.mdx', '.mjs', '.mts',
  '.php', '.properties', '.py', '.rb', '.rs', '.sass', '.scss', '.sh', '.sql',
  '.svelte', '.swift', '.toml', '.ts', '.tsx', '.txt', '.vue', '.xml', '.yaml',
  '.yml', '.zsh',
]);
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.ico', '.svg',
]);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogv', '.mov', '.m4v']);

const extensionOf = (relativePath) => {
  const fileName = filenameFromPath(relativePath).toLocaleLowerCase('und');
  if (fileName === '.env' || fileName.startsWith('.env.')) return '.env';
  return extname(fileName);
};

export const isSensitiveSearchFile = (relativePath) => {
  const fileName = filenameFromPath(relativePath);
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
};

export const classifySearchMediaType = (relativePath) => {
  const extension = extensionOf(relativePath);
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  if (extension === '.pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return 'unknown';
};

export const mediaTypeToPreviewHint = (mediaType) =>
  mediaType === 'unknown' ? 'unsupported' : mediaType;

export const isProbablyText = (buffer) => {
  if (buffer.length === 0) return true;
  if (buffer.length >= 2 &&
      ((buffer[0] === 0xff && buffer[1] === 0xfe) ||
       (buffer[0] === 0xfe && buffer[1] === 0xff))) return true;
  let controlBytes = 0;
  const length = Math.min(buffer.length, SAMPLE_BYTES);
  for (let index = 0; index < length; index += 1) {
    const byte = buffer[index];
    if (byte === 0) return false;
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13) {
      controlBytes += 1;
    }
  }
  return controlBytes / length <= 0.1;
};

const startsWithBytes = (buffer, expected) =>
  expected.every((byte, index) => buffer[index] === byte);

const decodeUtf16 = (buffer, bigEndian) => {
  const payload = buffer.subarray(2);
  if (payload.length % 2 !== 0) throw new TypeError('Incomplete UTF-16 code unit');
  const normalized = Uint8Array.from(payload);
  if (bigEndian) {
    for (let index = 0; index < normalized.length; index += 2) {
      const left = normalized[index];
      normalized[index] = normalized[index + 1];
      normalized[index + 1] = left;
    }
  }
  return new TextDecoder('utf-16le', { fatal: true }).decode(normalized);
};

export const decodeSearchText = (buffer) => {
  if (startsWithBytes(buffer, [0xff, 0xfe])) return decodeUtf16(buffer, false);
  if (startsWithBytes(buffer, [0xfe, 0xff])) return decodeUtf16(buffer, true);
  const payload = startsWithBytes(buffer, [0xef, 0xbb, 0xbf]) ? buffer.subarray(3) : buffer;
  if (!isProbablyText(payload)) throw new TypeError('Binary content');
  return new TextDecoder('utf-8', { fatal: true }).decode(payload);
};

export const readBoundedFromHandle = async (handle, byteLimit) => {
  const buffer = Buffer.alloc(byteLimit);
  let offset = 0;
  while (offset < byteLimit) {
    const read = await handle.read(buffer, offset, byteLimit - offset, offset);
    if (read.bytesRead === 0) break;
    offset += read.bytesRead;
  }
  return buffer.subarray(0, offset);
};

export const readClassifiedSearchContent = async ({ handle, relativePath, size }) => {
  let mediaType = classifySearchMediaType(relativePath);
  if (mediaType !== 'text' && mediaType !== 'unknown') {
    return { mediaType, contentIndexed: false, originalContent: '' };
  }
  if (size > MAX_TEXT_BYTES || isSensitiveSearchFile(relativePath)) {
    return { mediaType, contentIndexed: false, originalContent: '' };
  }
  const buffer = await readBoundedFromHandle(handle, MAX_TEXT_BYTES + 1);
  if (buffer.length > MAX_TEXT_BYTES) {
    return { mediaType, contentIndexed: false, originalContent: '' };
  }
  try {
    const originalContent = decodeSearchText(buffer);
    mediaType = 'text';
    return { mediaType, contentIndexed: true, originalContent };
  } catch {
    return { mediaType: 'unknown', contentIndexed: false, originalContent: '' };
  }
};
