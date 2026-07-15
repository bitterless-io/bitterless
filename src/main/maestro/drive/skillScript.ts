import vm from 'node:vm'
import { z } from 'zod'
import type { ApiCall, ApiCallResult, AuthHint, ReplayEngine } from './replayEngine'
import type { SkillRecipe } from '@maestro-main/skills/skillRecipe.types'
import type { SkillApiSafetyDecision } from './apiSafety'

// Build a zod schema from a skill's declarative input constraints and validate `vars` BEFORE
// running. Unknown vars pass through (the script may use helpers). Returns coerced data or errors.
export function validateSkillVars(
  inputs: SkillRecipe['inputs'],
  vars: Record<string, unknown>
): { ok: true; data: Record<string, unknown> } | { ok: false; errors: string[] } {
  const data = cloneVars(vars)
  const errors: string[] = []
  for (const input of inputs) {
    const value = readInputVar(vars, input.name)
    if (value === undefined && !input.required) continue
    const parsed = validatorForInput(input).safeParse(value)
    if (!parsed.success) {
      errors.push(...parsed.error.issues.map((e) => `${input.name}${e.path.length ? `.${e.path.join('.')}` : ''}: ${e.message}`))
      continue
    }
    writeInputVar(data, input.name, parsed.data)
  }
  return errors.length ? { ok: false, errors } : { ok: true, data }
}

function validatorForInput(input: SkillRecipe['inputs'][number]): z.ZodTypeAny {
  if (input.type === 'number') return z.coerce.number()
  if (input.type === 'boolean') {
    // z.coerce.boolean() is JS Boolean(): "false"/"0"/"no" all become true. vars arrive as
    // strings, so map explicitly (avoid silently inverting opt-in/consent flags).
    return z.preprocess((v) => {
      if (typeof v === 'boolean') return v
      if (typeof v === 'string') {
        const t = v.trim().toLowerCase()
        if (['true', '1', 'yes', 'on'].includes(t)) return true
        if (['false', '0', 'no', 'off', ''].includes(t)) return false
      }
      return v
    }, z.boolean())
  }
  if (input.type === 'enum' && input.enum && input.enum.length) return z.enum(input.enum as [string, ...string[]])
  let str = z.string().min(input.required ? 1 : 0)
  // The pattern is LLM-authored; a malformed regex must not throw out of validation.
  if (input.pattern) {
    try {
      str = str.regex(new RegExp(input.pattern), `must match ${input.pattern}`)
    } catch {
      /* invalid regex — skip the constraint rather than crash */
    }
  }
  return str
}

function cloneVars(vars: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(vars || {})) as Record<string, unknown>
  } catch {
    return { ...(vars || {}) }
  }
}

function readInputVar(vars: Record<string, unknown>, name: string): unknown {
  if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name]
  const parts = name.split('.').map((part) => part.trim()).filter(Boolean)
  if (parts.length <= 1) return undefined
  let cursor: unknown = vars
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return cursor
}

function writeInputVar(vars: Record<string, unknown>, name: string, value: unknown): void {
  vars[name] = value
  const parts = name.split('.').map((part) => part.trim()).filter(Boolean)
  if (parts.length <= 1) return
  let cursor: Record<string, unknown> = vars
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part]
    if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[part] = {}
    cursor = cursor[part] as Record<string, unknown>
  }
  cursor[parts[parts.length - 1]] = value
}

// Runs a skill's parametric automation script (Playwright-style) in a node:vm sandbox, driving
// the LIVE operation view through ReplayEngine over CDP. The script sees ONLY `page` / `api` /
// `vars` / `console` — no `require`/`process`/`module` — so normal code can't pull in files.
// (vm is not a hard boundary; `lock()` blocks the common constructor-escape, and the real
// guard is the trust model: these scripts are our own LLM's output. Timeouts live in the
// driver methods + the AbortSignal watchdog, NOT vm's `timeout`, which ignores `await`.)

export class ScriptAborted extends Error {}

// Block the `page.constructor.constructor('return process')()` escape vector + return
// methods bound to the real driver.
function lock<T extends object>(obj: T): T {
  return new Proxy(obj, {
    get(target, key) {
      if (key === 'constructor' || key === '__proto__' || key === 'prototype') return undefined
      const v = (target as Record<string | symbol, unknown>)[key]
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
    },
    set() {
      return false
    }
  }) as T
}

export interface RunSkillScriptResult {
  ok: boolean
  result?: unknown
  error?: string
}

export async function runSkillScript(opts: {
  script: string
  replay: ReplayEngine
  vars: Record<string, unknown>
  auth?: AuthHint | AuthHint[] | null
  signal?: AbortSignal
  onApiBeforeFetch?: (call: ApiCall) => Promise<SkillApiSafetyDecision | void> | SkillApiSafetyDecision | void
  onApiFetch?: (call: ApiCall, result: ApiCallResult) => void
}): Promise<RunSkillScriptResult> {
  const { script, replay, vars, auth, signal, onApiBeforeFetch, onApiFetch } = opts
  const ck = (): void => {
    if (signal?.aborted) throw new ScriptAborted('aborted')
  }

  // page: UI automation (clicks are real trusted CDP coordinate clicks; fills are in-page
  // native-setter; waitFor/read/exists poll the live page).
  const page = lock({
    async click(selector: string): Promise<void> {
      ck()
      const r = await replay.runUiActions([{ action: 'click', selector }])
      if (!r.ok) throw new Error('click failed: ' + selector)
    },
    async fill(selector: string, value: unknown): Promise<void> {
      ck()
      const r = await replay.runUiActions([{ action: 'fill', selector, value: String(value ?? '') }])
      if (!r.ok) throw new Error('fill failed: ' + selector)
    },
    async select(selector: string, value: unknown): Promise<void> {
      ck()
      const r = await replay.runUiActions([{ action: 'select', selector, value: String(value ?? '') }])
      if (!r.ok) throw new Error('select failed: ' + selector)
    },
    async check(selector: string, checked = true): Promise<void> {
      ck()
      const r = await replay.runUiActions([{ action: 'check', selector, checked: !!checked }])
      if (!r.ok) throw new Error('check failed: ' + selector)
    },
    async submit(selector: string): Promise<void> {
      ck()
      const r = await replay.runUiActions([{ action: 'submit', selector }])
      if (!r.ok) throw new Error('submit failed: ' + selector)
    },
    async waitFor(selector: string, options?: { timeout?: number }): Promise<boolean> {
      ck()
      return replay.waitForSelector(selector, options?.timeout, signal)
    },
    async read(selector: string): Promise<string> {
      ck()
      return replay.readText(selector)
    },
    async exists(selector: string): Promise<boolean> {
      ck()
      return replay.elementExists(selector)
    }
  })

  // api: authenticated in-page fetch (reuses the live login; auth resolved live). Accepts
  // `path` or `url`; per-call `auth` overrides the bound scheme.
  const api = lock({
    async fetch(call: ApiCall & { path?: string; auth?: AuthHint | AuthHint[] | null }): Promise<unknown> {
      ck()
      const target = (call.url ?? call.path ?? '').trim()
      // Empty target → new URL('', page) would POST to the CURRENT page; reject instead.
      if (!target) throw new Error('api.fetch requires a non-empty path or url')
      const normalized: ApiCall = { ...call, url: target }
      const decision = await onApiBeforeFetch?.(normalized)
      if (decision?.safety === 'unsafe') throw new Error(`api ${decision.method} ${decision.path} blocked: ${decision.reason}`)
      const r = await replay.apiFetch(normalized, call.auth ?? auth ?? null)
      onApiFetch?.(normalized, r)
      if (!r.ok) {
        throw new Error(`api ${(normalized.method || 'GET').toUpperCase()} ${normalized.url} → ${r.status || r.error}`)
      }
      return r.data
    }
  })

  const ctx = vm.createContext({ page, api, vars: vars ?? {}, console })
  try {
    // `timeout` here only bounds SYNCHRONOUS parse/exec — async waits are bounded by the
    // driver methods (waitFor) + the caller's AbortSignal watchdog.
    const out = vm.runInContext(`(async () => {\n${script}\n})()`, ctx, { timeout: 5000, filename: 'skill-script.js' })
    const result = await out
    return { ok: true, result }
  } catch (err) {
    return { ok: false, error: err instanceof ScriptAborted ? 'aborted' : (err as Error).message }
  }
}
