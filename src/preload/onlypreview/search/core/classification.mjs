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
  '.cjs',
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
const METADATA_ONLY_EXTENSIONS = new Set([
  '.xlsx',
  '.xlsm',
  '.docx',
  '.pptx',
  '.drawio',
  '.doc',
  '.xls',
  '.ppt',
  '.heic',
  '.heif',
  '.tif',
  '.tiff',
  '.raw',
  '.mkv',
  '.avi',
  '.wmv',
  '.flv'
]);

/**
 * 压缩包与二进制:只进元数据,内容一律不读。
 *
 * `classifySearchMediaType` 的兜底是 `return 'text'` —— 扩展名不认识就当文本读。那条兜底对
 * **没列进 TEXT_EXTENSIONS 的源码扩展名**是对的(新语言不必改表就能被索引),对压缩包和二进制
 * 却是灾难:一个 900 KB 的 `.rar` 会被整份读进来、按 UTF-8 解码成一串 U+FFFD、再切块送进
 * trigram 与中日韩倒排。`decodeSearchText` 不做任何二进制嗅探,所以在这一步之前没有一层会拦住它。
 *
 * 唯一拦住过它们的是体积:`MAX_TEXT_BYTES`(1 MiB)。也就是说**大的二进制侥幸躲掉了,小的全进了
 * 索引** —— 而小的恰恰是最多的那一类(`.pyc` / `.class` / `.o` / `.node` / 图标 / 字体)。
 * Ral 2026-09-23:「所有的压缩包类型、二进制类型的文件后缀都应该被排除索引」。
 *
 * 只挡**确定**是二进制的扩展名。像 `.gltf`(JSON)、`.svg`(XML)这类看着像二进制、实际是文本的
 * 一律不进这张表 —— 错杀一个文本扩展名,是让它从此搜不到。
 */
export const ARCHIVE_EXTENSIONS = new Set([
  '.zip', '.rar', '.7z', '.gz', '.tgz', '.bz2', '.tbz', '.tbz2', '.xz', '.txz',
  '.lz', '.lzma', '.zst', '.tzst', '.tar', '.z', '.cab', '.arj', '.lzh',
  '.iso', '.dmg', '.pkg', '.msi', '.appx', '.deb', '.rpm',
  '.jar', '.war', '.ear', '.apk', '.aab', '.ipa', '.crx', '.xpi', '.nupkg', '.whl', '.gem',
  '.asar'
]);

export const BINARY_EXTENSIONS = new Set([
  // 可执行、库与目标文件
  '.exe', '.dll', '.so', '.dylib', '.a', '.lib', '.o', '.obj', '.bin', '.elf',
  '.node', '.wasm', '.class', '.pyc', '.pyo', '.pyd', '.pdb', '.ilk', '.exp',
  // 数据库与包索引
  '.db', '.db3', '.sqlite', '.sqlite3', '.mdb', '.accdb', '.realm', '.idx', '.pack',
  // 字体
  '.ttf', '.otf', '.ttc', '.woff', '.woff2', '.eot',
  // 设计稿与三维(`.gltf` 是 JSON,故意不在此)
  '.psd', '.ai', '.sketch', '.fig', '.blend', '.fbx', '.glb',
  // 磁盘映像、转储与其它大块二进制
  '.dat', '.dump', '.img', '.vmdk', '.qcow2', '.swp', '.pak', '.bak'
]);

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
  if (METADATA_ONLY_EXTENSIONS.has(extension)) return 'unknown';
  // 兜底之前先挡确定的二进制 —— 兜底是 'text',会让它们被当文本读进索引。
  if (ARCHIVE_EXTENSIONS.has(extension) || BINARY_EXTENSIONS.has(extension)) return 'unknown';
  return 'text';
};

export const mediaTypeToPreviewHint = (mediaType, relativePath = '') => {
  if (mediaType !== 'unknown') return mediaType;
  const extension = extensionOf(relativePath);
  if (extension === '.xlsx' || extension === '.xlsm') return 'sheet';
  if (extension === '.docx') return 'document';
  if (extension === '.pptx') return 'presentation';
  if (extension === '.drawio') return 'diagram';
  return 'unsupported';
};

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
  const buffer = await readBoundedFromHandle(handle, MAX_TEXT_BYTES);
  const afterStat = await handle.stat();
  if (!sameOpenedIdentity(openedStat, afterStat)) return metadataOnly(mediaType, true);
  return {
    mediaType,
    contentIndexed: true,
    originalContent: decodeSearchText(buffer)
  };
};
