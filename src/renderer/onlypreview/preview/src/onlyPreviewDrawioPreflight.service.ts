import {
  ONLY_PREVIEW_DRAWIO_MAX_CELLS,
  ONLY_PREVIEW_DRAWIO_MAX_EXPANDED_BYTES,
  ONLY_PREVIEW_DRAWIO_MAX_PAGES,
  type OnlyPreviewDrawioWorkerErrorCode
} from './workers/onlyPreviewDrawioWorker.contract';

export interface OnlyPreviewDrawioPreflightResult {
  pageCount: number;
  cellCount: number;
  expandedBytes: number;
}

export class OnlyPreviewDrawioPreflightError extends Error {
  constructor(readonly code: OnlyPreviewDrawioWorkerErrorCode) {
    super(code);
    this.name = 'OnlyPreviewDrawioPreflightError';
  }
}

const INPUT_CHUNK_BYTES = 64 * 1024;
const MAX_XML_TAG_CHARS = 64 * 1024;
const BASE64_OUTPUT_CHUNK_BYTES = 24 * 1024;
const MAX_XML_DEPTH = 256;

const fail = (code: OnlyPreviewDrawioWorkerErrorCode): never => {
  throw new OnlyPreviewDrawioPreflightError(code);
};

const rethrowStreamFailure = (error: unknown): never => {
  if (error instanceof OnlyPreviewDrawioPreflightError) throw error;
  return fail('DIAGRAM_PARSE_FAILED');
};

type XmlToken =
  | { type: 'text'; raw: string }
  | { type: 'meta'; raw: string }
  | { type: 'open' | 'close' | 'self'; name: string; raw: string };

type XmlTokenConsumer = (token: XmlToken) => void | Promise<void>;

const findTagEnd = (candidate: string): number => {
  if (candidate.startsWith('<!--')) {
    const end = candidate.indexOf('-->');
    return end < 0 ? -1 : end + 3;
  }
  if (candidate.startsWith('<![CDATA[')) {
    const end = candidate.indexOf(']]>');
    return end < 0 ? -1 : end + 3;
  }
  let quote: '"' | "'" | null = null;
  for (let index = 1; index < candidate.length; index += 1) {
    const character = candidate[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index + 1;
    }
  }
  return -1;
};

const parseXmlTag = (raw: string): XmlToken => {
  if (/^<!--[\s\S]*-->$/u.test(raw) || /^<\?xml\b[\s\S]*\?>$/iu.test(raw)) {
    return { type: 'meta', raw };
  }
  if (/^<!/u.test(raw) || /<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(raw)) {
    return fail('DIAGRAM_PARSE_FAILED');
  }
  const match = raw.match(/^<\s*(\/)?\s*([a-z_][\w:.-]*)([\s\S]*?)(\/)?\s*>$/iu);
  if (!match) return fail('DIAGRAM_PARSE_FAILED');
  const [, closing, name, , selfClosing] = match;
  if (closing && selfClosing) return fail('DIAGRAM_PARSE_FAILED');
  return {
    type: closing ? 'close' : selfClosing ? 'self' : 'open',
    name,
    raw
  };
};

class StreamingXmlTokenizer {
  private pendingTag = '';

  constructor(private readonly consume: XmlTokenConsumer) {}

  async write(source: string): Promise<void> {
    let cursor = 0;
    while (cursor < source.length) {
      if (!this.pendingTag) {
        const tagStart = source.indexOf('<', cursor);
        if (tagStart < 0) {
          await this.consume({ type: 'text', raw: source.slice(cursor) });
          return;
        }
        if (tagStart > cursor) {
          await this.consume({ type: 'text', raw: source.slice(cursor, tagStart) });
        }
        this.pendingTag = '<';
        cursor = tagStart + 1;
      }

      const previousLength = this.pendingTag.length;
      const candidate = this.pendingTag + source.slice(cursor);
      const tagEnd = findTagEnd(candidate);
      if (tagEnd < 0) {
        if (candidate.length > MAX_XML_TAG_CHARS) return fail('DIAGRAM_LIMIT');
        this.pendingTag = candidate;
        return;
      }
      if (tagEnd > MAX_XML_TAG_CHARS) return fail('DIAGRAM_LIMIT');
      const consumedFromSource = tagEnd - previousLength;
      const raw = candidate.slice(0, tagEnd);
      this.pendingTag = '';
      cursor += consumedFromSource;
      await this.consume(parseXmlTag(raw));
    }
  }

  end(): void {
    if (this.pendingTag) fail('DIAGRAM_PARSE_FAILED');
  }
}

class Utf8ByteCounter {
  private pendingHighSurrogate = false;

  count(source: string): number {
    let bytes = 0;
    let index = 0;
    if (this.pendingHighSurrogate) {
      const first = source.charCodeAt(0);
      if (first < 0xdc00 || first > 0xdfff) return fail('DIAGRAM_PARSE_FAILED');
      bytes += 4;
      this.pendingHighSurrogate = false;
      index = 1;
    }
    for (; index < source.length; index += 1) {
      const code = source.charCodeAt(index);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff) {
        if (index + 1 === source.length) {
          this.pendingHighSurrogate = true;
          break;
        }
        const low = source.charCodeAt(index + 1);
        if (low < 0xdc00 || low > 0xdfff) return fail('DIAGRAM_PARSE_FAILED');
        bytes += 4;
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        return fail('DIAGRAM_PARSE_FAILED');
      } else bytes += 3;
    }
    return bytes;
  }

  end(): void {
    if (this.pendingHighSurrogate) fail('DIAGRAM_PARSE_FAILED');
  }
}

const isXmlCharacter = (codePoint: number): boolean =>
  codePoint === 0x09 ||
  codePoint === 0x0a ||
  codePoint === 0x0d ||
  (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
  (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
  (codePoint >= 0x10000 && codePoint <= 0x10ffff);

const decodeEntity = (entity: string): string => {
  if (entity === '&lt;') return '<';
  if (entity === '&gt;') return '>';
  if (entity === '&amp;') return '&';
  if (entity === '&quot;') return '"';
  if (entity === '&apos;') return "'";
  const numeric = entity.match(/^&#(x[\da-f]+|\d+);$/iu)?.[1];
  if (!numeric) return fail('DIAGRAM_PARSE_FAILED');
  const hexadecimal = numeric.startsWith('x') || numeric.startsWith('X');
  const codePoint = Number.parseInt(numeric.replace(/^x/iu, ''), hexadecimal ? 16 : 10);
  if (!Number.isSafeInteger(codePoint) || !isXmlCharacter(codePoint)) {
    return fail('DIAGRAM_PARSE_FAILED');
  }
  return String.fromCodePoint(codePoint);
};

const canonicalizeXmlReferences = (source: string): string => {
  let canonical = '';
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('&', cursor);
    if (start < 0) return canonical + source.slice(cursor);
    canonical += source.slice(cursor, start);
    const end = source.indexOf(';', start + 1);
    if (end < 0 || end - start + 1 > 32) fail('DIAGRAM_PARSE_FAILED');
    canonical += decodeEntity(source.slice(start, end + 1));
    cursor = end + 1;
  }
  return canonical;
};

const tagHasImageContent = (token: Extract<XmlToken, { name: string }>): boolean => {
  const localName = token.name.toLowerCase().split(':').at(-1);
  if (localName === 'image' || localName === 'mximage' || localName === 'svg') return true;
  const canonical = canonicalizeXmlReferences(token.raw);
  return (
    /(?:data:image\/|blob:|svg\+xml)/iu.test(canonical) ||
    /(?:^|[;"'\s])(?:image|imagebackground|imageborder)\s*=/iu.test(canonical) ||
    /shape\s*=\s*["']?(?:image|stencil)\b/iu.test(canonical) ||
    /(?:<|%3c)\s*(?:img|image|svg)\b/iu.test(canonical)
  );
};

const textHasImageContent = (source: string): boolean =>
  /(?:data:image\/|blob:|svg\+xml|(?:&lt;|&#60;|&#x0*3c;|%3c)\s*(?:img|image|svg)\b)/iu.test(
    source
  );

class GraphPageScanner {
  private readonly tokenizer = new StreamingXmlTokenizer((token) => this.acceptToken(token));
  private readonly stack: string[] = [];
  private readonly byteCounter = new Utf8ByteCounter();
  private started = false;
  private completed = false;
  private cellCount = 0;

  constructor(private readonly addExpandedBytes: (bytes: number) => void) {}

  async write(source: string): Promise<void> {
    this.addExpandedBytes(this.byteCounter.count(source));
    await this.tokenizer.write(source);
  }

  acceptDirectToken(token: XmlToken): void {
    this.addExpandedBytes(this.byteCounter.count(token.raw));
    this.acceptToken(token);
  }

  finish(): number {
    this.tokenizer.end();
    this.byteCounter.end();
    if (!this.completed || this.stack.length !== 0) fail('DIAGRAM_PARSE_FAILED');
    if (this.cellCount === 0) fail('DIAGRAM_EMPTY');
    return this.cellCount;
  }

  private acceptToken(token: XmlToken): void {
    if (token.type === 'text') {
      if (textHasImageContent(token.raw)) fail('DIAGRAM_LIMIT');
      if ((!this.started || this.completed) && token.raw.trim()) fail('DIAGRAM_PARSE_FAILED');
      return;
    }
    if (token.type === 'meta') {
      if (this.started) fail('DIAGRAM_PARSE_FAILED');
      return;
    }
    if (tagHasImageContent(token)) fail('DIAGRAM_LIMIT');
    const name = token.name.toLowerCase();
    if (!this.started) {
      if ((token.type !== 'open' && token.type !== 'self') || name !== 'mxgraphmodel') {
        fail('DIAGRAM_PARSE_FAILED');
      }
      this.started = true;
    }
    if (this.completed) fail('DIAGRAM_PARSE_FAILED');
    if (token.type === 'open') {
      this.stack.push(name);
      if (this.stack.length > MAX_XML_DEPTH) fail('DIAGRAM_LIMIT');
    } else if (token.type === 'close') {
      if (this.stack.pop() !== name) fail('DIAGRAM_PARSE_FAILED');
      if (this.stack.length === 0) this.completed = true;
    } else if (name === 'mxgraphmodel') {
      this.completed = true;
    }
    if (name === 'mxcell' && token.type !== 'close') {
      this.cellCount += 1;
      if (this.cellCount > ONLY_PREVIEW_DRAWIO_MAX_CELLS) fail('DIAGRAM_LIMIT');
    }
  }
}

class StreamingXmlEntityDecoder {
  private pendingEntity = '';

  constructor(private readonly emit: (source: string) => Promise<void>) {}

  async write(source: string): Promise<void> {
    let cursor = 0;
    while (cursor < source.length) {
      if (this.pendingEntity) {
        const end = source.indexOf(';', cursor);
        if (end < 0) {
          this.pendingEntity += source.slice(cursor);
          if (this.pendingEntity.length > 32) fail('DIAGRAM_PARSE_FAILED');
          return;
        }
        this.pendingEntity += source.slice(cursor, end + 1);
        await this.emit(decodeEntity(this.pendingEntity));
        this.pendingEntity = '';
        cursor = end + 1;
        continue;
      }
      const start = source.indexOf('&', cursor);
      if (start < 0) {
        await this.emit(source.slice(cursor));
        return;
      }
      if (start > cursor) await this.emit(source.slice(cursor, start));
      this.pendingEntity = '&';
      cursor = start + 1;
    }
  }

  end(): void {
    if (this.pendingEntity) fail('DIAGRAM_PARSE_FAILED');
  }
}

const base64Value = (character: string): number => {
  const code = character.charCodeAt(0);
  if (code === 9 || code === 10 || code === 13 || code === 32) return -3;
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (character === '+' || character === '-') return 62;
  if (character === '/' || character === '_') return 63;
  if (character === '=') return -1;
  return -2;
};

class StreamingPercentUtf8Decoder {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private percentState = 0;
  private highNibble = 0;

  constructor(private readonly emit: (source: string) => Promise<void>) {}

  async write(source: Uint8Array): Promise<void> {
    const decoded = new Uint8Array(source.byteLength);
    let outputLength = 0;
    for (const byte of source) {
      if (byte > 0x7f) fail('DIAGRAM_PARSE_FAILED');
      if (this.percentState === 0) {
        if (byte === 0x25) this.percentState = 1;
        else decoded[outputLength++] = byte;
        continue;
      }
      const nibble =
        byte >= 0x30 && byte <= 0x39
          ? byte - 0x30
          : byte >= 0x41 && byte <= 0x46
            ? byte - 0x37
            : byte >= 0x61 && byte <= 0x66
              ? byte - 0x57
              : -1;
      if (nibble < 0) fail('DIAGRAM_PARSE_FAILED');
      if (this.percentState === 1) {
        this.highNibble = nibble;
        this.percentState = 2;
      } else {
        decoded[outputLength++] = (this.highNibble << 4) | nibble;
        this.percentState = 0;
      }
    }
    if (outputLength === 0) return;
    try {
      const text = this.decoder.decode(decoded.subarray(0, outputLength), { stream: true });
      if (text) await this.emit(text);
    } catch (error) {
      rethrowStreamFailure(error);
    }
  }

  async end(): Promise<void> {
    if (this.percentState !== 0) fail('DIAGRAM_PARSE_FAILED');
    try {
      const tail = this.decoder.decode();
      if (tail) await this.emit(tail);
    } catch (error) {
      rethrowStreamFailure(error);
    }
  }
}

class StreamingCompressedPageScanner {
  private readonly stream = new DecompressionStream('deflate-raw');
  private readonly writer = this.stream.writable.getWriter();
  private readonly output = new Uint8Array(BASE64_OUTPUT_CHUNK_BYTES);
  private readonly quartet: number[] = [];
  private outputLength = 0;
  private paddingFinished = false;
  private inflatedUriBytes = 0;
  private failure: unknown = null;
  private readonly readPromise: Promise<void>;

  constructor(private readonly page: GraphPageScanner) {
    const percentDecoder = new StreamingPercentUtf8Decoder((source) => this.page.write(source));
    this.readPromise = this.readInflated(percentDecoder);
    void this.readPromise.catch((error) => {
      this.failure = error;
    });
  }

  async write(source: string): Promise<void> {
    for (const character of source) {
      const value = base64Value(character);
      if (value === -3) continue;
      if (this.paddingFinished) fail('DIAGRAM_PARSE_FAILED');
      if (value < -1) fail('DIAGRAM_PARSE_FAILED');
      this.quartet.push(value);
      if (this.quartet.length === 4) await this.flushQuartet();
    }
  }

  async end(): Promise<number> {
    if (this.quartet.length === 1) fail('DIAGRAM_PARSE_FAILED');
    if (this.quartet.length > 1) {
      while (this.quartet.length < 4) this.quartet.push(-1);
      await this.flushQuartet();
    }
    await this.flushOutput();
    try {
      await this.writer.close();
      await this.readPromise;
    } catch (error) {
      rethrowStreamFailure(this.failure ?? error);
    }
    return this.page.finish();
  }

  private async flushQuartet(): Promise<void> {
    const [a, b, c, d] = this.quartet;
    this.quartet.length = 0;
    if (a < 0 || b < 0 || (c < 0 && d >= 0)) fail('DIAGRAM_PARSE_FAILED');
    this.output[this.outputLength++] = (a << 2) | (b >> 4);
    if (c >= 0) this.output[this.outputLength++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) this.output[this.outputLength++] = ((c & 3) << 6) | d;
    if (c < 0 || d < 0) this.paddingFinished = true;
    if (this.outputLength >= this.output.byteLength - 3) await this.flushOutput();
  }

  private async flushOutput(): Promise<void> {
    if (this.outputLength === 0) return;
    const chunk = this.output.slice(0, this.outputLength);
    this.outputLength = 0;
    try {
      await this.writer.write(chunk);
    } catch (error) {
      rethrowStreamFailure(this.failure ?? error);
    }
  }

  private async readInflated(percentDecoder: StreamingPercentUtf8Decoder): Promise<void> {
    const reader = this.stream.readable.getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        this.inflatedUriBytes += result.value.byteLength;
        if (this.inflatedUriBytes > ONLY_PREVIEW_DRAWIO_MAX_EXPANDED_BYTES) {
          await reader.cancel();
          fail('DIAGRAM_LIMIT');
        }
        await percentDecoder.write(result.value);
      }
      await percentDecoder.end();
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      rethrowStreamFailure(error);
    }
  }
}

type PageMode = 'pending' | 'direct' | 'escaped' | 'compressed';

class DrawioDocumentScanner {
  private root: 'none' | 'mxfile' | 'graph' | 'done' = 'none';
  private pageMode: PageMode | null = null;
  private page: GraphPageScanner | null = null;
  private escapedDecoder: StreamingXmlEntityDecoder | null = null;
  private compressedScanner: StreamingCompressedPageScanner | null = null;
  private pageCount = 0;
  private cellCount = 0;
  private expandedBytes = 0;

  async accept(token: XmlToken): Promise<void> {
    if (this.root === 'graph') {
      this.page!.acceptDirectToken(token);
      return;
    }
    if (this.pageMode) {
      await this.acceptPageToken(token);
      return;
    }
    if (token.type === 'text') {
      if (token.raw.trim()) fail('DIAGRAM_PARSE_FAILED');
      return;
    }
    if (token.type === 'meta') {
      if (this.root !== 'none') fail('DIAGRAM_PARSE_FAILED');
      return;
    }
    const name = token.name.toLowerCase();
    if (this.root === 'none') {
      if ((token.type !== 'open' && token.type !== 'self') || name === 'diagram') {
        fail('DIAGRAM_PARSE_FAILED');
      }
      if (name === 'mxgraphmodel') {
        this.root = 'graph';
        this.page = this.createPage();
        this.pageCount = 1;
        this.page.acceptDirectToken(token);
      } else if (name === 'mxfile' && token.type === 'open') this.root = 'mxfile';
      else fail('DIAGRAM_PARSE_FAILED');
      return;
    }
    if (this.root === 'done') fail('DIAGRAM_PARSE_FAILED');
    if (name === 'diagram' && token.type === 'open') {
      this.pageCount += 1;
      if (this.pageCount > ONLY_PREVIEW_DRAWIO_MAX_PAGES) fail('DIAGRAM_LIMIT');
      this.pageMode = 'pending';
      this.page = this.createPage();
      return;
    }
    if (name === 'mxfile' && token.type === 'close') {
      if (this.pageCount === 0) fail('DIAGRAM_EMPTY');
      this.root = 'done';
      return;
    }
    fail('DIAGRAM_PARSE_FAILED');
  }

  finish(): OnlyPreviewDrawioPreflightResult {
    if (this.pageMode) fail('DIAGRAM_PARSE_FAILED');
    if (this.root === 'graph') {
      this.cellCount = this.page!.finish();
      this.root = 'done';
    }
    if (this.root !== 'done' || this.pageCount === 0 || this.cellCount === 0) {
      fail(this.pageCount === 0 ? 'DIAGRAM_EMPTY' : 'DIAGRAM_PARSE_FAILED');
    }
    return {
      pageCount: this.pageCount,
      cellCount: this.cellCount,
      expandedBytes: this.expandedBytes
    };
  }

  private async acceptPageToken(token: XmlToken): Promise<void> {
    if (token.type === 'close' && token.name.toLowerCase() === 'diagram') {
      await this.finishPage();
      return;
    }
    if (this.pageMode === 'pending') {
      if (token.type === 'text') {
        if (!token.raw.trim()) return;
        if (token.raw.trimStart().startsWith('&')) {
          this.pageMode = 'escaped';
          this.escapedDecoder = new StreamingXmlEntityDecoder((source) => this.page!.write(source));
          await this.escapedDecoder.write(token.raw);
        } else {
          this.pageMode = 'compressed';
          this.compressedScanner = new StreamingCompressedPageScanner(this.page!);
          await this.compressedScanner.write(token.raw);
        }
        return;
      }
      if (
        (token.type === 'open' || token.type === 'self') &&
        token.name.toLowerCase() === 'mxgraphmodel'
      ) {
        this.pageMode = 'direct';
        this.page!.acceptDirectToken(token);
        return;
      }
      fail('DIAGRAM_PARSE_FAILED');
    }
    if (this.pageMode === 'direct') {
      this.page!.acceptDirectToken(token);
      return;
    }
    if (token.type !== 'text') fail('DIAGRAM_PARSE_FAILED');
    if (this.pageMode === 'escaped') await this.escapedDecoder!.write(token.raw);
    else await this.compressedScanner!.write(token.raw);
  }

  private async finishPage(): Promise<void> {
    let cells: number;
    if (this.pageMode === 'pending') fail('DIAGRAM_EMPTY');
    if (this.pageMode === 'direct') cells = this.page!.finish();
    else if (this.pageMode === 'escaped') {
      this.escapedDecoder!.end();
      cells = this.page!.finish();
    } else cells = await this.compressedScanner!.end();
    this.cellCount += cells;
    if (this.cellCount > ONLY_PREVIEW_DRAWIO_MAX_CELLS) fail('DIAGRAM_LIMIT');
    this.pageMode = null;
    this.page = null;
    this.escapedDecoder = null;
    this.compressedScanner = null;
  }

  private createPage(): GraphPageScanner {
    return new GraphPageScanner((bytes) => {
      this.expandedBytes += bytes;
      if (this.expandedBytes > ONLY_PREVIEW_DRAWIO_MAX_EXPANDED_BYTES) fail('DIAGRAM_LIMIT');
    });
  }
}

export const preflightOnlyPreviewDrawio = async (
  bytes: ArrayBuffer
): Promise<OnlyPreviewDrawioPreflightResult> => {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) fail('DIAGRAM_EMPTY');
  const documentScanner = new DrawioDocumentScanner();
  const tokenizer = new StreamingXmlTokenizer((token) => documentScanner.accept(token));
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const input = new Uint8Array(bytes);
  try {
    for (let offset = 0; offset < input.byteLength; offset += INPUT_CHUNK_BYTES) {
      const text = decoder.decode(input.subarray(offset, offset + INPUT_CHUNK_BYTES), {
        stream: true
      });
      if (text) await tokenizer.write(text);
    }
    const tail = decoder.decode();
    if (tail) await tokenizer.write(tail);
  } catch (error) {
    rethrowStreamFailure(error);
  }
  tokenizer.end();
  return documentScanner.finish();
};
