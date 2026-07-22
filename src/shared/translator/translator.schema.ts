import { z } from 'zod';
import {
  TRANSLATOR_MAX_SOURCE_LENGTH,
  TRANSLATOR_MAX_TRANSLATION_LENGTH,
  type TranslatorCancelInput,
  type TranslatorTranslateInput
} from './translator.contract';

const requestIdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value.trim() === value, 'Identifiers must not have surrounding whitespace.');

export const translatorTranslateInputSchema = z
  .object({
    clientId: requestIdSchema,
    requestId: requestIdSchema,
    sourceText: z
      .string()
      .min(1)
      .max(TRANSLATOR_MAX_SOURCE_LENGTH * 2)
      .refine(
        (value) => Array.from(value).length <= TRANSLATOR_MAX_SOURCE_LENGTH,
        `Source text must contain at most ${TRANSLATOR_MAX_SOURCE_LENGTH} Unicode characters.`
      )
      .refine((value) => value.trim().length > 0, 'Source text must contain visible content.')
  })
  .strict();

export const translatorCancelInputSchema = z
  .object({
    clientId: requestIdSchema,
    requestId: requestIdSchema
  })
  .strict();

export const translatorOutputSchema = z
  .object({
    translation: z
      .string()
      .min(1)
      .max(TRANSLATOR_MAX_TRANSLATION_LENGTH)
      .refine((value) => value.trim().length > 0, 'Translation must contain visible content.')
  })
  .strict();

export const parseTranslatorTranslateInput = (value: unknown): TranslatorTranslateInput =>
  translatorTranslateInputSchema.parse(value) as TranslatorTranslateInput;

export const parseTranslatorCancelInput = (value: unknown): TranslatorCancelInput =>
  translatorCancelInputSchema.parse(value) as TranslatorCancelInput;

export const parseTranslatorOutput = (value: unknown): { translation: string } =>
  translatorOutputSchema.parse(value) as { translation: string };
