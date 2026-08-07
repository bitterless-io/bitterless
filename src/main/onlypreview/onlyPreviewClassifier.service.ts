import type { FileHandle } from 'node:fs/promises';
import { extname } from 'node:path';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_MAX_TEXT_BYTES,
  type OnlyPreviewDescriptor,
  type OnlyPreviewKind,
  type OnlyPreviewTextContent,
  type OnlyPreviewTextEncoding
} from '@shared/onlypreview/onlyPreview.types';
import type { OpenedOnlyPreviewFile } from './onlyPreviewWorkspace.registry';
import {
  onlyPreviewAssetRegistry,
  type OnlyPreviewAssetRegistry
} from './onlyPreviewAsset.registry';

const SAMPLE_BYTES = 8_192;

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
  '.m4v': 'video/x-m4v'
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

const extensionOf = (relativePath: string): string => {
  const name = relativePath.split('/').at(-1)?.toLowerCase() ?? '';
  if (name === '.env' || name.startsWith('.env.')) return '.env';
  return extname(relativePath).toLowerCase();
};

export const classifyOnlyPreviewExtension = (relativePath: string): OnlyPreviewKind => {
  const extension = extensionOf(relativePath);
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  if (PDF_EXTENSIONS.has(extension)) return 'pdf';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return 'unsupported';
};

export const isProbablyOnlyPreviewText = (buffer: Uint8Array): boolean => {
  if (buffer.length === 0) return true;
  if (
    buffer.length >= 2 &&
    ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff))
  )
    return true;
  let controlBytes = 0;
  for (const byte of buffer) {
    if (byte === 0) return false;
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13) {
      controlBytes += 1;
    }
  }
  return controlBytes / buffer.length <= 0.1;
};

const startsWithBytes = (buffer: Uint8Array, expected: readonly number[]): boolean =>
  expected.every((byte, index) => buffer[index] === byte);

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
  return true;
};

const readBounded = async (handle: FileHandle, byteLimit: number): Promise<Buffer> => {
  const buffer = Buffer.alloc(byteLimit);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return buffer.subarray(0, offset);
};

const decodeUtf16 = (buffer: Uint8Array, bigEndian: boolean): string => {
  const payload = buffer.subarray(2);
  if (payload.length % 2 !== 0) {
    throw new OnlyPreviewContractError(
      'INVALID_ENCODING',
      'UTF-16 text has an incomplete code unit.'
    );
  }
  const normalized = bigEndian ? Uint8Array.from(payload) : payload;
  if (bigEndian) {
    for (let index = 0; index < normalized.length; index += 2) {
      const left = normalized[index];
      normalized[index] = normalized[index + 1];
      normalized[index + 1] = left;
    }
  }
  return new TextDecoder('utf-16le', { fatal: true }).decode(normalized);
};

export class OnlyPreviewClassifierService {
  constructor(private readonly assets: OnlyPreviewAssetRegistry) {}

  async describe(file: OpenedOnlyPreviewFile): Promise<OnlyPreviewDescriptor> {
    const extension = extensionOf(file.relativePath);
    const sample = await readBounded(file.fileHandle, SAMPLE_BYTES);
    let kind = classifyOnlyPreviewExtension(file.relativePath);
    if (kind === 'unsupported' && isProbablyOnlyPreviewText(sample)) kind = 'text';
    if (kind === 'text' && !isProbablyOnlyPreviewText(sample)) kind = 'unsupported';

    const mimeType =
      MIME_BY_EXTENSION[extension] ?? (kind === 'text' ? 'text/plain' : 'application/octet-stream');
    const signatureMatches =
      kind === 'unsupported' || kind === 'text' ? true : matchesSignature(extension, sample);
    const descriptor: OnlyPreviewDescriptor = {
      workspaceId: file.workspace.workspaceId,
      relativePath: file.relativePath,
      name: file.relativePath.split('/').at(-1) ?? file.relativePath,
      displayPath: file.realPath,
      extension,
      kind,
      mimeType,
      language: kind === 'text' ? (LANGUAGE_BY_EXTENSION[extension] ?? 'plaintext') : '',
      size: file.size,
      modifiedAt: file.modifiedAt
    };
    if (!signatureMatches) {
      descriptor.previewError = {
        code: 'SIGNATURE_MISMATCH',
        message: 'The file signature does not match its extension.'
      };
      return descriptor;
    }
    if (kind === 'pdf' || kind === 'image' || kind === 'audio' || kind === 'video') {
      descriptor.assetUrl = this.assets.issue(file, mimeType);
    }
    return descriptor;
  }

  async readText(file: OpenedOnlyPreviewFile): Promise<OnlyPreviewTextContent> {
    if (file.size > ONLY_PREVIEW_MAX_TEXT_BYTES) {
      throw new OnlyPreviewContractError(
        'TEXT_TOO_LARGE',
        `Text preview is limited to ${ONLY_PREVIEW_MAX_TEXT_BYTES / 1024 / 1024} MiB.`
      );
    }
    const buffer = await readBounded(file.fileHandle, ONLY_PREVIEW_MAX_TEXT_BYTES + 1);
    if (buffer.length > ONLY_PREVIEW_MAX_TEXT_BYTES) {
      throw new OnlyPreviewContractError(
        'TEXT_TOO_LARGE',
        `Text preview is limited to ${ONLY_PREVIEW_MAX_TEXT_BYTES / 1024 / 1024} MiB.`
      );
    }
    let encoding: OnlyPreviewTextEncoding = 'utf-8';
    let text: string;
    try {
      if (startsWithBytes(buffer, [0xff, 0xfe])) {
        encoding = 'utf-16le';
        text = decodeUtf16(buffer, false);
      } else if (startsWithBytes(buffer, [0xfe, 0xff])) {
        encoding = 'utf-16be';
        text = decodeUtf16(buffer, true);
      } else {
        const payload = startsWithBytes(buffer, [0xef, 0xbb, 0xbf]) ? buffer.subarray(3) : buffer;
        if (!isProbablyOnlyPreviewText(payload)) {
          throw new OnlyPreviewContractError('BINARY_TEXT', 'This file contains binary data.');
        }
        text = new TextDecoder('utf-8', { fatal: true }).decode(payload);
      }
    } catch (error) {
      if (error instanceof OnlyPreviewContractError) throw error;
      throw new OnlyPreviewContractError('INVALID_ENCODING', 'The text encoding is not supported.');
    }
    return {
      workspaceId: file.workspace.workspaceId,
      relativePath: file.relativePath,
      text,
      encoding,
      size: buffer.length
    };
  }
}

export const onlyPreviewClassifierService = new OnlyPreviewClassifierService(
  onlyPreviewAssetRegistry
);
