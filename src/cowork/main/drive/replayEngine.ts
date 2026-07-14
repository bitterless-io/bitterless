import type { WebContents } from 'electron'
import type { ReplayResult } from '@cowork-shared/coach.api'
import type { RecipeStep, SkillRecipe } from '@cowork-main/skills/skillRecipe.types'

type RecipeNetwork = SkillRecipe['network'][number]
type HeaderPolicyRule = RecipeNetwork['headerPolicy'][number]

export interface ApiReplayCall {
  method: string
  url: string
  headers: Record<string, string>
  headerPolicy?: HeaderPolicyRule[]
  body?: string
}

export interface CallResult {
  method: string
  url: string
  status: number
  ok: boolean
  body: string
}

// Generic JSON command executed IN the embedded page (same origin, cookies reused).
// Extensible: add a `command` variant + a case in commandRunner to grow it.
export type BrowserCommand =
  | { command: 'read_context'; id?: string; keys?: string[] }
  | {
      command: 'fetch'
      id?: string
      url: string
      method?: string
      query?: Record<string, string | number | boolean>
      headers?: Record<string, string>
      auth?: AuthHint | AuthHint[] | null
      body?: unknown
    }
  | { command: 'parallel'; id?: string; commands: BrowserCommand[] }

export interface CommandResult {
  command: string
  id?: string
  ok: boolean
  status?: number
  data?: unknown
  error?: string
  auth?: { header: string; source: string; key?: string; applied: boolean }[]
}

// A single UI action the AGENT chooses from a live page snapshot (the observe→
// act→observe loop), as opposed to a pre-recorded recipe step.
export interface AgentUiAction {
  action: 'click' | 'fill' | 'select' | 'check' | 'submit'
  selector: string
  value?: string
  checked?: boolean
}

export interface AgentUiActionResult {
  action: string
  selector: string
  ok: boolean
  error?: string
  /** The resolved element's tag / id / name attribute, for display in the activity log. */
  target?: { tag: string; id: string; name: string }
}

// Value-free auth scheme for api.fetch — resolved LIVE in-page at call time (never a stored value).
export interface AuthHint {
  header: string
  candidateKeys?: string[]
  prefix?: string
  meta?: string
}

export interface ApiCall {
  method?: string
  url: string
  query?: Record<string, string | number | boolean>
  body?: unknown
  headers?: Record<string, string>
}

export interface ApiCallResult {
  ok: boolean
  status: number
  data?: unknown
  error?: string
  auth?: { header: string; source: string; key?: string; applied: boolean }[]
}

export class ReplayEngine {
  constructor(private readonly wc: WebContents) {}

  async replay(recipe: SkillRecipe, variables: Record<string, string>): Promise<ReplayResult> {
    const missing = recipe.inputs
      .filter((input) => input.required && !variables[input.name])
      .map((input) => input.name)
    if (missing.length > 0) {
      return {
        ok: false,
        skillId: recipe.id,
        stepsRun: 0,
        errors: missing.map((name) => `Missing input: ${name}`)
      }
    }

    const apiPlan = buildApiReplayPlan(recipe, variables)
    if (apiPlan.length > 0) {
      const apiResult = await this.runApiPlan(apiPlan)
      return {
        ok: apiResult.ok,
        skillId: recipe.id,
        stepsRun: apiResult.callsRun,
        errors: apiResult.errors,
        mode: 'api',
        apiCalls: apiResult.callsRun,
        responseText: apiResult.responseText
      }
    }

    const errors: string[] = []
    let stepsRun = 0
    for (const step of recipe.steps) {
      const result = await this.runStep(applyVariables(step, variables))
      if (!result.ok) errors.push(result.error || `Step failed: ${step.action} ${step.target.selector}`)
      else stepsRun += 1
      await wait(220)
    }
    return { ok: errors.length === 0, skillId: recipe.id, stepsRun, errors, mode: 'ui' }
  }

  /**
   * Perform a sequence of agent-chosen UI actions (the act half of the
   * observe→act→observe loop). Each action targets a single selector the agent
   * picked from a live page snapshot. Stops at the first failing action so the
   * agent can re-snapshot and re-decide rather than blindly continuing.
   */
  async runUiActions(actions: AgentUiAction[]): Promise<{ ok: boolean; results: AgentUiActionResult[] }> {
    const results: AgentUiActionResult[] = []
    for (const action of actions) {
      const step: RecipeStep = {
        action: action.action,
        target: { tag: 'element', selector: action.selector, selectors: [action.selector] },
        valueTemplate: action.value,
        checked: action.checked
      }
      const result = await this.runStep(step)
      results.push({ action: action.action, selector: action.selector, ok: result.ok, error: result.error, target: result.desc })
      if (!result.ok) break
      await wait(180)
    }
    return { ok: results.length > 0 && results.every((r) => r.ok), results }
  }

  // Playwright-style await: poll the live page over CDP until the selector exists + is laid
  // out, or timeout. Used by skill scripts (page.waitFor). Throws on timeout.
  async waitForSelector(selector: string, timeout = 8000, signal?: AbortSignal): Promise<boolean> {
    const end = Date.now() + timeout
    const expr = `(()=>{const e=document.querySelector(${JSON.stringify(selector)}); return !!(e && e.getClientRects().length)})()`
    for (;;) {
      // Honor the run's abort watchdog every poll — otherwise a long timeout keeps polling
      // for minutes after the script was aborted, hanging the agent turn.
      if (signal?.aborted) throw new Error('aborted')
      const r = (await this.wc.debugger.sendCommand('Runtime.evaluate', { expression: expr, returnByValue: true })) as {
        result?: { value?: boolean }
      }
      if (r.result?.value) return true
      if (Date.now() >= end) throw new Error('waitFor timeout: ' + selector)
      await wait(120)
    }
  }

  // Read an element's value/text (for branching in skill scripts). '' when absent.
  async readText(selector: string): Promise<string> {
    const expr = `(()=>{const e=document.querySelector(${JSON.stringify(selector)}); if(!e) return ''; const v=('value' in e)? e.value : null; return String(v!=null?v:(e.textContent||'')).trim()})()`
    const r = (await this.wc.debugger.sendCommand('Runtime.evaluate', { expression: expr, returnByValue: true })) as {
      result?: { value?: string }
    }
    return r.result?.value ?? ''
  }

  async elementExists(selector: string): Promise<boolean> {
    const r = (await this.wc.debugger.sendCommand('Runtime.evaluate', {
      expression: `!!document.querySelector(${JSON.stringify(selector)})`,
      returnByValue: true
    })) as { result?: { value?: boolean } }
    return !!r.result?.value
  }

  // In-page fetch with LIVE auth resolution: cookies ride along (credentials:'include'); a
  // bearer/csrf token is resolved from storage/cookie/meta AT CALL TIME per `auth` (never a
  // stored value). Same page session as the user — used by skill scripts (api.fetch).
  async apiFetch(call: ApiCall, auth?: AuthHint | AuthHint[] | null): Promise<ApiCallResult> {
    const auths = Array.isArray(auth) ? auth : auth ? [auth] : []
    try {
      const r = (await this.wc.debugger.sendCommand('Runtime.evaluate', {
        expression: `(${apiFetchRunner})(${JSON.stringify(call)}, ${JSON.stringify(auths)})`,
        awaitPromise: true,
        returnByValue: true
      })) as { result?: { value?: ApiCallResult } }
      return r.result?.value ?? { ok: false, status: 0, error: 'no api result' }
    } catch (err) {
      return { ok: false, status: 0, error: (err as Error).message }
    }
  }

  private async runStep(
    step: RecipeStep
  ): Promise<{ ok: boolean; error?: string; desc?: { tag: string; id: string; name: string } }> {
    // Clicks use a REAL coordinate mouse press (not el.click()): the page often binds the
    // handler on an ancestor, and only a hit-tested move→press→release at the element's
    // point fires the full pointer sequence that bubbles to whichever ancestor listens.
    if (step.action === 'click') return this.clickStep(step)
    try {
      const response = (await this.wc.debugger.sendCommand('Runtime.evaluate', {
        expression: `(${browserStepRunner})(${JSON.stringify(step)})`,
        awaitPromise: true,
        returnByValue: true
      })) as { result?: { value?: { ok: boolean; error?: string; desc?: { tag: string; id: string; name: string } } } }
      return response.result?.value || { ok: false, error: 'No replay result returned.' }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  // Locate the element + its viewport-center in the page, then dispatch a real mouse
  // click there via CDP Input (move → press → release). Hit-testing at the point means
  // the topmost element / the right ancestor handler receives a genuine pointer
  // sequence — unlike a synthetic el.click(), which only fires a (bubbling) click event
  // on the target itself.
  private async clickStep(
    step: RecipeStep
  ): Promise<{ ok: boolean; error?: string; desc?: { tag: string; id: string; name: string } }> {
    try {
      const located = (await this.wc.debugger.sendCommand('Runtime.evaluate', {
        expression: `(${clickLocator})(${JSON.stringify(step)})`,
        awaitPromise: true,
        returnByValue: true
      })) as {
        result?: {
          value?: { ok: boolean; x?: number; y?: number; error?: string; desc?: { tag: string; id: string; name: string } }
        }
      }
      const v = located.result?.value
      if (!v || !v.ok || typeof v.x !== 'number' || typeof v.y !== 'number') {
        return { ok: false, error: v?.error || 'click target not located', desc: v?.desc }
      }
      const { x, y, desc } = v
      await this.wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
      await wait(60)
      await this.wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        buttons: 1,
        clickCount: 1
      })
      await wait(30)
      await this.wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        buttons: 0,
        clickCount: 1
      })
      return { ok: true, desc }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  /**
   * Run a list of concrete API calls in the page context and return each
   * response. Used by the agentic path to (a) live-fetch option lists before
   * planning and (b) execute the LLM-authored write calls afterwards.
   */
  async runCalls(calls: ApiReplayCall[]): Promise<{ ok: boolean; results: CallResult[]; errors: string[] }> {
    if (calls.length === 0) return { ok: true, results: [], errors: [] }
    try {
      const response = (await this.wc.debugger.sendCommand('Runtime.evaluate', {
        expression: `(${multiCallRunner})(${JSON.stringify(calls)})`,
        awaitPromise: true,
        returnByValue: true
      })) as { result?: { value?: { ok: boolean; results: CallResult[]; errors: string[] } } }
      return response.result?.value || { ok: false, results: [], errors: ['No call result returned.'] }
    } catch (err) {
      return { ok: false, results: [], errors: [(err as Error).message] }
    }
  }

  /**
   * Run a list of generic JSON commands in the page context (read_context / fetch)
   * and return each result in order. The page origin + session are reused, so cookies
   * (incl. httpOnly) ride along automatically on `fetch`.
   */
  async runCommands(commands: BrowserCommand[]): Promise<{ ok: boolean; results: CommandResult[] }> {
    if (commands.length === 0) return { ok: true, results: [] }
    try {
      const response = (await this.wc.debugger.sendCommand('Runtime.evaluate', {
        expression: `(${commandRunner})(${JSON.stringify(commands)})`,
        awaitPromise: true,
        returnByValue: true
      })) as { result?: { value?: { ok?: boolean; results?: CommandResult[] } } }
      const value = response.result?.value
      if (!value || !Array.isArray(value.results)) {
        return { ok: false, results: [{ command: '?', ok: false, error: 'No command result returned.' }] }
      }
      return { ok: value.ok ?? value.results.every((r) => r.ok), results: value.results }
    } catch (err) {
      return { ok: false, results: [{ command: '?', ok: false, error: (err as Error).message }] }
    }
  }

  private async runApiPlan(plan: ApiReplayCall[]): Promise<{
    ok: boolean
    callsRun: number
    errors: string[]
    responseText?: string
  }> {
    try {
      const response = (await this.wc.debugger.sendCommand('Runtime.evaluate', {
        expression: `(${apiReplayRunner})(${JSON.stringify(plan)})`,
        awaitPromise: true,
        returnByValue: true
      })) as {
        result?: { value?: { ok?: boolean; callsRun?: number; errors?: string[]; responseText?: string } }
      }
      const value = response.result?.value
      if (!value) return { ok: false, callsRun: 0, errors: ['No API replay result returned.'] }
      // Normalize: an in-page result may omit fields — never let `errors` be undefined.
      const errors = Array.isArray(value.errors) ? value.errors : []
      return { ok: value.ok ?? errors.length === 0, callsRun: value.callsRun ?? 0, errors, responseText: value.responseText }
    } catch (err) {
      return { ok: false, callsRun: 0, errors: [(err as Error).message] }
    }
  }
}

function applyVariables(step: RecipeStep, variables: Record<string, string>): RecipeStep {
  const rendered = step.valueTemplate?.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_m, key: string) => {
    return variables[key] ?? ''
  })
  return { ...step, valueTemplate: rendered }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Recorded mutating API calls (the "actions" the agent may author bodies for).
export function collectApiWrites(recipe: SkillRecipe): RecipeNetwork[] {
  return recipe.network.filter(
    (item) => item.method && (item.apiRole === 'write' || (!item.apiRole && isMutatingMethod(item.method) && isApiLike(item)))
  )
}

// Recorded read calls to re-fire live for option/catalog context. Restricted to
// GETs that (a) are api-like, (b) are NOT action-like URLs (logout/confirm/...),
// and (c) recorded a LIST-SHAPED response — so we don't blindly replay an
// incidental, possibly non-idempotent GET against the live target. Deduped by
// path (query stripped) and capped.
export function collectApiReads(recipe: SkillRecipe): RecipeNetwork[] {
  // List-shape is precomputed at ingest into `optionLike` (the raw response preview is NOT
  // persisted — see recipeRedact). Fall back to a live preview only for legacy recipes.
  const optionLikeById = new Map<string, boolean>()
  for (const item of recipe.network) {
    if (!item.requestId) continue
    if (typeof item.optionLike === 'boolean') optionLikeById.set(item.requestId, item.optionLike)
    else if (typeof item.responseBodyPreview === 'string') optionLikeById.set(item.requestId, looksListShaped(item.responseBodyPreview))
  }
  const seenPaths = new Set<string>()
  const reads: RecipeNetwork[] = []
  for (const item of recipe.network) {
    if (!item.method || item.method.toUpperCase() !== 'GET') continue
    if (item.apiRole) {
      if (item.apiRole !== 'option-read') continue
    } else {
      if (!isApiLike(item)) continue
      if (isActionLikeUrl(item.url)) continue
      if (!isOptionLikeUrl(item.url)) continue
      if (!(item.requestId && optionLikeById.get(item.requestId))) continue
    }
    const key = pathKey(item.url)
    if (seenPaths.has(key)) continue
    seenPaths.add(key)
    reads.push(item)
  }
  return reads.slice(0, 8)
}

function isActionLikeUrl(url: string): boolean {
  return /\b(logout|sign-?out|confirm|verify|activate|deactivate|delete|remove|cancel|revoke|reset|approve|reject|checkout|pay)\b/i.test(
    url
  )
}

function isOptionLikeUrl(url: string): boolean {
  const path = pathKey(url).toLowerCase()
  if (/\b(bookings?|patients?|records?|history|orders?|invoices?|payments?|users?|customers?)\b/.test(path)) return false
  return /\b(options?|departments?|doctors?|specialt(?:y|ies)|catalog|pricing|price-list|prices?|items?|services?|exams?|tests?|procedures?|slots?|schedules?|locations?|clinics?|rooms?)\b/.test(
    path
  )
}

export function looksListShaped(preview: string): boolean {
  if (!preview) return false
  if (preview.trimStart().startsWith('[')) return true
  return /"(items|list|data|results|options|records|departments|catalog|rows|content)"\s*:\s*\[/i.test(preview)
}

function pathKey(url: string): string {
  try {
    const u = new URL(url)
    return u.origin + u.pathname
  } catch {
    return url.split('?')[0]
  }
}

// Build a concrete call from a recorded request. Headers always come from the
// recording (never the model), so the agent can only influence the body.
export function buildReplayCall(item: RecipeNetwork, body?: string): ApiReplayCall {
  return {
    method: (item.method || (body ? 'POST' : 'GET')).toUpperCase(),
    url: item.url,
    headers: filterReplayHeaders(item.headers, Boolean(body), !item.headerPolicy?.length),
    headerPolicy: item.headerPolicy,
    body
  }
}

function buildApiReplayPlan(recipe: SkillRecipe, variables: Record<string, string>): ApiReplayCall[] {
  const requests = recipe.network.filter((item) => item.method && isApiLike(item))
  const hasMutation = requests.some((item) => isMutatingMethod(item.method || '') && item.requestBody)
  if (!hasMutation) return []

  return requests.map((item) => {
    const body = item.requestBody ? renderRequestBody(item.requestBody, recipe, variables) : undefined
    return {
      method: (item.method || 'GET').toUpperCase(),
      url: item.url,
      headers: filterReplayHeaders(item.headers, Boolean(body), !item.headerPolicy?.length),
      headerPolicy: item.headerPolicy,
      body
    }
  })
}

function isApiLike(item: SkillRecipe['network'][number]): boolean {
  if (/fetch|xhr/i.test(item.resourceType || '')) return true
  try {
    const path = new URL(item.url).pathname
    return /\/api\//i.test(path)
  } catch {
    return /\/api\//i.test(item.url)
  }
}

function isMutatingMethod(method: string): boolean {
  return /^(POST|PUT|PATCH|DELETE)$/i.test(method)
}

function filterReplayHeaders(
  headers: Record<string, string | string[]> | undefined,
  hasBody: boolean,
  _allowStaticSensitive = false
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = key.toLowerCase()
    if (lower === 'authorization' || lower === 'cookie' || lower === 'set-cookie') continue
    if (/csrf|xsrf|token|auth|secret|credential|session|jwt|bearer|api[-_]?key/i.test(lower)) continue
    if (lower === 'content-type' || /^x-(client|app|request|trace|correlation|version)/i.test(lower)) {
      out[key] = Array.isArray(value) ? value.join(', ') : value
    }
  }
  if (hasBody && !Object.keys(out).some((key) => key.toLowerCase() === 'content-type')) out['content-type'] = 'application/json'
  return out
}

function renderRequestBody(body: string, recipe: SkillRecipe, variables: Record<string, string>): string {
  try {
    const parsed = JSON.parse(body) as unknown
    return JSON.stringify(rewriteJsonValues(parsed, recipe, variables))
  } catch {
    let rendered = body
    for (const input of recipe.inputs) {
      const value = variables[input.name]
      if (!value) continue
      if (input.example) rendered = rendered.split(input.example).join(value)
      rendered = rendered.replace(new RegExp(`\\{\\{${input.name}\\}\\}`, 'g'), value)
    }
    return rendered
  }
}

// Key-based substitution (a body field whose name matches an input) applies
// ONLY at the top level: the recorded body's top-level fields are the form
// fields the user filled in. A deeper key that merely collides with an input
// name (e.g. a nested `doctor.name`) must NOT be overwritten — nested values
// are still rewritten via rewritePrimitive's example-match guard.
function rewriteJsonValues(
  value: unknown,
  recipe: SkillRecipe,
  variables: Record<string, string>,
  topLevel = true
): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteJsonValues(item, recipe, variables, false))
  if (!value || typeof value !== 'object') return rewritePrimitive(value, recipe, variables)
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (topLevel && variables[key]) return [key, variables[key]]
      return [key, rewriteJsonValues(item, recipe, variables, false)]
    })
  )
}

function rewritePrimitive(value: unknown, recipe: SkillRecipe, variables: Record<string, string>): unknown {
  if (typeof value !== 'string') return value
  for (const input of recipe.inputs) {
    if (input.example && input.example === value && variables[input.name]) return variables[input.name]
  }
  return value
}

// Serialized into the page (like browserStepRunner). Locates the click target and
// returns its viewport-center coordinates, so the main process can dispatch a real
// mouse click there via CDP Input.dispatchMouseEvent. Self-contained (no outer scope).
function clickLocator(step: RecipeStep): Promise<{
  ok: boolean
  x?: number
  y?: number
  desc?: { tag: string; id: string; name: string }
  error?: string
}> {
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
  return (async () => {
    const selectors = step.target.selectors?.length ? step.target.selectors : [step.target.selector]
    const started = Date.now()
    let el: Element | null = null
    while (Date.now() - started < 6000) {
      for (const selector of selectors) {
        try {
          const found = document.querySelector(selector)
          if (found) {
            el = found
            break
          }
        } catch {
          /* try next selector */
        }
      }
      if (el) break
      await sleep(120)
    }
    if (!el) return { ok: false, error: `Selector not found: ${step.target.selector}` }
    const desc = { tag: el.tagName.toLowerCase(), id: el.id || '', name: el.getAttribute('name') || '' }
    ;(el as HTMLElement).scrollIntoView({ block: 'center', inline: 'center' })
    await sleep(80)
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      return { ok: false, error: 'element has no box (0x0); cannot click by coordinate', desc }
    }
    return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, desc }
  })()
}

function browserStepRunner(
  step: RecipeStep
): Promise<{ ok: boolean; error?: string; desc?: { tag: string; id: string; name: string } }> {
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
  const find = async (selectors: string[]): Promise<Element | null> => {
    const started = Date.now()
    while (Date.now() - started < 6000) {
      for (const selector of selectors) {
        try {
          const el = document.querySelector(selector)
          if (el) return el
        } catch {
          /* try next selector */
        }
      }
      await sleep(120)
    }
    return null
  }
  const setValue = (el: Element, value: string): void => {
    const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    const proto =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : input instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
    if (descriptor?.set) descriptor.set.call(input, value)
    else input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const selectValue = async (el: Element, rawValue: string): Promise<{ ok: boolean; error?: string }> => {
    const norm = (value: unknown): string =>
      String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
    const matchOption = (options: HTMLOptionElement[], value: string): HTMLOptionElement | undefined => {
      const target = norm(value)
      return options.find((option) => option.value === value && !option.disabled)
        || options.find((option) => (option.textContent || '').trim() === value && !option.disabled)
        || options.find((option) => norm(option.value) === target && !option.disabled)
        || options.find((option) => norm(option.textContent) === target && !option.disabled)
        || options.find((option) => norm(option.label) === target && !option.disabled)
    }
    const isDisabledChoice = (option: Element): boolean => {
      if (option.getAttribute('aria-disabled') === 'true' || option.hasAttribute('disabled')) return true
      try {
        return option.matches(':disabled')
      } catch {
        return false
      }
    }
    const isVisibleOption = (option: Element): boolean => {
      try {
        if (option.getAttribute('aria-hidden') === 'true') return false
        const rect = option.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      } catch {
        return false
      }
    }
    const isChoiceNode = (option: Element): boolean => {
      const role = option.getAttribute('role') || ''
      const tag = option.tagName.toLowerCase()
      return tag === 'option'
        || role === 'option'
        || role === 'menuitem'
        || role === 'menuitemradio'
        || role === 'radio'
        || option.hasAttribute('data-value')
        || option.hasAttribute('data-option-value')
    }
    const optionMatches = (option: Element, value: string): boolean => {
      const target = norm(value)
      const candidates = [
        option.getAttribute('data-value'),
        option.getAttribute('data-option-value'),
        option.getAttribute('data-key'),
        option.getAttribute('data-id'),
        option.getAttribute('value'),
        option.getAttribute('title'),
        option.getAttribute('aria-label'),
        option.textContent
      ]
      return candidates.some((candidate) => candidate === value || norm(candidate) === target)
    }
    const clickChoice = (target: Element): void => {
      ;(target as HTMLElement).scrollIntoView({ block: 'center', inline: 'center' })
      ;(target as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }))
      ;(target as HTMLElement).dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }))
      ;(target as HTMLElement).click()
      target.dispatchEvent(new Event('input', { bubbles: true }))
      target.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const setNativeValue = (target: HTMLSelectElement, value: string): void => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
      if (descriptor?.set) descriptor.set.call(target, value)
      else target.value = value
      target.dispatchEvent(new Event('input', { bubbles: true }))
      target.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const wanted = String(rawValue || '')
    const parentSelect = el instanceof HTMLOptionElement ? el.closest('select') as HTMLSelectElement | null : null
    if (parentSelect) {
      if (isDisabledChoice(el)) return { ok: false, error: `select option is disabled: ${wanted || (el.textContent || '').trim() || (el as HTMLOptionElement).value}` }
      setNativeValue(parentSelect, (el as HTMLOptionElement).value)
      return { ok: true }
    }
    if (el instanceof HTMLSelectElement) {
      const deadline = Date.now() + 3000
      let options: HTMLOptionElement[] = []
      while (Date.now() < deadline) {
        options = Array.from(el.options || [])
        if (!wanted || matchOption(options, wanted)) break
        await sleep(120)
      }
      const matched = wanted ? matchOption(options, wanted) : options.find((option) => !option.disabled)
      if (!matched) {
        const available = options
          .filter((option) => !option.disabled)
          .slice(0, 12)
          .map((option) => (option.value && option.value !== option.textContent?.trim() ? `${option.textContent?.trim()}=${option.value}` : option.textContent?.trim() || option.value))
          .filter(Boolean)
          .join(', ')
        return { ok: false, error: `select option not found: ${wanted}${available ? ` (available: ${available})` : ''}` }
      }
      setNativeValue(el, matched.value)
      return { ok: true }
    }

    if (isChoiceNode(el) && !isDisabledChoice(el) && (!wanted || optionMatches(el, wanted))) {
      clickChoice(el)
      return { ok: true }
    }
    ;(el as HTMLElement).click()
    const deadline = Date.now() + 2500
    while (Date.now() < deadline) {
      const options = Array.from(
        document.querySelectorAll('[role="option"],[role="menuitem"],[role="menuitemradio"],[role="radio"],[data-value],[data-option-value],li,option')
      ).filter((option) => isVisibleOption(option) && !isDisabledChoice(option))
      const matched = options.find((option) => optionMatches(option, wanted))
      if (matched) {
        clickChoice(matched)
        return { ok: true }
      }
      await sleep(120)
    }
    return { ok: false, error: `custom select option not found: ${wanted}` }
  }
  return (async () => {
    const selectors = step.target.selectors?.length ? step.target.selectors : [step.target.selector]
    const el = await find(selectors)
    if (!el) return { ok: false, error: `Selector not found: ${step.target.selector}` }
    // Report the element we actually operated on: tag / id / name attribute.
    const desc = { tag: el.tagName.toLowerCase(), id: el.id || '', name: el.getAttribute('name') || '' }
    ;(el as HTMLElement).scrollIntoView({ block: 'center', inline: 'center' })
    await sleep(80)
    // NOTE: 'click' never reaches here — runStep routes it to clickStep (real mouse).
    if (step.action === 'fill' || step.action === 'select') {
      ;(el as HTMLElement).focus()
      // A <select>'s options may load async (e.g. on focus). Wait briefly for the
      // requested option to exist before setting, so agent-chosen selects don't
      // silently no-op against a not-yet-populated list.
      if (step.action === 'select') {
        const selected = await selectValue(el, step.valueTemplate || '')
        if (!selected.ok) return { ok: false, error: selected.error, desc }
        return { ok: true, desc }
      }
      setValue(el, step.valueTemplate || '')
      return { ok: true, desc }
    }
    if (step.action === 'check') {
      const input = el as HTMLInputElement
      input.checked = Boolean(step.checked)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true, desc }
    }
    if (step.action === 'submit') {
      const form = el.closest('form') as HTMLFormElement | null
      if (form?.requestSubmit) form.requestSubmit()
      else if (form) form.submit()
      else (el as HTMLElement).click()
      return { ok: true, desc }
    }
    return { ok: false, error: `Unsupported action: ${step.action}` }
  })()
}

function multiCallRunner(calls: ApiReplayCall[]): Promise<{
  ok: boolean
  results: CallResult[]
  errors: string[]
}> {
  return (async () => {
    const redactSecrets = (value: unknown, key = ''): unknown => {
      const sensitiveKey = /(authorization|cookie|set-cookie|token|secret|password|credential|session|jwt|bearer|api[-_]?key|csrf|xsrf)/i
      const jwt = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
      const bearer = /\bbearer\s+[A-Za-z0-9._~-]{12,}/gi
      if (sensitiveKey.test(key)) return '<redacted>'
      if (Array.isArray(value)) return value.map((item) => redactSecrets(item))
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {}
        for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
          out[childKey] = redactSecrets(childValue, childKey)
        }
        return out
      }
      if (typeof value === 'string') return value.replace(jwt, '[REDACTED_JWT]').replace(bearer, 'Bearer [REDACTED]')
      return value
    }
    const redactResponseText = (text: string): string => {
      try {
        return JSON.stringify(redactSecrets(JSON.parse(text)))
      } catch {
        return String(redactSecrets(text))
      }
    }
    const readStorage = (storage: Storage | null): Record<string, string> => {
      const out: Record<string, string> = {}
      if (!storage) return out
      try {
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i)
          if (!key) continue
          out[key] = storage.getItem(key) || ''
        }
      } catch {
        /* inaccessible storage */
      }
      return out
    }
    const cookies = (): Record<string, string> => {
      const out: Record<string, string> = {}
      try {
        for (const part of document.cookie.split(';')) {
          const [key, ...rest] = part.trim().split('=')
          if (key) out[decodeURIComponent(key)] = decodeURIComponent(rest.join('=') || '')
        }
      } catch {
        /* inaccessible cookies */
      }
      return out
    }
    const metas = (): Record<string, string> => {
      const out: Record<string, string> = {}
      for (const el of Array.from(document.querySelectorAll('meta[name], meta[property]'))) {
        const key = el.getAttribute('name') || el.getAttribute('property') || ''
        const value = el.getAttribute('content') || ''
        if (key && value) out[key] = value
      }
      return out
    }
    const norm = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')
    const findValue = (keys: string[] = []): string => {
      const sources = [readStorage(localStorage), readStorage(sessionStorage), cookies(), metas()]
      const wanted = keys.map(norm).filter(Boolean)
      for (const source of sources) {
        for (const key of keys) if (source[key]) return source[key]
        for (const [key, value] of Object.entries(source)) {
          const nk = norm(key)
          if (wanted.some((item) => nk === item || nk.includes(item) || item.includes(nk))) return value
        }
      }
      return ''
    }
    const stripBearer = (value: string): string => value.replace(/^bearer\s+/i, '').trim()
    const safeStaticHeader = (header: string): boolean => {
      const lower = header.toLowerCase()
      if (lower === 'content-type') return true
      return /^x-(client|app|request|trace|correlation|version)/i.test(lower)
    }
    const resolveHeaders = (call: ApiReplayCall): Record<string, string> => {
      const headers: Record<string, string> = {}
      for (const [header, value] of Object.entries(call.headers || {})) {
        if (safeStaticHeader(header)) headers[header] = String(value)
      }
      for (const policy of call.headerPolicy || []) {
        const keys = [...(policy.storageKeys || []), ...(policy.cookieNames || [])]
        let value = policy.kind === 'static' && safeStaticHeader(policy.header) ? headers[policy.header] || policy.fallback || '' : findValue(keys)
        if (policy.kind === 'bearer-token') value = value ? `${policy.prefix || 'Bearer '}${stripBearer(value)}` : ''
        if (value) headers[policy.header] = value
      }
      return headers
    }
    const runCommand = async (command: { command: 'fetch'; params: ApiReplayCall }): Promise<CallResult> => {
      const call = command.params
      const response = await fetch(call.url, {
        method: call.method,
        headers: resolveHeaders(call),
        body: call.body,
        credentials: 'include'
      })
      const body = redactResponseText(await response.text())
      return { method: call.method, url: call.url, status: response.status, ok: response.ok, body }
    }
    const results: CallResult[] = []
    const errors: string[] = []
    let lastBody = ''
    for (const call of calls) {
      try {
        const result = await runCommand({ command: 'fetch', params: call })
        results.push(result)
        if (result.ok) lastBody = result.body
        else errors.push(`${call.method} ${call.url} -> ${result.status}: ${result.body.slice(0, 200)}`)
      } catch (err) {
        results.push({ method: call.method, url: call.url, status: 0, ok: false, body: String(err) })
        errors.push(`${call.method} ${call.url} -> ${String(err)}`)
      }
    }
    const resultEl = document.getElementById('result')
    if (resultEl && lastBody) {
      try {
        resultEl.textContent = JSON.stringify(JSON.parse(lastBody), null, 2)
      } catch {
        resultEl.textContent = lastBody
      }
    }
    return { ok: errors.length === 0, results, errors }
  })()
}

// Serialized into the page and run via Runtime.evaluate. Self-contained. One authenticated
// fetch with LIVE auth resolution: token read from storage/sessionStorage/meta AT THIS MOMENT
// (never a stored value); cookies ride along via credentials:'include'.
function apiFetchRunner(
  call: { method?: string; url: string; query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string> },
  auths: { header: string; candidateKeys?: string[]; prefix?: string; meta?: string }[]
): Promise<{ ok: boolean; status: number; data?: unknown; error?: string; auth?: { header: string; source: string; key?: string; applied: boolean }[] }> {
  return (async () => {
    try {
      const redactSecrets = (value: unknown, key = ''): unknown => {
        const sensitiveKey = /(authorization|cookie|set-cookie|token|secret|password|credential|session|jwt|bearer|api[-_]?key|csrf|xsrf)/i
        const jwt = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
        const bearer = /\bbearer\s+[A-Za-z0-9._~-]{12,}/gi
        if (sensitiveKey.test(key)) return '<redacted>'
        if (Array.isArray(value)) return value.map((item) => redactSecrets(item))
        if (value && typeof value === 'object') {
          const out: Record<string, unknown> = {}
          for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
            out[childKey] = redactSecrets(childValue, childKey)
          }
          return out
        }
        if (typeof value === 'string') return value.replace(jwt, '[REDACTED_JWT]').replace(bearer, 'Bearer [REDACTED]')
        return value
      }
      // Default: write NO custom headers (the browser adds cookies/UA itself; credentials:'include'
      // carries the live session). For each auth scheme, dynamically generate its header from the
      // LIVE storage/cookie/meta value; direct secret-like caller headers are ignored so they cannot
      // override the live auth resolver.
      const headers: Record<string, string> = {}
      const authResolution: { header: string; source: string; key?: string; applied: boolean }[] = []
      const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
      const hit = (k: string | null, wanted: string[]): boolean =>
        !!k && wanted.some((w) => norm(k) === w || norm(k).includes(w))
      for (const auth of auths || []) {
        if (!auth || !auth.header) continue
        const wanted = (auth.candidateKeys || []).map(norm)
        const scanStore = (store: Storage | null, source: string): { value: string; source: string; key: string } | null => {
          if (!store) return null
          try {
            for (let i = 0; i < store.length; i += 1) {
              const k = store.key(i)
              if (hit(k, wanted)) return { value: store.getItem(k as string) || '', source, key: k as string }
            }
          } catch (_e) {
            /* inaccessible */
          }
          return null
        }
        const scanCookies = (): { value: string; source: string; key: string } | null => {
          try {
            for (const part of document.cookie.split(';')) {
              const idx = part.indexOf('=')
              const k = decodeURIComponent((idx >= 0 ? part.slice(0, idx) : part).trim())
              if (hit(k, wanted)) return { value: decodeURIComponent((idx >= 0 ? part.slice(idx + 1) : '').trim()), source: 'cookie', key: k }
            }
          } catch (_e) {
            /* inaccessible */
          }
          return null
        }
        const scanMeta = (): { value: string; source: string; key: string } | null => {
          try {
            for (const m of Array.from(document.querySelectorAll('meta[name],meta[property]'))) {
              const name = m.getAttribute('name') || m.getAttribute('property') || ''
              if (hit(name, wanted)) return { value: m.getAttribute('content') || '', source: 'meta', key: name }
            }
          } catch (_e) {
            /* inaccessible */
          }
          return null
        }
        // Resolve the token LIVE from any source the scheme points at: storage → cookie → meta.
        let found = wanted.length ? scanStore(localStorage, 'localStorage') || scanStore(sessionStorage, 'sessionStorage') || scanCookies() || scanMeta() : null
        if (!found && auth.meta) {
          const m = document.querySelector('meta[name="' + auth.meta + '"]')
          if (m) found = { value: m.getAttribute('content') || '', source: 'meta', key: auth.meta }
        }
        if (found?.value) headers[auth.header] = (auth.prefix || '') + found.value
        authResolution.push({
          header: auth.header,
          source: found?.value ? found.source : 'missing',
          key: found?.key || auth.meta,
          applied: Boolean(found?.value)
        })
      }
      const bodyIsObject = call.body !== null && call.body !== undefined && typeof call.body === 'object'
      if (bodyIsObject) headers['content-type'] = 'application/json'
      const explicitHeaders: string[] = []
      for (const [header, value] of Object.entries(call.headers || {})) {
        if (isUnsafeExplicitHeader(header)) continue
        headers[header] = String(value)
        explicitHeaders.push(header)
      }
      for (const item of authResolution) {
        if (explicitHeaders.some((header) => header.toLowerCase() === item.header.toLowerCase())) {
          item.source = 'explicit-header'
          item.key = item.header
          item.applied = true
        }
      }
      let url = call.url
      if (call.query && typeof call.query === 'object') {
        const u = new URL(call.url, location.href)
        for (const [k, v] of Object.entries(call.query)) u.searchParams.set(k, String(v))
        url = u.toString()
      }
      const res = await fetch(url, {
        method: (call.method || 'GET').toUpperCase(),
        headers,
        body: bodyIsObject ? JSON.stringify(call.body) : (call.body as string | undefined),
        credentials: 'include'
      })
      const text = await res.text()
      let data: unknown = text
      try {
        data = JSON.parse(text)
      } catch (_e) {
        /* keep as text */
      }
      data = redactSecrets(data)
      return { ok: res.ok, status: res.status, data, auth: authResolution }
    } catch (err) {
      return { ok: false, status: 0, error: String((err as Error)?.message ?? err) }
    }
  })()
}

function isUnsafeExplicitHeader(header: string): boolean {
  return /^(authorization|cookie|set-cookie|proxy-authorization|host|origin|referer|user-agent|content-length)$/i.test(header) ||
    /(csrf|xsrf|token|secret|credential|session|jwt|bearer|api[-_]?key)/i.test(header)
}

// Serialized into the page and run via Runtime.evaluate. Self-contained (no outer
// scope). Executes BrowserCommand[] in order; fetch reuses the page session/cookies.
function commandRunner(commands: BrowserCommand[]): Promise<{ ok: boolean; results: CommandResult[] }> {
  return (async () => {
    const redactSecrets = (value: unknown, key = ''): unknown => {
      const sensitiveKey = /(authorization|cookie|set-cookie|token|secret|password|credential|session|jwt|bearer|api[-_]?key|csrf|xsrf)/i
      const jwt = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
      const bearer = /\bbearer\s+[A-Za-z0-9._~-]{12,}/gi
      if (sensitiveKey.test(key)) return '<redacted>'
      if (Array.isArray(value)) return value.map((item) => redactSecrets(item))
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {}
        for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
          out[childKey] = redactSecrets(childValue, childKey)
        }
        return out
      }
      if (typeof value === 'string') return value.replace(jwt, '[REDACTED_JWT]').replace(bearer, 'Bearer [REDACTED]')
      return value
    }
    const summarizeValue = (value: string): { present: boolean; length: number } => ({
      present: Boolean(value),
      length: value.length
    })
    const readStorage = (storage: Storage | null): Record<string, { present: boolean; length: number }> => {
      const out: Record<string, { present: boolean; length: number }> = {}
      if (!storage) return out
      try {
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i)
          if (key) out[key] = summarizeValue(storage.getItem(key) || '')
        }
      } catch {
        /* inaccessible */
      }
      return out
    }
    const readCookies = (): Record<string, { present: boolean; length: number }> => {
      const out: Record<string, { present: boolean; length: number }> = {}
      try {
        for (const part of document.cookie.split(';')) {
          const [key, ...rest] = part.trim().split('=')
          if (key) out[decodeURIComponent(key)] = summarizeValue(decodeURIComponent(rest.join('=') || ''))
        }
      } catch {
        /* inaccessible */
      }
      return out
    }
    const filterKeys = (
      obj: Record<string, { present: boolean; length: number }>,
      keys?: string[]
    ): Record<string, { present: boolean; length: number }> => {
      if (!keys || keys.length === 0) return obj
      const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
      const wanted = keys.map(norm)
      const out: Record<string, { present: boolean; length: number }> = {}
      for (const [k, v] of Object.entries(obj)) {
        const nk = norm(k)
        if (wanted.some((w) => nk === w || nk.includes(w) || w.includes(nk))) out[k] = v
      }
      return out
    }
    const normalizeCommandId = (value: unknown): string | undefined => {
      if (typeof value !== 'string') return undefined
      const text = value.trim().replace(/\s+/g, '_').slice(0, 80)
      if (!text || /[\r\n]/.test(text)) return undefined
      if (/(authorization|cookie|token|secret|password|credential|session|jwt|bearer|api[-_]?key|csrf|xsrf)/i.test(text)) return undefined
      if (/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(text)) return undefined
      if (/\bbearer\s+[A-Za-z0-9._~-]{12,}/i.test(text)) return undefined
      return text
    }
    const isMutatingMethod = (method?: string): boolean => !['GET', 'HEAD', 'OPTIONS'].includes((method || 'GET').toUpperCase())
    const hasMutatingFetch = (entry: BrowserCommand): boolean => {
      if (entry.command === 'fetch') return isMutatingMethod((entry as { method?: string }).method)
      if (entry.command === 'parallel') return (entry as { commands: BrowserCommand[] }).commands.some(hasMutatingFetch)
      return false
    }

    const results: CommandResult[] = []
    for (const cmd of commands) {
      const id = normalizeCommandId((cmd as { id?: unknown }).id)
      try {
        if (cmd.command === 'read_context') {
          const keys = (cmd as { keys?: string[] }).keys
          results.push({
            command: 'read_context',
            id,
            ok: true,
            data: {
              url: location.href,
              localStorage: filterKeys(readStorage(localStorage), keys),
              sessionStorage: filterKeys(readStorage(sessionStorage), keys),
              cookies: filterKeys(readCookies(), keys)
            }
          })
        } else if (cmd.command === 'fetch') {
          const f = cmd as {
            url: string
            method?: string
            query?: Record<string, string | number | boolean>
            headers?: Record<string, string>
            body?: unknown
          }
          const headers: Record<string, string> = { ...(f.headers || {}) }
          const bodyIsObject = f.body !== null && f.body !== undefined && typeof f.body === 'object'
          if (bodyIsObject && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
            headers['content-type'] = 'application/json'
          }
          let url = f.url
          if (f.query && typeof f.query === 'object') {
            const u = new URL(f.url, location.href)
            for (const [k, v] of Object.entries(f.query)) u.searchParams.set(k, String(v))
            url = u.toString()
          }
          const res = await fetch(url, {
            method: (f.method || 'GET').toUpperCase(),
            headers,
            body: bodyIsObject ? JSON.stringify(f.body) : (f.body as string | undefined),
            credentials: 'include'
          })
          const text = await res.text()
          let data: unknown = text
          try {
            data = JSON.parse(text)
          } catch {
            /* keep as text */
          }
          data = redactSecrets(data)
          // Demo convenience: mirror the latest response into a #result panel if present.
          const panel = document.getElementById('result')
          if (panel) panel.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
          results.push({ command: 'fetch', id, ok: res.ok, status: res.status, data })
        } else if (cmd.command === 'parallel') {
          const nested = (cmd as { commands?: BrowserCommand[] }).commands || []
          if (nested.some(hasMutatingFetch)) {
            results.push({ command: 'parallel', id, ok: false, error: 'parallel browser_exec only allows read-only fetches; run mutating API requests sequentially.' })
            continue
          }
          const groups = await Promise.all(nested.map((item) => commandRunner([item])))
          for (const item of groups.flatMap((group) => group.results || [])) {
            results.push({ ...item, command: `parallel.${item.command}` })
          }
        } else {
          results.push({ command: String((cmd as { command?: unknown }).command), id, ok: false, error: 'unknown command' })
        }
      } catch (err) {
        results.push({
          command: String((cmd as { command?: unknown }).command ?? '?'),
          id,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
    return { ok: results.every((r) => r.ok), results }
  })()
}

function apiReplayRunner(plan: ApiReplayCall[]): Promise<{
  ok: boolean
  callsRun: number
  errors: string[]
  responseText?: string
}> {
  return (async () => {
    const redactSecrets = (value: unknown, key = ''): unknown => {
      const sensitiveKey = /(authorization|cookie|set-cookie|token|secret|password|credential|session|jwt|bearer|api[-_]?key|csrf|xsrf)/i
      const jwt = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
      const bearer = /\bbearer\s+[A-Za-z0-9._~-]{12,}/gi
      if (sensitiveKey.test(key)) return '<redacted>'
      if (Array.isArray(value)) return value.map((item) => redactSecrets(item))
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {}
        for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
          out[childKey] = redactSecrets(childValue, childKey)
        }
        return out
      }
      if (typeof value === 'string') return value.replace(jwt, '[REDACTED_JWT]').replace(bearer, 'Bearer [REDACTED]')
      return value
    }
    const redactResponseText = (text: string): string => {
      try {
        return JSON.stringify(redactSecrets(JSON.parse(text)))
      } catch {
        return String(redactSecrets(text))
      }
    }
    const readStorage = (storage: Storage | null): Record<string, string> => {
      const out: Record<string, string> = {}
      if (!storage) return out
      try {
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i)
          if (!key) continue
          out[key] = storage.getItem(key) || ''
        }
      } catch {
        /* inaccessible storage */
      }
      return out
    }
    const cookies = (): Record<string, string> => {
      const out: Record<string, string> = {}
      try {
        for (const part of document.cookie.split(';')) {
          const [key, ...rest] = part.trim().split('=')
          if (key) out[decodeURIComponent(key)] = decodeURIComponent(rest.join('=') || '')
        }
      } catch {
        /* inaccessible cookies */
      }
      return out
    }
    const metas = (): Record<string, string> => {
      const out: Record<string, string> = {}
      for (const el of Array.from(document.querySelectorAll('meta[name], meta[property]'))) {
        const key = el.getAttribute('name') || el.getAttribute('property') || ''
        const value = el.getAttribute('content') || ''
        if (key && value) out[key] = value
      }
      return out
    }
    const norm = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')
    const findValue = (keys: string[] = []): string => {
      const sources = [readStorage(localStorage), readStorage(sessionStorage), cookies(), metas()]
      const wanted = keys.map(norm).filter(Boolean)
      for (const source of sources) {
        for (const key of keys) if (source[key]) return source[key]
        for (const [key, value] of Object.entries(source)) {
          const nk = norm(key)
          if (wanted.some((item) => nk === item || nk.includes(item) || item.includes(nk))) return value
        }
      }
      return ''
    }
    const stripBearer = (value: string): string => value.replace(/^bearer\s+/i, '').trim()
    const safeStaticHeader = (header: string): boolean => {
      const lower = header.toLowerCase()
      if (lower === 'content-type') return true
      return /^x-(client|app|request|trace|correlation|version)/i.test(lower)
    }
    const resolveHeaders = (call: ApiReplayCall): Record<string, string> => {
      const headers: Record<string, string> = {}
      for (const [header, value] of Object.entries(call.headers || {})) {
        if (safeStaticHeader(header)) headers[header] = String(value)
      }
      for (const policy of call.headerPolicy || []) {
        const keys = [...(policy.storageKeys || []), ...(policy.cookieNames || [])]
        let value = policy.kind === 'static' && safeStaticHeader(policy.header) ? headers[policy.header] || policy.fallback || '' : findValue(keys)
        if (policy.kind === 'bearer-token') value = value ? `${policy.prefix || 'Bearer '}${stripBearer(value)}` : ''
        if (value) headers[policy.header] = value
      }
      return headers
    }
    const errors: string[] = []
    let responseText = ''
    let callsRun = 0
    for (const call of plan) {
      const response = await fetch(call.url, {
        method: call.method,
        headers: resolveHeaders(call),
        body: call.body,
        credentials: 'include'
      })
      const text = redactResponseText(await response.text())
      responseText = text
      callsRun += 1
      if (!response.ok) errors.push(`${call.method} ${call.url} -> ${response.status}: ${text}`)
    }
    const result = document.getElementById('result')
    if (result && responseText) {
      try {
        result.textContent = JSON.stringify(JSON.parse(responseText), null, 2)
      } catch {
        result.textContent = responseText
      }
    }
    return { ok: errors.length === 0, callsRun, errors, responseText }
  })()
}
