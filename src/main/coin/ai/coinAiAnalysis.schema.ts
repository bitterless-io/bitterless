import { Buffer } from 'node:buffer';
import { z } from 'zod';
import {
  COIN_AI_EFFORTS,
  COIN_AI_MODEL_EFFORTS,
  COIN_AI_MODELS,
  COIN_AI_RECEIPT_MODELS,
  type CoinAiAnalysisReceipt,
  type CoinAiAnalysisResult,
  type CoinAiAnalyzeInput,
  type CoinAiCancelInput,
} from '@shared/coin/coinAnalysis.type';

export const COIN_AI_MAX_CONTEXT_BYTES = 48 * 1024;
export const COIN_AI_MAX_OUTPUT_BYTES = 24 * 1024;
export const COIN_AI_MAX_RECEIPTS = 100;

const boundedString = (max: number): z.ZodString => z.string().trim().min(1).max(max);
const evidenceRefsSchema = z.array(boundedString(160)).min(1).max(64).superRefine((refs, context) => {
  if (new Set(refs).size !== refs.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Evidence references must be unique.' });
  }
});

export const coinAiTargetSchema = z.object({
  kind: z.enum(['monitor', 'screener', 'meme', 'strategy']),
  resultId: boundedString(160),
}).strict();

export const coinAiAnalysisResultSchema = z.object({
  schema: z.literal('coin-ai-analysis-v1'),
  summary: boundedString(1_200),
  attentionThesis: z.array(boundedString(600)).max(12),
  risks: z.array(boundedString(600)).max(12),
  evidenceRefs: evidenceRefsSchema,
  unsupportedClaims: z.array(boundedString(600)).max(12),
  confidence: z.number().finite().min(0).max(1),
}).strict();

export const coinAiAnalysisReceiptSchema = z.object({
  schema: z.literal('coin-ai-analysis-receipt-v1'),
  runId: z.string().uuid(),
  target: coinAiTargetSchema,
  provider: z.literal('openai-codex'),
  model: z.enum(COIN_AI_RECEIPT_MODELS),
  effort: z.enum(COIN_AI_EFFORTS),
  contextHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  startedAt: z.number().finite().nonnegative(),
  completedAt: z.number().finite().nonnegative(),
  evidenceRefs: evidenceRefsSchema,
  result: coinAiAnalysisResultSchema,
}).strict().superRefine((receipt, context) => {
  if (receipt.completedAt < receipt.startedAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['completedAt'],
      message: 'Completion must not precede start.',
    });
  }
  if (
    receipt.evidenceRefs.length !== receipt.result.evidenceRefs.length ||
    receipt.evidenceRefs.some((ref, index) => ref !== receipt.result.evidenceRefs[index])
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['evidenceRefs'],
      message: 'Receipt evidence must match validated result evidence.',
    });
  }
});

export const coinAiAnalyzeInputSchema = z.object({
  runId: z.string().uuid(),
  target: coinAiTargetSchema,
  model: z.enum(COIN_AI_MODELS),
  effort: z.enum(COIN_AI_EFFORTS),
}).strict().superRefine((input, context) => {
  if (!COIN_AI_MODEL_EFFORTS[input.model].some((effort) => effort === input.effort)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['effort'],
      message: 'Selected model does not support this effort.',
    });
  }
});

export const coinAiCancelInputSchema = z.object({
  runId: z.string().uuid(),
}).strict();

export const parseCoinAiAnalyzeInput = (value: unknown): CoinAiAnalyzeInput =>
  coinAiAnalyzeInputSchema.parse(value) as CoinAiAnalyzeInput;

export const parseCoinAiCancelInput = (value: unknown): CoinAiCancelInput =>
  coinAiCancelInputSchema.parse(value) as CoinAiCancelInput;

export const parseCoinAiAnalysisReceipt = (value: unknown): CoinAiAnalysisReceipt =>
  coinAiAnalysisReceiptSchema.parse(value) as CoinAiAnalysisReceipt;

export const parseCoinAiAnalysisText = (
  value: string,
  supportedEvidenceIds: ReadonlySet<string>,
): CoinAiAnalysisResult => {
  if (Buffer.byteLength(value, 'utf8') > COIN_AI_MAX_OUTPUT_BYTES) {
    throw new Error('coin-ai-output-too-large');
  }
  if (!value || value.charCodeAt(0) === 0xfeff || value.trimStart().startsWith('```')) {
    throw new Error('coin-ai-invalid-json');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('coin-ai-invalid-json');
  }
  const result = coinAiAnalysisResultSchema.parse(parsed) as CoinAiAnalysisResult;
  for (const ref of result.evidenceRefs) {
    if (!supportedEvidenceIds.has(ref)) throw new Error('coin-ai-unsupported-evidence');
  }
  return result;
};
