import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import {
  decodeZellijClientMessage,
  encodeZellijConnectedFrame,
  encodeZellijExitFrame,
  encodeZellijNativeFrame,
  ZellijNativeFrameDecoder
} from './zellijNativeProtocol';
import { ZellijNativeCopyService, type ZellijNativeCopyOptions } from './zellijNativeCopy.service';

interface SessionBridge {
  server: Server;
  target: string | null;
  generation: number;
  peers: Set<Socket>;
  clients: Set<ZellijNativeCopyService>;
}

/** Web-only discovery never enumerates canonical native sockets. ConnStatus describes this
 * live bridge, while the runtime independently verifies the actual session before navigation.
 * Tombstones prevent native Web auto-creation during an in-flight reconnect after tab closure. */
export class ZellijWebBridgeService {
  readonly directory: string;
  private readonly bridges = new Map<string, SessionBridge>();
  private readonly pending = new Map<string, Promise<void>>();
  private stopped = false;

  constructor(private readonly failed: (session: string) => void) {
    this.directory = mkdtempSync('/tmp/bzw-');
    mkdirSync(join(this.directory, 'contract_version_1'), { mode: 0o700 });
  }

  async register(session: string, target: string): Promise<void> {
    if (this.stopped || !/^[a-z0-9-]{1,48}$/u.test(session)) throw new Error('operation-failed');
    await this.pending.get(session);
    if (this.stopped) throw new Error('operation-failed');
    const previous = this.bridges.get(session);
    if (previous) {
      if (previous.target === target) return;
      previous.generation += 1;
      previous.target = target;
      for (const client of previous.clients) client.dispose();
      previous.clients.clear();
      return;
    }
    const server = createServer((socket) => this.connect(session, socket));
    const bridge: SessionBridge = {
      server,
      target,
      generation: 0,
      peers: new Set(),
      clients: new Set()
    };
    this.bridges.set(session, bridge);
    const pending = new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(join(this.directory, 'contract_version_1', session), () => {
        server.removeListener('error', reject);
        server.on('error', () => this.fail(session, bridge, bridge.generation));
        resolve();
      });
    })
      .catch((error) => {
        if (this.bridges.get(session) === bridge) this.bridges.delete(session);
        server.close();
        throw error;
      })
      .finally(() => {
        if (this.pending.get(session) === pending) this.pending.delete(session);
      });
    this.pending.set(session, pending);
    await pending;
    if (this.stopped) throw new Error('operation-failed');
  }

  retire(session: string): void {
    const bridge = this.bridges.get(session);
    if (!bridge) return;
    bridge.generation += 1;
    bridge.target = null;
    for (const client of bridge.clients) client.dispose();
    bridge.clients.clear();
    for (const socket of bridge.peers) socket.destroy();
    bridge.peers.clear();
  }

  async copySelection(session: string, options: ZellijNativeCopyOptions): Promise<string> {
    const bridge = this.bridges.get(session);
    if (this.stopped || !bridge?.target || bridge.clients.size !== 1 || options.signal.aborted)
      return '';
    const client = [...bridge.clients][0];
    const generation = bridge.generation;
    const text = await client.request(options);
    return !this.stopped &&
      bridge.generation === generation &&
      bridge.target &&
      bridge.clients.size === 1 &&
      bridge.clients.has(client) &&
      !options.signal.aborted
      ? text
      : '';
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await Promise.allSettled([...this.pending.values()]);
    await Promise.all(
      [...this.bridges.entries()].map(([session, bridge]) => {
        this.retire(session);
        return new Promise<void>((resolve) => bridge.server.close(() => resolve()));
      })
    );
    this.bridges.clear();
    rmSync(this.directory, { recursive: true, force: true });
  }

  private fail(session: string, bridge: SessionBridge, generation: number): void {
    if (this.stopped || bridge.generation !== generation || !bridge.target) return;
    this.retire(session);
    this.failed(session);
  }

  private connect(session: string, socket: Socket): void {
    const bridge = this.bridges.get(session);
    if (!bridge || this.stopped) return void socket.destroy();
    const generation = bridge.generation;
    bridge.peers.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => bridge.peers.delete(socket));
    let bytes = Buffer.alloc(0);
    const timer = setTimeout(() => socket.destroy(), 1_000);
    socket.once('close', () => clearTimeout(timer));
    const first = (chunk: Buffer): void => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length < 4) return;
      const length = bytes.readUInt32LE();
      if (!length || length > 1024 * 1024 || bytes.length > 2 * 1024 * 1024)
        return void socket.destroy();
      if (bytes.length < length + 4) return;
      socket.removeListener('data', first);
      socket.pause();
      clearTimeout(timer);
      let webClient = false;
      try {
        const hello = decodeZellijClientMessage(bytes.subarray(4, length + 4));
        if (hello.message === 'connStatus') {
          socket.end(encodeZellijConnectedFrame());
          return;
        }
        webClient = hello.attachClient?.isWebClient === true;
      } catch {
        socket.destroy();
        return;
      }
      const target = bridge.target;
      if (!target || bridge.generation !== generation) {
        socket.end(encodeZellijExitFrame('Terminal session is closed.'));
        return;
      }
      const upstream = createConnection(target);
      bridge.peers.add(upstream);
      const connectTimer = setTimeout(() => {
        upstream.destroy();
        this.fail(session, bridge, generation);
      }, 750);
      let replyTimer: ReturnType<typeof setTimeout> | null = null;
      let copy: ZellijNativeCopyService | null = null;
      upstream.once('connect', () => {
        clearTimeout(connectTimer);
        if (bridge.generation !== generation || this.stopped) return void upstream.destroy();
        replyTimer = setTimeout(() => this.fail(session, bridge, generation), 3_000);
        upstream.once('data', () => {
          if (replyTimer) clearTimeout(replyTimer);
          replyTimer = null;
        });
        if (webClient) {
          // A reload can briefly overlap peers. Cancel old copy requests before exposing the new
          // attached client; never guess which of two clients owns a surface's current selection.
          for (const client of bridge.clients) client.dispose();
          let inputBlocked = false;
          let outputBlocked = false;
          const send = (frame: Buffer): void => {
            if (!upstream.write(frame) && !inputBlocked) {
              inputBlocked = true;
              socket.pause();
              upstream.once('drain', () => {
                inputBlocked = false;
                socket.resume();
              });
            }
          };
          const client = new ZellijNativeCopyService(send);
          copy = client;
          bridge.clients.add(client);
          const input = new ZellijNativeFrameDecoder(8 * 1024 * 1024);
          const output = new ZellijNativeFrameDecoder(8 * 1024 * 1024);
          const forwardInput = (chunk: Buffer): void => {
            try {
              for (const body of input.push(chunk))
                if (!client.consumeClientFrame(body)) send(encodeZellijNativeFrame(body));
            } catch {
              client.dispose();
              socket.destroy();
            }
          };
          socket.on('data', forwardInput);
          upstream.on('data', (chunk: Buffer) => {
            try {
              for (const body of output.push(chunk)) {
                if (
                  !client.consumeServerFrame(body) &&
                  !socket.write(encodeZellijNativeFrame(body)) &&
                  !outputBlocked
                ) {
                  outputBlocked = true;
                  upstream.pause();
                  socket.once('drain', () => {
                    outputBlocked = false;
                    upstream.resume();
                  });
                }
              }
            } catch {
              client.dispose();
              socket.destroy();
            }
          });
          forwardInput(bytes);
          if (!inputBlocked) socket.resume();
        } else {
          upstream.write(bytes);
          socket.pipe(upstream);
          upstream.pipe(socket);
        }
      });
      upstream.once('error', () => this.fail(session, bridge, generation));
      upstream.once('close', () => {
        clearTimeout(connectTimer);
        if (replyTimer) clearTimeout(replyTimer);
        copy?.dispose();
        if (copy) bridge.clients.delete(copy);
        bridge.peers.delete(upstream);
        socket.destroy();
      });
      socket.once('close', () => {
        copy?.dispose();
        if (copy) bridge.clients.delete(copy);
        upstream.destroy();
      });
    };
    socket.on('data', first);
  }
}
