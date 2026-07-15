import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  CoinAiAnalysisReceipt,
  CoinPersistentData,
  CoinStateLoadResult,
  CoinStateRecoveryResult,
  CoinStateSaveResult,
  CoinStateSnapshot,
} from '@shared/coin/coinAnalysis.type';
import { createDefaultCoinPersistentData } from '@shared/coin/coinAnalysis.type';
import {
  parseCoinPersistentData,
  parseCoinStateSaveInput,
  parseCoinStateSnapshot,
} from './coinState.schema';
import {
  COIN_AI_MAX_RECEIPTS,
  parseCoinAiAnalysisReceipt,
} from '../ai/coinAiAnalysis.schema';

const MAX_STATE_BYTES = 4 * 1024 * 1024;

export interface CoinStateServiceDependencies {
  userDataRoot(): string;
  now?: () => number;
}

export type CoinAiReceiptAppendResult =
  | { status: 'saved'; snapshot: CoinStateSnapshot }
  | { status: 'cancelled' | 'conflict' | 'malformed' | 'target-not-found'; snapshot: null };

export class CoinStateService {
  private readonly now: () => number;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: CoinStateServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
  }

  get filePath(): string {
    return join(this.dependencies.userDataRoot(), 'coin', 'coin-state.json');
  }

  load(): CoinStateLoadResult {
    if (!existsSync(this.filePath)) {
      return { status: 'ready', snapshot: this.defaultSnapshot() };
    }
    try {
      if (statSync(this.filePath).size > MAX_STATE_BYTES) throw new Error('state-too-large');
      const snapshot = parseCoinStateSnapshot(
        JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown,
      );
      return { status: 'ready', snapshot };
    } catch {
      return {
        status: 'malformed',
        snapshot: null,
        error: { code: 'coin-state-malformed', recoverable: true },
      };
    }
  }

  async save(value: unknown): Promise<CoinStateSaveResult> {
    let input: ReturnType<typeof parseCoinStateSaveInput>;
    try {
      input = parseCoinStateSaveInput(value);
    } catch {
      return { status: 'malformed', snapshot: null };
    }

    let result: CoinStateSaveResult = { status: 'malformed', snapshot: null };
    const operation = this.saveQueue.then(() => {
      const current = this.load();
      if (current.status !== 'ready') {
        result = { status: 'malformed', snapshot: null };
        return;
      }
      if (current.snapshot.revision !== input.expectedRevision) {
        result = { status: 'conflict', snapshot: current.snapshot };
        return;
      }
      const inputData = parseCoinPersistentData(input.data);
      const snapshot: CoinStateSnapshot = {
        schema: 'coin-state-v1',
        revision: current.snapshot.revision + 1,
        updatedAt: this.now(),
        data: parseCoinPersistentData({
          ...inputData,
          ai: {
            ...inputData.ai,
            receipts: current.snapshot.data.ai.receipts
              .filter((receipt) => this.hasAiTarget(inputData, receipt))
              .slice(-COIN_AI_MAX_RECEIPTS),
          },
        }),
      };
      this.write(snapshot);
      result = { status: 'saved', snapshot };
    });
    this.saveQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    try {
      await operation;
      return result;
    } catch {
      return { status: 'malformed', snapshot: null };
    }
  }

  async appendAiReceipt(
    value: unknown,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<CoinAiReceiptAppendResult> {
    let receipt: CoinAiAnalysisReceipt;
    try {
      receipt = parseCoinAiAnalysisReceipt(value);
    } catch {
      return { status: 'malformed', snapshot: null };
    }

    let result: CoinAiReceiptAppendResult = { status: 'malformed', snapshot: null };
    const operation = this.saveQueue.then(() => {
      if (signal?.aborted) {
        result = { status: 'cancelled', snapshot: null };
        return;
      }
      const current = this.load();
      if (current.status !== 'ready') return;
      if (current.snapshot.revision !== expectedRevision) {
        result = { status: 'conflict', snapshot: null };
        return;
      }
      if (!this.hasAiTarget(current.snapshot.data, receipt)) {
        result = { status: 'target-not-found', snapshot: null };
        return;
      }

      const existing = current.snapshot.data.ai.receipts.filter(
        ({ runId }) => runId !== receipt.runId,
      );
      const data = parseCoinPersistentData({
        ...current.snapshot.data,
        ai: {
          model: receipt.model,
          effort: receipt.effort,
          receipts: [...existing, receipt].slice(-COIN_AI_MAX_RECEIPTS),
        },
      });
      const snapshot: CoinStateSnapshot = {
        schema: 'coin-state-v1',
        revision: current.snapshot.revision + 1,
        updatedAt: this.now(),
        data,
      };
      if (signal?.aborted) {
        result = { status: 'cancelled', snapshot: null };
        return;
      }
      this.write(snapshot);
      result = { status: 'saved', snapshot };
    });
    this.saveQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    try {
      await operation;
      return result;
    } catch {
      return { status: 'malformed', snapshot: null };
    }
  }

  async recover(): Promise<CoinStateRecoveryResult> {
    let result: CoinStateRecoveryResult = { status: 'failed', snapshot: null };
    const operation = this.saveQueue.then(() => {
      const directory = dirname(this.filePath);
      this.ensurePrivateDirectory(directory);
      if (existsSync(this.filePath)) {
        const quarantinePath = join(directory, `coin-state.corrupt-${this.now()}.json`);
        renameSync(this.filePath, quarantinePath);
        if (process.platform !== 'win32') chmodSync(quarantinePath, 0o600);
      }
      const snapshot = this.defaultSnapshot();
      this.write(snapshot);
      result = { status: 'recovered', snapshot };
    });
    this.saveQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    try {
      await operation;
      return result;
    } catch {
      return { status: 'failed', snapshot: null };
    }
  }

  private defaultSnapshot(): CoinStateSnapshot {
    return {
      schema: 'coin-state-v1',
      revision: 0,
      updatedAt: this.now(),
      data: createDefaultCoinPersistentData(),
    };
  }

  private hasAiTarget(
    data: CoinPersistentData,
    receipt: CoinAiAnalysisReceipt,
  ): boolean {
    if (receipt.target.kind === 'strategy') {
      return data.decisions.some(({ id }) => id === receipt.target.resultId);
    }
    return data.analyses.some(
      ({ id, type }) => id === receipt.target.resultId && type === receipt.target.kind,
    );
  }

  private ensurePrivateDirectory(directory: string): void {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') chmodSync(directory, 0o700);
  }

  private write(snapshot: CoinStateSnapshot): void {
    const parsed = parseCoinStateSnapshot(snapshot);
    const directory = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    this.ensurePrivateDirectory(directory);
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      if (statSync(temporaryPath).size > MAX_STATE_BYTES) throw new Error('state-too-large');
      if (process.platform !== 'win32') chmodSync(temporaryPath, 0o600);
      renameSync(temporaryPath, this.filePath);
      if (process.platform !== 'win32') chmodSync(this.filePath, 0o600);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }
}
