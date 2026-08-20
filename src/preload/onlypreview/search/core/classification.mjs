import { extname } from 'node:path';

import { MAX_TEXT_BYTES, SENSITIVE_FILE_PATTERNS } from './constants.mjs';
import { filenameFromPath } from './normalization.mjs';

const READ_CHUNK_BYTES = 64 * 1024;

const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cfg',
  '.conf',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.env',
  '.go',
  '.graphql',
  '.h',
  '.hpp',
  '.htm',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.json5',
  '.jsx',
  '.less',
  '.log',
  '.lua',
  '.markdown',
  '.md',
  '.mdx',
  '.mjs',
  '.mts',
  '.php',
  '.properties',
  '.py',
  '.rb',
  '.rs',
  '.sass',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh'
]);
const KNOWN_TEXT_BASENAMES = new Set([
  'dockerfile',
  'containerfile',
  'makefile',
  'rakefile',
  'gemfile',
  'procfile',
  'readme',
  'license',
  'notice',
  'changelog',
  'authors',
  'codeowners',
  '.gitignore',
  '.gitattributes',
  '.gitmodules',
  '.dockerignore',
  '.editorconfig',
  '.npmrc',
  '.yarnrc',
  '.prettierrc',
  '.eslintrc',
  '.stylelintrc',
  '.babelrc'
]);
const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.ico',
  '.svg'
]);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogv', '.mov', '.m4v']);

const extensionOf = (relativePath) => {
  const fileName = filenameFromPath(relativePath).toLocaleLowerCase('und');
  if (fileName === '.env' || fileName.startsWith('.env.')) return '.env';
  return extname(fileName);
};

const basenameOf = (relativePath) => filenameFromPath(relativePath).toLocaleLowerCase('und');

export const isSensitiveSearchFile = (relativePath) => {
  const fileName = filenameFromPath(relativePath);
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
};

export const classifySearchMediaType = (relativePath) => {
  const extension = extensionOf(relativePath);
  if (TEXT_EXTENSIONS.has(extension) || KNOWN_TEXT_BASENAMES.has(basenameOf(relativePath))) {
    return 'text';
  }
  if (extension === '.pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return 'unknown';
};

export const mediaTypeToPreviewHint = (mediaType) =>
  mediaType === 'unknown' ? 'unsupported' : mediaType;

const startsWithBytes = (buffer, expected) =>
  buffer.length >= expected.length && expected.every((byte, index) => buffer[index] === byte);

export const decodeSearchText = (buffer) => {
  if (startsWithBytes(buffer, [0xff, 0xfe])) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  }
  if (startsWithBytes(buffer, [0xfe, 0xff])) {
    return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  }
  const payload = startsWithBytes(buffer, [0xef, 0xbb, 0xbf]) ? buffer.subarray(3) : buffer;
  return new TextDecoder('utf-8').decode(payload);
};

export const readBoundedFromHandle = async (handle, byteLimit) => {
  const chunks = [];
  let offset = 0;
  while (offset < byteLimit) {
    const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, byteLimit - offset));
    const read = await handle.read(chunk, 0, chunk.length, offset);
    if (read.bytesRead === 0) break;
    chunks.push(chunk.subarray(0, read.bytesRead));
    offset += read.bytesRead;
  }
  return Buffer.concat(chunks, offset);
};

const numericStatValue = (value) => (typeof value === 'bigint' ? Number(value) : value);

const sameOpenedIdentity = (left, right) =>
  right.isFile() &&
  left.dev === right.dev &&
  left.ino === right.ino &&
  numericStatValue(left.size) === numericStatValue(right.size) &&
  numericStatValue(left.mtimeMs) === numericStatValue(right.mtimeMs);

const metadataOnly = (mediaType, changed = false) => ({
  mediaType,
  contentIndexed: false,
  originalContent: '',
  ...(changed ? { changed: true } : {})
});

export const readClassifiedSearchContent = async ({ handle, relativePath, openedStat }) => {
  const mediaType = classifySearchMediaType(relativePath);
  if (mediaType !== 'text') return metadataOnly(mediaType);
  const size = numericStatValue(openedStat.size);
  if (
    !Number.isSafeInteger(size) ||
    size < 0 ||
    size > MAX_TEXT_BYTES ||
    isSensitiveSearchFile(relativePath)
  ) {
    return metadataOnly(mediaType);
  }
  const buffer = await readBoundedFromHandle(handle, MAX_TEXT_BYTES + 1);
  if (buffer.length > MAX_TEXT_BYTES) return metadataOnly(mediaType, true);
  const afterStat = await handle.stat();
  if (!sameOpenedIdentity(openedStat, afterStat)) return metadataOnly(mediaType, true);
  return {
    mediaType,
    contentIndexed: true,
    originalContent: decodeSearchText(buffer)
  };
};
