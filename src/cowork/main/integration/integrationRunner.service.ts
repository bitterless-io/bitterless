import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { bundledMicromeetCliPath, micromeetCliCredentialFile } from '@cowork-main/cli/micromeetCli.service'
import type {
  IntegrationMigrationRunRequest,
  IntegrationReportReadinessRequest,
  IntegrationRunOutput,
  IntegrationRunSummary,
  IntegrationTarget
} from '@cowork-shared/coach.api'

interface CliInvocation {
  command: string
  argsPrefix: string[]
  missing?: string
}

export interface CliRunResult {
  ok: boolean
  name: string
  command: string
  args: string[]
  exitCode?: number
  durationMs: number
  stdout: string
  stderr: string
  json?: unknown
  error?: string
}

interface McuRecordLike {
  id?: string
  check_status?: string
  generate_status?: string
  report_generate_status?: string
  report_send_status?: string
  fit_status?: string
  patient_name?: string
}

const OUTPUT_PREVIEW_LIMIT = 900

const clip = (value: string, max = OUTPUT_PREVIEW_LIMIT): string =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const asList = (value: unknown): McuRecordLike[] => {
  const raw = asRecord(value)
  const list = Array.isArray(raw.list) ? raw.list : []
  return list.filter((item): item is McuRecordLike => !!item && typeof item === 'object')
}

const compactCommand = (args: string[]): string =>
  ['micromeet', ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ')

const resolveCliInvocation = (): CliInvocation => {
  const bundled = bundledMicromeetCliPath()
  if (existsSync(bundled)) return { command: bundled, argsPrefix: [] }

  const devDist = join(app.getAppPath(), 'packages', 'micromeet-cli', 'dist', 'cli.js')
  if (existsSync(devDist)) return { command: process.env.MICROMEET_NODE_BINARY || 'node', argsPrefix: [devDist] }

  return {
    command: bundled,
    argsPrefix: [],
    missing: `micromeet CLI not found. Expected packaged binary at ${bundled} or dev build at ${devDist}. Run yarn workspace @micromeet/cli build or yarn prepare:cowork-cli.`
  }
}

const parseJson = (text: string): unknown | undefined => {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

const runCli = async (name: string, args: string[], params: { timeoutMs?: number } = {}): Promise<CliRunResult> => {
  const invocation = resolveCliInvocation()
  const startedAt = Date.now()
  const commandText = compactCommand(args)
  if (invocation.missing) {
    return {
      ok: false,
      name,
      command: invocation.command,
      args,
      durationMs: Date.now() - startedAt,
      stdout: '',
      stderr: '',
      error: invocation.missing
    }
  }

  return await new Promise<CliRunResult>((resolve) => {
    const child = spawn(invocation.command, [...invocation.argsPrefix, ...args], {
      env: {
        ...process.env,
        MICROMEET_CRMS_CREDENTIAL_FILE:
          process.env.MICROMEET_CRMS_CREDENTIAL_FILE || micromeetCliCredentialFile()
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timeout = params.timeoutMs
      ? setTimeout(() => {
          if (settled) return
          settled = true
          child.kill('SIGTERM')
          resolve({
            ok: false,
            name,
            command: commandText,
            args,
            durationMs: Date.now() - startedAt,
            stdout,
            stderr,
            error: `timed out after ${params.timeoutMs}ms`
          })
        }, params.timeoutMs)
      : null

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      resolve({
        ok: false,
        name,
        command: commandText,
        args,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        error: err.message
      })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      const ok = code === 0
      resolve({
        ok,
        name,
        command: commandText,
        args,
        exitCode: code ?? undefined,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        json: ok ? parseJson(stdout) : undefined,
        error: ok ? undefined : clip(stderr.trim() || stdout.trim() || `exit ${code}`)
      })
    })
  })
}

export const runMicromeetCli = async (name: string, args: string[], params: { timeoutMs?: number } = {}): Promise<CliRunResult> =>
  runCli(name, args, params)

const outputFor = (run: CliRunResult, summary?: string): IntegrationRunOutput => ({
  name: run.name,
  ok: run.ok,
  command: compactCommand(run.args),
  exitCode: run.exitCode,
  durationMs: run.durationMs,
  summary,
  error: run.error || (run.ok ? undefined : clip(run.stderr.trim() || run.stdout.trim()))
})

const migratedSummary = (value: unknown): string => {
  const raw = asRecord(value)
  const migrated = asRecord(raw.migrated)
  const counts = Object.entries(migrated)
    .map(([key, count]) => `${key}=${String(count)}`)
    .join(', ')
  const dryRun = raw.dryRun === true ? 'dry-run' : raw.dryRun === false ? 'applied' : 'migration'
  return counts ? `${dryRun}: ${counts}` : dryRun
}

const recordStatusSummary = (records: McuRecordLike[]): { summary: string; missing: string[]; ids: string[] } => {
  const ids = records.map((item) => item.id).filter(Boolean) as string[]
  const missing: string[] = []
  if (!records.length) missing.push('mcu records')
  const notValidated = records.filter((item) => item.check_status !== 'validated').length
  const noConclusion = records.filter((item) => item.generate_status !== 'generated').length
  const noReport = records.filter((item) => item.report_generate_status !== 'generated').length
  if (notValidated) missing.push(`${notValidated} record(s) not validated`)
  if (noConclusion) missing.push(`${noConclusion} record(s) without generated conclusion`)
  if (noReport) missing.push(`${noReport} record(s) without generated report`)
  return {
    ids,
    missing,
    summary: `${records.length} record(s), ${notValidated} not validated, ${noConclusion} without conclusion, ${noReport} without report`
  }
}

const listArgs = (params: IntegrationReportReadinessRequest): string[] => {
  const args = ['mcu', 'records', '--page', '1', '--page-size', String(Math.min(Math.max(params.pageSize || 20, 1), 100)), '--json']
  if (params.keyword?.trim()) args.push('--keyword', params.keyword.trim())
  if (params.corporateId?.trim()) args.push('--corporate-id', params.corporateId.trim())
  if (params.projectId?.trim()) args.push('--project-id', params.projectId.trim())
  return args
}

const idsArg = (ids: string[]): string => ids.join(',')

export const runAiCrmsReportReadiness = async (
  target: IntegrationTarget,
  params: IntegrationReportReadinessRequest
): Promise<IntegrationRunSummary> => {
  const startedAt = Date.now()
  const commandRuns: CliRunResult[] = []
  const notes: string[] = []
  const missing: string[] = []
  const outputs: IntegrationRunOutput[] = []

  notes.push('AI-CRMS report-readiness runner uses the bundled micromeet CLI and the Cowork-synced encrypted credential.')
  notes.push(params.generate ? 'generate=true: validate/conclusion/report/queue commands may enqueue server-side work.' : 'Read-only readiness check; no writes were requested.')

  const listRun = await runCli('mcu records', listArgs(params), { timeoutMs: 60_000 })
  commandRuns.push(listRun)
  const list = asList(listRun.json)
  const requestedIds = (params.mcuRecordIds || []).map((id) => String(id || '').trim()).filter(Boolean)
  const status = recordStatusSummary(list)
  outputs.push(outputFor(listRun, listRun.ok ? status.summary : undefined))
  if (!listRun.ok) missing.push('AI-CRMS records list API')
  else missing.push(...status.missing)

  const ids = requestedIds.length ? requestedIds : status.ids
  if (params.generate && ids.length) {
    for (const step of [
      { name: 'mcu record validate', args: ['mcu', 'record', 'validate', '--ids', idsArg(ids), '--json'] },
      { name: 'mcu conclusion generate', args: ['mcu', 'conclusion', 'generate', '--ids', idsArg(ids), '--json'] },
      { name: 'mcu report generate', args: ['mcu', 'report', 'generate', '--ids', idsArg(ids), '--json'] },
      { name: 'mcu queue tick', args: ['mcu', 'queue', 'tick', '--json'] },
      ...(params.send ? [{ name: 'mcu report send', args: ['mcu', 'report', 'send', '--ids', idsArg(ids), '--json'] }] : [])
    ]) {
      const run = await runCli(step.name, step.args, { timeoutMs: 300_000 })
      commandRuns.push(run)
      outputs.push(outputFor(run, run.ok ? 'command completed' : undefined))
      if (!run.ok) missing.push(step.name)
      if (!run.ok) break
    }
  } else if (params.generate && !ids.length) {
    missing.push('mcu record ids for generation')
  }

  const anyCommandFailed = commandRuns.some((run) => !run.ok)
  const runStatus = anyCommandFailed ? 'failed' : missing.length ? 'warning' : 'success'
  return {
    id: randomUUID(),
    mode: params.generate ? 'apply' : 'readiness',
    status: runStatus,
    startedAt,
    finishedAt: Date.now(),
    endpointCount: target.endpoints.length,
    readCount: target.endpoints.filter((endpoint) => endpoint.role === 'read').length,
    writeCount: target.endpoints.filter((endpoint) => endpoint.role === 'write').length,
    entityCount: target.entities.length,
    commandCount: commandRuns.length,
    notes,
    missing,
    outputs
  }
}

export const runAiCrmsMigration = async (
  target: IntegrationTarget,
  params: IntegrationMigrationRunRequest
): Promise<IntegrationRunSummary> => {
  const startedAt = Date.now()
  const migration = target.source.migration
  const notes: string[] = []
  const missing: string[] = []
  const outputs: IntegrationRunOutput[] = []

  notes.push('AI-CRMS migration runner calls the bundled micromeet CLI admin/migration/account wrapper.')
  notes.push('Migration auth uses MICROMEET_MIGRATION_TOKEN or --migration-token; Cowork does not store the token on the target.')
  notes.push(params.apply ? 'apply=true: backend migration will write rows.' : 'apply=false/default: backend dryRun rolls the transaction back.')

  if (!migration?.source) missing.push('migration source account')
  if (!migration?.target) missing.push('migration target account')
  if (missing.length) {
    return {
      id: randomUUID(),
      mode: params.apply ? 'apply' : 'dry-run',
      status: 'warning',
      startedAt,
      finishedAt: Date.now(),
      endpointCount: target.endpoints.length,
      readCount: target.endpoints.filter((endpoint) => endpoint.role === 'read').length,
      writeCount: target.endpoints.filter((endpoint) => endpoint.role === 'write').length,
      entityCount: target.entities.length,
      commandCount: 0,
      notes,
      missing,
      outputs
    }
  }

  const source = migration?.source || ''
  const targetAccount = migration?.target || ''
  const domains = (params.domains?.length ? params.domains : migration?.domains || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
  const body: Record<string, unknown> = {
    source,
    target: targetAccount,
    dryRun: params.apply !== true
  }
  if (domains.length) body.domains = domains

  const run = await runCli(
    params.apply ? 'migration account apply' : 'migration account dry-run',
    ['migration', 'account', '--body', JSON.stringify(body), '--timeout', String(params.timeoutMs || 300_000), '--json'],
    { timeoutMs: params.timeoutMs || 300_000 }
  )
  outputs.push(outputFor(run, run.ok ? migratedSummary(run.json) : undefined))
  if (!run.ok) missing.push('admin/migration/account')

  return {
    id: randomUUID(),
    mode: params.apply ? 'apply' : 'dry-run',
    status: run.ok ? 'success' : 'failed',
    startedAt,
    finishedAt: Date.now(),
    endpointCount: target.endpoints.length,
    readCount: target.endpoints.filter((endpoint) => endpoint.role === 'read').length,
    writeCount: target.endpoints.filter((endpoint) => endpoint.role === 'write').length,
    entityCount: target.entities.length,
    commandCount: 1,
    notes,
    missing,
    outputs
  }
}
