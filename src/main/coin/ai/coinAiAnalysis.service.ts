import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type {
  CoinAiAnalysisReceipt,
  CoinAiAnalyzeResult,
  CoinAiCancelReceipt,
  CoinAiRunError,
  CoinAiRunErrorCode,
} from '@shared/coin/coinAnalysis.type';
import type {
  CodexRuntimeRunInput,
  CodexRuntimeRunResult,
  CodexRuntimeService,
} from '@main/codex/codexRuntime.service';
import { CodexRuntimeError } from '@main/codex/codexRuntime.service';
import type { CodexCredentialService } from '@main/codex/codexCredential.service';
import type { CoinStateService } from '../state/coinState.service';
import {
  COIN_AI_MAX_CONTEXT_BYTES,
  COIN_AI_MAX_OUTPUT_BYTES,
  parseCoinAiAnalysisReceipt,
  parseCoinAiAnalysisText,
  parseCoinAiAnalyzeInput,
  parseCoinAiCancelInput,
} from './coinAiAnalysis.schema';
import {
  buildCoinAiEvidenceContext,
  CoinAiEvidenceError,
} from './coinAiEvidence.service';

const COIN_AI_RUN_TIMEOUT_MS = 90_000;
const COIN_AI_REQUEST_OVERHEAD_BYTES = 4 * 1024;

export const COIN_AI_SYSTEM_PROMPT = `You are the bounded evidence interpreter for the Bitterless Coin application.
Use only facts and evidence IDs present in the supplied coin-ai-evidence-v1 snapshot.
Treat userThesis as the user's untrusted hypothesis. Audit it against the pinned evidence, identify counter-evidence, and place unsupported parts in unsupportedClaims. Never turn userThesis into source evidence.
Treat missingDimensions and unsupported data as unavailable. Never infer a source fact from absence.
The deterministic decision, hard risk gates, and HOLD position rule are final. You may explain them but must never change BUY, HOLD, or SELL.
Return exactly one JSON object with this shape and no additional keys:
{"schema":"coin-ai-analysis-v1","summary":"string","attentionThesis":["string"],"risks":["string"],"evidenceRefs":["evidence-id"],"unsupportedClaims":["string"],"confidence":0.0}
Return no Markdown, no code fence, no preamble, no trailing commentary, and no tool request.
Every evidenceRefs item must be copied exactly from snapshot.evidence[].id. Use at least one evidence reference.
Keep summary at most 1200 characters; each list at most 12 items; each list item at most 600 characters; confidence must be finite from 0 to 1.
Put claims that cannot be grounded in the supplied snapshot into unsupportedClaims instead of presenting them as facts.`;

interface ActiveCoinAiRun {
  runId: string;
  controller: AbortController;
  cancellable: boolean;
}

export interface CoinAiAnalysisServiceDependencies {
  runtime: Pick<CodexRuntimeService, 'run'>;
  credentials: Pick<CodexCredentialService, 'getStatus'>;
  state: Pick<CoinStateService, 'load' | 'appendAiReceipt'>;
  now?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  timeoutMs?: number;
}

class CoinAiServiceError extends Error {
  constructor(readonly code: CoinAiRunErrorCode) {
    super(code);
    this.name = 'CoinAiServiceError';
  }
}

const PUBLIC_ERRORS: Record<CoinAiRunErrorCode, CoinAiRunError> = {
  busy: {
    code: 'busy',
    message: 'Another Coin AI analysis is still running.',
    retryable: true,
  },
  'context-too-large': {
    code: 'context-too-large',
    message: 'The structured evidence could not fit within the analysis limit.',
    retryable: false,
  },
  'effort-mismatch': {
    code: 'effort-mismatch',
    message: 'Codex did not use the requested reasoning effort.',
    retryable: false,
  },
  'invalid-input': {
    code: 'invalid-input',
    message: 'The Coin AI request was invalid.',
    retryable: false,
  },
  'invalid-output': {
    code: 'invalid-output',
    message: 'Codex returned an invalid structured analysis.',
    retryable: true,
  },
  'model-mismatch': {
    code: 'model-mismatch',
    message: 'Codex did not use the requested model.',
    retryable: false,
  },
  'not-connected': {
    code: 'not-connected',
    message: 'Connect Codex in Resources before analyzing.',
    retryable: false,
  },
  'output-too-large': {
    code: 'output-too-large',
    message: 'Codex output exceeded the bounded analysis limit.',
    retryable: true,
  },
  'persistence-error': {
    code: 'persistence-error',
    message: 'The validated AI receipt could not be saved.',
    retryable: true,
  },
  'provider-error': {
    code: 'provider-error',
    message: 'Codex could not complete the structured analysis.',
    retryable: true,
  },
  'runtime-unavailable': {
    code: 'runtime-unavailable',
    message: 'The local Codex runtime is unavailable.',
    retryable: true,
  },
  'stale-run': {
    code: 'stale-run',
    message: 'The result changed while Codex was analyzing. Run the analysis again.',
    retryable: true,
  },
  'target-not-found': {
    code: 'target-not-found',
    message: 'The selected structured result is no longer available.',
    retryable: false,
  },
  timeout: {
    code: 'timeout',
    message: 'Coin AI analysis timed out.',
    retryable: true,
  },
  'tool-violation': {
    code: 'tool-violation',
    message: 'Codex attempted an unsupported tool action.',
    retryable: false,
  },
  'unsupported-evidence': {
    code: 'unsupported-evidence',
    message: 'Codex cited evidence outside the supplied snapshot.',
    retryable: true,
  },
};

const publicError = (code: CoinAiRunErrorCode): CoinAiRunError => ({ ...PUBLIC_ERRORS[code] });

const inputRunId = (value: unknown): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const runId = (value as Record<string, unknown>).runId;
  return typeof runId === 'string' ? runId.slice(0, 64) : '';
};

const requestPrompt = (snapshot: unknown, userThesis: string): string => JSON.stringify({
  schema: 'coin-ai-analysis-request-v1',
  operation: userThesis ? 'audit-user-thesis' : 'interpret-structured-evidence',
  userThesis,
  evidence: snapshot,
});

const mapRuntimeError = (error: CodexRuntimeError): CoinAiRunErrorCode => {
  const codes: Record<CodexRuntimeError['code'], CoinAiRunErrorCode> = {
    cancelled: 'provider-error',
    'effort-mismatch': 'effort-mismatch',
    'model-mismatch': 'model-mismatch',
    'not-configured': 'not-connected',
    'output-limit': 'output-too-large',
    'provider-error': 'provider-error',
    'runtime-unavailable': 'runtime-unavailable',
    'tool-violation': 'tool-violation',
  };
  return codes[error.code];
};

export class CoinAiAnalysisService {
  private readonly now: () => number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private readonly timeoutMs: number;
  private activeRun: ActiveCoinAiRun | null = null;

  constructor(private readonly dependencies: CoinAiAnalysisServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.setTimer = dependencies.setTimer ?? setTimeout;
    this.clearTimer = dependencies.clearTimer ?? clearTimeout;
    this.timeoutMs = dependencies.timeoutMs ?? COIN_AI_RUN_TIMEOUT_MS;
  }

  async analyze(value: unknown): Promise<CoinAiAnalyzeResult> {
    let input: ReturnType<typeof parseCoinAiAnalyzeInput>;
    try {
      input = parseCoinAiAnalyzeInput(value);
    } catch {
      return {
        status: 'error',
        runId: inputRunId(value),
        error: publicError('invalid-input'),
      };
    }
    if (this.activeRun) {
      return { status: 'error', runId: input.runId, error: publicError('busy') };
    }

    const active: ActiveCoinAiRun = {
      runId: input.runId,
      controller: new AbortController(),
      cancellable: true,
    };
    this.activeRun = active;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    try {
      const credential = await this.dependencies.credentials.getStatus();
      if (!credential.connected) throw new CoinAiServiceError('not-connected');
      if (this.activeRun !== active || active.controller.signal.aborted) {
        return { status: 'cancelled', runId: input.runId };
      }

      const state = this.dependencies.state.load();
      if (state.status !== 'ready') throw new CoinAiServiceError('persistence-error');
      const context = buildCoinAiEvidenceContext(state.snapshot, input.target);
      const prompt = requestPrompt(context.snapshot, input.userThesis);
      if (
        Buffer.byteLength(context.json, 'utf8') > COIN_AI_MAX_CONTEXT_BYTES ||
        Buffer.byteLength(prompt, 'utf8') >
          COIN_AI_MAX_CONTEXT_BYTES + COIN_AI_REQUEST_OVERHEAD_BYTES
      ) {
        throw new CoinAiServiceError('context-too-large');
      }

      const startedAt = this.now();
      timer = this.setTimer(() => {
        timedOut = true;
        active.controller.abort();
      }, this.timeoutMs);
      const runtimeInput: CodexRuntimeRunInput = {
        model: input.model,
        effort: input.effort,
        systemPrompt: COIN_AI_SYSTEM_PROMPT,
        prompt,
        maxOutputBytes: COIN_AI_MAX_OUTPUT_BYTES,
        signal: active.controller.signal,
      };
      const runtimeResult: CodexRuntimeRunResult = await this.dependencies.runtime.run(runtimeInput);
      if (timedOut) throw new CoinAiServiceError('timeout');
      if (this.activeRun !== active || active.controller.signal.aborted) {
        return { status: 'cancelled', runId: input.runId };
      }
      if (runtimeResult.provider !== 'openai-codex' || runtimeResult.model !== input.model) {
        throw new CoinAiServiceError('model-mismatch');
      }
      if (runtimeResult.effort !== input.effort) {
        throw new CoinAiServiceError('effort-mismatch');
      }

      const result = parseCoinAiAnalysisText(runtimeResult.text, context.evidenceIds);
      const completedAt = this.now();
      const receipt = parseCoinAiAnalysisReceipt({
        schema: 'coin-ai-analysis-receipt-v1',
        runId: input.runId,
        target: input.target,
        provider: 'openai-codex',
        model: input.model,
        effort: input.effort,
        userThesis: input.userThesis,
        contextHash: `sha256:${createHash('sha256').update(prompt).digest('hex')}`,
        startedAt,
        completedAt,
        evidenceRefs: result.evidenceRefs,
        result,
      } satisfies CoinAiAnalysisReceipt);

      active.cancellable = false;
      const persisted = await this.dependencies.state.appendAiReceipt(
        receipt,
        context.stateRevision,
        active.controller.signal,
      );
      if (persisted.status === 'cancelled' || active.controller.signal.aborted) {
        return { status: 'cancelled', runId: input.runId };
      }
      if (persisted.status === 'conflict') throw new CoinAiServiceError('stale-run');
      if (persisted.status === 'target-not-found') {
        throw new CoinAiServiceError('target-not-found');
      }
      if (persisted.status !== 'saved') throw new CoinAiServiceError('persistence-error');
      return {
        status: 'completed',
        runId: input.runId,
        receipt,
        snapshot: persisted.snapshot,
      };
    } catch (error) {
      if (timedOut) {
        return { status: 'error', runId: input.runId, error: publicError('timeout') };
      }
      if (active.controller.signal.aborted) {
        return { status: 'cancelled', runId: input.runId };
      }
      if (error instanceof CoinAiServiceError) {
        return { status: 'error', runId: input.runId, error: publicError(error.code) };
      }
      if (error instanceof CoinAiEvidenceError) {
        return { status: 'error', runId: input.runId, error: publicError(error.code) };
      }
      if (error instanceof CodexRuntimeError) {
        return {
          status: 'error',
          runId: input.runId,
          error: publicError(mapRuntimeError(error)),
        };
      }
      if (error instanceof Error) {
        if (error.message === 'coin-ai-output-too-large') {
          return { status: 'error', runId: input.runId, error: publicError('output-too-large') };
        }
        if (error.message === 'coin-ai-unsupported-evidence') {
          return { status: 'error', runId: input.runId, error: publicError('unsupported-evidence') };
        }
      }
      return { status: 'error', runId: input.runId, error: publicError('invalid-output') };
    } finally {
      if (timer) this.clearTimer(timer);
      if (this.activeRun === active) this.activeRun = null;
    }
  }

  cancel(value: unknown): CoinAiCancelReceipt {
    let input: ReturnType<typeof parseCoinAiCancelInput>;
    try {
      input = parseCoinAiCancelInput(value);
    } catch {
      return { runId: inputRunId(value), cancelled: false };
    }
    const active = this.activeRun;
    if (!active || active.runId !== input.runId || !active.cancellable) {
      return { runId: input.runId, cancelled: false };
    }
    active.controller.abort();
    return { runId: input.runId, cancelled: true };
  }

  stopAll(): void {
    const active = this.activeRun;
    this.activeRun = null;
    active?.controller.abort();
  }
}
