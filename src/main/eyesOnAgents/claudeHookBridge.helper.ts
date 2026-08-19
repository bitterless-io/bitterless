import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import {
  createClaudeHookEventV2,
  parseClaudeHookHelperArgs,
  toMetadataOnlyClaudeHookDelivery
} from '@shared/eyesOnAgents/claudeHookBridge.contract';
import type {
  ClaudeHookDelivery,
  ClaudeHookHelperArgs,
  ClaudeHookMetadataOnlyDelivery
} from '@shared/eyesOnAgents/claudeHookBridge.type';
import {
  persistClaudeHookOutboxDelivery,
  sendClaudeHookDelivery
} from './claudeHookOutbox.service';

const MAX_INPUT_BYTES = 1024 * 1024;

export const readClaudeHookInput = (
  input: Readable,
  maxBytes = MAX_INPUT_BYTES
): Promise<unknown> => new Promise((resolve, reject) => {
  const chunks: Buffer[] = [];
  let bytes = 0;
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
      reject(new Error('Claude hook input is not valid JSON'));
    }
  };
  const onData = (chunk: Buffer | string): void => {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.length;
    if (bytes > maxBytes) {
      input.pause();
      finish(new Error('Claude hook input is too large'));
      return;
    }
    chunks.push(value);
  };
  const onEnd = (): void => finish();
  const onError = (): void => finish(new Error('Unable to read Claude hook input'));
  input.on('data', onData);
  input.once('end', onEnd);
  input.once('error', onError);
});

export interface ClaudeHookHelperDependencies {
  parseArgs?: (argv: readonly string[]) => ClaudeHookHelperArgs;
  readInput?: (input: Readable) => Promise<unknown>;
  send?: (args: ClaudeHookHelperArgs, delivery: ClaudeHookDelivery) => Promise<boolean>;
  persist?: (params: {
    outboxPath: string;
    delivery: ClaudeHookMetadataOnlyDelivery;
  }) => boolean;
  isLastUserPromptCaptureEnabled?: (outboxPath: string) => boolean;
  now?: () => number;
  idFactory?: () => string;
}

export const isClaudeHookLastUserPromptCaptureEnabled = (outboxPath: string): boolean => {
  try {
    return lstatSync(join(
      dirname(dirname(outboxPath)),
      'claude-last-user-prompt.enabled'
    )).isFile();
  } catch {
    return false;
  }
};

export const runClaudeHookHelper = async (
  argv: readonly string[],
  input: Readable,
  dependencies: ClaudeHookHelperDependencies = {}
): Promise<void> => {
  try {
    const args = (dependencies.parseArgs ?? parseClaudeHookHelperArgs)(argv);
    const rawInput = await (dependencies.readInput ?? readClaudeHookInput)(input);
    const deliveryId = (dependencies.idFactory ?? randomUUID)();
    let captureUserPrompt = false;
    try {
      captureUserPrompt = (
        dependencies.isLastUserPromptCaptureEnabled ??
        isClaudeHookLastUserPromptCaptureEnabled
      )(args.outboxPath);
    } catch {
      captureUserPrompt = false;
    }
    const event = createClaudeHookEventV2({
      rawInput,
      eventId: deliveryId,
      occurredAt: (dependencies.now ?? Date.now)(),
      captureUserPrompt
    });
    const delivery: ClaudeHookDelivery = {
      schemaVersion: 1,
      deliveryId,
      installationId: args.installationId,
      event
    };
    let committed = false;
    try {
      committed = await (dependencies.send ?? (async (helperArgs, value) => (
        await sendClaudeHookDelivery(helperArgs.endpoint, value)
      )))(args, delivery);
    } catch {
      committed = false;
    }
    if (!committed) {
      const metadataOnlyDelivery = toMetadataOnlyClaudeHookDelivery(delivery);
      (dependencies.persist ?? persistClaudeHookOutboxDelivery)({
        outboxPath: args.outboxPath,
        delivery: metadataOnlyDelivery
      });
    }
  } catch {
    // Observation is best-effort and must never block Claude Code.
  }
};
