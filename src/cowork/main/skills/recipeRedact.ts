import type { SkillRecipe } from './skillRecipe.types'
import { looksListShaped } from '@cowork-main/drive/replayEngine'

// Skills are a METHOD, not a data dump: they must NOT persist the user's auth or any captured
// data. Everything dynamic — auth tokens, cookies, typed input values, request/response
// bodies, page values — is resolved LIVE at run time from the injected page script / the
// conversation. This pass strips every captured VALUE from a recipe before it is stored,
// keeping only structure: endpoints, field names, the value-free headerPolicy, UI step
// targets, and (for reads) the precomputed `optionLike` flag.

const ALWAYS_SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization'])
const VAR_TEMPLATE = /^\{\{[a-zA-Z0-9_]+\}\}$/

// Drop auth header VALUES (Authorization/Cookie/CSRF/token); keep harmless ones (content-type…).
function redactHeaders(
  headers: Record<string, string | string[]> | undefined,
  policy: SkillRecipe['network'][number]['headerPolicy']
): Record<string, string | string[]> | undefined {
  if (!headers) return headers
  const drop = new Set(ALWAYS_SENSITIVE_HEADERS)
  for (const p of policy || []) if (p.kind !== 'static') drop.add(p.header.toLowerCase())
  const out: Record<string, string | string[]> = {}
  for (const [k, v] of Object.entries(headers)) if (!drop.has(k.toLowerCase())) out[k] = v
  return out
}

// Blank every leaf VALUE but keep keys + nesting + array shape, so the agent learns WHAT
// fields a write takes without seeing any recorded value.
function blankJsonValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 1).map(blankJsonValues)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>)) out[k] = blankJsonValues((value as Record<string, unknown>)[k])
    return out
  }
  if (typeof value === 'number') return 0
  if (typeof value === 'boolean') return false
  if (value === null) return null
  return ''
}

// Request body → shape only. JSON keeps keys (blank values); form keeps keys (blank values);
// opaque bodies are dropped (can't redact safely).
function redactBodyValues(body: string | null | undefined): string | null {
  if (!body) return null
  const t = body.trim()
  if (!t) return null
  try {
    return JSON.stringify(blankJsonValues(JSON.parse(t)))
  } catch {
    /* not JSON */
  }
  if (t.includes('=') && !t.includes('\n')) {
    try {
      const src = new URLSearchParams(t)
      const out = new URLSearchParams()
      for (const k of src.keys()) out.set(k, '')
      const s = out.toString()
      return s || null
    } catch {
      /* not a form body */
    }
  }
  return null
}

// Aria snapshots carry typed input values as [value="…"]; strip them, keep roles/names/structure.
function stripSnapshotValues(yaml: string): string {
  return yaml.replace(/\s*\[value="[^"]*"\]/g, '')
}

export function redactRecipeForStorage(recipe: SkillRecipe): SkillRecipe {
  return {
    ...recipe,
    // Drop recorded example VALUES (they're the user's typed data); keep name/label/required.
    inputs: recipe.inputs.map((input) => ({ ...input, example: undefined })),
    steps: recipe.steps.map((step) => ({
      ...step,
      // Keep {{var}} placeholders; NEVER keep a recorded literal value.
      valueTemplate: step.valueTemplate && VAR_TEMPLATE.test(step.valueTemplate) ? step.valueTemplate : undefined,
      originalValue: undefined,
      // step.yaml embeds the typed value and has no runtime consumer — drop it.
      yaml: undefined
    })),
    network: recipe.network.map((item) => {
      const optionLike =
        typeof item.optionLike === 'boolean'
          ? item.optionLike
          : typeof item.responseBodyPreview === 'string'
            ? looksListShaped(item.responseBodyPreview)
            : undefined
      return {
        ...item,
        headers: redactHeaders(item.headers, item.headerPolicy),
        // A non-static policy's `fallback` is the recorded header VALUE (e.g. an x-api-key
        // secret) — drop it so no captured auth is persisted; auth resolves live from candidates.
        headerPolicy: (item.headerPolicy || []).map((p) => (p.kind === 'static' ? p : { ...p, fallback: undefined })),
        requestBody: redactBodyValues(item.requestBody),
        optionLike,
        responseBodyPreview: null
      }
    }),
    snapshots: recipe.snapshots.map((snap) => ({ ...snap, yaml: stripSnapshotValues(snap.yaml) }))
  }
}
