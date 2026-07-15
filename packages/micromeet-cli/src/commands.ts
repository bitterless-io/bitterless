import { readFileSync, rmSync } from 'fs'
import { optionBoolean, optionNumber, optionString, optionValues } from './args'
import { parseRegionCode, redactToken, regionBaseUrl } from './config'
import { normalizeCredentialEmail } from './credentialCrypto'
import { removeCredential, saveCredential } from './credentialStore'
import { runCurl } from './curl'
import { CliError } from './errors'
import { coreGet, corePost } from './http'
import { helpForCommand, modulesText, readManual, shortHelp } from './manual'
import { printConfigSummary, printJson, printTable } from './format'
import { isInteractiveTerminal, promptHidden, promptLine } from './prompt'
import type { AuthRealm, CommandContext, ParsedArgv } from './types'

interface UserProfile {
  id?: string
  email?: string
  name?: string
  role?: string
  is_platform_admin?: boolean
}

interface CrmsLoginResult {
  jwt_token?: string
  tenant_id?: string
  account_tenant_id?: string
  role?: string
  status?: string
  must_set_password?: boolean
  set_password?: boolean
}

interface SysLoginResult {
  token?: string
  sysAdmin?: Record<string, unknown>
}

interface CrmsSetPasswordResult {
  set?: boolean
}

interface McuRecordRow extends Record<string, unknown> {
  id: string
  mcu_id?: string
  outer_mcu_id?: string | null
  patient_name?: string
  user_type?: string | null
  check_status?: string
  fit_status?: string | null
  generate_status?: string
  report_generate_status?: string
  report_send_status?: string
  created_at?: string
}

interface McuListResult {
  list?: McuRecordRow[]
  total?: number
  page?: number
  page_size?: number
}

interface SettingsDetailResult {
  tenant?: Record<string, unknown> | null
  institution?: Record<string, unknown> | null
  effective_branding?: Record<string, unknown> | null
  permissions?: Record<string, unknown> | null
}

interface ListResult<Row extends Record<string, unknown>> {
  list?: Row[]
  total?: number
  page?: number
  page_size?: number
}

const enabled = (value: unknown): string => (value ? 'yes' : 'no')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const splitCsv = (value: string | undefined): string[] =>
  (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

const readJsonValue = (raw: string, label: string): unknown => {
  const source = raw.startsWith('@') ? readFileSync(raw.slice(1), 'utf8') : raw
  try {
    return JSON.parse(source)
  } catch (err) {
    throw new CliError(`${label} must be valid JSON: ${(err as Error).message}`)
  }
}

const bodyOption = (ctx: CommandContext): unknown | undefined => {
  const values = [...optionValues(ctx.argv, 'body'), ...optionValues(ctx.argv, 'data')]
  const raw = values[values.length - 1]
  if (raw === undefined) return undefined
  if (!raw) throw new CliError('--body/-d requires a JSON value or @file')
  return readJsonValue(raw, '--body/-d')
}

const bodyFromOptions = (
  ctx: CommandContext,
  keys: string[],
  params: { required?: string[] } = {}
): Record<string, unknown> => {
  const explicit = bodyOption(ctx)
  if (explicit !== undefined) {
    if (!isRecord(explicit)) throw new CliError('--body/-d must be a JSON object for this command')
    return explicit
  }
  const body: Record<string, unknown> = {}
  for (const key of keys) {
    const value = optionString(ctx.argv, key)
    if (value !== undefined && value !== '') body[key.replace(/-/g, '_')] = value
  }
  for (const key of params.required || []) {
    if (body[key] === undefined) throw new CliError(`Missing required option --${key.replace(/_/g, '-')}, or pass --body JSON`)
  }
  return body
}

const requiredOption = (ctx: CommandContext, key: string): string => {
  const value = optionString(ctx.argv, key)
  if (!value) throw new CliError(`Missing required option --${key}`)
  return value
}

const realmEnvironment = (realm: AuthRealm, suffix: string): string | undefined =>
  process.env[`MICROMEET_${realm.toUpperCase()}_${suffix}`]

const loginEmail = async (ctx: CommandContext): Promise<string> => {
  const value =
    optionString(ctx.argv, 'email') ||
    realmEnvironment(ctx.config.realm, 'EMAIL') ||
    process.env.MICROMEET_EMAIL ||
    ctx.config.email ||
    (await promptLine('Email: '))
  return normalizeCredentialEmail(value)
}

const loginPassword = async (ctx: CommandContext): Promise<string> => {
  const value =
    optionString(ctx.argv, 'password') ||
    realmEnvironment(ctx.config.realm, 'PASSWORD') ||
    process.env.MICROMEET_PASSWORD ||
    (await promptHidden('Password: '))
  if (!value) throw new CliError('Password cannot be empty')
  return value
}

const isExplicitSource = (source: string): boolean => source === 'cli' || source === 'env' || source.startsWith('env:')

const resolveCrmsLoginContext = async (ctx: CommandContext): Promise<CommandContext> => {
  const hasExplicitRegion = isExplicitSource(ctx.config.regionSource)
  const inheritsMaestroRegion =
    ctx.config.regionSource === 'credential' && ctx.config.credentialAuthSource === 'cowork'
  if (hasExplicitRegion || inheritsMaestroRegion) return ctx

  if (!isInteractiveTerminal()) {
    throw new CliError(
      'CRMS region is required in non-interactive mode; pass --region SG|HK|ID or log in through Maestro first'
    )
  }

  const answer = await promptLine(`Region [SG/HK/ID] (${ctx.config.region}): `)
  const region = parseRegionCode(answer, ctx.config.region)
  const hasExplicitBaseUrl = isExplicitSource(ctx.config.baseUrlSource)
  return {
    ...ctx,
    config: {
      ...ctx.config,
      region,
      regionSource: 'prompt',
      baseUrl: hasExplicitBaseUrl ? ctx.config.baseUrl : regionBaseUrl(region),
      baseUrlSource: hasExplicitBaseUrl ? ctx.config.baseUrlSource : `region:${region}`
    }
  }
}

const printLoginResult = (
  ctx: CommandContext,
  payload: { email: string; workspaceId?: string; account?: Record<string, unknown> }
): void => {
  const result = {
    realm: ctx.config.realm,
    email: payload.email,
    region: ctx.config.region,
    baseUrl: ctx.config.baseUrl,
    credentialFile: ctx.config.credentialFile,
    workspaceId: payload.workspaceId || undefined,
    account: payload.account
  }
  if (optionBoolean(ctx.argv, 'json')) {
    printJson(result)
    return
  }
  console.log(`${ctx.config.realm.toUpperCase()} login saved for ${payload.email}`)
  console.log(`credentialFile: ${ctx.config.credentialFile}`)
  if (payload.workspaceId) console.log(`workspaceId: ${payload.workspaceId}`)
}

const crmsLogin = async (ctx: CommandContext): Promise<void> => {
  const loginContext = await resolveCrmsLoginContext(ctx)
  const email = await loginEmail(loginContext)
  const password = await loginPassword(loginContext)
  const result = await corePost<CrmsLoginResult>(
    loginContext.config,
    '/share/auth/password-login',
    {
      email,
      password,
      language: optionString(loginContext.argv, 'language') || 'en'
    },
    { auth: false }
  )
  if (!result?.jwt_token) throw new CliError('CRMS login response did not include jwt_token')
  const account = {
    account_tenant_id: result.account_tenant_id,
    role: result.role,
    status: result.status,
    must_set_password: result.must_set_password,
    set_password: result.set_password
  }
  saveCredential(loginContext.config.credentialFile, {
    realm: 'crms',
    email,
    token: result.jwt_token,
    workspace_id: result.tenant_id,
    region: loginContext.config.region,
    api_base_url: loginContext.config.baseUrl,
    account,
    auth_source: 'cli',
    updated_at: Date.now()
  })
  printLoginResult(loginContext, { email, workspaceId: result.tenant_id, account })
  if (result.must_set_password && !optionBoolean(loginContext.argv, 'json')) {
    console.log('activationRequired: yes')
    console.log('next: micromeet crms auth set-password')
  }
}

const crmsSetPassword = async (ctx: CommandContext): Promise<void> => {
  const password = await loginPassword(ctx)
  const result = await corePost<CrmsSetPasswordResult>(ctx.config, '/share/auth/set-password', { password })
  if (result?.set !== true) throw new CliError('CRMS set-password response did not confirm activation')
  const payload = { realm: 'crms', activated: true }
  if (optionBoolean(ctx.argv, 'json')) {
    printJson(payload)
    return
  }
  console.log('CRMS account activated.')
}

const sysLogin = async (ctx: CommandContext): Promise<void> => {
  const email = await loginEmail(ctx)
  const password = await loginPassword(ctx)
  const result = await corePost<SysLoginResult>(
    ctx.config,
    '/sys/auth/login',
    { email, password },
    { auth: false }
  )
  if (!result?.token) throw new CliError('Sys login response did not include token')
  saveCredential(ctx.config.credentialFile, {
    realm: 'sys',
    email,
    token: result.token,
    region: ctx.config.region,
    api_base_url: ctx.config.baseUrl,
    account: result.sysAdmin,
    auth_source: 'cli',
    updated_at: Date.now()
  })
  printLoginResult(ctx, { email, account: result.sysAdmin })
}

const logout = (ctx: CommandContext): void => {
  const removed = removeCredential(ctx.config.credentialFile)
  let legacyRemoved = false
  if (ctx.config.realm === 'crms' && ctx.config.sessionFileExists) {
    rmSync(ctx.config.sessionFile, { force: true })
    legacyRemoved = true
  }
  const result = {
    realm: ctx.config.realm,
    credentialFile: ctx.config.credentialFile,
    credentialRemoved: removed,
    legacySessionRemoved: legacyRemoved,
    environmentTokenStillActive: ctx.config.tokenSource.startsWith('env') || ctx.config.tokenSource === 'cli'
  }
  if (optionBoolean(ctx.argv, 'json')) {
    printJson(result)
    return
  }
  console.log(`${ctx.config.realm.toUpperCase()} local credential ${removed ? 'removed' : 'was not present'}`)
  if (legacyRemoved) console.log(`legacySessionFile: removed ${ctx.config.sessionFile}`)
  if (result.environmentTokenStillActive) console.log('An option/environment token remains active for this process.')
}

const listBody = (ctx: CommandContext, extraKeys: string[] = []): Record<string, unknown> => ({
  page: optionNumber(ctx.argv, 'page', 1, { min: 1 }),
  page_size: optionNumber(ctx.argv, 'page-size', 20, { min: 1 }),
  keyword: optionString(ctx.argv, 'keyword') || undefined,
  status: optionString(ctx.argv, 'status') || undefined,
  ...bodyFromOptions(ctx, extraKeys)
})

const printListResult = <Row extends Record<string, unknown>>(
  ctx: CommandContext,
  res: ListResult<Row>,
  columns: Array<{ key: keyof Row; label: string }>
): void => {
  const list = res.list ?? []
  if (optionBoolean(ctx.argv, 'json')) {
    printJson(res)
    return
  }
  console.log(`total: ${res.total ?? list.length}  page: ${res.page ?? ''}  page_size: ${res.page_size ?? ''}`.trim())
  if (!list.length) {
    console.log('No records.')
    return
  }
  printTable(list, columns)
}

const printResult = (ctx: CommandContext, value: unknown): void => {
  if (optionBoolean(ctx.argv, 'json')) {
    printJson(value)
    return
  }
  printJson(value)
}

const recordIdsBody = (ctx: CommandContext, params: { allowNull?: boolean } = {}): Record<string, unknown> => {
  const explicit = bodyOption(ctx)
  if (explicit !== undefined) {
    if (!isRecord(explicit)) throw new CliError('--body/-d must be a JSON object for this command')
    return explicit
  }
  const ids = splitCsv(optionString(ctx.argv, 'ids') || optionString(ctx.argv, 'mcu-record-ids') || optionString(ctx.argv, 'id'))
  if (!ids.length && !params.allowNull) throw new CliError('Missing --ids <mcu_record_id[,mcu_record_id]>')
  return {
    mcu_record_ids: ids.length ? ids : null,
    pdf_file_name_mode: optionString(ctx.argv, 'pdf-file-name-mode') || undefined,
    force: optionBoolean(ctx.argv, 'force') || undefined
  }
}

const authStatus = async ({ config, argv }: CommandContext): Promise<void> => {
  const payload = {
    realm: config.realm,
    region: config.region,
    regionSource: config.regionSource,
    baseUrl: config.baseUrl,
    baseUrlSource: config.baseUrlSource,
    email: config.email || '',
    emailSource: config.emailSource,
    credentialAuthSource: config.credentialAuthSource || '',
    credentialFile: config.credentialFile,
    credentialFileExists: config.credentialFileExists,
    credentialError: config.credentialError,
    legacySessionFile: config.realm === 'crms' ? config.sessionFile : undefined,
    legacySessionFileExists: config.realm === 'crms' ? config.sessionFileExists : undefined,
    legacySessionUpdatedAt: config.realm === 'crms' ? config.sessionUpdatedAt : undefined,
    token: {
      present: Boolean(config.token),
      source: config.tokenSource,
      redacted: redactToken(config.token)
    },
    workspaceId: {
      value: config.workspaceId || '',
      source: config.workspaceIdSource
    }
  }

  if (optionBoolean(argv, 'check')) {
    const profile = await corePost<UserProfile>(config, '/share/user/profile/detail', {})
    if (optionBoolean(argv, 'json')) {
      printJson({ ...payload, profile })
      return
    }
    printConfigSummary(config)
    console.log(`token: ${payload.token.present ? payload.token.redacted : 'missing'} (${payload.token.source})`)
    console.log(`workspaceId: ${config.workspaceId || 'missing'} (${config.workspaceIdSource})`)
    console.log(`profile: ${profile.email || profile.name || profile.id || 'ok'}`)
    if (profile.role) console.log(`role: ${profile.role}`)
    if (profile.is_platform_admin !== undefined) console.log(`platformAdmin: ${enabled(profile.is_platform_admin)}`)
    return
  }

  if (optionBoolean(argv, 'json')) {
    printJson(payload)
    return
  }
  printConfigSummary(config)
  console.log(`token: ${payload.token.present ? payload.token.redacted : 'missing'} (${payload.token.source})`)
  console.log(`workspaceId: ${config.workspaceId || 'missing'} (${config.workspaceIdSource})`)
}

const sysMe = async (ctx: CommandContext): Promise<Record<string, unknown>> => {
  const profile = await coreGet<Record<string, unknown>>(ctx.config, '/sys/me')
  if (optionBoolean(ctx.argv, 'json')) printJson(profile)
  else printJson(profile)
  return profile
}

const sysAuthStatus = async (ctx: CommandContext): Promise<void> => {
  const payload = {
    realm: 'sys',
    region: ctx.config.region,
    regionSource: ctx.config.regionSource,
    baseUrl: ctx.config.baseUrl,
    baseUrlSource: ctx.config.baseUrlSource,
    email: ctx.config.email || '',
    emailSource: ctx.config.emailSource,
    credentialAuthSource: ctx.config.credentialAuthSource || '',
    credentialFile: ctx.config.credentialFile,
    credentialFileExists: ctx.config.credentialFileExists,
    credentialError: ctx.config.credentialError,
    token: {
      present: Boolean(ctx.config.token),
      source: ctx.config.tokenSource,
      redacted: redactToken(ctx.config.token)
    }
  }
  if (optionBoolean(ctx.argv, 'check')) {
    const me = await coreGet<Record<string, unknown>>(ctx.config, '/sys/me')
    if (optionBoolean(ctx.argv, 'json')) printJson({ ...payload, me })
    else {
      printConfigSummary(ctx.config)
      console.log(`token: ${payload.token.present ? payload.token.redacted : 'missing'} (${payload.token.source})`)
      console.log(`me: ${String(me.email || me.name || me.id || 'ok')}`)
    }
    return
  }
  if (optionBoolean(ctx.argv, 'json')) {
    printJson(payload)
    return
  }
  printConfigSummary(ctx.config)
  console.log(`token: ${payload.token.present ? payload.token.redacted : 'missing'} (${payload.token.source})`)
}

const withPositionals = (ctx: CommandContext, positionals: string[]): CommandContext => ({
  ...ctx,
  argv: {
    ...ctx.argv,
    positionals
  } as ParsedArgv
})

const runSysCommand = async (ctx: CommandContext): Promise<void> => {
  const [, functionName, subFunction] = ctx.argv.positionals
  if (!functionName || functionName === 'help') {
    console.log(helpForCommand(['sys']))
    return
  }
  if (functionName === 'login') {
    if (optionBoolean(ctx.argv, 'help')) {
      console.log('micromeet sys login [--email <email>] [--password <password>] [--region <SG|HK|ID>]')
      return
    }
    await sysLogin(ctx)
    return
  }
  if (functionName === 'logout') {
    logout(ctx)
    return
  }
  if (functionName === 'auth' && subFunction === 'status') {
    await sysAuthStatus(ctx)
    return
  }
  if (functionName === 'me') {
    await sysMe(ctx)
    return
  }
  if (functionName === 'curl') {
    await runCurl(withPositionals(ctx, ctx.argv.positionals.slice(1)))
    return
  }
  throw new CliError(`Unknown sys command: ${ctx.argv.positionals.slice(1).join(' ')}`)
}

const mcuRecords = async ({ config, argv }: CommandContext): Promise<void> => {
  const page = optionNumber(argv, 'page', 1, { min: 1 })
  const pageSize = optionNumber(argv, 'page-size', 20, { min: 1 })
  const body = {
    page,
    page_size: pageSize,
    keyword: optionString(argv, 'keyword') || undefined,
    check_status: optionString(argv, 'status') || undefined,
    fit_status: optionString(argv, 'fit-status') || undefined,
    user_type: optionString(argv, 'user-type') || undefined,
    corporate_id: optionString(argv, 'corporate-id') || undefined,
    project_id: optionString(argv, 'project-id') || undefined
  }
  const res = await corePost<McuListResult>(config, '/mcu/record/list', body)
  const list = res.list ?? []
  if (optionBoolean(argv, 'json')) {
    printJson({ ...res, page, page_size: pageSize })
    return
  }
  console.log(`total: ${res.total ?? list.length}  page: ${page}  page_size: ${pageSize}`)
  if (!list.length) {
    console.log('No records.')
    return
  }
  printTable(list, [
    { key: 'id', label: 'id' },
    { key: 'mcu_id', label: 'mcu_id' },
    { key: 'patient_name', label: 'patient' },
    { key: 'user_type', label: 'type' },
    { key: 'check_status', label: 'check' },
    { key: 'fit_status', label: 'fit' },
    { key: 'generate_status', label: 'conclusion' },
    { key: 'report_generate_status', label: 'report' },
    { key: 'report_send_status', label: 'email' }
  ])
}

const patientsList = async (ctx: CommandContext): Promise<void> => {
  const res = await corePost<ListResult<Record<string, unknown>>>(ctx.config, '/medical/patient/list', listBody(ctx))
  printListResult(ctx, res, [
    { key: 'id', label: 'id' },
    { key: 'full_name', label: 'name' },
    { key: 'gender', label: 'gender' },
    { key: 'national_id', label: 'national_id' },
    { key: 'phone', label: 'phone' },
    { key: 'status', label: 'status' },
    { key: 'mcu_record_count', label: 'mcu_records' }
  ])
}

const patientBody = (ctx: CommandContext, requireId = false): Record<string, unknown> => {
  const body = bodyFromOptions(ctx, [
    'id',
    'full-name',
    'name',
    'gender',
    'birth-date',
    'date-of-birth',
    'national-id',
    'nik',
    'phone',
    'ihs-number',
    'address',
    'status',
    'note'
  ])
  if (!body.full_name && body.name) body.full_name = body.name
  if (!body.birth_date && body.date_of_birth) body.birth_date = body.date_of_birth
  if (!body.national_id && body.nik) body.national_id = body.nik
  delete body.name
  delete body.date_of_birth
  delete body.nik
  if (requireId && !body.id) throw new CliError('Missing required option --id, or pass --body JSON')
  if (!requireId && !body.full_name) throw new CliError('Missing required option --full-name, --name, or pass --body JSON')
  return body
}

const patientDetail = async (ctx: CommandContext): Promise<void> => {
  const res = await corePost<Record<string, unknown>>(ctx.config, '/medical/patient/detail', {
    id: requiredOption(ctx, 'id')
  })
  printResult(ctx, res)
}

const patientCreate = async (ctx: CommandContext): Promise<void> => {
  const body = patientBody(ctx)
  const res = await corePost<Record<string, unknown>>(ctx.config, '/medical/patient/create', body)
  printResult(ctx, res)
}

const patientUpdate = async (ctx: CommandContext): Promise<void> => {
  const body = patientBody(ctx, true)
  const res = await corePost<Record<string, unknown>>(ctx.config, '/medical/patient/update', body)
  printResult(ctx, res)
}

const patientDelete = async (ctx: CommandContext): Promise<void> => {
  const res = await corePost<Record<string, unknown>>(ctx.config, '/medical/patient/delete', {
    id: requiredOption(ctx, 'id')
  })
  printResult(ctx, res)
}

const corporatesList = async (ctx: CommandContext): Promise<void> => {
  const res = await corePost<ListResult<Record<string, unknown>>>(ctx.config, '/medical/corporate/list', listBody(ctx))
  printListResult(ctx, res, [
    { key: 'id', label: 'id' },
    { key: 'name', label: 'name' },
    { key: 'code', label: 'code' },
    { key: 'status', label: 'status' },
    { key: 'project_count', label: 'projects' },
    { key: 'mcu_record_count', label: 'mcu_records' }
  ])
}

const corporateDetail = async (ctx: CommandContext): Promise<void> => {
  const res = await corePost<Record<string, unknown>>(ctx.config, '/medical/corporate/detail', {
    id: requiredOption(ctx, 'id')
  })
  printResult(ctx, res)
}

const corporateCreate = async (ctx: CommandContext): Promise<void> => {
  const body = bodyFromOptions(ctx, ['code', 'name', 'address', 'status', 'note', 'prompt'], { required: ['name'] })
  const res = await corePost<Record<string, unknown>>(ctx.config, '/medical/corporate/create', body)
  printResult(ctx, res)
}

const corporateUpdate = async (ctx: CommandContext): Promise<void> => {
  const body = bodyFromOptions(ctx, ['id', 'code', 'name', 'address', 'status', 'note', 'prompt'], { required: ['id'] })
  const res = await corePost<Record<string, unknown>>(ctx.config, '/medical/corporate/update', body)
  printResult(ctx, res)
}

const corporateDelete = async (ctx: CommandContext): Promise<void> => {
  const res = await corePost<Record<string, unknown>>(ctx.config, '/medical/corporate/delete', {
    id: requiredOption(ctx, 'id')
  })
  printResult(ctx, res)
}

const projectsList = async (ctx: CommandContext): Promise<void> => {
  const res = await corePost<ListResult<Record<string, unknown>>>(
    ctx.config,
    '/medical/project/list',
    listBody(ctx, ['corporate-id'])
  )
  printListResult(ctx, res, [
    { key: 'id', label: 'id' },
    { key: 'name', label: 'name' },
    { key: 'code', label: 'code' },
    { key: 'corporate_name', label: 'corporate' },
    { key: 'status', label: 'status' },
    { key: 'mcu_record_count', label: 'mcu_records' }
  ])
}

const projectDetail = async (ctx: CommandContext): Promise<void> => {
  const res = await corePost<Record<string, unknown>>(ctx.config, '/medical/project/detail', {
    id: requiredOption(ctx, 'id')
  })
  printResult(ctx, res)
}

const projectCreate = async (ctx: CommandContext): Promise<void> => {
  const body = bodyFromOptions(
    ctx,
    ['corporate-id', 'code', 'name', 'status', 'batch-date', 'period-start', 'period-end', 'note', 'prompt'],
    { required: ['name'] }
  )
  const res = await corePost<Record<string, unknown>>(ctx.config, '/medical/project/create', body)
  printResult(ctx, res)
}

const projectUpdate = async (ctx: CommandContext): Promise<void> => {
  const body = bodyFromOptions(
    ctx,
    ['id', 'corporate-id', 'code', 'name', 'status', 'batch-date', 'period-start', 'period-end', 'note', 'prompt'],
    { required: ['id'] }
  )
  const res = await corePost<Record<string, unknown>>(ctx.config, '/medical/project/update', body)
  printResult(ctx, res)
}

const projectDelete = async (ctx: CommandContext): Promise<void> => {
  const res = await corePost<Record<string, unknown>>(ctx.config, '/medical/project/delete', {
    id: requiredOption(ctx, 'id')
  })
  printResult(ctx, res)
}

const mappingFieldConfig = async (ctx: CommandContext): Promise<void> => {
  const language = optionString(ctx.argv, 'language')
  const mcuType = optionString(ctx.argv, 'mcu-type')
  const res = await coreGet<Record<string, unknown>>(
    ctx.config,
    '/mcu/setting/field-config',
    language ? { language } : undefined
  )
  printResult(ctx, mcuType ? { mcu_type: mcuType, config: res[mcuType] ?? null } : res)
}

const dataMapList = async (ctx: CommandContext): Promise<void> => {
  const body = {
    mcu_type: requiredOption(ctx, 'mcu-type'),
    status: optionString(ctx.argv, 'status') || ''
  }
  const res = await corePost<ListResult<Record<string, unknown>>>(ctx.config, '/mcu/setting/data-map/list', body)
  printListResult(ctx, res, [
    { key: 'id', label: 'id' },
    { key: 'mcu_type', label: 'mcu_type' },
    { key: 'column_name', label: 'column' },
    { key: 'system_field', label: 'system_field' },
    { key: 'status', label: 'status' },
    { key: 'check_unit', label: 'unit' }
  ])
}

const dataMapUpsert = async (ctx: CommandContext): Promise<void> => {
  const body = bodyFromOptions(ctx, [
    'id',
    'mcu-type',
    'column-name',
    'system-field',
    'status',
    'check-unit',
    'check-method',
    'reference'
  ])
  if (!body.mcu_type || !body.column_name) {
    throw new CliError('Missing --mcu-type and --column-name, or pass --body JSON')
  }
  const res = await corePost<Record<string, unknown>>(ctx.config, '/mcu/setting/data-map/upsert', body)
  printResult(ctx, res)
}

const dataMapDelete = async (ctx: CommandContext): Promise<void> => {
  const res = await corePost<Record<string, unknown>>(ctx.config, '/mcu/setting/data-map/delete', {
    id: requiredOption(ctx, 'id')
  })
  printResult(ctx, res)
}

const dataMapBulkStatus = async (ctx: CommandContext): Promise<void> => {
  const explicit = bodyOption(ctx)
  const body = explicit
    ? explicit
    : {
        ids: splitCsv(requiredOption(ctx, 'ids')),
        status: requiredOption(ctx, 'status')
      }
  const res = await corePost<Record<string, unknown>>(ctx.config, '/mcu/setting/data-map/bulk-status', body)
  printResult(ctx, res)
}

const mappingFileConfirm = async (ctx: CommandContext): Promise<void> => {
  const body = bodyFromOptions(ctx, ['mcu-type', 'mcu-file-id'])
  if (!body.mcu_type || !body.maps) {
    throw new CliError('Missing mapping confirm body. Pass --body JSON with {mcu_type,mcu_file_id?,maps[]}.')
  }
  const res = await corePost<Record<string, unknown>>(ctx.config, '/mcu/setting/file/mapping/confirm', body)
  printResult(ctx, res)
}

const mcuRecordDetail = async (ctx: CommandContext): Promise<void> => {
  const mcuRecordId = requiredOption(ctx, 'id')
  const summary = await corePost<Record<string, unknown>>(ctx.config, '/mcu/record/summary/detail', {
    mcu_record_id: mcuRecordId
  })
  printResult(ctx, summary)
}

const mcuRecordCreate = async (ctx: CommandContext): Promise<void> => {
  const body = bodyFromOptions(ctx, [
    'source-institution-id',
    'patient-id',
    'medical-client-id',
    'corporate-id',
    'project-id',
    'outer-mcu-id',
    'operator-user-id',
    'user-type'
  ])
  if (!body.patient_id) throw new CliError('Missing --patient-id, or pass --body JSON')
  const res = await corePost<Record<string, unknown>>(ctx.config, '/mcu/record/create', body)
  printResult(ctx, res)
}

const mcuRecordUpdateBody = (
  ctx: CommandContext,
  keys: string[],
  params: { requireReportType?: boolean } = {}
): Record<string, unknown> => {
  const body = bodyFromOptions(ctx, ['id', 'mcu-record-id', ...keys])
  if (!body.mcu_record_id && body.id) body.mcu_record_id = body.id
  delete body.id
  if (!body.mcu_record_id) throw new CliError('Missing --id/--mcu-record-id, or pass --body JSON')
  if (params.requireReportType && !body.report_type) throw new CliError('Missing --report-type, or pass --body JSON')
  return body
}

const mcuRecordPatientInfoUpdate = async (ctx: CommandContext): Promise<void> => {
  const body = mcuRecordUpdateBody(ctx, ['basic-info', 'company-info'])
  if (!body.basic_info && !body.company_info) {
    throw new CliError('Missing patient-info update payload. Pass --body JSON with {mcu_record_id,basic_info?,company_info?}.')
  }
  const res = await corePost<Record<string, unknown>>(ctx.config, '/mcu/record/patient-info/update', body)
  printResult(ctx, res)
}

const mcuRecordDiagnosticDataUpdate = async (ctx: CommandContext): Promise<void> => {
  const body = mcuRecordUpdateBody(ctx, ['report-type', 'diagnostic-data'], { requireReportType: true })
  if (!body.diagnostic_data) {
    throw new CliError('Missing diagnostic-data update payload. Pass --body JSON with {mcu_record_id,report_type,diagnostic_data}.')
  }
  const res = await corePost<Record<string, unknown>>(ctx.config, '/mcu/record/diagnostic-data/update', body)
  printResult(ctx, res)
}

const mcuRecordConclusionUpdate = async (ctx: CommandContext): Promise<void> => {
  const body = mcuRecordUpdateBody(ctx, ['report-type', 'conclusion-findings', 'recommendations', 'fitness'])
  if (!body.conclusion_findings && !body.recommendations && !body.fitness) {
    throw new CliError('Missing conclusion update payload. Pass --body JSON with {mcu_record_id,conclusion_findings?,recommendations?,fitness?}.')
  }
  const res = await corePost<Record<string, unknown>>(ctx.config, '/mcu/record/conclusion/update', body)
  printResult(ctx, res)
}

const mcuRecordValidate = async (ctx: CommandContext): Promise<void> => {
  const res = await corePost<Record<string, unknown>>(ctx.config, '/mcu/record/validate', recordIdsBody(ctx))
  printResult(ctx, res)
}

const mcuStatusOverview = async (ctx: CommandContext): Promise<void> => {
  const body = bodyFromOptions(ctx, ['source-institution-id', 'medical-client-id', 'corporate-id', 'project-id'])
  const res = await corePost<Record<string, unknown>>(ctx.config, '/mcu/status-overview', body)
  printResult(ctx, res)
}

const mcuConclusionGenerate = async (ctx: CommandContext): Promise<void> => {
  const res = await corePost<Record<string, unknown>>(
    ctx.config,
    '/mcu/conclusion/generate',
    recordIdsBody(ctx, { allowNull: true })
  )
  printResult(ctx, res)
}

const mcuReportGenerate = async (ctx: CommandContext): Promise<void> => {
  const body = recordIdsBody(ctx)
  if (!body.pdf_file_name_mode) body.pdf_file_name_mode = 'mcu_id_name'
  const res = await corePost<Record<string, unknown>>(ctx.config, '/mcu/report/generate', body)
  printResult(ctx, res)
}

const mcuReportSend = async (ctx: CommandContext): Promise<void> => {
  const res = await corePost<Record<string, unknown>>(ctx.config, '/mcu/report/send', recordIdsBody(ctx))
  printResult(ctx, res)
}

const mcuReportDownload = async (ctx: CommandContext): Promise<void> => {
  const res = await corePost<Record<string, unknown>>(ctx.config, '/mcu/report/download', {
    mcu_record_id: requiredOption(ctx, 'id')
  })
  printResult(ctx, res)
}

const mcuQueueTick = async (ctx: CommandContext): Promise<void> => {
  const res = await corePost<Record<string, unknown>>(ctx.config, '/mcu/queue/tick', {})
  printResult(ctx, res)
}

const migrationHeaders = (ctx: CommandContext): Record<string, string> => {
  const token = optionString(ctx.argv, 'migration-token') || process.env.MICROMEET_MIGRATION_TOKEN
  if (!token) throw new CliError('MICROMEET_MIGRATION_TOKEN or --migration-token is required for migration commands')
  return { 'x-migration-token': token }
}

const migrationProvision = async (ctx: CommandContext): Promise<void> => {
  const body = bodyFromOptions(ctx, ['admin-email', 'admin-name', 'tenant-name', 'tenant-code', 'institution-name', 'institution-code'])
  if (!body.admin_email || !body.tenant_name) {
    throw new CliError('Missing --admin-email and --tenant-name, or pass --body JSON')
  }
  const res = await corePost<Record<string, unknown>>(ctx.config, '/admin/migration/provision', body, {
    auth: false,
    headers: migrationHeaders(ctx)
  })
  printResult(ctx, res)
}

const migrationAccount = async (ctx: CommandContext): Promise<void> => {
  const explicit = bodyOption(ctx)
  const body = explicit ?? {
    source: requiredOption(ctx, 'source'),
    target: requiredOption(ctx, 'target'),
    dryRun: !optionBoolean(ctx.argv, 'apply'),
    domains: splitCsv(optionString(ctx.argv, 'domains'))
  }
  const res = await corePost<Record<string, unknown>>(ctx.config, '/admin/migration/account', body, {
    auth: false,
    headers: migrationHeaders(ctx),
    timeoutMs: optionNumber(ctx.argv, 'timeout', 300_000, { min: 1 })
  })
  printResult(ctx, res)
}

const settingsDetail = async ({ config, argv }: CommandContext): Promise<void> => {
  const res = await corePost<SettingsDetailResult>(config, '/medical/settings/detail', {})
  if (optionBoolean(argv, 'json')) {
    printJson(res)
    return
  }
  const tenant = res.tenant
  const institution = res.institution
  const permissions = res.permissions
  console.log(`tenant: ${String(tenant?.name || 'empty')} ${tenant?.id ? `(${String(tenant.id)})` : ''}`.trim())
  console.log(
    `institution: ${String(institution?.name || 'empty')} ${
      institution?.code ? `[${String(institution.code)}]` : ''
    }`.trim()
  )
  if (permissions) {
    console.log(
      `permissions: role=${String(permissions.role || '')} can_edit_tenant=${enabled(
        permissions.can_edit_tenant
      )} can_edit_institution=${enabled(permissions.can_edit_institution)}`
    )
  }
  if (res.effective_branding) {
    console.log(`brandingSource: ${String(res.effective_branding.source || '')}`)
    if (res.effective_branding.prompt_source) {
      console.log(`promptSource: ${String(res.effective_branding.prompt_source)}`)
    }
  }
}

export const runCommand = async (ctx: CommandContext): Promise<void> => {
  const [moduleName, functionName, subFunction, detailFunction] = ctx.argv.positionals

  if (!moduleName || moduleName === 'help') {
    console.log(shortHelp())
    return
  }
  if (moduleName === 'crms') {
    if (!functionName || functionName === 'help') {
      console.log(helpForCommand(['crms']))
      return
    }
    if (functionName === 'login') {
      if (optionBoolean(ctx.argv, 'help')) {
        console.log('micromeet crms login [--email <email>] [--password <password>] [--region <SG|HK|ID>]')
        return
      }
      await crmsLogin(ctx)
      return
    }
    if (functionName === 'logout') {
      logout(ctx)
      return
    }
    await runCommand(withPositionals(ctx, ctx.argv.positionals.slice(1)))
    return
  }
  if (moduleName === 'sys') {
    await runSysCommand(ctx)
    return
  }
  if (moduleName === 'manual') {
    console.log(readManual().trimEnd())
    return
  }
  if (moduleName === 'modules') {
    console.log(modulesText())
    return
  }
  if (moduleName === 'curl') {
    await runCurl(ctx)
    return
  }
  if (moduleName === 'auth' && functionName === 'status') {
    await authStatus(ctx)
    return
  }
  if (moduleName === 'auth' && functionName === 'set-password') {
    await crmsSetPassword(ctx)
    return
  }
  if (moduleName === 'mcu' && functionName === 'records') {
    await mcuRecords(ctx)
    return
  }
  if (moduleName === 'mcu' && functionName === 'status-overview') {
    await mcuStatusOverview(ctx)
    return
  }
  if (moduleName === 'mcu' && functionName === 'queue' && subFunction === 'tick') {
    await mcuQueueTick(ctx)
    return
  }
  if (moduleName === 'mcu' && functionName === 'record' && subFunction === 'detail') {
    await mcuRecordDetail(ctx)
    return
  }
  if (moduleName === 'mcu' && functionName === 'record' && subFunction === 'create') {
    await mcuRecordCreate(ctx)
    return
  }
  if (moduleName === 'mcu' && functionName === 'record' && subFunction === 'patient-info' && detailFunction === 'update') {
    await mcuRecordPatientInfoUpdate(ctx)
    return
  }
  if (moduleName === 'mcu' && functionName === 'record' && subFunction === 'diagnostic-data' && detailFunction === 'update') {
    await mcuRecordDiagnosticDataUpdate(ctx)
    return
  }
  if (moduleName === 'mcu' && functionName === 'record' && subFunction === 'conclusion' && detailFunction === 'update') {
    await mcuRecordConclusionUpdate(ctx)
    return
  }
  if (moduleName === 'mcu' && functionName === 'record' && subFunction === 'validate') {
    await mcuRecordValidate(ctx)
    return
  }
  if (moduleName === 'mcu' && functionName === 'conclusion' && subFunction === 'generate') {
    await mcuConclusionGenerate(ctx)
    return
  }
  if (moduleName === 'mcu' && functionName === 'report' && subFunction === 'generate') {
    await mcuReportGenerate(ctx)
    return
  }
  if (moduleName === 'mcu' && functionName === 'report' && subFunction === 'send') {
    await mcuReportSend(ctx)
    return
  }
  if (moduleName === 'mcu' && functionName === 'report' && subFunction === 'download') {
    await mcuReportDownload(ctx)
    return
  }
  if (moduleName === 'patients' && functionName === 'list') {
    await patientsList(ctx)
    return
  }
  if (moduleName === 'patients' && functionName === 'detail') {
    await patientDetail(ctx)
    return
  }
  if (moduleName === 'patients' && functionName === 'create') {
    await patientCreate(ctx)
    return
  }
  if (moduleName === 'patients' && functionName === 'update') {
    await patientUpdate(ctx)
    return
  }
  if (moduleName === 'patients' && functionName === 'delete') {
    await patientDelete(ctx)
    return
  }
  if (moduleName === 'corporates' && functionName === 'list') {
    await corporatesList(ctx)
    return
  }
  if (moduleName === 'corporates' && functionName === 'detail') {
    await corporateDetail(ctx)
    return
  }
  if (moduleName === 'corporates' && functionName === 'create') {
    await corporateCreate(ctx)
    return
  }
  if (moduleName === 'corporates' && functionName === 'update') {
    await corporateUpdate(ctx)
    return
  }
  if (moduleName === 'corporates' && functionName === 'delete') {
    await corporateDelete(ctx)
    return
  }
  if (moduleName === 'corporates' && functionName === 'projects' && subFunction === 'list') {
    await projectsList(ctx)
    return
  }
  if (moduleName === 'corporates' && functionName === 'projects' && subFunction === 'detail') {
    await projectDetail(ctx)
    return
  }
  if (moduleName === 'corporates' && functionName === 'projects' && subFunction === 'create') {
    await projectCreate(ctx)
    return
  }
  if (moduleName === 'corporates' && functionName === 'projects' && subFunction === 'update') {
    await projectUpdate(ctx)
    return
  }
  if (moduleName === 'corporates' && functionName === 'projects' && subFunction === 'delete') {
    await projectDelete(ctx)
    return
  }
  if (moduleName === 'mapping' && functionName === 'field-config') {
    await mappingFieldConfig(ctx)
    return
  }
  if (moduleName === 'mapping' && functionName === 'data-map' && subFunction === 'list') {
    await dataMapList(ctx)
    return
  }
  if (moduleName === 'mapping' && functionName === 'data-map' && subFunction === 'upsert') {
    await dataMapUpsert(ctx)
    return
  }
  if (moduleName === 'mapping' && functionName === 'data-map' && subFunction === 'delete') {
    await dataMapDelete(ctx)
    return
  }
  if (moduleName === 'mapping' && functionName === 'data-map' && subFunction === 'bulk-status') {
    await dataMapBulkStatus(ctx)
    return
  }
  if (moduleName === 'mapping' && functionName === 'file' && subFunction === 'confirm') {
    await mappingFileConfirm(ctx)
    return
  }
  if (moduleName === 'migration' && functionName === 'provision') {
    await migrationProvision(ctx)
    return
  }
  if (moduleName === 'migration' && functionName === 'account') {
    await migrationAccount(ctx)
    return
  }
  if (moduleName === 'settings' && functionName === 'detail') {
    await settingsDetail(ctx)
    return
  }

  const requested = [moduleName, functionName, subFunction, detailFunction].filter(Boolean).join(' ')
  throw new CliError(`Unknown command: ${requested}. Run micromeet manual for the command tree.`)
}
