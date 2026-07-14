import { z } from 'zod'

export const RecipeInputSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean().default(true),
  example: z.string().optional(),
  // Optional value constraints — built into a zod schema at run time to validate the skill's
  // `vars` BEFORE executing (shape/format rules only, never hardcoded values).
  type: z.enum(['string', 'number', 'boolean', 'enum']).optional(),
  enum: z.array(z.string()).optional(),
  pattern: z.string().optional()
})

export const RecipeTargetSchema = z.object({
  tag: z.string().min(1),
  selector: z.string().min(1),
  selectors: z.array(z.string()).default([]),
  role: z.string().optional(),
  name: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  placeholder: z.string().optional(),
  inputType: z.string().optional()
})

export const RecipeStepSchema = z.object({
  action: z.enum(['click', 'fill', 'submit', 'select', 'check']),
  target: RecipeTargetSchema,
  valueTemplate: z.string().optional(),
  originalValue: z.string().optional(),
  checked: z.boolean().optional(),
  yaml: z.string().optional(),
  url: z.string().optional()
})

export const RecipeNetworkSchema = z.object({
  method: z.string().optional(),
  url: z.string(),
  status: z.number().optional(),
  requestId: z.string().optional(),
  resourceType: z.string().optional(),
  // Value-free classification computed at ingest. Older recipes may omit these and fall back to
  // method/url heuristics in collectApiReads/collectApiWrites.
  apiRole: z.enum(['option-read', 'context-read', 'write', 'other']).optional(),
  replaySafety: z.enum(['safe', 'confirm', 'unsafe']).optional(),
  bodyKind: z.enum(['none', 'json', 'form', 'raw']).optional(),
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  headerPolicy: z
    .array(
      z.object({
        header: z.string().min(1),
        kind: z.enum(['static', 'bearer-token', 'csrf-token', 'storage-or-cookie']).default('static'),
        storageKeys: z.array(z.string()).default([]),
        cookieNames: z.array(z.string()).default([]),
        prefix: z.string().optional(),
        fallback: z.string().optional()
      })
    )
    .default([]),
  // Request body is stored SHAPE-ONLY (keys kept, values blanked — see recipeRedact).
  requestBody: z.string().nullable().optional(),
  // Response bodies are NEVER persisted (they hold user data). `optionLike` is the only
  // thing collectApiReads needs from a response — precomputed at ingest, value dropped.
  optionLike: z.boolean().optional(),
  responseBodyPreview: z.string().nullable().optional()
})

export const SkillRecipeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  source: z.enum(['builtin', 'recording']),
  sourceUrl: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  inputs: z.array(RecipeInputSchema).default([]),
  aliases: z.array(z.string()).default([]),
  shortcuts: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  triggers: z.array(z.string()).default([]),
  steps: z.array(RecipeStepSchema).default([]),
  network: z.array(RecipeNetworkSchema).default([]),
  snapshots: z
    .array(
      z.object({
        url: z.string().optional(),
        title: z.string().optional(),
        yaml: z.string()
      })
    )
    .default([]),
  // Playwright-style automation script (parametric: uses page.*/api.fetch + vars.* slots, NO
  // captured values). Compiled + run at runtime in a vm sandbox against the live page — see
  // drive/skillScript.ts. Optional: skills may be UI-step / API-only with no script.
  script: z.string().optional(),
  // Operator-authored field rules (normalization / validation / mapping) the
  // invoking agent must apply to resolve input values before executing.
  fieldRules: z.string().optional(),
  detail: z.string().optional(),
  notes: z.preprocess(
    (value) => (Array.isArray(value) ? value.map((item) => String(item)).join('\n') : value),
    z.string().optional()
  )
})

export type SkillRecipe = z.infer<typeof SkillRecipeSchema>
export type RecipeStep = z.infer<typeof RecipeStepSchema>
