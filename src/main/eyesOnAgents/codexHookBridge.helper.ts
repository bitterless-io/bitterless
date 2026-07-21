import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import {
  createCodexHookDelivery,
  createCodexHookEventV2,
  parseCodexHookHelperArgs,
  toMetadataOnlyCodexHookDelivery
} from '@shared/eyesOnAgents/codexHookBridge.contract';
import type {
  CodexHookDelivery,
  CodexHookHelperArgs,
  CodexHookMetadataOnlyDelivery
} from '@shared/eyesOnAgents/codexHookBridge.type';
import {
  persistCodexHookOutboxDelivery,
  sendCodexHookDelivery,
  type CodexHookDeliveryResult,
  type CodexHookOutboxPersistResult
} from './codexHookOutbox.service';

const MAX_INPUT_BYTES = 1024 * 1024;

type DeliverySender = (
  args: CodexHookHelperArgs,
  delivery: CodexHookDelivery
) => Promise<CodexHookDeliveryResult>;
type OutboxWriter = (params: {
  outboxPath: string;
  delivery: CodexHookMetadataOnlyDelivery;
  now?: number;
}) => CodexHookOutboxPersistResult;

export interface CodexHookHelperDependencies {
  parseArgs?: (argv: string[]) => CodexHookHelperArgs;
  readInput?: (input: Readable) => Promise<unknown>;
  send?: DeliverySender;
  persist?: OutboxWriter;
  isLastUserPromptCaptureEnabled?: (outboxPath: string) => boolean;
  now?: () => number;
  idFactory?: () => string;
}

export const isCodexHookLastUserPromptCaptureEnabled = (outboxPath: string): boolean => {
  try {
    return lstatSync(
      join(dirname(outboxPath), 'last-user-prompt.enabled')
    ).isFile();
  } catch {
    return false;
  }
};

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

export const runCodexHookHelper = async (
  argv: string[],
  input: Readable,
  dependencies: CodexHookHelperDependencies = {}
): Promise<void> => {
  try {
    const args = (dependencies.parseArgs ?? parseCodexHookHelperArgs)(argv);
    const rawInput = await (dependencies.readInput ?? readCodexHookInput)(input);
    const deliveryId = (dependencies.idFactory ?? randomUUID)();
    let captureUserPrompt = false;
    try {
      captureUserPrompt = (
        dependencies.isLastUserPromptCaptureEnabled ??
        isCodexHookLastUserPromptCaptureEnabled
      )(args.outboxPath);
    } catch {
      captureUserPrompt = false;
    }
    const event = createCodexHookEventV2({
      rawInput,
      installationId: args.installationId,
      eventId: deliveryId,
      occurredAt: (dependencies.now ?? Date.now)(),
      captureUserPrompt
    });
    const delivery = createCodexHookDelivery({ deliveryId, event });
    const send = dependencies.send ?? (async (helperArgs, value) => {
      return await sendCodexHookDelivery(helperArgs.endpoint, value);
    });
    let result: CodexHookDeliveryResult = 'unavailable';
    try {
      result = await send(args, delivery);
    } catch {
      result = 'unavailable';
    }
    if (result !== 'committed') {
      const metadataOnlyDelivery = toMetadataOnlyCodexHookDelivery(delivery);
      (dependencies.persist ?? persistCodexHookOutboxDelivery)({
        outboxPath: args.outboxPath,
        delivery: metadataOnlyDelivery,
        now: (dependencies.now ?? Date.now)()
      });
    }
  } catch {
    // Observation must never block Codex when Bitterless is unavailable or input is malformed.
  }
};
