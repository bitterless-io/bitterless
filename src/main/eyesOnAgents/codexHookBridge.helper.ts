import { randomUUID } from 'node:crypto';
import net from 'node:net';
import type { Readable } from 'node:stream';
import {
  CODEX_HOOK_BRIDGE_MAX_FRAME_BYTES,
  createCodexHookEvent,
  parseCodexHookHelperArgs
} from '@shared/eyesOnAgents/codexHookBridge.contract';
import type {
  CodexHookBridgeEndpoint,
  CodexHookEvent,
  CodexHookHelperArgs
} from '@shared/eyesOnAgents/codexHookBridge.type';

const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_ACK_BYTES = 4096;
const HELPER_TIMEOUT_MS = 500;

type EventSender = (endpoint: CodexHookBridgeEndpoint, event: CodexHookEvent) => Promise<void>;

export interface CodexHookHelperDependencies {
  parseArgs?: (argv: string[]) => CodexHookHelperArgs;
  readInput?: (input: Readable) => Promise<unknown>;
  send?: EventSender;
  now?: () => number;
  idFactory?: () => string;
}

export const readCodexHookInput = (
  input: Readable,
  maxBytes = MAX_INPUT_BYTES
): Promise<unknown> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const cleanup = (): void => {
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      } catch {
        reject(new Error('Hook input is not valid JSON'));
      }
    };
    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        input.pause();
        finish(new Error('Hook input is too large'));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = (): void => finish();
    const onError = (): void => finish(new Error('Unable to read hook input'));
    input.on('data', onData);
    input.once('end', onEnd);
    input.once('error', onError);
  });
};

export const sendCodexHookEvent = (
  endpoint: CodexHookBridgeEndpoint,
  event: CodexHookEvent,
  timeoutMs = HELPER_TIMEOUT_MS
): Promise<void> => {
  return new Promise((resolve) => {
    const frame = `${JSON.stringify(event)}\n`;
    if (Buffer.byteLength(frame, 'utf8') > CODEX_HOOK_BRIDGE_MAX_FRAME_BYTES) {
      resolve();
      return;
    }
    const socket = net.createConnection(endpoint.path);
    socket.setEncoding('utf8');
    let settled = false;
    let ack = '';
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.removeAllListeners();
      socket.destroy();
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);
    timeout.unref();
    socket.once('connect', () => socket.write(frame));
    socket.on('data', (chunk: string) => {
      ack += chunk;
      if (Buffer.byteLength(ack, 'utf8') > MAX_ACK_BYTES || ack.includes('\n')) finish();
    });
    socket.once('error', finish);
    socket.once('close', finish);
  });
};

export const runCodexHookHelper = async (
  argv: string[],
  input: Readable,
  dependencies: CodexHookHelperDependencies = {}
): Promise<void> => {
  try {
    const args = (dependencies.parseArgs ?? parseCodexHookHelperArgs)(argv);
    const rawInput = await (dependencies.readInput ?? readCodexHookInput)(input);
    const event = createCodexHookEvent({
      rawInput,
      installationId: args.installationId,
      eventId: (dependencies.idFactory ?? randomUUID)(),
      occurredAt: (dependencies.now ?? Date.now)()
    });
    await (dependencies.send ?? sendCodexHookEvent)(args.endpoint, event);
  } catch {
    // Observation must never block Codex when Bitterless is unavailable or input is malformed.
  }
};
