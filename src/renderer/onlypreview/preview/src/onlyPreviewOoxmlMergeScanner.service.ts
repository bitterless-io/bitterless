import {
  ONLY_PREVIEW_OOXML_MAX_MERGED_CELLS,
  ONLY_PREVIEW_OOXML_MAX_MERGE_RANGES,
  ONLY_PREVIEW_OOXML_MAX_MERGE_TAG_BYTES,
  OnlyPreviewOoxmlPreflightError,
  type OnlyPreviewWorksheetMergeBudget,
  type OnlyPreviewWorksheetMergeScanner
} from './onlyPreviewOoxmlPreflight.type';

const MAX_WORKSHEET_ROW = 1_048_576;
const MAX_WORKSHEET_COLUMN = 16_384;
const XML_COMMENT_START = '<!--';
const XML_CDATA_START = '<![CDATA[';

const invalid = (message: string): never => {
  throw new OnlyPreviewOoxmlPreflightError('OOXML_ARCHIVE_INVALID', message);
};

const limit = (message: string): never => {
  throw new OnlyPreviewOoxmlPreflightError('OOXML_ARCHIVE_LIMIT', message);
};

const worksheetColumnNumber = (letters: string): number => {
  let column = 0;
  for (const character of letters.toUpperCase()) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  return column;
};

const mergeExpandedCellCount = (reference: string): number => {
  const match = /^\$?([A-Z]{1,3})\$?(\d{1,7}):\$?([A-Z]{1,3})\$?(\d{1,7})$/i.exec(reference);
  if (!match) return invalid('XLSX merge range is malformed');
  const left = worksheetColumnNumber(match[1]);
  const top = Number(match[2]);
  const right = worksheetColumnNumber(match[3]);
  const bottom = Number(match[4]);
  if (left === right && top === bottom) {
    invalid('XLSX merge range must cover more than one cell');
  }
  if (
    left < 1 ||
    left > MAX_WORKSHEET_COLUMN ||
    right < left ||
    right > MAX_WORKSHEET_COLUMN ||
    top < 1 ||
    top > MAX_WORKSHEET_ROW ||
    bottom < top ||
    bottom > MAX_WORKSHEET_ROW
  ) {
    invalid('XLSX merge range is outside worksheet bounds');
  }
  const expandedCells = (right - left + 1) * (bottom - top + 1);
  if (!Number.isSafeInteger(expandedCells) || expandedCells < 1) {
    invalid('XLSX merge range has an unsafe expanded size');
  }
  return expandedCells;
};

const isXmlWhitespace = (character: string): boolean =>
  character === ' ' || character === '\t' || character === '\r' || character === '\n';

const utf8ByteLength = (character: string): number => {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return 0;
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
};

const isMergeQualifiedName = (name: string): boolean => {
  const parts = name.split(':');
  if (parts.length === 1) return name === 'mergeCell';
  if (parts.at(-1) !== 'mergeCell') return false;
  if (parts.length !== 2 || !/^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(parts[0])) {
    invalid('XLSX mergeCell namespace prefix is malformed');
  }
  return true;
};

const acceptMergeRange = (reference: string, budget: OnlyPreviewWorksheetMergeBudget): void => {
  const expandedCells = mergeExpandedCellCount(reference);
  if (budget.ranges >= ONLY_PREVIEW_OOXML_MAX_MERGE_RANGES) {
    limit('XLSX merge ranges exceed the record limit');
  }
  if (budget.expandedCells > ONLY_PREVIEW_OOXML_MAX_MERGED_CELLS - expandedCells) {
    limit('XLSX merged cells exceed the expansion limit');
  }
  budget.ranges += 1;
  budget.expandedCells += expandedCells;
};

const parseMergeTag = (
  tag: string,
  budget: OnlyPreviewWorksheetMergeBudget,
  openTags: string[]
): void => {
  const closing = tag.startsWith('</');
  let cursor = closing ? 2 : 1;
  const nameStart = cursor;
  while (
    cursor < tag.length &&
    !isXmlWhitespace(tag[cursor]) &&
    tag[cursor] !== '/' &&
    tag[cursor] !== '>'
  ) {
    cursor += 1;
  }
  const qualifiedName = tag.slice(nameStart, cursor);
  if (!isMergeQualifiedName(qualifiedName)) {
    invalid('XLSX mergeCell tag name is malformed');
  }

  if (closing) {
    while (isXmlWhitespace(tag[cursor])) cursor += 1;
    if (cursor !== tag.length - 1 || tag[cursor] !== '>') {
      invalid('XLSX closing mergeCell tag is malformed');
    }
    if (openTags.pop() !== qualifiedName) {
      invalid('XLSX mergeCell tags do not close exactly');
    }
    return;
  }

  const attributes = new Set<string>();
  let reference: string | null = null;
  let selfClosing = false;
  while (cursor < tag.length - 1) {
    while (isXmlWhitespace(tag[cursor])) cursor += 1;
    if (cursor >= tag.length - 1) break;
    if (tag[cursor] === '/') {
      if (cursor !== tag.length - 2 || tag[cursor + 1] !== '>') {
        invalid('XLSX mergeCell empty-element close is malformed');
      }
      selfClosing = true;
      cursor += 1;
      break;
    }

    const attributeStart = cursor;
    while (
      cursor < tag.length - 1 &&
      !isXmlWhitespace(tag[cursor]) &&
      tag[cursor] !== '=' &&
      tag[cursor] !== '/' &&
      tag[cursor] !== '>'
    ) {
      cursor += 1;
    }
    const attributeName = tag.slice(attributeStart, cursor);
    if (attributeName.length === 0 || attributes.has(attributeName)) {
      invalid('XLSX mergeCell attributes are malformed or duplicated');
    }
    attributes.add(attributeName);
    while (isXmlWhitespace(tag[cursor])) cursor += 1;
    if (tag[cursor] !== '=') invalid('XLSX mergeCell attribute is missing an equals sign');
    cursor += 1;
    while (isXmlWhitespace(tag[cursor])) cursor += 1;
    const quote = tag[cursor];
    if (quote !== '"' && quote !== "'") {
      invalid('XLSX mergeCell attribute value must be quoted');
    }
    cursor += 1;
    const valueStart = cursor;
    while (cursor < tag.length - 1 && tag[cursor] !== quote) cursor += 1;
    if (cursor >= tag.length - 1) invalid('XLSX mergeCell attribute quote is not closed');
    const value = tag.slice(valueStart, cursor);
    if (value.includes('&') || value.includes('<')) {
      invalid('XLSX mergeCell attributes cannot contain entity or markup references');
    }
    cursor += 1;
    if (attributeName === 'ref') {
      if (reference !== null) invalid('XLSX mergeCell ref is ambiguous');
      reference = value;
    }
  }

  if (tag[cursor] !== '>') invalid('XLSX mergeCell tag does not close exactly');
  if (reference === null) return invalid('XLSX mergeCell ref is missing');
  acceptMergeRange(reference, budget);
  if (!selfClosing) {
    if (openTags.length !== 0) invalid('Nested XLSX mergeCell tags are malformed');
    openTags.push(qualifiedName);
  }
};

type XmlScannerMode = 'text' | 'markup' | 'tag' | 'comment' | 'cdata' | 'processing-instruction';

export const createOnlyPreviewWorksheetMergeScanner = (
  budget: OnlyPreviewWorksheetMergeBudget
): OnlyPreviewWorksheetMergeScanner => {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const openMergeTags: string[] = [];
  const leadingBytes: number[] = [];
  let mode: XmlScannerMode = 'text';
  let markup = '';
  let markerTail = '';
  let tagBuffer = '';
  let tagBytes = 0;
  let tagNameComplete = false;
  let tagIsMerge = false;
  let tagQuote: '"' | "'" | null = null;

  const resetToText = (): void => {
    mode = 'text';
    markup = '';
    markerTail = '';
    tagBuffer = '';
    tagBytes = 0;
    tagNameComplete = false;
    tagIsMerge = false;
    tagQuote = null;
  };

  const finishTag = (): void => {
    if (tagIsMerge) parseMergeTag(tagBuffer, budget, openMergeTags);
    resetToText();
  };

  const consumeTagCharacter = (character: string): void => {
    if (!tagNameComplete) {
      tagBuffer += character;
      tagBytes += utf8ByteLength(character);
      if (tagBytes > ONLY_PREVIEW_OOXML_MAX_MERGE_TAG_BYTES) {
        invalid('XLSX XML tag name exceeds the merge preflight limit');
      }
      if (tagBuffer === '</') return;
      if (character !== '/' && character !== '>' && !isXmlWhitespace(character)) {
        return;
      }

      const nameStart = tagBuffer.startsWith('</') ? 2 : 1;
      const qualifiedName = tagBuffer.slice(nameStart, -1);
      if (qualifiedName.length === 0) invalid('XLSX XML tag name is malformed');
      tagIsMerge = isMergeQualifiedName(qualifiedName);
      tagNameComplete = true;
      if (!tagIsMerge) tagBuffer = '';
      if (character === '>') finishTag();
      return;
    }

    if (tagIsMerge) {
      tagBuffer += character;
      tagBytes += utf8ByteLength(character);
      if (tagBytes > ONLY_PREVIEW_OOXML_MAX_MERGE_TAG_BYTES) {
        invalid('XLSX mergeCell tag exceeds the preflight limit');
      }
    }
    if (tagQuote !== null) {
      if (character === tagQuote) tagQuote = null;
      return;
    }
    if (character === '"' || character === "'") {
      tagQuote = character;
      return;
    }
    if (character === '<') invalid('XLSX XML tag contains ambiguous nested markup');
    if (character === '>') finishTag();
  };

  const beginTag = (characters: string): void => {
    mode = 'tag';
    tagBuffer = '<';
    tagBytes = 1;
    tagNameComplete = false;
    tagIsMerge = false;
    tagQuote = null;
    for (const character of characters) consumeTagCharacter(character);
  };

  const consumeCharacter = (character: string): void => {
    if (mode === 'text') {
      if (character === '<') {
        mode = 'markup';
        markup = '<';
      }
      return;
    }

    if (mode === 'markup') {
      markup += character;
      if (markup === '<?') {
        mode = 'processing-instruction';
        markerTail = '';
        return;
      }
      if (XML_COMMENT_START.startsWith(markup)) {
        if (markup === '<!--') {
          mode = 'comment';
          markerTail = '';
        }
        return;
      }
      if (XML_CDATA_START.startsWith(markup)) {
        if (markup === '<![CDATA[') {
          mode = 'cdata';
          markerTail = '';
        }
        return;
      }
      if (markup.startsWith('<!')) {
        invalid('XLSX XML declarations and entities are not supported');
      }
      const tagCharacters = markup.slice(1);
      markup = '';
      beginTag(tagCharacters);
      return;
    }

    if (mode === 'tag') {
      consumeTagCharacter(character);
      return;
    }

    if (mode === 'processing-instruction') {
      markerTail = `${markerTail}${character}`.slice(-2);
      if (markerTail === '?>') resetToText();
      return;
    }

    if (mode === 'comment') {
      if (markerTail === '--') {
        if (character !== '>') invalid('XLSX XML comment contains malformed double hyphens');
        resetToText();
        return;
      }
      markerTail = `${markerTail}${character}`.slice(-2);
      return;
    }

    markerTail = `${markerTail}${character}`.slice(-3);
    if (markerTail === ']]>') resetToText();
  };

  const consume = (source: string): void => {
    for (const character of source) consumeCharacter(character);
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
      for (const byte of chunk) {
        if (byte === 0) invalid('XLSX XML contains a NUL byte');
        if (leadingBytes.length < 2) leadingBytes.push(byte);
      }
      if (
        leadingBytes.length === 2 &&
        ((leadingBytes[0] === 0xff && leadingBytes[1] === 0xfe) ||
          (leadingBytes[0] === 0xfe && leadingBytes[1] === 0xff))
      ) {
        invalid('XLSX XML must not use a UTF-16 byte-order mark');
      }
      consume(decode(chunk));
    },
    finish() {
      consume(decode());
      if (mode !== 'text' || openMergeTags.length !== 0) {
        invalid('XLSX XML merge markup does not close exactly');
      }
    }
  };
};
