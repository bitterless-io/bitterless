import { basename, extname } from 'node:path';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_MAX_MARKDOWN_BYTES,
  ONLY_PREVIEW_MAX_TEXT_BYTES,
  getOnlyPreviewFileSizeLimit,
  type OnlyPreviewDescriptor,
  type OnlyPreviewKind,
  type OnlyPreviewPreviewAdapterId,
  type OnlyPreviewTextContent,
  type OnlyPreviewTextEncoding
} from '@shared/onlypreview/onlyPreview.types';

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
const UNSUPPORTED_IMAGE_EXTENSIONS = new Set(['.heic', '.heif', '.tif', '.tiff', '.raw']);
const UNSUPPORTED_VIDEO_EXTENSIONS = new Set(['.mkv', '.avi', '.wmv', '.flv']);
const UNSUPPORTED_LEGACY_OFFICE_EXTENSIONS = new Set(['.doc', '.xls', '.ppt']);
const SHEET_EXTENSIONS = new Set(['.xlsx', '.xlsm']);
const DOCUMENT_EXTENSIONS = new Set(['.docx']);
const PRESENTATION_EXTENSIONS = new Set(['.pptx']);
const DIAGRAM_EXTENSIONS = new Set(['.drawio']);

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
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.drawio': 'application/vnd.jgraph.mxfile'
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
  '.cjs': 'javascript',
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
  if (PRESENTATION_EXTENSIONS.has(extension)) return 'presentation';
  if (DIAGRAM_EXTENSIONS.has(extension)) return 'diagram';
  if (
    UNSUPPORTED_IMAGE_EXTENSIONS.has(extension) ||
    UNSUPPORTED_VIDEO_EXTENSIONS.has(extension) ||
    UNSUPPORTED_LEGACY_OFFICE_EXTENSIONS.has(extension)
  ) {
    return 'unsupported';
  }
  return 'text';
};

const startsWithBytes = (buffer: Uint8Array, expected: readonly number[]): boolean =>
  buffer.length >= expected.length && expected.every((byte, index) => buffer[index] === byte);

const asciiAt = (buffer: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...buffer.slice(start, start + length));

const skipSvgDoctype = (source: string, start: number): number => {
  let quote = '';
  let subsetDepth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '[') {
      subsetDepth += 1;
    } else if (character === ']') {
      subsetDepth = Math.max(0, subsetDepth - 1);
    } else if (character === '>' && subsetDepth === 0) {
      return index + 1;
    }
  }
  return -1;
};

const hasSvgRoot = (sample: Uint8Array): boolean => {
  const source = new TextDecoder('utf-8').decode(sample).replace(/^\uFEFF/, '');
  let offset = 0;
  const skipWhitespace = (): void => {
    while (/\s/u.test(source[offset] ?? '')) offset += 1;
  };
  skipWhitespace();
  while (offset < source.length) {
    if (source.startsWith('<?xml', offset)) {
      const end = source.indexOf('?>', offset + 5);
      if (end < 0) return false;
      offset = end + 2;
    } else if (source.startsWith('<!--', offset)) {
      const end = source.indexOf('-->', offset + 4);
      if (end < 0) return false;
      offset = end + 3;
    } else if (/^<!doctype\b/iu.test(source.slice(offset))) {
      const end = skipSvgDoctype(source, offset + 9);
      if (end < 0) return false;
      offset = end;
    } else {
      break;
    }
    skipWhitespace();
  }
  return /^<svg(?:\s|>)/iu.test(source.slice(offset));
};

const hasPlausibleMediaAtom = (sample: Uint8Array, acceptedTypes: ReadonlySet<string>): boolean => {
  if (sample.length < 8 || !acceptedTypes.has(asciiAt(sample, 4, 4))) return false;
  const view = new DataView(sample.buffer, sample.byteOffset, sample.byteLength);
  const atomSize = view.getUint32(0);
  if (atomSize === 1) return sample.length >= 16 && view.getBigUint64(8) >= 16n;
  return atomSize === 0 || atomSize >= 8;
};

const QUICKTIME_FIRST_ATOMS = new Set(['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip']);

export const matchesOnlyPreviewSignature = (
  extension: string,
  sample: Uint8Array
): boolean => {
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
  if (extension === '.svg') return hasSvgRoot(sample);
  if (extension === '.mp3') {
    return asciiAt(sample, 0, 3) === 'ID3' || (sample[0] === 0xff && (sample[1] & 0xe0) === 0xe0);
  }
  if (extension === '.wav')
    return asciiAt(sample, 0, 4) === 'RIFF' && asciiAt(sample, 8, 4) === 'WAVE';
  if (extension === '.ogg' || extension === '.ogv') return asciiAt(sample, 0, 4) === 'OggS';
  if (extension === '.flac') return asciiAt(sample, 0, 4) === 'fLaC';
  if (extension === '.aac') {
    return (
      (sample[0] === 0xff && (sample[1] & 0xf6) === 0xf0) ||
      asciiAt(sample, 0, 4) === 'ADIF' ||
      asciiAt(sample, 4, 4) === 'ftyp'
    );
  }
  if (extension === '.mov') return hasPlausibleMediaAtom(sample, QUICKTIME_FIRST_ATOMS);
  if (extension === '.m4a' || extension === '.mp4' || extension === '.m4v') {
    return asciiAt(sample, 4, 4) === 'ftyp';
  }
  if (extension === '.webm') return startsWithBytes(sample, [0x1a, 0x45, 0xdf, 0xa3]);
  if (
    SHEET_EXTENSIONS.has(extension) ||
    DOCUMENT_EXTENSIONS.has(extension) ||
    PRESENTATION_EXTENSIONS.has(extension)
  ) {
    return startsWithBytes(sample, [0x50, 0x4b, 0x03, 0x04]);
  }
  return false;
};

export const getOnlyPreviewSignatureBytes = (extension: string): number => {
  if (extension === '.svg') return 512;
  if (extension === '.avif') return 40;
  return 16;
};

export const decodeOnlyPreviewText = (
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

const adapterForClassification = (
  relativePath: string,
  kind: OnlyPreviewKind
): OnlyPreviewPreviewAdapterId => {
  const extension = extensionOf(relativePath);
  if (kind === 'text') {
    if (extension === '.md') return 'markdown-dom';
    if (extension === '.html' || extension === '.htm') return 'html-page';
    return 'monaco';
  }
  if (kind === 'pdf') return 'chromium-pdf';
  if (kind === 'image') return 'image';
  if (kind === 'audio') return 'audio';
  if (kind === 'video') return 'video';
  if (kind === 'sheet') return 'ooxml-xlsx';
  if (kind === 'document') return 'ooxml-docx';
  if (kind === 'presentation') return 'ooxml-pptx';
  if (kind === 'diagram') return 'drawio-viewer';
  return 'unsupported';
};

export const getOnlyPreviewTextAdapter = (
  relativePath: string
): Extract<OnlyPreviewPreviewAdapterId, 'monaco' | 'markdown-dom'> | null => {
  const extension = extensionOf(relativePath);
  if (extension === '.html' || extension === '.htm') return null;
  return extension === '.md' ? 'markdown-dom' : 'monaco';
};

export interface OnlyPreviewPreparedFileMetadata {
  workspaceId: string;
  relativePath: string;
  size: number;
  modifiedAt: number;
}

export class OnlyPreviewClassifierService {
  describe(file: OnlyPreviewPreparedFileMetadata, sample?: Uint8Array): OnlyPreviewDescriptor {
    const extension = extensionOf(file.relativePath);
    const kind = classifyOnlyPreviewExtension(file.relativePath);
    const descriptor: OnlyPreviewDescriptor = {
      workspaceId: file.workspaceId,
      relativePath: file.relativePath,
      name: basename(file.relativePath),
      extension,
      kind,
      mimeType:
        MIME_BY_EXTENSION[extension] ??
        (kind === 'text' ? 'text/plain; charset=utf-8' : 'application/octet-stream'),
      language: kind === 'text' ? (LANGUAGE_BY_EXTENSION[extension] ?? 'plaintext') : '',
      size: file.size,
      modifiedAt: file.modifiedAt
    };

    if (UNSUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
      descriptor.unsupportedCategory = 'image-format';
    } else if (UNSUPPORTED_VIDEO_EXTENSIONS.has(extension)) {
      descriptor.unsupportedCategory = 'video-container';
    }

    const adapterId = adapterForClassification(file.relativePath, kind);
    const byteLimit = adapterId === 'unsupported' ? null : getOnlyPreviewFileSizeLimit(adapterId);
    if (byteLimit !== null && file.size > byteLimit) {
      descriptor.previewError = {
        code: 'TEXT_TOO_LARGE',
        message: `Preview is limited to ${byteLimit} bytes for this format.`
      };
      return descriptor;
    }
    if (kind === 'unsupported' || kind === 'text') return descriptor;
    if (file.size === 0 && kind === 'image') {
      descriptor.previewError = {
        code: 'IMAGE_EMPTY',
        message: 'The selected image is empty.'
      };
      return descriptor;
    }
    if (file.size === 0 && (kind === 'audio' || kind === 'video')) {
      descriptor.previewError = {
        code: 'MEDIA_EMPTY',
        message: 'The selected media file is empty.'
      };
      return descriptor;
    }
    if (file.size === 0 && kind === 'diagram') {
      descriptor.previewError = {
        code: 'DIAGRAM_EMPTY',
        message: 'The selected diagram is empty.'
      };
      return descriptor;
    }
    if (kind === 'diagram') return descriptor;
    if (kind === 'sheet' || kind === 'document' || kind === 'presentation') return descriptor;

    if (!sample) return descriptor;
    if (!matchesOnlyPreviewSignature(extension, sample)) {
      descriptor.previewError = {
        code: 'SIGNATURE_MISMATCH',
        message: 'The file signature does not match its extension.'
      };
    }
    return descriptor;
  }

  decodeText(
    file: OnlyPreviewPreparedFileMetadata,
    adapterId: Extract<OnlyPreviewPreviewAdapterId, 'monaco' | 'markdown-dom'>,
    buffer: Uint8Array
  ): OnlyPreviewTextContent {
    const expectedAdapter = getOnlyPreviewTextAdapter(file.relativePath);
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
    if (buffer.byteLength !== file.size) {
      throw new OnlyPreviewContractError(
        'PATH_NOT_FOUND',
        'The selected text file changed while it was being read.'
      );
    }
    const decoded = decodeOnlyPreviewText(buffer);
    return {
      workspaceId: file.workspaceId,
      relativePath: file.relativePath,
      text: decoded.text,
      encoding: decoded.encoding,
      size: buffer.length
    };
  }
}

export const onlyPreviewClassifierService = new OnlyPreviewClassifierService();
