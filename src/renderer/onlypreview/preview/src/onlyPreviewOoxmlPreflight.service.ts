import { createOnlyPreviewWorksheetMergeScanner } from './onlyPreviewOoxmlMergeScanner.service';
import {
  ONLY_PREVIEW_OOXML_MAX_ARCHIVE_BYTES,
  ONLY_PREVIEW_OOXML_MAX_COMPRESSION_RATIO,
  ONLY_PREVIEW_OOXML_MAX_ENTRIES,
  ONLY_PREVIEW_OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES,
  ONLY_PREVIEW_OOXML_MAX_MERGE_TAG_BYTES,
  ONLY_PREVIEW_OOXML_MAX_TOTAL_UNCOMPRESSED_BYTES,
  ONLY_PREVIEW_OOXML_PREFLIGHT_TIMEOUT_MS,
  OnlyPreviewOoxmlPreflightError,
  type OnlyPreviewOoxmlCentralEntry,
  type OnlyPreviewOoxmlPackageKind,
  type OnlyPreviewOoxmlPreflightOptions,
  type OnlyPreviewOoxmlPreflightResult,
  type OnlyPreviewOoxmlValidatedEntry,
  type OnlyPreviewXlsxCompatibility,
  type OnlyPreviewWorksheetMergeBudget
} from './onlyPreviewOoxmlPreflight.type';

export {
  ONLY_PREVIEW_OOXML_MAX_ARCHIVE_BYTES,
  ONLY_PREVIEW_OOXML_MAX_COMPRESSION_RATIO,
  ONLY_PREVIEW_OOXML_MAX_ENTRIES,
  ONLY_PREVIEW_OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES,
  ONLY_PREVIEW_OOXML_MAX_MERGED_CELLS,
  ONLY_PREVIEW_OOXML_MAX_MERGE_RANGES,
  ONLY_PREVIEW_OOXML_MAX_MERGE_TAG_BYTES,
  ONLY_PREVIEW_OOXML_MAX_TOTAL_UNCOMPRESSED_BYTES,
  ONLY_PREVIEW_OOXML_PREFLIGHT_TIMEOUT_MS,
  OnlyPreviewOoxmlPreflightError,
  type OnlyPreviewOoxmlEntry,
  type OnlyPreviewOoxmlPackageKind,
  type OnlyPreviewOoxmlPreflightErrorCode,
  type OnlyPreviewOoxmlPreflightOptions,
  type OnlyPreviewOoxmlPreflightResult
} from './onlyPreviewOoxmlPreflight.type';

type CentralEntry = OnlyPreviewOoxmlCentralEntry;
type ValidatedEntry = OnlyPreviewOoxmlValidatedEntry;

interface WorksheetSheetDataScanner {
  push(chunk: Uint8Array): void;
  finish(): number;
}

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const AES_EXTRA_FIELD_ID = 0x9901;
const UNICODE_PATH_EXTRA_FIELD_ID = 0x7075;
const UTF8_NAME_FLAG = 0x0800;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const ENCRYPTION_FLAGS = 0x2041;
const DEFLATE_OPTION_FLAGS = 0x0006;
const SUPPORTED_FLAGS = UTF8_NAME_FLAG | DEFLATE_OPTION_FLAGS;
const XML_SCAN_CHUNK_BYTES = 64 * 1024;
const XLSM_MAIN_CONTENT_TYPE = new TextEncoder().encode(
  'application/vnd.ms-excel.sheet.macroenabled.main+xml'
);
const CRC32_TABLE = new Uint32Array(256);

for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC32_TABLE[index] = value >>> 0;
}

const CP437_HIGH_CHARACTERS =
  'ÇüéâäàåçêëèïîìÄÅ' +
  'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩' +
  '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

const REQUIRED_PARTS: Record<OnlyPreviewOoxmlPackageKind, readonly string[]> = {
  xlsx: ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml'],
  docx: ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'],
  pptx: ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml']
};

const invalid = (message: string): never => {
  throw new OnlyPreviewOoxmlPreflightError('OOXML_ARCHIVE_INVALID', message);
};

const limit = (message: string): never => {
  throw new OnlyPreviewOoxmlPreflightError('OOXML_ARCHIVE_LIMIT', message);
};

const encrypted = (message: string): never => {
  throw new OnlyPreviewOoxmlPreflightError('OOXML_ENCRYPTED', message);
};

const timedOut = (): never => {
  throw new OnlyPreviewOoxmlPreflightError(
    'OOXML_PREFLIGHT_TIMEOUT',
    'OOXML archive preflight exceeded its deadline'
  );
};

const defaultNow = (): number =>
  typeof performance === 'undefined' ? Date.now() : performance.now();

const updateCrc32 = (crc32: number, bytes: Uint8Array): number => {
  let next = crc32;
  for (const byte of bytes) {
    next = CRC32_TABLE[(next ^ byte) & 0xff] ^ (next >>> 8);
  }
  return next >>> 0;
};

const assertRange = (start: number, length: number, boundary: number, label: string): void => {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(length) ||
    start < 0 ||
    length < 0 ||
    start > boundary ||
    length > boundary - start
  ) {
    invalid(`${label} exceeds the archive boundary`);
  }
};

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

const decodeCp437 = (bytes: Uint8Array): string => {
  let result = '';
  for (const byte of bytes) {
    result += byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH_CHARACTERS[byte - 0x80];
  }
  return result;
};

const decodeJsZipUtf8 = (bytes: Uint8Array): string => {
  let result = '';
  let index = 0;
  while (index < bytes.byteLength) {
    let codePoint = bytes[index];
    index += 1;
    if (codePoint < 0x80) {
      result += String.fromCharCode(codePoint);
      continue;
    }

    let sequenceLength =
      codePoint >= 252
        ? 6
        : codePoint >= 248
          ? 5
          : codePoint >= 240
            ? 4
            : codePoint >= 224
              ? 3
              : codePoint >= 192
                ? 2
                : 1;
    if (codePoint === 254) sequenceLength = 1;
    if (sequenceLength > 4) {
      result += '\ufffd';
      index += sequenceLength - 1;
      continue;
    }

    codePoint &= sequenceLength === 2 ? 0x1f : sequenceLength === 3 ? 0x0f : 0x07;
    while (sequenceLength > 1 && index < bytes.byteLength) {
      codePoint = (codePoint << 6) | (bytes[index] & 0x3f);
      index += 1;
      sequenceLength -= 1;
    }
    if (sequenceLength > 1) {
      result += '\ufffd';
    } else if (codePoint < 0x10000) {
      result += String.fromCharCode(codePoint);
    } else {
      codePoint -= 0x10000;
      result += String.fromCharCode(
        0xd800 | ((codePoint >> 10) & 0x3ff),
        0xdc00 | (codePoint & 0x3ff)
      );
    }
  }
  return result;
};

const decodeEntryName = (bytes: Uint8Array, flags: number): string => {
  if (bytes.byteLength === 0) invalid('ZIP entries must have a name');
  if ((flags & UTF8_NAME_FLAG) === 0) return decodeCp437(bytes);

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return invalid('ZIP entry name is not valid UTF-8');
  }
};

const normalizeEntryName = (rawName: string): string => {
  const name = rawName.normalize('NFC');
  for (const character of name) {
    const codeUnit = character.charCodeAt(0);
    if (codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f)) {
      invalid('ZIP entry name contains control characters');
    }
  }
  if (name.includes('\\')) invalid('ZIP entry name contains a backslash');
  if (name.startsWith('/') || /^[a-zA-Z]:/u.test(name)) {
    invalid('ZIP entry name is absolute');
  }

  const directoryEntry = name.endsWith('/');
  const segments = name.split('/');
  if (directoryEntry) segments.pop();
  if (
    segments.length === 0 ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    invalid('ZIP entry name is not a normalized relative path');
  }
  return directoryEntry ? `${segments.join('/')}/` : segments.join('/');
};

const entryNamespaceKey = (name: string): string => (name.endsWith('/') ? name.slice(0, -1) : name);

const isWorkbookXmlEntry = (name: string): boolean =>
  !name.endsWith('/') && name.startsWith('xl/') && name.toLowerCase().endsWith('.xml');

const isWorksheetXmlEntry = (name: string): boolean => /^xl\/worksheets\/[^/]+\.xml$/iu.test(name);

const createAsciiTokenScanner = (
  token: Uint8Array
): { push(chunk: Uint8Array): void; found(): boolean } => {
  const prefix = new Uint32Array(token.byteLength);
  for (let index = 1, matched = 0; index < token.byteLength; index += 1) {
    while (matched > 0 && token[index] !== token[matched]) matched = prefix[matched - 1];
    if (token[index] === token[matched]) matched += 1;
    prefix[index] = matched;
  }
  let matched = 0;
  let complete = false;
  return {
    push(chunk) {
      if (complete) return;
      for (const sourceByte of chunk) {
        const byte = sourceByte >= 0x41 && sourceByte <= 0x5a ? sourceByte + 0x20 : sourceByte;
        while (matched > 0 && byte !== token[matched]) matched = prefix[matched - 1];
        if (byte === token[matched]) matched += 1;
        if (matched === token.byteLength) {
          complete = true;
          return;
        }
      }
    },
    found: () => complete
  };
};

const isSheetDataQualifiedName = (name: string): boolean => {
  const parts = name.split(':');
  if (parts.at(-1) !== 'sheetData') return false;
  if (parts.length === 1) return true;
  if (parts.length !== 2 || !/^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(parts[0])) {
    invalid('XLSX sheetData namespace prefix is malformed');
  }
  return true;
};

const createWorksheetSheetDataScanner = (): WorksheetSheetDataScanner => {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let mode: 'text' | 'markup' | 'tag' | 'comment' | 'cdata' | 'processing-instruction' = 'text';
  let marker = '';
  let tagName = '';
  let closing = false;
  let nameComplete = false;
  let quote: '"' | "'" | null = null;
  let count = 0;

  const reset = (): void => {
    mode = 'text';
    marker = '';
    tagName = '';
    closing = false;
    nameComplete = false;
    quote = null;
  };

  const completeName = (): void => {
    if (tagName.length === 0) invalid('XLSX worksheet tag name is malformed');
    if (!closing && isSheetDataQualifiedName(tagName)) {
      count += 1;
      if (count > 1) invalid('XLSX worksheet contains multiple sheetData elements');
    }
    nameComplete = true;
  };

  const consumeTag = (character: string): void => {
    if (!nameComplete) {
      if (tagName.length === 0 && character === '/') {
        closing = true;
        return;
      }
      if (character === '>' || character === '/' || /[\t\n\r ]/u.test(character)) {
        completeName();
        if (character === '>') reset();
        return;
      }
      tagName += character;
      if (tagName.length > ONLY_PREVIEW_OOXML_MAX_MERGE_TAG_BYTES) {
        invalid('XLSX worksheet tag name exceeds the preflight limit');
      }
      return;
    }
    if (quote !== null) {
      if (character === quote) quote = null;
      return;
    }
    if (character === '"' || character === "'") {
      quote = character;
      return;
    }
    if (character === '<') invalid('XLSX worksheet tag contains ambiguous nested markup');
    if (character === '>') reset();
  };

  const consume = (source: string): void => {
    for (const character of source) {
      if (mode === 'text') {
        if (character === '<') {
          mode = 'markup';
          marker = '<';
        }
        continue;
      }
      if (mode === 'markup') {
        marker += character;
        if (marker === '<?') {
          mode = 'processing-instruction';
          marker = '';
        } else if ('<!--'.startsWith(marker)) {
          if (marker === '<!--') {
            mode = 'comment';
            marker = '';
          }
        } else if ('<![CDATA['.startsWith(marker)) {
          if (marker === '<![CDATA[') {
            mode = 'cdata';
            marker = '';
          }
        } else if (marker.startsWith('<!')) {
          invalid('XLSX XML declarations and entities are not supported');
        } else {
          mode = 'tag';
          const pending = marker.slice(1);
          marker = '';
          for (const pendingCharacter of pending) consumeTag(pendingCharacter);
        }
        continue;
      }
      if (mode === 'tag') {
        consumeTag(character);
        continue;
      }
      if (mode === 'processing-instruction') {
        marker = `${marker}${character}`.slice(-2);
        if (marker === '?>') reset();
        continue;
      }
      if (mode === 'comment') {
        marker = `${marker}${character}`.slice(-3);
        if (marker === '-->') reset();
        continue;
      }
      marker = `${marker}${character}`.slice(-3);
      if (marker === ']]>') reset();
    }
  };

  const decode = (chunk?: Uint8Array): string => {
    try {
      return chunk === undefined ? decoder.decode() : decoder.decode(chunk, { stream: true });
    } catch {
      return invalid('XLSX XML is not valid UTF-8');
    }
  };

  return {
    push(chunk) {
      consume(decode(chunk));
    },
    finish() {
      consume(decode());
      if (mode !== 'text') invalid('XLSX worksheet markup does not close exactly');
      return count;
    }
  };
};

const validateExtraFields = (
  view: DataView,
  start: number,
  length: number,
  boundary: number
): void => {
  assertRange(start, length, boundary, 'ZIP extra field');
  const end = start + length;
  let cursor = start;
  while (cursor < end) {
    assertRange(cursor, 4, end, 'ZIP extra field header');
    const fieldId = view.getUint16(cursor, true);
    const fieldLength = view.getUint16(cursor + 2, true);
    assertRange(cursor + 4, fieldLength, end, 'ZIP extra field body');
    if (fieldId === ZIP64_EXTRA_FIELD_ID) invalid('Zip64 extra fields are not supported');
    if (fieldId === AES_EXTRA_FIELD_ID) encrypted('AES-encrypted ZIP entries are not supported');
    if (fieldId === UNICODE_PATH_EXTRA_FIELD_ID) {
      invalid('Unicode path override extra fields are not supported');
    }
    cursor += 4 + fieldLength;
  }
};

const validateFlagsAndMethod = (flags: number, method: number): 0 | 8 => {
  if ((flags & ENCRYPTION_FLAGS) !== 0 || method === 99) {
    encrypted('Encrypted ZIP entries are not supported');
  }
  if ((flags & DATA_DESCRIPTOR_FLAG) !== 0) {
    invalid('ZIP data descriptors are not supported');
  }
  if ((flags & ~SUPPORTED_FLAGS) !== 0) invalid('ZIP entry uses unsupported flags');
  if (method === 0) {
    if ((flags & DEFLATE_OPTION_FLAGS) !== 0) {
      invalid('Stored ZIP entries cannot use DEFLATE option flags');
    }
    return 0;
  }
  if (method === 8) return 8;
  return invalid('ZIP compression method is not supported');
};

const validateCompressionLimits = (
  compressedSize: number,
  uncompressedSize: number,
  method: 0 | 8
): void => {
  if (uncompressedSize > ONLY_PREVIEW_OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES) {
    limit('ZIP entry exceeds the uncompressed-size limit');
  }
  if (method === 0 && compressedSize !== uncompressedSize) {
    invalid('Stored ZIP entry sizes do not match');
  }
  if (
    uncompressedSize > 0 &&
    (compressedSize === 0 ||
      uncompressedSize > compressedSize * ONLY_PREVIEW_OOXML_MAX_COMPRESSION_RATIO)
  ) {
    limit('ZIP entry exceeds the compression-ratio limit');
  }
};

const findEndOfCentralDirectory = (view: DataView, assertWithinDeadline: () => void): number => {
  const minimumOffset = Math.max(0, view.byteLength - 65_535 - 22);
  const candidates: number[] = [];
  for (let offset = minimumOffset; offset <= view.byteLength - 22; offset += 1) {
    if ((offset - minimumOffset) % 256 === 0) assertWithinDeadline();
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === view.byteLength) candidates.push(offset);
  }
  if (candidates.length !== 1)
    invalid('ZIP must contain one exact end-of-central-directory record');
  return candidates[0];
};

const parseCentralDirectory = (
  view: DataView,
  bytes: Uint8Array,
  centralOffset: number,
  centralSize: number,
  entryCount: number,
  assertWithinDeadline: () => void
): CentralEntry[] => {
  const centralEnd = centralOffset + centralSize;
  const entries: CentralEntry[] = [];
  const normalizedNames = new Set<string>();
  const tolerantUtf8Names = new Set<string>();
  const jsZipUtf8Names = new Set<string>();
  let cursor = centralOffset;
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    assertWithinDeadline();
    assertRange(cursor, 46, centralEnd, 'ZIP central-directory header');
    if (view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_HEADER_SIGNATURE) {
      invalid('ZIP central-directory signature is missing');
    }

    const flags = view.getUint16(cursor + 8, true);
    const versionMadeBy = view.getUint16(cursor + 4, true);
    const versionNeeded = view.getUint16(cursor + 6, true);
    const method = validateFlagsAndMethod(flags, view.getUint16(cursor + 10, true));
    const modificationTime = view.getUint16(cursor + 12, true);
    const modificationDate = view.getUint16(cursor + 14, true);
    const crc32 = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const diskNumber = view.getUint16(cursor + 34, true);
    const externalAttributes = view.getUint32(cursor + 38, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      invalid('Zip64 entry values are not supported');
    }
    if (diskNumber !== 0) invalid('Multi-disk ZIP entries are not supported');

    const variableLength = nameLength + extraLength + commentLength;
    assertRange(cursor + 46, variableLength, centralEnd, 'ZIP central-directory record');
    const nameStart = cursor + 46;
    const rawName = bytes.subarray(nameStart, nameStart + nameLength);
    const name = normalizeEntryName(decodeEntryName(rawName, flags));
    const madeBy = versionMadeBy >>> 8;
    const engineDirectory =
      (externalAttributes & 0x10) !== 0 ||
      (madeBy === 3 && ((externalAttributes >>> 16) & 0x4000) !== 0);
    if (engineDirectory && !name.endsWith('/')) {
      invalid('ZIP directory attributes disagree with the entry path');
    }
    const duplicateKey = entryNamespaceKey(name);
    if (normalizedNames.has(duplicateKey)) invalid('ZIP contains duplicate entry paths');
    normalizedNames.add(duplicateKey);
    const tolerantUtf8Name =
      (flags & UTF8_NAME_FLAG) === 0
        ? normalizeEntryName(new TextDecoder('utf-8').decode(rawName))
        : name;
    const jsZipUtf8Name =
      (flags & UTF8_NAME_FLAG) === 0 ? normalizeEntryName(decodeJsZipUtf8(rawName)) : name;
    const tolerantUtf8Key = entryNamespaceKey(tolerantUtf8Name);
    const jsZipUtf8Key = entryNamespaceKey(jsZipUtf8Name);
    if (tolerantUtf8Names.has(tolerantUtf8Key) || jsZipUtf8Names.has(jsZipUtf8Key)) {
      invalid('ZIP entry paths collide in the workbook engine');
    }
    tolerantUtf8Names.add(tolerantUtf8Key);
    jsZipUtf8Names.add(jsZipUtf8Key);
    validateExtraFields(view, nameStart + nameLength, extraLength, centralEnd);
    validateCompressionLimits(compressedSize, uncompressedSize, method);
    if (name.endsWith('/') && (method !== 0 || compressedSize !== 0 || uncompressedSize !== 0)) {
      invalid('ZIP directory entries must be empty and stored');
    }

    totalCompressedBytes += compressedSize;
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > ONLY_PREVIEW_OOXML_MAX_TOTAL_UNCOMPRESSED_BYTES) {
      limit('ZIP exceeds the total uncompressed-size limit');
    }

    entries.push({
      name,
      versionNeeded,
      flags,
      modificationTime,
      modificationDate,
      compressionMethod: method,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      rawName,
      scanWorkbookXml: [name, tolerantUtf8Name, jsZipUtf8Name].some(isWorkbookXmlEntry)
    });
    cursor += 46 + variableLength;
  }

  if (cursor !== centralEnd) invalid('ZIP central directory does not close exactly');
  if (
    totalUncompressedBytes > 0 &&
    (totalCompressedBytes === 0 ||
      totalUncompressedBytes > totalCompressedBytes * ONLY_PREVIEW_OOXML_MAX_COMPRESSION_RATIO)
  ) {
    limit('ZIP exceeds the aggregate compression-ratio limit');
  }
  return entries;
};

const validateLocalRecords = (
  view: DataView,
  bytes: Uint8Array,
  centralOffset: number,
  entries: readonly CentralEntry[],
  assertWithinDeadline: () => void
): ValidatedEntry[] => {
  const orderedEntries = [...entries].sort(
    (left, right) => left.localHeaderOffset - right.localHeaderOffset
  );
  const validatedEntries: ValidatedEntry[] = [];
  let expectedOffset = 0;

  for (const entry of orderedEntries) {
    assertWithinDeadline();
    if (entry.localHeaderOffset !== expectedOffset) {
      invalid('ZIP local records are overlapping or do not close exactly');
    }
    assertRange(entry.localHeaderOffset, 30, centralOffset, 'ZIP local-file header');
    if (view.getUint32(entry.localHeaderOffset, true) !== LOCAL_FILE_HEADER_SIGNATURE) {
      invalid('ZIP local-file signature is missing');
    }

    const flags = view.getUint16(entry.localHeaderOffset + 6, true);
    const versionNeeded = view.getUint16(entry.localHeaderOffset + 4, true);
    const method = validateFlagsAndMethod(flags, view.getUint16(entry.localHeaderOffset + 8, true));
    const modificationTime = view.getUint16(entry.localHeaderOffset + 10, true);
    const modificationDate = view.getUint16(entry.localHeaderOffset + 12, true);
    const crc32 = view.getUint32(entry.localHeaderOffset + 14, true);
    const compressedSize = view.getUint32(entry.localHeaderOffset + 18, true);
    const uncompressedSize = view.getUint32(entry.localHeaderOffset + 22, true);
    const nameLength = view.getUint16(entry.localHeaderOffset + 26, true);
    const extraLength = view.getUint16(entry.localHeaderOffset + 28, true);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      invalid('Zip64 local values are not supported');
    }
    const nameStart = entry.localHeaderOffset + 30;
    assertRange(nameStart, nameLength + extraLength, centralOffset, 'ZIP local-file record');
    const rawName = bytes.subarray(nameStart, nameStart + nameLength);
    validateExtraFields(view, nameStart + nameLength, extraLength, centralOffset);

    if (
      versionNeeded !== entry.versionNeeded ||
      flags !== entry.flags ||
      method !== entry.compressionMethod ||
      modificationTime !== entry.modificationTime ||
      modificationDate !== entry.modificationDate ||
      crc32 !== entry.crc32 ||
      compressedSize !== entry.compressedSize ||
      uncompressedSize !== entry.uncompressedSize ||
      !bytesEqual(rawName, entry.rawName)
    ) {
      invalid('ZIP local and central records disagree');
    }

    const dataStart = nameStart + nameLength + extraLength;
    assertRange(dataStart, compressedSize, centralOffset, 'ZIP entry data');
    expectedOffset = dataStart + compressedSize;
    validatedEntries.push({ ...entry, dataOffset: dataStart });
  }

  if (expectedOffset !== centralOffset)
    invalid('ZIP local records do not reach the central directory');
  return validatedEntries;
};

const validateStoredPayload = (
  bytes: Uint8Array,
  entry: ValidatedEntry,
  acceptedUncompressedBytes: number,
  assertWithinDeadline: () => void,
  onChunk?: (chunk: Uint8Array) => void
): number => {
  let crc32 = 0xffffffff;
  const end = entry.dataOffset + entry.compressedSize;
  for (let offset = entry.dataOffset; offset < end; offset += XML_SCAN_CHUNK_BYTES) {
    assertWithinDeadline();
    const chunk = bytes.subarray(offset, Math.min(end, offset + XML_SCAN_CHUNK_BYTES));
    onChunk?.(chunk);
    assertWithinDeadline();
    crc32 = updateCrc32(crc32, chunk);
  }
  if (
    acceptedUncompressedBytes + entry.uncompressedSize >
    ONLY_PREVIEW_OOXML_MAX_TOTAL_UNCOMPRESSED_BYTES
  ) {
    limit('ZIP payloads exceed the total uncompressed-size limit');
  }
  if ((crc32 ^ 0xffffffff) >>> 0 !== entry.crc32) {
    invalid('ZIP entry payload does not match its CRC');
  }
  return entry.uncompressedSize;
};

const createCompressedStream = (bytes: Uint8Array<ArrayBuffer>): ReadableStream<BufferSource> => {
  let offset = 0;
  return new ReadableStream<BufferSource>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(bytes.byteLength, offset + XML_SCAN_CHUNK_BYTES);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    }
  });
};

const validateDeflatedPayload = async (
  bytes: Uint8Array<ArrayBuffer>,
  entry: ValidatedEntry,
  acceptedUncompressedBytes: number,
  assertWithinDeadline: () => void,
  onChunk?: (chunk: Uint8Array) => void
): Promise<number> => {
  if (typeof DecompressionStream !== 'function') {
    invalid('The runtime cannot validate DEFLATE payloads');
  }

  const compressedBytes = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let actualSize = 0;
  let crc32 = 0xffffffff;
  try {
    const decompressed = createCompressedStream(compressedBytes).pipeThrough(
      new DecompressionStream('deflate-raw')
    );
    reader = decompressed.getReader();
    while (true) {
      assertWithinDeadline();
      const chunk = await reader.read();
      assertWithinDeadline();
      if (chunk.done) break;
      actualSize += chunk.value.byteLength;
      if (actualSize > entry.uncompressedSize) {
        invalid('ZIP entry payload exceeds its declared size');
      }
      if (
        actualSize > ONLY_PREVIEW_OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES ||
        acceptedUncompressedBytes + actualSize > ONLY_PREVIEW_OOXML_MAX_TOTAL_UNCOMPRESSED_BYTES ||
        actualSize > entry.compressedSize * ONLY_PREVIEW_OOXML_MAX_COMPRESSION_RATIO
      ) {
        limit('ZIP payload exceeds its actual expansion limits');
      }
      onChunk?.(chunk.value);
      assertWithinDeadline();
      crc32 = updateCrc32(crc32, chunk.value);
    }
  } catch (error) {
    if (error instanceof OnlyPreviewOoxmlPreflightError) throw error;
    return invalid('ZIP DEFLATE payload is malformed');
  } finally {
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // The stream may already be closed or errored.
      }
      reader.releaseLock();
    }
  }

  if (actualSize !== entry.uncompressedSize) {
    invalid('ZIP entry payload size disagrees with its header');
  }
  if ((crc32 ^ 0xffffffff) >>> 0 !== entry.crc32) {
    invalid('ZIP entry payload does not match its CRC');
  }
  return actualSize;
};

const validateEntryPayloads = async (
  bytes: Uint8Array<ArrayBuffer>,
  entries: readonly ValidatedEntry[],
  assertWithinDeadline: () => void,
  kind: OnlyPreviewOoxmlPackageKind
): Promise<OnlyPreviewXlsxCompatibility | undefined> => {
  let totalUncompressedBytes = 0;
  let totalCompressedBytes = 0;
  const mergeBudget: OnlyPreviewWorksheetMergeBudget = { ranges: 0, expandedCells: 0 };
  let worksheetCount = 0;
  let missingSheetDataCount = 0;
  let macroEnabled = false;
  for (const entry of entries) {
    assertWithinDeadline();
    const mergeScanner =
      kind === 'xlsx' && entry.scanWorkbookXml
        ? createOnlyPreviewWorksheetMergeScanner(mergeBudget)
        : null;
    const sheetDataScanner =
      kind === 'xlsx' && isWorksheetXmlEntry(entry.name) ? createWorksheetSheetDataScanner() : null;
    const macroScanner =
      kind === 'xlsx' && entry.name === '[Content_Types].xml'
        ? createAsciiTokenScanner(XLSM_MAIN_CONTENT_TYPE)
        : null;
    const scanChunk =
      mergeScanner || sheetDataScanner || macroScanner
        ? (chunk: Uint8Array): void => {
            mergeScanner?.push(chunk);
            sheetDataScanner?.push(chunk);
            macroScanner?.push(chunk);
          }
        : undefined;
    const acceptedBytes =
      entry.compressionMethod === 0
        ? validateStoredPayload(
            bytes,
            entry,
            totalUncompressedBytes,
            assertWithinDeadline,
            scanChunk
          )
        : await validateDeflatedPayload(
            bytes,
            entry,
            totalUncompressedBytes,
            assertWithinDeadline,
            scanChunk
          );
    mergeScanner?.finish();
    if (sheetDataScanner) {
      worksheetCount += 1;
      if (sheetDataScanner.finish() === 0) missingSheetDataCount += 1;
    }
    if (macroScanner?.found()) macroEnabled = true;
    assertWithinDeadline();
    totalUncompressedBytes += acceptedBytes;
    totalCompressedBytes += entry.compressedSize;
  }
  if (
    totalUncompressedBytes > 0 &&
    (totalCompressedBytes === 0 ||
      totalUncompressedBytes > totalCompressedBytes * ONLY_PREVIEW_OOXML_MAX_COMPRESSION_RATIO)
  ) {
    limit('ZIP payloads exceed the aggregate actual compression-ratio limit');
  }
  return kind === 'xlsx'
    ? {
        macroEnabled,
        worksheetCount,
        missingSheetDataCount,
        requiresSheetDataNormalization: missingSheetDataCount > 0
      }
    : undefined;
};

export const preflightOnlyPreviewOoxml = async (
  buffer: ArrayBuffer,
  kind: OnlyPreviewOoxmlPackageKind,
  options: OnlyPreviewOoxmlPreflightOptions = {}
): Promise<OnlyPreviewOoxmlPreflightResult> => {
  const now = options.now ?? defaultNow;
  const startedAt = now();
  const assertWithinDeadline = (): void => {
    const current = now();
    if (
      !Number.isFinite(startedAt) ||
      !Number.isFinite(current) ||
      current < startedAt ||
      current - startedAt >= ONLY_PREVIEW_OOXML_PREFLIGHT_TIMEOUT_MS
    ) {
      timedOut();
    }
  };
  assertWithinDeadline();

  if (kind !== 'xlsx' && kind !== 'docx' && kind !== 'pptx') {
    invalid('OOXML package kind is not supported');
  }
  if (buffer.byteLength > ONLY_PREVIEW_OOXML_MAX_ARCHIVE_BYTES) {
    limit('OOXML archive exceeds the input-size limit');
  }
  if (buffer.byteLength < 22) invalid('OOXML archive is too short');

  let view: DataView;
  try {
    view = new DataView(buffer);
  } catch {
    return invalid('OOXML input is not an ArrayBuffer');
  }
  const bytes = new Uint8Array(buffer);
  if (view.getUint32(0, true) !== LOCAL_FILE_HEADER_SIGNATURE) {
    invalid('OOXML archive does not start with a local-file header');
  }

  const eocdOffset = findEndOfCentralDirectory(view, assertWithinDeadline);
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDiskNumber = view.getUint16(eocdOffset + 6, true);
  const diskEntryCount = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (
    entryCount === 0xffff ||
    diskEntryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    invalid('Zip64 end-of-directory values are not supported');
  }
  if (diskNumber !== 0 || centralDiskNumber !== 0 || diskEntryCount !== entryCount) {
    invalid('Multi-disk ZIP archives are not supported');
  }
  if (entryCount === 0) invalid('OOXML archive has no entries');
  if (entryCount > ONLY_PREVIEW_OOXML_MAX_ENTRIES) {
    limit('ZIP exceeds the entry-count limit');
  }
  assertRange(centralOffset, centralSize, eocdOffset, 'ZIP central directory');
  if (centralOffset + centralSize !== eocdOffset) {
    invalid('ZIP central directory does not meet the end record');
  }

  const centralEntries = parseCentralDirectory(
    view,
    bytes,
    centralOffset,
    centralSize,
    entryCount,
    assertWithinDeadline
  );
  const validatedEntries = validateLocalRecords(
    view,
    bytes,
    centralOffset,
    centralEntries,
    assertWithinDeadline
  );

  const names = new Set(centralEntries.map((entry) => entry.name));
  for (const requiredPart of REQUIRED_PARTS[kind]) {
    if (!names.has(requiredPart)) invalid(`OOXML package is missing ${requiredPart}`);
  }
  const xlsxCompatibility = await validateEntryPayloads(
    bytes,
    validatedEntries,
    assertWithinDeadline,
    kind
  );

  const totalCompressedBytes = centralEntries.reduce(
    (total, entry) => total + entry.compressedSize,
    0
  );
  const totalUncompressedBytes = centralEntries.reduce(
    (total, entry) => total + entry.uncompressedSize,
    0
  );
  return {
    kind,
    entries: centralEntries.map(
      ({ name, compressionMethod, compressedSize, uncompressedSize }) => ({
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize
      })
    ),
    totalCompressedBytes,
    totalUncompressedBytes,
    ...(xlsxCompatibility ? { xlsxCompatibility } : {})
  };
};
