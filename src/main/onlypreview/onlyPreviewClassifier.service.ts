import type { FileHandle } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_MAX_DOCUMENT_BYTES,
  ONLY_PREVIEW_MAX_HTML_BYTES,
  ONLY_PREVIEW_MAX_IMAGE_BYTES,
  ONLY_PREVIEW_MAX_MARKDOWN_BYTES,
  ONLY_PREVIEW_MAX_PDF_BYTES,
  ONLY_PREVIEW_MAX_SHEET_BYTES,
  ONLY_PREVIEW_MAX_TEXT_BYTES,
  type OnlyPreviewDescriptor,
  type OnlyPreviewKind,
  type OnlyPreviewPreviewAdapterId,
  type OnlyPreviewTextContent,
  type OnlyPreviewTextEncoding
} from '@shared/onlypreview/onlyPreview.types';
import {
  onlyPreviewWorkspaceRegistry,
  type OpenedOnlyPreviewFile,
  type OnlyPreviewWorkspaceRegistry
} from './onlyPreviewWorkspace.registry';

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

const PDF_EXTENSIONS = new Set(['.pdf']);
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
const SHEET_EXTENSIONS = new Set(['.xlsx', '.xlsm']);
const DOCUMENT_EXTENSIONS = new Set(['.docx']);

const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.c': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.h': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.css': 'css',
  '.go': 'go',
  '.graphql': 'graphql',
  '.htm': 'html',
  '.html': 'html',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.json5': 'json',
  '.jsx': 'javascript',
  '.less': 'less',
  '.lua': 'lua',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'markdown',
  '.mjs': 'javascript',
  '.mts': 'typescript',
  '.php': 'php',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.sass': 'scss',
  '.scss': 'scss',
  '.sh': 'shell',
  '.sql': 'sql',
  '.swift': 'swift',
  '.toml': 'ini',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.vue': 'html',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.zsh': 'shell'
};

const basenameOf = (relativePath: string): string => basename(relativePath).toLowerCase();

const extensionOf = (relativePath: string): string => {
  const name = basenameOf(relativePath);
  if (name === '.env' || name.startsWith('.env.')) return '.env';
  return extname(name);
};

export const classifyOnlyPreviewExtension = (relativePath: string): OnlyPreviewKind => {
  const name = basenameOf(relativePath);
  const extension = extensionOf(relativePath);
  if (TEXT_EXTENSIONS.has(extension) || KNOWN_TEXT_BASENAMES.has(name)) return 'text';
  if (PDF_EXTENSIONS.has(extension)) return 'pdf';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (SHEET_EXTENSIONS.has(extension)) return 'sheet';
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'document';
  return 'unsupported';
};

const startsWithBytes = (buffer: Uint8Array, expected: readonly number[]): boolean =>
  buffer.length >= expected.length && expected.every((byte, index) => buffer[index] === byte);

const asciiAt = (buffer: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...buffer.slice(start, start + length));

const matchesSignature = (extension: string, sample: Uint8Array): boolean => {
  if (extension === '.pdf') return asciiAt(sample, 0, 5) === '%PDF-';
  if (extension === '.png')
    return startsWithBytes(sample, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (extension === '.jpg' || extension === '.jpeg')
    return startsWithBytes(sample, [0xff, 0xd8, 0xff]);
  if (extension === '.gif') return ['GIF87a', 'GIF89a'].includes(asciiAt(sample, 0, 6));
  if (extension === '.webp')
    return asciiAt(sample, 0, 4) === 'RIFF' && asciiAt(sample, 8, 4) === 'WEBP';
  if (extension === '.avif') {
    const brands = asciiAt(sample, 8, Math.min(32, Math.max(0, sample.length - 8)));
    return asciiAt(sample, 4, 4) === 'ftyp' && /avi[fs]/.test(brands);
  }
  if (extension === '.bmp') return asciiAt(sample, 0, 2) === 'BM';
  if (extension === '.ico') return startsWithBytes(sample, [0x00, 0x00, 0x01, 0x00]);
  if (extension === '.svg') {
    const source = new TextDecoder('utf-8')
      .decode(sample)
      .replace(/^\uFEFF/, '')
      .trimStart();
    return /^(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(source);
  }
  if (extension === '.mp3') {
    return asciiAt(sample, 0, 3) === 'ID3' || (sample[0] === 0xff && (sample[1] & 0xe0) === 0xe0);
  }
  if (extension === '.wav')
    return asciiAt(sample, 0, 4) === 'RIFF' && asciiAt(sample, 8, 4) === 'WAVE';
  if (extension === '.ogg' || extension === '.ogv') return asciiAt(sample, 0, 4) === 'OggS';
  if (extension === '.flac') return asciiAt(sample, 0, 4) === 'fLaC';
  if (extension === '.aac') {
    return (sample[0] === 0xff && (sample[1] & 0xf6) === 0xf0) || asciiAt(sample, 4, 4) === 'ftyp';
  }
  if (
    extension === '.m4a' ||
    extension === '.mp4' ||
    extension === '.mov' ||
    extension === '.m4v'
  ) {
    return asciiAt(sample, 4, 4) === 'ftyp';
  }
  if (extension === '.webm') return startsWithBytes(sample, [0x1a, 0x45, 0xdf, 0xa3]);
  if (SHEET_EXTENSIONS.has(extension) || DOCUMENT_EXTENSIONS.has(extension)) {
    return startsWithBytes(sample, [0x50, 0x4b, 0x03, 0x04]);
  }
  return false;
};

const signatureBytesFor = (extension: string): number => {
  if (extension === '.svg') return 512;
  if (extension === '.avif') return 40;
  return 16;
};

const readBounded = async (handle: FileHandle, byteLimit: number): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset < byteLimit) {
    const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, byteLimit - offset));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead));
    offset += bytesRead;
  }
  return Buffer.concat(chunks, offset);
};

const decodeOnlyPreviewText = (
  buffer: Uint8Array
): { text: string; encoding: OnlyPreviewTextEncoding } => {
  if (startsWithBytes(buffer, [0xff, 0xfe])) {
    return {
      text: new TextDecoder('utf-16le').decode(buffer.subarray(2)),
      encoding: 'utf-16le'
    };
  }
  if (startsWithBytes(buffer, [0xfe, 0xff])) {
    return {
      text: new TextDecoder('utf-16be').decode(buffer.subarray(2)),
      encoding: 'utf-16be'
    };
  }
  const payload = startsWithBytes(buffer, [0xef, 0xbb, 0xbf]) ? buffer.subarray(3) : buffer;
  return { text: new TextDecoder('utf-8').decode(payload), encoding: 'utf-8' };
};

const byteLimitForDescriptor = (relativePath: string, kind: OnlyPreviewKind): number | null => {
  const extension = extensionOf(relativePath);
  if (kind === 'text') {
    if (extension === '.md') return ONLY_PREVIEW_MAX_MARKDOWN_BYTES;
    if (extension === '.html' || extension === '.htm') return ONLY_PREVIEW_MAX_HTML_BYTES;
    return ONLY_PREVIEW_MAX_TEXT_BYTES;
  }
  if (kind === 'pdf') return ONLY_PREVIEW_MAX_PDF_BYTES;
  if (kind === 'image') return ONLY_PREVIEW_MAX_IMAGE_BYTES;
  if (kind === 'sheet') return ONLY_PREVIEW_MAX_SHEET_BYTES;
  if (kind === 'document') return ONLY_PREVIEW_MAX_DOCUMENT_BYTES;
  return null;
};

const textAdapterFor = (
  relativePath: string
): Extract<OnlyPreviewPreviewAdapterId, 'monaco' | 'markdown-dom'> | null => {
  const extension = extensionOf(relativePath);
  if (extension === '.html' || extension === '.htm') return null;
  return extension === '.md' ? 'markdown-dom' : 'monaco';
};

export class OnlyPreviewClassifierService {
  constructor(private readonly workspaces: OnlyPreviewWorkspaceRegistry) {}

  async describe(file: OpenedOnlyPreviewFile): Promise<OnlyPreviewDescriptor> {
    const extension = extensionOf(file.relativePath);
    const kind = classifyOnlyPreviewExtension(file.relativePath);
    const descriptor: OnlyPreviewDescriptor = {
      workspaceId: file.workspace.workspaceId,
      relativePath: file.relativePath,
      name: basename(file.relativePath),
      displayPath: file.realPath,
      extension,
      kind,
      mimeType:
        MIME_BY_EXTENSION[extension] ??
        (kind === 'text' ? 'text/plain; charset=utf-8' : 'application/octet-stream'),
      language: kind === 'text' ? (LANGUAGE_BY_EXTENSION[extension] ?? 'plaintext') : '',
      size: file.size,
      modifiedAt: file.modifiedAt
    };

    const byteLimit = byteLimitForDescriptor(file.relativePath, kind);
    if (byteLimit !== null && file.size > byteLimit) {
      descriptor.previewError = {
        code: 'TEXT_TOO_LARGE',
        message: `Preview is limited to ${byteLimit} bytes for this format.`
      };
      return descriptor;
    }
    if (kind === 'unsupported' || kind === 'text') return descriptor;

    const sample = await readBounded(file.fileHandle, signatureBytesFor(extension));
    await this.workspaces.assertOpenedFileCurrent(file);
    if (!matchesSignature(extension, sample)) {
      descriptor.previewError = {
        code: 'SIGNATURE_MISMATCH',
        message: 'The file signature does not match its extension.'
      };
    }
    return descriptor;
  }

  async readText(
    file: OpenedOnlyPreviewFile,
    adapterId: Extract<OnlyPreviewPreviewAdapterId, 'monaco' | 'markdown-dom'>
  ): Promise<OnlyPreviewTextContent> {
    const expectedAdapter = textAdapterFor(file.relativePath);
    if (
      expectedAdapter !== adapterId ||
      classifyOnlyPreviewExtension(file.relativePath) !== 'text'
    ) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'The selected file does not belong to this text adapter.'
      );
    }
    const byteLimit =
      adapterId === 'markdown-dom' ? ONLY_PREVIEW_MAX_MARKDOWN_BYTES : ONLY_PREVIEW_MAX_TEXT_BYTES;
    if (file.size > byteLimit) {
      throw new OnlyPreviewContractError(
        'TEXT_TOO_LARGE',
        `Text preview is limited to ${byteLimit} bytes.`
      );
    }
    const buffer = await readBounded(file.fileHandle, byteLimit + 1);
    if (buffer.length > byteLimit) {
      throw new OnlyPreviewContractError(
        'TEXT_TOO_LARGE',
        `Text preview is limited to ${byteLimit} bytes.`
      );
    }
    await this.workspaces.assertOpenedFileCurrent(file);
    const decoded = decodeOnlyPreviewText(buffer);
    return {
      workspaceId: file.workspace.workspaceId,
      relativePath: file.relativePath,
      text: decoded.text,
      encoding: decoded.encoding,
      size: buffer.length
    };
  }
}

export const onlyPreviewClassifierService = new OnlyPreviewClassifierService(
  onlyPreviewWorkspaceRegistry
);
