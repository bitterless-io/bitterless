import { z } from 'zod';
import {
  CLAUDE_SUBSCRIPTION_HOST,
  CLAUDE_SUBSCRIPTION_OPERATION_ERROR_CODES,
  CLAUDE_SUBSCRIPTION_MAX_PORT,
  CLAUDE_SUBSCRIPTION_MIN_PORT,
  CLAUDE_SUBSCRIPTION_SNAPSHOT_SCHEMA,
  type ClaudeSubscriptionAccountIdInput,
  type ClaudeSubscriptionAdoptAccountInput,
  type ClaudeSubscriptionSetServerPortInput,
  type ClaudeSubscriptionActionResult,
  type ClaudeSubscriptionCopyResult,
  type ClaudeSubscriptionFlowIdInput,
  type ClaudeSubscriptionRenameAccountInput,
  type ClaudeSubscriptionSetAccountEnabledInput,
  type ClaudeSubscriptionSnapshot,
  type ClaudeSubscriptionStartAuthInput,
  type ClaudeSubscriptionSubmitAuthCodeInput
} from './claudeSubscription.contract';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SINGLE_LINE_PATTERN = /^[^\r\n]+$/u;

export const claudeSubscriptionAccountIdSchema = z
  .string()
  .regex(UUID_PATTERN, 'Invalid Claude account identifier.');

export const claudeSubscriptionFlowIdSchema = z
  .string()
  .regex(UUID_PATTERN, 'Invalid Claude authorization flow identifier.');

export const claudeSubscriptionLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(SINGLE_LINE_PATTERN)
  .transform((label) => label.replace(/\s+/gu, ' '));

export const claudeSubscriptionAccountStatusSchema = z.enum([
  'checking',
  'usable',
  'busy',
  'limited',
  'reconnect',
  'disabled'
]);

export const claudeSubscriptionOperationErrorSchema = z
  .object({
    code: z.enum(CLAUDE_SUBSCRIPTION_OPERATION_ERROR_CODES),
    retryable: z.boolean()
  })
  .strict();

export const claudeSubscriptionAccountViewSchema = z
  .object({
    id: claudeSubscriptionAccountIdSchema,
    label: claudeSubscriptionLabelSchema,
    // Derived from the slot, never trusted from the registry — see
    // docs/features/claude-subscription-account-slots.md.
    directory: z.string().min(1).max(512).optional(),
    email: z.string().email().max(320).optional(),
    subscriptionType: z.enum(['pro', 'max', 'team', 'enterprise']),
    enabled: z.boolean(),
    status: claudeSubscriptionAccountStatusSchema,
    activeRequests: z.number().int().nonnegative(),
    active: z.boolean().optional(),
    cooldownUntil: z.number().int().nonnegative().optional(),
    usage: z
      .object({
        status: z.string().min(1).max(64).optional(),
        window: z.string().min(1).max(64).optional(),
        resetsAt: z.number().int().nonnegative().optional(),
        usingOverage: z.boolean().optional(),
        sessionUsedPercent: z.number().min(0).max(100).optional(),
        weekUsedPercent: z.number().min(0).max(100).optional(),
        sessionResetsAt: z.string().min(1).max(120).optional(),
        weekResetsAt: z.string().min(1).max(120).optional(),
        observedAt: z.number().int().nonnegative()
      })
      .strict()
      .optional(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true })
  })
  .strict();

export const claudeSubscriptionServerViewSchema = z
  .object({
    state: z.enum(['starting', 'ready', 'attention', 'stopped']),
    host: z.literal(CLAUDE_SUBSCRIPTION_HOST),
    port: z.number().int().min(CLAUDE_SUBSCRIPTION_MIN_PORT).max(CLAUDE_SUBSCRIPTION_MAX_PORT)
  })
  .strict();

export const claudeSubscriptionAuthFlowViewSchema = z
  .object({
    flowId: claudeSubscriptionFlowIdSchema,
    accountId: claudeSubscriptionAccountIdSchema,
    status: z.enum(['starting', 'browser_open', 'awaiting_code', 'saving']),
    canSubmitCode: z.boolean(),
    codeAttempt: z.number().int().min(0),
    error: claudeSubscriptionOperationErrorSchema.optional()
  })
  .strict();

export const claudeSubscriptionSnapshotSchema = z
  .object({
    schema: z.literal(CLAUDE_SUBSCRIPTION_SNAPSHOT_SCHEMA),
    revision: z.number().int().nonnegative(),
    observedAt: z.number().int().nonnegative(),
    secureStorageAvailable: z.boolean(),
    accounts: z.array(claudeSubscriptionAccountViewSchema),
    server: claudeSubscriptionServerViewSchema,
    authFlow: claudeSubscriptionAuthFlowViewSchema.nullable(),
    codexUpstream: z
      .object({
        connected: z.boolean(),
        models: z.array(z.string().min(1)),
        accounts: z.array(
          z
            .object({
              id: z.string().min(1).max(64),
              label: z.string().min(1).max(64),
              active: z.boolean(),
              createdAt: z.string().min(1).max(64)
            })
            .strict()
        )
      })
      .strict()
  })
  .strict();

export const claudeSubscriptionActionResultSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      snapshot: claudeSubscriptionSnapshotSchema
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      snapshot: claudeSubscriptionSnapshotSchema,
      error: claudeSubscriptionOperationErrorSchema
    })
    .strict()
]);

export const claudeSubscriptionCopyResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: claudeSubscriptionOperationErrorSchema
    })
    .strict()
]);

export const claudeSubscriptionSetServerPortInputSchema = z
  .object({
    port: z.number().int().min(CLAUDE_SUBSCRIPTION_MIN_PORT).max(CLAUDE_SUBSCRIPTION_MAX_PORT)
  })
  .strict();

export const claudeSubscriptionAdoptAccountInputSchema = z
  .object({
    // Mirrors MINIMUM_SLOT in the repository: slot 1 is ~/.claude, which an
    // interactive CLI session owns and which therefore cannot be pooled.
    slot: z.number().int().min(2).max(9999),
    label: claudeSubscriptionLabelSchema
  })
  .strict();

export const claudeSubscriptionStartAuthInputSchema = z
  .object({
    label: claudeSubscriptionLabelSchema,
    accountId: claudeSubscriptionAccountIdSchema.optional()
  })
  .strict();

export const claudeSubscriptionSubmitAuthCodeInputSchema = z
  .object({
    flowId: claudeSubscriptionFlowIdSchema,
    code: z
      .string()
      .trim()
      .min(1)
      .max(4_096)
      .regex(SINGLE_LINE_PATTERN)
      .refine((code) => !code.includes('\u0000'))
  })
  .strict();

export const claudeSubscriptionFlowIdInputSchema = z
  .object({ flowId: claudeSubscriptionFlowIdSchema })
  .strict();

export const claudeSubscriptionAccountIdInputSchema = z
  .object({ accountId: claudeSubscriptionAccountIdSchema })
  .strict();

export const claudeSubscriptionRenameAccountInputSchema = z
  .object({
    accountId: claudeSubscriptionAccountIdSchema,
    label: claudeSubscriptionLabelSchema
  })
  .strict();

export const claudeSubscriptionSetAccountEnabledInputSchema = z
  .object({
    accountId: claudeSubscriptionAccountIdSchema,
    enabled: z.boolean()
  })
  .strict();

export const parseClaudeSubscriptionSnapshot = (value: unknown): ClaudeSubscriptionSnapshot =>
  claudeSubscriptionSnapshotSchema.parse(value) as ClaudeSubscriptionSnapshot;

export const parseClaudeSubscriptionActionResult = (
  value: unknown
): ClaudeSubscriptionActionResult =>
  claudeSubscriptionActionResultSchema.parse(value) as ClaudeSubscriptionActionResult;

export const parseClaudeSubscriptionCopyResult = (value: unknown): ClaudeSubscriptionCopyResult =>
  claudeSubscriptionCopyResultSchema.parse(value) as ClaudeSubscriptionCopyResult;

export const parseClaudeSubscriptionSetServerPortInput = (
  value: unknown
): ClaudeSubscriptionSetServerPortInput =>
  claudeSubscriptionSetServerPortInputSchema.parse(value) as ClaudeSubscriptionSetServerPortInput;

export const parseClaudeSubscriptionAdoptAccountInput = (
  value: unknown
): ClaudeSubscriptionAdoptAccountInput =>
  claudeSubscriptionAdoptAccountInputSchema.parse(value) as ClaudeSubscriptionAdoptAccountInput;

export const parseClaudeSubscriptionStartAuthInput = (
  value: unknown
): ClaudeSubscriptionStartAuthInput =>
  claudeSubscriptionStartAuthInputSchema.parse(value) as ClaudeSubscriptionStartAuthInput;

export const parseClaudeSubscriptionSubmitAuthCodeInput = (
  value: unknown
): ClaudeSubscriptionSubmitAuthCodeInput =>
  claudeSubscriptionSubmitAuthCodeInputSchema.parse(value) as ClaudeSubscriptionSubmitAuthCodeInput;

export const parseClaudeSubscriptionFlowIdInput = (value: unknown): ClaudeSubscriptionFlowIdInput =>
  claudeSubscriptionFlowIdInputSchema.parse(value) as ClaudeSubscriptionFlowIdInput;

export const parseClaudeSubscriptionAccountIdInput = (
  value: unknown
): ClaudeSubscriptionAccountIdInput =>
  claudeSubscriptionAccountIdInputSchema.parse(value) as ClaudeSubscriptionAccountIdInput;

export const parseClaudeSubscriptionRenameAccountInput = (
  value: unknown
): ClaudeSubscriptionRenameAccountInput =>
  claudeSubscriptionRenameAccountInputSchema.parse(value) as ClaudeSubscriptionRenameAccountInput;

export const parseClaudeSubscriptionSetAccountEnabledInput = (
  value: unknown
): ClaudeSubscriptionSetAccountEnabledInput =>
  claudeSubscriptionSetAccountEnabledInputSchema.parse(
    value
  ) as ClaudeSubscriptionSetAccountEnabledInput;
