import { z } from 'zod';
import {
  MODEL_PROVIDER_CODEX_EFFORT,
  MODEL_PROVIDER_CODEX_ID,
  MODEL_PROVIDER_CODEX_MODEL,
  MODEL_PROVIDER_RECORD_SCHEMA_VERSION,
  MODEL_PROVIDER_SNAPSHOT_SCHEMA,
  type ModelProviderConnectInput,
  type ModelProviderDisconnectInput,
  type ModelProviderRecord,
  type ModelProviderSnapshot
} from './modelProvider.contract';

export const modelProviderAuthStateSchema = z.enum([
  'login_required',
  'authenticating',
  'ready',
  'invalidated',
  'unavailable'
]);

export const modelProviderInvalidationReasonSchema = z.enum([
  'expired',
  'invalid-grant',
  'invalid-token',
  'revoked',
  'sign-in-required',
  'unauthorized'
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const fixedTargetValue = (value: unknown): unknown =>
  isRecord(value)
    ? {
        ...value,
        model: MODEL_PROVIDER_CODEX_MODEL,
        effort: MODEL_PROVIDER_CODEX_EFFORT
      }
    : value;

export const modelProviderTargetSchema = z.preprocess(
  fixedTargetValue,
  z
    .object({
      provider: z.literal(MODEL_PROVIDER_CODEX_ID),
      model: z.literal(MODEL_PROVIDER_CODEX_MODEL),
      effort: z.literal(MODEL_PROVIDER_CODEX_EFFORT)
    })
    .strict()
);

export const modelProviderRecordSchema = z
  .preprocess((value) => {
    if (!isRecord(value)) return value;
    return {
      ...value,
      configuredModels: [MODEL_PROVIDER_CODEX_MODEL],
      defaultTarget: fixedTargetValue(value.defaultTarget)
    };
  }, z
    .object({
      schemaVersion: z.literal(MODEL_PROVIDER_RECORD_SCHEMA_VERSION),
      provider: z.literal(MODEL_PROVIDER_CODEX_ID),
      configuredModels: z.tuple([z.literal(MODEL_PROVIDER_CODEX_MODEL)]),
      defaultTarget: modelProviderTargetSchema,
      authState: modelProviderAuthStateSchema,
      invalidationReason: modelProviderInvalidationReasonSchema.nullable(),
      lastObservedAt: z.number().int().nonnegative(),
      lastSuccessfulRuntimeAt: z.number().int().nonnegative().nullable()
    })
    .strict())
  .superRefine((record, context) => {
    if (record.authState === 'invalidated' && record.invalidationReason === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['invalidationReason'],
        message: 'Invalidated providers require a reason.'
      });
    }
    if (record.authState !== 'invalidated' && record.invalidationReason !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['invalidationReason'],
        message: 'Only invalidated providers may retain an invalidation reason.'
      });
    }
  });

export const modelProviderSnapshotSchema = z
  .object({
    schema: z.literal(MODEL_PROVIDER_SNAPSHOT_SCHEMA),
    observedAt: z.number().int().nonnegative(),
    providers: z.tuple([modelProviderRecordSchema]),
    availableTargets: z.array(modelProviderTargetSchema).max(1)
  })
  .strict()
  .superRefine((snapshot, context) => {
    const ready = snapshot.providers[0].authState === 'ready';
    if (ready !== (snapshot.availableTargets.length === 1)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['availableTargets'],
        message: 'The fixed target is available exactly when Codex is ready.'
      });
    }
  });

export const modelProviderConnectInputSchema = z
  .object({
    provider: z.literal(MODEL_PROVIDER_CODEX_ID),
    method: z.enum(['browser', 'device_code'])
  })
  .strict();

export const modelProviderDisconnectInputSchema = z
  .object({
    provider: z.literal(MODEL_PROVIDER_CODEX_ID)
  })
  .strict();

export const parseModelProviderRecord = (value: unknown): ModelProviderRecord =>
  modelProviderRecordSchema.parse(value) as ModelProviderRecord;

export const parseModelProviderSnapshot = (value: unknown): ModelProviderSnapshot =>
  modelProviderSnapshotSchema.parse(value) as ModelProviderSnapshot;

export const parseModelProviderConnectInput = (value: unknown): ModelProviderConnectInput =>
  modelProviderConnectInputSchema.parse(value) as ModelProviderConnectInput;

export const parseModelProviderDisconnectInput = (value: unknown): ModelProviderDisconnectInput =>
  modelProviderDisconnectInputSchema.parse(value) as ModelProviderDisconnectInput;
