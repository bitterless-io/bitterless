import { AsyncLocalStorage } from 'node:async_hooks'
import { navigateAgentBrowser, type BrowserNavigationAction } from './browserNavigation'
import type { BrowserWindow } from 'electron'
import { injectable } from 'inversify'
import {
  interceptionRuleSummary,
  normalizeNetworkInterceptionRule,
  publicInterceptionRule,
  type NetworkInterceptionRule
} from '@maestro-main/capture/networkInterception'
import { clipText } from '@maestro-main/capture/traceTimeline'
import type { DebuggerCapture } from '@maestro-main/capture/debuggerCapture'
import {
  type ApiCallResult,
  type AuthHint,
  type BrowserCommand,
  type CommandResult,
  type ReplayEngine
} from '@maestro-main/drive/replayEngine'
import {
  classifySkillApiCall,
  isMutatingHttpMethod,
  normalizeHttpMethod,
  type SkillApiSafetyDecision
} from '@maestro-main/drive/apiSafety'
import { runSkillScript, validateSkillVars } from '@maestro-main/drive/skillScript'
import { readApiProfile } from '@maestro-main/skills/apiProfile.service'
import type { SkillRecipe } from '@maestro-main/skills/skillRecipe.types'
import type { SkillRegistryService } from '@maestro-main/skills/skillRegistry.service'
import type { OperationTab } from '@maestro-main/windows/main/maestroBrowserView.service'
import { taskRegistry } from '@maestro-main/tasks/taskRegistry.service'
import { buildUnknownConfirmPayload } from '@maestro-main/drive/confirmPayload'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'
import type {
  AgentActivityStep,
  BrowserRequestReplayRequest,
  BrowserRequestReplayResult,
  CodexDebugEvent,
  HostApprovalEvent,
  ReplayResult,
  SkillSummary
} from '@maestro-shared/coach.api'
import type { TraceEvent } from '@maestro-shared/trace.types'
import {
  apiActivityPath,
  apiActivityPhase,
  browserCommandHasMutatingFetch,
  buildSkillContractText,
  compactReplayData,
  describeUiActionResult,
  describeApiAuthResolution,
  hostFromUrl,
  isBrowserFetchResultCommand,
  mergeAuthHints,
  normalizeApiQuery,
  parseAgentUiActions,
  parseBrowserCommand,
  replayResponsePreview,
  sanitizeReplayHeaders
} from './requestExec.helper'

const SNAPSHOT_RESULT_LIMIT = 200_000

interface RequestExecRuntimeServices {
  registry: SkillRegistryService
}

export interface RequestExecServiceState {
  browserWindow: BrowserWindow | null
  currentUrl: string
  readonly tabs: OperationTab[]
  readonly activeTabId: string | null
  capture: DebuggerCapture | null
  replayEngine: ReplayEngine | null
  lastAgentRun: { skill?: SkillSummary; skills?: SkillSummary[]; replay?: ReplayResult }

  ensureServices(): RequestExecRuntimeServices
  warmAndLoad(tab: OperationTab): Promise<void>
  drainNewTabsNote(sessionId?: string): string
  replaySkill(params: { skillId: string; variables: Record<string, string> }): Promise<ReplayResult>
  emitTrace(event: TraceEvent): void
  debugCodex(event: CodexDebugEvent): void
  broadcastActivity(phase: AgentActivityStep['phase'], label: string, ok?: boolean): void
  pushHostApprovalEvent(event: Omit<HostApprovalEvent, 'id' | 'requestedAt'>): Promise<string>
  resolveHostApprovalEvent(id: string, status: HostApprovalEvent['status']): Promise<void>
  confirmBrowserInterceptionRule(rule: NetworkInterceptionRule, tabId: string): Promise<boolean>
}

/**
 * Browser and request execution for Maestro agent tools.
 *
 * The service owns interception rules and every API write gate. Window lifecycle, tab ownership,
 * host-approval persistence, and interception confirmation remain controller callbacks.
 */
@injectable()
export class RequestExecService extends CommonService<RequestExecServiceState> {
  private readonly interceptionByTab = new Map<string, NetworkInterceptionRule[]>()

  private get browserInterceptionRules(): NetworkInterceptionRule[] {
    const target = this.browserTarget.getStore()
    if (!target) throw new Error('browser_intercept requires a resolved browser target.')
    if (!this.interceptionByTab.has(target.tab.id)) this.interceptionByTab.set(target.tab.id, [])
    return this.interceptionByTab.get(target.tab.id)!
  }

  private set browserInterceptionRules(rules: NetworkInterceptionRule[]) {
    const target = this.browserTarget.getStore()
    if (!target) throw new Error('browser_intercept requires a resolved browser target.')
    this.interceptionByTab.set(target.tab.id, rules)
  }

  private browserInterceptionSeq = 0
  private readonly browserTarget = new AsyncLocalStorage<{ tab: OperationTab; capture: DebuggerCapture; replay: ReplayEngine; url: string; sessionId?: string }>()

  async withBrowserTarget<T>(tab: OperationTab, work: () => Promise<T>, sessionId?: string): Promise<T> {
    return this.browserTarget.run({ tab, capture: tab.capture!, replay: tab.replay!, url: tab.url, sessionId }, work)
  }

  private get targetReplay(): ReplayEngine | null {
    const target = this.browserTarget.getStore()
    if (target) {
      const wc = target.tab.view?.webContents
      if (!this._state.tabs.includes(target.tab) || !wc || wc.isDestroyed() || wc.isCrashed() || target.tab.browserError || target.tab.replay !== target.replay) {
        throw new Error(`Tab ${target.tab.id}: browser target became unavailable. Reopen its intended URL explicitly; no action was retried.`)
      }
      return target.replay
    }
    return this._state.replayEngine
  }

  private get targetCapture(): DebuggerCapture | null {
    return this.browserTarget.getStore()?.capture ?? this._state.capture
  }

  private get targetUrl(): string {
    return this.browserTarget.getStore()?.url ?? this._state.currentUrl
  }

  async toolWebNav(rawAction: string): Promise<string> {
    const action = rawAction.trim().toLowerCase() || 'where'
    const target = this.browserTarget.getStore()
    if (!target) return 'ERROR: web_nav requires this chat\'s resolved browser target.'
    if (!['back', 'forward', 'reload', 'where'].includes(action)) return `ERROR: Tab ${target.tab.id}: action must be back | forward | reload | where.`
    // Validate ownership before and after the await; a replaced view cannot stand in for this one.
    this.targetReplay
    const wc = target.tab.view!.webContents
    const result = await navigateAgentBrowser(wc, target.tab.id, action as BrowserNavigationAction)
    this.targetReplay
    return result
  }

  async replayBrowserRequest(
    params: BrowserRequestReplayRequest
  ): Promise<BrowserRequestReplayResult> {
    const startedAt = Date.now()
    if (!this.targetReplay) {
      return {
        ok: false,
        status: 0,
        error: 'browser view is not ready',
        durationMs: 0
      }
    }
    const url = String(params.url || '').trim()
    if (!url) {
      return {
        ok: false,
        status: 0,
        error: 'url is required',
        durationMs: Date.now() - startedAt
      }
    }
    const method = String(params.method || 'GET').toUpperCase()
    const auth = readApiProfile(hostFromUrl(url || this.targetUrl))
    const result = await this.targetReplay.apiFetch(
      {
        url,
        method,
        query: normalizeApiQuery(params.query),
        headers: sanitizeReplayHeaders(params.headers),
        body: params.body
      },
      auth
    )
    this.broadcastApiActivity(method, url, result.ok, result.auth)
    this._state.emitTrace({
      kind: result.ok ? 'info' : 'error',
      msg: `workbench replay: ${method} ${apiActivityPath(url, this.targetUrl)} -> ${result.status || result.error || 'failed'}`,
      ts: Date.now()
    })
    return {
      ok: result.ok,
      status: result.status,
      data: compactReplayData(result.data),
      error: result.error,
      auth: result.auth,
      durationMs: Date.now() - startedAt
    }
  }

  broadcastApiActivity(
    method: string | undefined,
    url: string,
    ok: boolean,
    auth?: { header: string; source: string; key?: string; applied: boolean }[]
  ): void {
    const verb = (method || 'GET').toUpperCase()
    const authText = describeApiAuthResolution(auth)
    this._state.broadcastActivity(
      apiActivityPhase(verb),
      `${verb} ${apiActivityPath(url, this.targetUrl)}${authText ? ` · auth ${authText}` : ''}`,
      ok
    )
  }

  async toolBrowserIntercept(commandsJson: string): Promise<string> {
    let parsed: unknown
    try {
      parsed = JSON.parse(commandsJson)
    } catch {
      return 'ERROR: commands_json is not valid JSON.'
    }
    const rawList = Array.isArray(parsed) ? parsed : [parsed]
    const results: Array<Record<string, unknown>> = []
    for (const entry of rawList) {
      if (!entry || typeof entry !== 'object') {
        results.push({ ok: false, error: 'command must be an object' })
        continue
      }
      const command = String((entry as Record<string, unknown>).command || 'list').trim()
      if (command === 'list') {
        results.push({
          ok: true,
          command,
          rules: this.browserInterceptionRules.map(publicInterceptionRule)
        })
        continue
      }
      if (command === 'clear') {
        const count = this.browserInterceptionRules.length
        this.browserInterceptionRules = []
        await this.applyBrowserInterceptionRules()
        this._state.broadcastActivity('tool', `browser_intercept cleared ${count} rules`)
        results.push({ ok: true, command, cleared: count })
        continue
      }
      if (command === 'remove') {
        const id = String((entry as Record<string, unknown>).id || '').trim()
        const before = this.browserInterceptionRules.length
        this.browserInterceptionRules = this.browserInterceptionRules.filter((rule) => rule.id !== id)
        const removed = before - this.browserInterceptionRules.length
        if (removed) await this.applyBrowserInterceptionRules()
        results.push({ ok: removed > 0, command, id, removed })
        continue
      }
      if (command === 'add') {
        const normalized = normalizeNetworkInterceptionRule(
          entry,
          `intercept-${Date.now()}-${++this.browserInterceptionSeq}`
        )
        if (!normalized.ok || !normalized.rule) {
          results.push({
            ok: false,
            command,
            error: normalized.error || 'invalid rule'
          })
          continue
        }
        const allowed = await this._state.confirmBrowserInterceptionRule(normalized.rule, this.browserTarget.getStore()!.tab.id)
        if (!allowed) {
          results.push({
            ok: false,
            command,
            error: 'operator denied interception rule',
            rule: publicInterceptionRule(normalized.rule)
          })
          continue
        }
        this.browserInterceptionRules.push(normalized.rule)
        await this.applyBrowserInterceptionRules()
        this._state.broadcastActivity(
          'tool',
          `browser_intercept added ${interceptionRuleSummary(normalized.rule)}`
        )
        results.push({
          ok: true,
          command,
          rule: publicInterceptionRule(normalized.rule)
        })
        continue
      }
      results.push({
        ok: false,
        command,
        error: 'unsupported command; use list, add, remove, or clear'
      })
    }
    return JSON.stringify(
      {
        ok: results.every((item) => item.ok !== false),
        total: this.browserInterceptionRules.length,
        rules: this.browserInterceptionRules.map(publicInterceptionRule),
        results
      },
      null,
      1
    )
  }

  async applyBrowserInterceptionRules(): Promise<void> {
    this.targetReplay
    const target = this.browserTarget.getStore()
    if (!target) throw new Error('browser_intercept requires a resolved browser target.')
    await target.capture.setInterceptionRules(this.browserInterceptionRules)
  }

  async toolPageSnapshot(tabId?: string): Promise<string> {
    const tab = tabId ? this._state.tabs.find((item) => item.id === tabId) : undefined
    if (tabId && !tab) {
      return `ERROR: unknown tab_id "${tabId}". Call list_tabs to see open tabs.`
    }
    if (tab && (!tab.capture || !tab.view || tab.view.webContents.isDestroyed())) {
      await this._state.warmAndLoad(tab)
    }
    const capture = tab ? tab.capture : this.targetCapture
    const url = tab ? tab.url : this.targetUrl
    if (!capture) return 'ERROR: page capture is not ready.'
    const snapshot = await capture.snapshot()
    if (!snapshot.ok) {
      this._state.broadcastActivity('observe', 'snapshot failed', false)
      return 'ERROR: ' + (snapshot.error || 'snapshot failed')
    }
    this._state.broadcastActivity(
      'observe',
      `observed ${snapshot.nodeCount} elements${tab ? ` · tab ${tab.id}` : ''}`
    )
    this._state.emitTrace({
      kind: 'info',
      msg: `agent observed: ${snapshot.title || url} · ${snapshot.nodeCount} elements`,
      ts: Date.now()
    })
    return clipText(
      [
        `# tab: ${tab?.id ?? this._state.activeTabId ?? ''}`,
        `# page: ${url}`,
        `# title: ${snapshot.title || ''}`,
        `# elements: ${snapshot.nodeCount}`,
        '',
        snapshot.yaml
      ].join('\n'),
      SNAPSHOT_RESULT_LIMIT
    )
  }

  async toolUiAct(actionsJson: string): Promise<string> {
    if (!this.targetReplay) return 'ERROR: browser view is not ready.'
    let parsed: unknown
    try {
      parsed = JSON.parse(actionsJson)
    } catch {
      return 'ERROR: actions_json is not valid JSON.'
    }
    const actions = parseAgentUiActions(parsed)
    if (actions.length === 0) {
      return 'ERROR: no valid actions. Each needs {"action":"click|fill|select|check|submit","ref":"<eN from the snapshot>", ...} (or "selector":"<css>").'
    }
    const run = await this.targetReplay.runUiActions(actions)
    for (const result of run.results) {
      const label = `${result.action} ${describeUiActionResult(result)}`
      this._state.broadcastActivity('act', label, result.ok)
      this._state.emitTrace({
        kind: result.ok ? 'info' : 'error',
        msg: `agent ui_act: ${label} -> ${result.ok ? 'ok' : 'FAIL ' + (result.error || '')}`,
        ts: Date.now()
      })
    }
    this._state.lastAgentRun = {
      skill: this._state.lastAgentRun.skill,
      skills: this._state.lastAgentRun.skills,
      replay: {
        ok: run.ok,
        skillId: this._state.lastAgentRun.skill?.id || 'ui_act',
        stepsRun: run.results.filter((result) => result.ok).length,
        errors: run.results
          .filter((result) => !result.ok)
          .map(
            (result) =>
              `${result.action} ${describeUiActionResult(result)}: ${result.error || 'failed'}`
          ),
        mode: 'ui'
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 700))
    return clipText(JSON.stringify(run, null, 1)) + this._state.drainNewTabsNote(this.browserTarget.getStore()?.sessionId)
  }

  toolSkillContract(skillId: string): string {
    const services = this._state.ensureServices()
    const recipe = services.registry.readRecipe(skillId)
    const skill = services.registry
      .listSkills()
      .find((item) => item.id === skillId)
    if (!recipe) {
      if (!skill) return `ERROR: unknown skill_id "${skillId}".`
      const detail = services.registry.readSkillDetail(skillId)
      this._state.lastAgentRun = { skill, skills: [skill] }
      this._state.broadcastActivity('skill', `reading ${skill.name}`)
      return clipText(
        JSON.stringify(
          {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            source: skill.source,
            runtime: 'external_markdown',
            executable_by_coach: false,
            note: 'This skill has SKILL.md but no Coach recipe.json. Read markdown_body as guidance only; do not call run_skill_script or replay_skill_ui for it.',
            triggers: skill.triggers,
            inputs: skill.inputs,
            markdown_body: detail?.body || ''
          },
          null,
          1
        )
      )
    }
    if (skill) {
      this._state.lastAgentRun = { skill, skills: [skill] }
      this._state.broadcastActivity('skill', `using ${skill.name}`)
    }
    return buildSkillContractText(recipe)
  }

  async toolBrowserExec(commandsJson: string): Promise<string> {
    if (!this.targetReplay) return 'ERROR: browser view is not ready.'
    let parsed: unknown
    try {
      parsed = JSON.parse(commandsJson)
    } catch {
      return 'ERROR: commands_json is not valid JSON.'
    }
    const raw = Array.isArray(parsed) ? parsed : [parsed]
    const commands = raw
      .map(parseBrowserCommand)
      .filter((command): command is BrowserCommand => Boolean(command))
    if (commands.length === 0) {
      return 'ERROR: no valid commands. Each needs {"command":"read_context"|"fetch"|"parallel", ...}. Arbitrary eval is not exposed to the agent.'
    }
    const domainAuth = readApiProfile(hostFromUrl(this.targetUrl))
    const results: CommandResult[] = []
    for (const command of commands) {
      results.push(...(await this.executeBrowserCommand(command, domainAuth)))
    }
    const run = { ok: results.every((result) => result.ok), results }
    const fetches = run.results.filter((result) =>
      isBrowserFetchResultCommand(result.command)
    )
    if (fetches.length > 0) {
      const last = fetches[fetches.length - 1]
      this._state.lastAgentRun = {
        skill: this._state.lastAgentRun.skill,
        skills: this._state.lastAgentRun.skills,
        replay: {
          ok: run.ok,
          skillId: this._state.lastAgentRun.skill?.id || 'browser_exec',
          stepsRun: run.results.length,
          errors: run.results
            .filter((result) => !result.ok)
            .map(
              (result) =>
                result.error || `command ${result.command} failed`
            ),
          mode: 'api',
          apiCalls: fetches.length,
          responseText: replayResponsePreview(last.data),
          auth: last.auth
        }
      }
    }
    this._state.emitTrace({
      kind: run.ok ? 'info' : 'error',
      msg: run.ok
        ? `browser_exec: ${run.results.map((result) => result.command).join(', ')}`
        : `browser_exec failed: ${run.results
            .filter((result) => !result.ok)
            .map((result) => result.error)
            .join('; ')}`,
      ts: Date.now()
    })
    return clipText(JSON.stringify(run, null, 1)) + this._state.drainNewTabsNote(this.browserTarget.getStore()?.sessionId)
  }

  async toolRunSkillScript(
    skillId: string,
    variablesJson: string
  ): Promise<string> {
    if (!this.targetReplay) return 'ERROR: browser view is not ready.'
    const services = this._state.ensureServices()
    const recipe = services.registry.readRecipe(skillId)
    if (!recipe) {
      const skill = services.registry
        .listSkills()
        .find((item) => item.id === skillId)
      if (!skill) return `ERROR: unknown skill_id "${skillId}".`
      return `ERROR: skill "${skill.name}" is an external markdown skill with no Coach recipe.json — read get_skill_contract and use normal browser tools if needed.`
    }
    if (!recipe.script) {
      return `ERROR: skill "${recipe.name}" has no automation script — drive it via the page_snapshot → ui_act loop or browser_exec instead.`
    }
    let variables: Record<string, string> = {}
    try {
      const parsed = JSON.parse(variablesJson || '{}')
      if (parsed && typeof parsed === 'object') {
        variables = parsed as Record<string, string>
      }
    } catch {
      return 'ERROR: variables_json is not valid JSON.'
    }
    const check = validateSkillVars(recipe.inputs, variables)
    if (check.ok === false) return 'ERROR: invalid inputs — ' + check.errors.join('; ')
    variables = check.data as Record<string, string>
    const skill = services.registry
      .listSkills()
      .find((item) => item.id === skillId)
    if (skill) {
      this._state.lastAgentRun = { skill, skills: [skill] }
      this._state.broadcastActivity('skill', `running ${skill.name}`)
    }
    let host = ''
    try {
      host = new URL(recipe.sourceUrl || this.targetUrl).hostname.replace(
        /^www\./,
        ''
      )
    } catch {
      try {
        host = new URL(this.targetUrl).hostname.replace(/^www\./, '')
      } catch {
        // Keep the empty host; readApiProfile will return no hints.
      }
    }
    const auth = readApiProfile(host)
    const controller = new AbortController()
    const watchdog = setTimeout(() => controller.abort(), 120_000)
    const apiResults: {
      call: { method?: string; url: string }
      result: ApiCallResult
    }[] = []
    try {
      const run = await runSkillScript({
        script: recipe.script,
        replay: this.targetReplay,
        vars: variables,
        auth,
        signal: controller.signal,
        onApiFetch: (call, result) => {
          apiResults.push({
            call: { method: call.method, url: call.url },
            result
          })
          this.broadcastApiActivity(call.method, call.url, result.ok, result.auth)
        },
        onApiBeforeFetch: async (call) => {
          const decision = classifySkillApiCall(recipe, call)
          await this.handleSkillApiSafety(decision, call.url, {
            query: call.query,
            body: call.body
          })
          return decision
        }
      })
      const lastApi = apiResults[apiResults.length - 1]
      const replay: ReplayResult = {
        ok: run.ok,
        skillId,
        stepsRun: apiResults.length || (run.ok ? 1 : 0),
        errors: run.ok ? [] : [run.error || 'skill script failed'],
        mode: apiResults.length ? 'api' : 'ui',
        apiCalls: apiResults.length || undefined,
        responseText: lastApi
          ? replayResponsePreview(lastApi.result.data)
          : undefined,
        auth: lastApi?.result.auth
      }
      this._state.lastAgentRun = {
        skill,
        skills: skill ? [skill] : undefined,
        replay
      }
      this._state.broadcastActivity(
        'act',
        run.ok
          ? `ran skill script ${recipe.name}`
          : `script failed: ${run.error}`,
        run.ok
      )
      this._state.emitTrace({
        kind: run.ok ? 'info' : 'error',
        msg: run.ok
          ? `run_skill_script: ${recipe.name} ok`
          : `run_skill_script failed: ${run.error}`,
        ts: Date.now()
      })
      return clipText(JSON.stringify(run, null, 1)) + this._state.drainNewTabsNote(this.browserTarget.getStore()?.sessionId)
    } finally {
      clearTimeout(watchdog)
    }
  }

  async toolReplayUi(skillId: string, variablesJson: string): Promise<string> {
    const services = this._state.ensureServices()
    const skill = services.registry
      .listSkills()
      .find((item) => item.id === skillId)
    if (!skill) return `ERROR: unknown skill_id "${skillId}".`
    const variables: Record<string, string> = {}
    if (variablesJson.trim()) {
      try {
        const parsed = JSON.parse(variablesJson)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return 'ERROR: variables_json must be a JSON object.'
        }
        for (const [key, value] of Object.entries(
          parsed as Record<string, unknown>
        )) {
          if (value !== null && value !== undefined) variables[key] = String(value)
        }
      } catch {
        return 'ERROR: variables_json is not valid JSON.'
      }
    }
    const recipe = services.registry.readRecipe(skillId)
    if (!recipe) return 'ERROR: skill recipe was not found.'
    const replay = await this.replayRecipe(recipe, variables)
    this._state.lastAgentRun = { skill, skills: [skill], replay }
    await new Promise((resolve) => setTimeout(resolve, 700))
    return (
      JSON.stringify({
        ok: replay.ok,
        stepsRun: replay.stepsRun,
        errors: replay.errors
      }) + this._state.drainNewTabsNote(this.browserTarget.getStore()?.sessionId)
    )
  }

  async replayRecipe(
    recipe: SkillRecipe,
    variables: Record<string, string>
  ): Promise<ReplayResult> {
    if (!this.targetReplay) {
      return {
        ok: false,
        skillId: recipe.id,
        stepsRun: 0,
        errors: ['Browser view is not ready.']
      }
    }
    return await this.targetReplay.replay(recipe, variables)
  }

  private async handleSkillApiSafety(
    decision: SkillApiSafetyDecision,
    url: string,
    request?: { query?: Record<string, unknown> | null; body?: unknown }
  ): Promise<void> {
    if (decision.safety === 'safe') return
    const label = `${decision.method} ${apiActivityPath(url, this.targetUrl)}`
    if (decision.safety === 'unsafe') {
      await this._state.pushHostApprovalEvent({
        kind: 'api',
        status: 'blocked',
        label,
        method: decision.method,
        path: apiActivityPath(url, this.targetUrl),
        reason: decision.reason
      })
      this._state.broadcastActivity(
        'api-call',
        `blocked ${label} · ${decision.reason}`,
        false
      )
      this._state.debugCodex({
        scope: 'agent',
        phase: 'api-blocked',
        level: 'warn',
        message: `Blocked skill API request: ${label}`,
        detail: decision,
        ts: Date.now()
      })
      throw new Error(
        `api ${decision.method} ${decision.path} blocked: ${decision.reason}`
      )
    }
    const allowed = await this.confirmApiRequest({
      method: decision.method,
      url,
      reason: decision.reason,
      payload: buildUnknownConfirmPayload({
        summary: `${decision.method} ${apiActivityPath(url, this.targetUrl)}`,
        query: request?.query,
        body: request?.body
      })
    })
    if (!allowed) {
      this._state.broadcastActivity('api-call', `denied ${label}`, false)
      throw new Error(
        `operator denied api ${decision.method} ${decision.path}`
      )
    }
  }

  private async confirmApiRequest(params: {
    method: string
    url: string
    reason: string
    payload?: Parameters<typeof taskRegistry.askOperator>[0]['payload']
  }): Promise<boolean> {
    const path = apiActivityPath(params.url, this.targetUrl)
    const eventId = await this._state.pushHostApprovalEvent({
      kind: 'api',
      status: 'pending',
      label: `${params.method} ${path}`,
      method: params.method,
      path,
      reason: params.reason
    })
    const allowed = await taskRegistry.askOperator({
      name: 'api-approval',
      title: `Allow ${params.method} request?`,
      detail: `${params.reason}\n\n${params.method} ${path}`,
      confirmLabel: 'Run request',
      cancelLabel: 'Cancel',
      payload: params.payload
    })
    await this._state.resolveHostApprovalEvent(
      eventId,
      allowed ? 'approved' : 'denied'
    )
    this._state.broadcastActivity(
      'api-call',
      `${allowed ? 'approved' : 'denied'} ${params.method} ${apiActivityPath(params.url, this.targetUrl)}`,
      allowed
    )
    this._state.debugCodex({
      scope: 'agent',
      phase: allowed ? 'api-confirmed' : 'api-denied',
      level: allowed ? 'info' : 'warn',
      message: `${params.method} ${apiActivityPath(params.url, this.targetUrl)} ${allowed ? 'approved' : 'denied'} by operator.`,
      detail: {
        method: params.method,
        url: params.url,
        reason: params.reason
      },
      ts: Date.now()
    })
    return allowed
  }

  private async executeBrowserCommand(
    command: BrowserCommand,
    domainAuth: AuthHint[]
  ): Promise<CommandResult[]> {
    if (!this.targetReplay) {
      return [
        {
          command: command.command,
          id: command.id,
          ok: false,
          error: 'browser view is not ready'
        }
      ]
    }
    if (command.command === 'parallel') {
      if (command.commands.some(browserCommandHasMutatingFetch)) {
        return [
          {
            command: 'parallel',
            id: command.id,
            ok: false,
            error:
              'parallel browser_exec only allows read-only fetches; run mutating API requests sequentially.'
          }
        ]
      }
      const groups = await Promise.all(
        command.commands.map((item) =>
          this.executeBrowserCommand(item, domainAuth)
        )
      )
      return groups
        .flat()
        .map((item) => ({ ...item, command: `parallel.${item.command}` }))
    }
    if (command.command === 'fetch') {
      if (isMutatingHttpMethod(command.method)) {
        const allowed = await this.confirmApiRequest({
          method: normalizeHttpMethod(command.method),
          url: command.url,
          reason: 'browser_exec mutating API request',
          payload: buildUnknownConfirmPayload({
            summary: `${normalizeHttpMethod(command.method)} ${apiActivityPath(command.url, this.targetUrl)}`,
            query: command.query,
            body: command.body
          })
        })
        if (!allowed) {
          this._state.broadcastActivity(
            'api-call',
            `denied ${normalizeHttpMethod(command.method)} ${apiActivityPath(command.url, this.targetUrl)}`,
            false
          )
          return [
            {
              command: 'fetch',
              id: command.id,
              ok: false,
              status: 0,
              error: `operator denied ${normalizeHttpMethod(command.method)} ${apiActivityPath(command.url, this.targetUrl)}`
            }
          ]
        }
      }
      const result = await this.targetReplay.apiFetch(
        {
          url: command.url,
          method: command.method,
          query: command.query,
          headers: command.headers,
          body: command.body
        },
        mergeAuthHints(domainAuth, command.auth)
      )
      this.broadcastApiActivity(
        command.method,
        command.url,
        result.ok,
        result.auth
      )
      return [
        {
          command: 'fetch',
          id: command.id,
          ok: result.ok,
          status: result.status,
          data: result.data,
          error: result.error,
          auth: result.auth
        }
      ]
    }
    const single = await this.targetReplay.runCommands([command])
    return single.results
  }
}
