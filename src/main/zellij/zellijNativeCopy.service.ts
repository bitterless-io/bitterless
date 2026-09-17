import {
  decodeZellijClientMessage,
  decodeZellijServerMessage,
  encodeZellijClientMessage
} from './zellijNativeProtocol';

const COPY_MARKER = Buffer.from('\x1b[99;9u');
const MAX_COPY_BYTES = 1024 * 1024;
const OSC_PREFIX = '\x1b]52;';

export interface ZellijNativeCopyOptions {
  sendMarker(): Promise<boolean>;
  signal: AbortSignal;
}

interface CopyRequest {
  options: ZellijNativeCopyOptions;
  resolve(text: string): void;
  timer: ReturnType<typeof setTimeout>;
  abort(): void;
  settled: boolean;
  phase: 'marker' | 'before' | 'selection';
  text: string | null;
  osc: string;
  invalid: boolean;
}

/** Copy belongs to this existing attached web client, never a newly connected CLI client.
 * The page's Super+C marker follows earlier mouse input over the same WebSocket/native stream.
 * QueryTabNames traverses the same screen -> server FIFO as Copy's OSC52 Render; ConnStatus and
 * CurrentTabInfo do not provide that barrier. No selection is retained outside one request. */
export class ZellijNativeCopyService {
  private active: CopyRequest | null = null;
  private queued: CopyRequest | null = null;
  private disabled = false;

  constructor(
    private readonly send: (frame: Buffer) => void,
    private readonly options: { timeoutMs?: number } = {}
  ) {}

  request(options: ZellijNativeCopyOptions): Promise<string> {
    if (this.disabled || options.signal.aborted) return Promise.resolve('');
    return new Promise((resolve) => {
      const request: CopyRequest = {
        options,
        resolve,
        timer: setTimeout(() => {
          if (this.active === request) {
            // Untagged late barriers cannot be reassigned safely. Keep the terminal alive, but
            // require a new attached peer before copying again after a protocol timeout.
            this.dispose();
          } else if (this.queued === request) {
            this.queued = null;
            this.settle(request, '');
          }
        }, this.options.timeoutMs ?? 1500),
        abort: () => {
          this.settle(request, '');
          if (this.queued === request) this.queued = null;
          // An active marker/fence still has to drain, even though its caller is cancelled.
        },
        settled: false,
        phase: 'marker',
        text: null,
        osc: '',
        invalid: false
      };
      options.signal.addEventListener('abort', request.abort, { once: true });
      if (this.active) {
        if (this.queued) this.settle(this.queued, '');
        this.queued = request;
      } else this.start(request);
    });
  }

  /** Always swallow the reserved plain Cmd+C marker, including a cancelled or late marker. */
  consumeClientFrame(body: Buffer): boolean {
    let bytes: number[] | undefined;
    try {
      bytes = decodeZellijClientMessage(body).key?.rawBytes;
    } catch {
      this.dispose();
      return false;
    }
    if (!bytes || !Buffer.from(bytes).equals(COPY_MARKER)) return false;
    const request = this.active;
    if (!request || request.phase !== 'marker') return true;
    if (request.settled) {
      this.complete(request, '');
      return true;
    }
    request.phase = 'before';
    const action = (value: 'copy' | 'queryTabNames'): Buffer =>
      encodeZellijClientMessage({ action: { action: { [value]: {} }, isCliClient: false } });
    this.send(Buffer.concat([action('queryTabNames'), action('copy'), action('queryTabNames')]));
    return true;
  }

  /** Consume only this transaction's barrier logs; all terminal rendering remains untouched. */
  consumeServerFrame(body: Buffer): boolean {
    const request = this.active;
    if (!request || request.phase === 'marker') return false;
    try {
      const reply = decodeZellijServerMessage(body);
      if (reply.exit || reply.logError) {
        this.dispose();
        return false;
      }
      if (reply.log) {
        if (request.phase === 'before') request.phase = 'selection';
        else this.complete(request, request.invalid || request.osc ? '' : (request.text ?? ''));
        return true;
      }
      if (request.phase === 'selection' && !request.settled && reply.render?.content)
        this.capture(request, reply.render.content);
    } catch {
      this.dispose();
    }
    return false;
  }

  dispose(): void {
    this.disabled = true;
    if (this.queued) this.settle(this.queued, '');
    this.queued = null;
    if (this.active) {
      clearTimeout(this.active.timer);
      this.settle(this.active, '');
    }
    this.active = null;
  }

  private start(request: CopyRequest): void {
    this.active = request;
    void request.options
      .sendMarker()
      .then((sent) => {
        if (!sent && this.active === request) this.complete(request, '');
      })
      .catch(() => {
        // Navigation can reject after the marker was sent. Reserve its slot until drained/timeout.
        this.settle(request, '');
      });
  }

  private settle(request: CopyRequest, text: string): void {
    if (request.settled) return;
    request.settled = true;
    request.options.signal.removeEventListener('abort', request.abort);
    if (this.active !== request) clearTimeout(request.timer);
    request.text = null;
    request.osc = '';
    request.resolve(request.options.signal.aborted ? '' : text);
  }

  private complete(request: CopyRequest, text: string): void {
    if (this.active !== request) return;
    clearTimeout(request.timer);
    this.settle(request, text);
    this.active = null;
    const queued = this.queued;
    this.queued = null;
    if (queued) this.start(queued);
  }

  private capture(request: CopyRequest, content: string): void {
    if (request.invalid) return;
    let pending = request.osc + content;
    request.osc = '';
    while (pending) {
      const start = pending.indexOf(OSC_PREFIX);
      if (start < 0) {
        for (let length = OSC_PREFIX.length - 1; length > 0; length--) {
          if (pending.endsWith(OSC_PREFIX.slice(0, length))) {
            request.osc = pending.slice(-length);
            break;
          }
        }
        return;
      }
      pending = pending.slice(start);
      const bell = pending.indexOf('\x07');
      const st = pending.indexOf('\x1b\\');
      const end = bell < 0 ? st : st < 0 ? bell : Math.min(bell, st);
      if (end < 0) {
        if (pending.length > MAX_COPY_BYTES * 2) request.invalid = true;
        else request.osc = pending;
        return;
      }
      const payload = pending.slice(OSC_PREFIX.length, end).match(/^[cp]*;([A-Za-z0-9+/=]*)$/);
      const encoded = payload?.[1];
      if (encoded === undefined || encoded.length > MAX_COPY_BYTES * 2 || request.text !== null) {
        request.invalid = true;
        return;
      }
      const decoded = Buffer.from(encoded, 'base64');
      if (decoded.length > MAX_COPY_BYTES || decoded.toString('base64') !== encoded) {
        request.invalid = true;
        return;
      }
      request.text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(decoded);
      pending = pending.slice(end + (end === bell ? 1 : 2));
    }
  }
}
