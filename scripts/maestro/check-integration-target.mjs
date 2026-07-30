import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const projectRoot = process.cwd()
const require = createRequire(import.meta.url)
const root = join(projectRoot, 'src')
const sourcePath = (relativePath) => {
  const [processName, ...rest] = relativePath.split('/')
  return join(root, processName, 'maestro', ...rest)
}
const read = (path) => readFileSync(sourcePath(path), 'utf8')
const readProject = (path) => readFileSync(join(projectRoot, path), 'utf8')
const readCli = (path) => readFileSync(join(projectRoot, 'packages', 'micromeet-cli', path), 'utf8')
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const includes = (path, needle) => {
  const text = read(path)
  assert(text.includes(needle), `${path} should include ${needle}`)
}
const count = (source, text) => source.split(text).length - 1
const normalizeSpace = (source) => source.replace(/\s+/g, ' ').trim()
const boundedSource = (source, start, end, message) => {
  const startIndex = source.indexOf(start)
  const endIndex = startIndex < 0 ? -1 : source.indexOf(end, startIndex + start.length)
  assert(startIndex >= 0 && endIndex > startIndex, message)
  return source.slice(startIndex, endIndex)
}
const assertExactDelegate = (source, start, end, statement, message) => {
  assert(count(source, start) === 1, `${message} should have one controller facade`)
  const method = boundedSource(source, start, end, `${message} should have a bounded controller facade`)
  const closeIndex = method.lastIndexOf('}')
  assert(closeIndex >= start.length, `${message} should keep a method body`)
  assert(
    normalizeSpace(method.slice(start.length, closeIndex)) === normalizeSpace(statement),
    `${message} should be an exact one-line delegate`
  )
}
const assertOrdered = (source, needles, message) => {
  let previous = -1
  for (const needle of needles) {
    const index = source.indexOf(needle)
    assert(index > previous, `${message} should preserve ordered step ${needle}`)
    previous = index
  }
}
const pureModuleCache = new Map()
const loadPureTsModule = (file) => {
  if (pureModuleCache.has(file)) return pureModuleCache.get(file).exports
  const mod = { exports: {} }
  pureModuleCache.set(file, mod)
  const output = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    fileName: file
  }).outputText
  const wrapped = vm.runInThisContext(
    `(function(exports, require, module, __filename, __dirname) {\n${output}\n})`,
    { filename: file }
  )
  wrapped(
    mod.exports,
    (specifier) => {
      if (specifier.startsWith('.')) {
        return loadPureTsModule(join(dirname(file), `${specifier}.ts`))
      }
      return require(specifier)
    },
    mod,
    file,
    dirname(file)
  )
  return mod.exports
}

const servicePath = 'main/integration/integrationTarget.service.ts'
const runnerPath = 'main/integration/integrationRunner.service.ts'
const schedulerPath = 'main/integration/integrationScheduler.service.ts'
const mappingPath = 'main/integration/integrationMapping.service.ts'
const orchestrationPath = 'main/integration/integration.service.ts'
const rowMappingPath = 'main/integration/recordedSite/rowMapping.ts'
const rowValuePath = 'main/integration/recordedSite/rowValue.ts'
const controllerPath = 'main/windows/main/maestroWindow.controller.ts'
assert(existsSync(sourcePath(servicePath)), 'integration target service should exist')
assert(existsSync(sourcePath(runnerPath)), 'integration runner service should exist')
assert(existsSync(sourcePath(schedulerPath)), 'integration scheduler service should exist')
assert(existsSync(sourcePath(mappingPath)), 'integration mapping service should exist')
assert(existsSync(sourcePath(orchestrationPath)), 'integration orchestration service should exist')
assert(existsSync(sourcePath(rowMappingPath)), 'recorded-site row mapping helper should exist')
assert(existsSync(sourcePath(rowValuePath)), 'recorded-site row value helper should exist')

includes('shared/config.api.ts', "INTEGRATION_TARGET_CONFIG_DOMAIN = 'integration-targets'")
includes('shared/config.api.ts', "INTEGRATION_TARGET_KEY_PREFIX = 'target:'")
includes('shared/config.api.ts', "INTEGRATION_MAPPING_CONFIG_DOMAIN = 'integration-mappings'")
includes('shared/config.api.ts', "INTEGRATION_MAPPING_KEY_PREFIX = 'map:'")
includes('shared/coach.api.ts', "listIntegrationTargets(): Promise<IntegrationTargetSummary[]>")
includes('shared/coach.api.ts', "createIntegrationTargetFromCapture")
includes('shared/coach.api.ts', "runIntegrationTargetDryRun")
includes('shared/coach.api.ts', "runIntegrationRecordedSiteDryRun")
includes('shared/coach.api.ts', "runIntegrationRecordedSitePlan")
includes('shared/coach.api.ts', "runIntegrationRecordedSiteApply")
includes('shared/coach.api.ts', "runIntegrationReportReadiness")
includes('shared/coach.api.ts', "setIntegrationTargetSchedule")
includes('shared/coach.api.ts', "listIntegrationMappings")
includes('shared/coach.api.ts', "upsertIntegrationMapping")
includes('shared/coach.api.ts', "deleteIntegrationMapping")
includes('shared/coach.api.ts', "createAiCrmsMigrationTarget")
includes('shared/coach.api.ts', "runIntegrationMigration")
includes('shared/coach.api.ts', "IntegrationMappingEntry")
includes('shared/coach.api.ts', "IntegrationMappingSummary")
includes('shared/coach.api.ts', "IntegrationMappingUpsertRequest")
includes('shared/coach.api.ts', "IntegrationRecordedSiteSyncRequest")
includes('shared/coach.api.ts', "IntegrationScheduleRunKind")
includes('shared/coach.api.ts', "'recorded-site-dry-run'")
includes('shared/coach.api.ts', "IntegrationMigrationTargetRequest")
includes('shared/coach.api.ts', "IntegrationMigrationRunRequest")
includes('shared/coach.api.ts', "IntegrationTargetScheduleRequest")
includes('shared/coach.api.ts', "IntegrationReportReadinessRequest")
includes('shared/coach.api.ts', "'readiness'")
includes('shared/coach.api.ts', "'integrations'")
includes('shared/coach.api.ts', "'integration'")

includes(servicePath, 'buildIntegrationEndpointContracts')
includes(servicePath, 'configStore.upsert')
includes(servicePath, 'schedule: {')
includes(servicePath, "enabled: false")
includes(servicePath, "mode: 'dry-run'")
includes(servicePath, 'Dry-run validates the saved integration contract only')
includes(servicePath, 'runReportReadiness')
includes(servicePath, 'createAiCrmsMigrationTarget')
includes(servicePath, 'runMigration')
includes(servicePath, 'setSchedule')
includes(servicePath, 'markScheduledRunCompleted')
includes(servicePath, 'deleteTargetMappings')
includes(servicePath, 'recordRun')
includes(servicePath, 'runAiCrmsReportReadiness')
includes(servicePath, 'runAiCrmsMigration')

includes(runnerPath, 'bundledMicromeetCliPath')
includes(runnerPath, 'runMicromeetCli')
includes(runnerPath, "['mcu', 'records'")
includes(runnerPath, "['mcu', 'record', 'validate'")
includes(runnerPath, "['mcu', 'report', 'generate'")
includes(runnerPath, "mode: params.generate ? 'apply' : 'readiness'")
includes(runnerPath, "['migration', 'account'")
includes(runnerPath, 'MICROMEET_MIGRATION_TOKEN')

includes(schedulerPath, 'SCHEDULER_POLL_MS')
includes(schedulerPath, 'runRecordedSiteDryRun')
includes(schedulerPath, "'recorded-site-dry-run'")
includes(schedulerPath, 'integrationTargetStore.runMigration({ targetId: target.id, apply: false })')
includes(schedulerPath, 'integrationTargetStore.runReportReadiness({ targetId: target.id, pageSize: 20, generate: false })')
includes(schedulerPath, 'runningTargets')
includes(schedulerPath, 'markScheduledRunCompleted')

includes(mappingPath, 'IntegrationMappingStore')
includes(mappingPath, 'INTEGRATION_MAPPING_CONFIG_DOMAIN')
includes(mappingPath, 'sourceKeyHash')
includes(mappingPath, 'listMappings')
includes(mappingPath, 'upsertMapping')
includes(mappingPath, 'deleteMapping')
includes(mappingPath, 'deleteTargetMappings')

const integration = read(orchestrationPath)
const rowMapping = read(rowMappingPath)
const controller = read(controllerPath)

for (const needle of [
  'export interface IntegrationServiceState',
  'export class IntegrationService extends CommonService<IntegrationServiceState>',
  'buildRecordedSiteDryRun',
  'buildRecordedSiteApply',
  'fetchRecordedSiteRowDetails',
  'runIntegrationMigration',
  'runIntegrationReportReadiness',
  'setIntegrationTargetSchedule',
  'listIntegrationMappings',
  'upsertIntegrationMapping',
  'deleteIntegrationMapping',
  'handleIntegrationSchedulerEvent'
]) {
  assert(integration.includes(needle), `${orchestrationPath} should include ${needle}`)
}
assert(!integration.includes('maestroWindow.controller'), 'IntegrationService must remain a leaf without importing its controller')

const createFromCaptureBody = boundedSource(
  integration,
  '  async createIntegrationTargetFromCapture(',
  '  async createAiCrmsMigrationTarget(',
  'IntegrationService should keep a bounded create-from-capture body'
)
for (const needle of [
  'await this._state.ensurePersistedCaptureRecordsLoaded()',
  'const capture = this._state.captureRecordsForAgent()',
  'await integrationTargetStore.createFromCapture({'
]) {
  assert(
    count(createFromCaptureBody, needle) === 1,
    `create-from-capture should preserve exactly one ${needle}`
  )
}
assertOrdered(
  createFromCaptureBody,
  [
    'await this._state.ensurePersistedCaptureRecordsLoaded()',
    'const capture = this._state.captureRecordsForAgent()',
    'await integrationTargetStore.createFromCapture({',
    "xpcMain.broadcast('coach/integration-targets-changed'"
  ],
  'create-from-capture'
)

for (const [start, end, buildCall, marker, name] of [
  [
    '  async runIntegrationRecordedSiteDryRun(',
    '  async runIntegrationRecordedSitePlan(',
    'await this.buildRecordedSiteDryRun(target, params)',
    'recordedSiteDryRun: true',
    'recorded-site dry-run'
  ],
  [
    '  async runIntegrationRecordedSitePlan(',
    '  async runIntegrationRecordedSiteApply(',
    'await this.buildRecordedSiteDryRun(target, params, { plan: true })',
    'recordedSitePlan: true',
    'recorded-site plan'
  ],
  [
    '  async runIntegrationRecordedSiteApply(',
    '  async buildRecordedSiteDryRun(',
    'await this.buildRecordedSiteApply(target, params)',
    'recordedSiteApply: true',
    'recorded-site apply'
  ]
]) {
  const body = boundedSource(integration, start, end, `${name} should keep a bounded body`)
  assertOrdered(
    body,
    [
      buildCall,
      'await integrationTargetStore.recordRun(target.id, run)',
      "xpcMain.broadcast('coach/integration-targets-changed'",
      marker
    ],
    name
  )
}

const dryRunBody = boundedSource(
  integration,
  '  async buildRecordedSiteDryRun(',
  '  async buildRecordedSiteApply(',
  'IntegrationService should keep a bounded recorded-site dry-run body'
)
for (const needle of [
  'recordedSiteDryRunUrl(endpoint)',
  'extractRecordedSiteRows(result.data, maxRows)',
  'integrationMappingStore.listMappings',
  'this._state.findRecordedSiteTab(target)',
  'this._state.broadcastApiActivity(endpoint.method, endpointPlan.url, result.ok, result.auth)',
  'recordedSiteRowSyncPlan(entity, enrichedRow, mapping, sourceHash)',
  "rowPlan.action === 'create'",
  "rowPlan.action === 'update'"
]) {
  assert(dryRunBody.includes(needle), `recorded-site dry-run should preserve ${needle}`)
}

const applyBody = boundedSource(
  integration,
  '  async buildRecordedSiteApply(',
  '  async fetchRecordedSiteRowDetails(',
  'IntegrationService should keep a bounded recorded-site apply body'
)
for (const needle of [
  'normalizeRecordedSiteApplyEntities(params.entities)',
  'recordedSiteAiCrmsBody',
  'runMicromeetCli',
  'integrationMappingStore.upsertMapping',
  'this._state.broadcastApiActivity(endpoint.method, endpointPlan.url, result.ok, result.auth)',
  "rowPlan.action === 'conflict'",
  '!params.allowUpdates'
]) {
  assert(applyBody.includes(needle), `recorded-site apply should preserve ${needle}`)
}

const detailFetchBody = boundedSource(
  integration,
  '  async fetchRecordedSiteRowDetails(',
  '  async runIntegrationMigration(',
  'IntegrationService should keep a bounded row-detail fetch body'
)
assert(
  detailFetchBody.includes(
    'this._state.broadcastApiActivity(endpoint.method, plan.url, result.ok, result.auth)'
  ),
  'recorded-site detail fetch should broadcast API activity'
)

const integrationOutcomeMethods = [
  [
    '  async runIntegrationMigration(',
    '  async runIntegrationReportReadiness(',
    [
      'await integrationTargetStore.runMigration(params)',
      "xpcMain.broadcast('coach/integration-targets-changed'",
      'migration: true',
      'apply: Boolean(params.apply)',
      'return result'
    ],
    'integration migration'
  ],
  [
    '  async runIntegrationReportReadiness(',
    '  async setIntegrationTargetSchedule(',
    [
      'await integrationTargetStore.runReportReadiness(params)',
      "xpcMain.broadcast('coach/integration-targets-changed'",
      'readiness: true',
      'generate: Boolean(params.generate)',
      'return result'
    ],
    'report readiness'
  ],
  [
    '  async setIntegrationTargetSchedule(',
    '  async listIntegrationMappings(',
    [
      'await integrationTargetStore.setSchedule(params)',
      'if (result.ok)',
      "xpcMain.broadcast('coach/integration-targets-changed'",
      'schedule: true',
      'enabled: result.target?.schedule.enabled',
      'return result'
    ],
    'integration schedule'
  ]
]
for (const [start, end, needles, name] of integrationOutcomeMethods) {
  const body = boundedSource(integration, start, end, `${name} should keep a bounded service body`)
  assertOrdered(body, needles, name)
}

const schedulerEventBody = boundedSource(
  integration,
  '  handleIntegrationSchedulerEvent(',
  '  async toolListIntegrationTargets(',
  'IntegrationService should keep a bounded scheduler event body'
)
for (const needle of [
  "xpcMain.broadcast('coach/integration-targets-changed'",
  'phase: event.phase',
  "if (event.phase === 'scheduled') return",
  'this._state.broadcastActivity(',
  "event.phase !== 'failed'"
]) {
  assert(schedulerEventBody.includes(needle), `scheduler event should preserve ${needle}`)
}

for (const [start, end, required, name] of [
  [
    '  async toolRunIntegrationMigration(',
    '  async toolRunIntegrationReportReadiness(',
    ['this._state.broadcastActivity(', 'await this.runIntegrationMigration(params)', 'appendActivityDuration('],
    'migration tool'
  ],
  [
    '  async toolRunIntegrationReportReadiness(',
    '  async toolSetIntegrationSchedule(',
    ['this._state.broadcastActivity(', 'await this.runIntegrationReportReadiness(params)', 'appendActivityDuration('],
    'report readiness tool'
  ],
  [
    '  async toolSetIntegrationSchedule(',
    '  async toolListIntegrationMappings(',
    ['this._state.broadcastActivity(', 'await this.setIntegrationTargetSchedule(params)', 'appendActivityDuration('],
    'schedule tool'
  ]
]) {
  const body = boundedSource(integration, start, end, `${name} should keep a bounded body`)
  for (const needle of required) {
    assert(body.includes(needle), `${name} should preserve meaningful ${needle}`)
  }
}

for (const needle of [
  'recordedSiteRowDetailUrl',
  'mergeRecordedSiteRowDetails',
  "['mapping', 'data-map', 'upsert'",
  "['mcu', 'record', 'create'",
  "['mcu', 'record', 'patient-info', 'update'",
  "['mcu', 'record', 'diagnostic-data', 'update'",
  "['mcu', 'record', 'conclusion', 'update'",
  "'data_mapping', 'mcu_record'"
]) {
  assert(rowMapping.includes(needle), `${rowMappingPath} should include ${needle}`)
}

const {
  recordedSiteRowSyncPlan,
  recordedSiteAiCrmsBody,
  recordedSiteAiCrmsCommands
} = loadPureTsModule(sourcePath(rowMappingPath))
const patientRow = { full_name: 'Guard Patient', phone: '10086' }
assert(
  recordedSiteRowSyncPlan('patient', patientRow, undefined, 'hash-new').action === 'create',
  'row plan should create an unmapped source row'
)
assert(
  recordedSiteRowSyncPlan(
    'patient',
    patientRow,
    { status: 'linked', aiCrmsId: 'patient-1', sourceHash: 'hash-old' },
    'hash-new'
  ).action === 'update',
  'row plan should update a linked row whose source hash changed'
)
assert(
  recordedSiteRowSyncPlan(
    'patient',
    patientRow,
    { status: 'conflict', aiCrmsId: 'patient-1', sourceHash: 'hash-old' },
    'hash-new'
  ).action === 'conflict',
  'row plan should preserve an explicit mapping conflict'
)
assert(
  recordedSiteRowSyncPlan(
    'patient',
    patientRow,
    { status: 'linked', aiCrmsId: 'patient-1', sourceHash: 'hash-new' },
    'hash-new'
  ).action === 'noop',
  'row plan should skip an unchanged linked row'
)
assert(
  recordedSiteRowSyncPlan('patient', {}, undefined, 'hash-empty').missingFields.includes(
    'patient full_name/name'
  ),
  'row plan should report required patient fields'
)
const patientCreateBody = recordedSiteAiCrmsBody('patient', patientRow, {
  action: 'create'
})
assert(
  patientCreateBody.body.full_name === 'Guard Patient' &&
    patientCreateBody.body.phone === '10086' &&
    patientCreateBody.missing.length === 0,
  'patient create body should map stable identity fields'
)
const patientUpdateBody = recordedSiteAiCrmsBody('patient', patientRow, {
  action: 'update',
  mapping: { status: 'linked', aiCrmsId: 'patient-1' }
})
assert(
  patientUpdateBody.body.id === 'patient-1',
  'patient update body should target the linked AI-CRMS row'
)
const patientCreateCommands = recordedSiteAiCrmsCommands(
  'patient',
  'create',
  patientCreateBody.body
)
assert(
  patientCreateCommands.length === 1 &&
    patientCreateCommands[0].args[0] === 'patients' &&
    patientCreateCommands[0].args[1] === 'create',
  'patient create command should preserve the micromeet CLI route'
)

const controllerDelegates = [
  [
    '  async listIntegrationTargets(): Promise<IntegrationTargetSummary[]> {',
    '  async getIntegrationTarget(',
    'return await this.integrationService.listIntegrationTargets()',
    'listIntegrationTargets'
  ],
  [
    '  async getIntegrationTarget(params: { targetId: string }): Promise<IntegrationTarget | null> {',
    '  async createIntegrationTargetFromCapture(',
    'return await this.integrationService.getIntegrationTarget(params)',
    'getIntegrationTarget'
  ],
  [
    '  async createIntegrationTargetFromCapture(params?: { name?: string; domain?: string }): Promise<IntegrationTargetCreateResult> {',
    '  async createAiCrmsMigrationTarget(',
    'return await this.integrationService.createIntegrationTargetFromCapture(params)',
    'createIntegrationTargetFromCapture'
  ],
  [
    '  async createAiCrmsMigrationTarget(params: IntegrationMigrationTargetRequest): Promise<IntegrationTargetCreateResult> {',
    '  async deleteIntegrationTarget(',
    'return await this.integrationService.createAiCrmsMigrationTarget(params)',
    'createAiCrmsMigrationTarget'
  ],
  [
    '  async deleteIntegrationTarget(params: { targetId: string }): Promise<IntegrationTargetDeleteResult> {',
    '  async runIntegrationTargetDryRun(',
    'return await this.integrationService.deleteIntegrationTarget(params)',
    'deleteIntegrationTarget'
  ],
  [
    '  async runIntegrationTargetDryRun(params: { targetId: string }): Promise<IntegrationTargetRunResult> {',
    '  async runIntegrationRecordedSiteDryRun(',
    'return await this.integrationService.runIntegrationTargetDryRun(params)',
    'runIntegrationTargetDryRun'
  ],
  [
    '  async runIntegrationRecordedSiteDryRun(params: IntegrationRecordedSiteSyncRequest): Promise<IntegrationTargetRunResult> {',
    '  async runIntegrationRecordedSitePlan(',
    'return await this.integrationService.runIntegrationRecordedSiteDryRun(params)',
    'runIntegrationRecordedSiteDryRun'
  ],
  [
    '  async runIntegrationRecordedSitePlan(params: IntegrationRecordedSiteSyncRequest): Promise<IntegrationTargetRunResult> {',
    '  async runIntegrationRecordedSiteApply(',
    'return await this.integrationService.runIntegrationRecordedSitePlan(params)',
    'runIntegrationRecordedSitePlan'
  ],
  [
    '  async runIntegrationRecordedSiteApply(params: IntegrationRecordedSiteApplyRequest): Promise<IntegrationTargetRunResult> {',
    '  async findRecordedSiteTab(',
    'return await this.integrationService.runIntegrationRecordedSiteApply(params)',
    'runIntegrationRecordedSiteApply'
  ],
  [
    '  async runIntegrationMigration(params: IntegrationMigrationRunRequest): Promise<IntegrationTargetRunResult> {',
    '  async runIntegrationReportReadiness(',
    'return await this.integrationService.runIntegrationMigration(params)',
    'runIntegrationMigration'
  ],
  [
    '  async runIntegrationReportReadiness(params: IntegrationReportReadinessRequest): Promise<IntegrationTargetRunResult> {',
    '  async setIntegrationTargetSchedule(',
    'return await this.integrationService.runIntegrationReportReadiness(params)',
    'runIntegrationReportReadiness'
  ],
  [
    '  async setIntegrationTargetSchedule(params: IntegrationTargetScheduleRequest): Promise<IntegrationTargetScheduleResult> {',
    '  async listIntegrationMappings(',
    'return await this.integrationService.setIntegrationTargetSchedule(params)',
    'setIntegrationTargetSchedule'
  ],
  [
    '  async listIntegrationMappings(params: IntegrationMappingListRequest): Promise<IntegrationMappingListResult> {',
    '  async upsertIntegrationMapping(',
    'return await this.integrationService.listIntegrationMappings(params)',
    'listIntegrationMappings'
  ],
  [
    '  async upsertIntegrationMapping(params: IntegrationMappingUpsertRequest): Promise<IntegrationMappingWriteResult> {',
    '  async deleteIntegrationMapping(',
    'return await this.integrationService.upsertIntegrationMapping(params)',
    'upsertIntegrationMapping'
  ],
  [
    '  async deleteIntegrationMapping(params: IntegrationMappingDeleteRequest): Promise<IntegrationMappingWriteResult> {',
    '  private handleIntegrationSchedulerEvent(',
    'return await this.integrationService.deleteIntegrationMapping(params)',
    'deleteIntegrationMapping'
  ],
  [
    '  private handleIntegrationSchedulerEvent(event: IntegrationSchedulerEvent): void {',
    '  async listInjectedButtons(',
    'this.integrationService.handleIntegrationSchedulerEvent(event)',
    'handleIntegrationSchedulerEvent'
  ],
  [
    '  private async toolListIntegrationTargets(targetId?: string): Promise<string> {',
    '  private async toolCreateIntegrationTargetFromCapture(',
    'return await this.integrationService.toolListIntegrationTargets(targetId)',
    'toolListIntegrationTargets'
  ],
  [
    '  private async toolCreateIntegrationTargetFromCapture(name?: string, domain?: string): Promise<string> {',
    '  private async toolCreateAiCrmsMigrationTarget(',
    'return await this.integrationService.toolCreateIntegrationTargetFromCapture(name, domain)',
    'toolCreateIntegrationTargetFromCapture'
  ],
  [
    '  private async toolCreateAiCrmsMigrationTarget(paramsJson: string): Promise<string> {',
    '  private async toolRunIntegrationDryRun(',
    'return await this.integrationService.toolCreateAiCrmsMigrationTarget(paramsJson)',
    'toolCreateAiCrmsMigrationTarget'
  ],
  [
    '  private async toolRunIntegrationDryRun(targetId: string): Promise<string> {',
    '  private async toolRunRecordedSiteSyncDryRun(',
    'return await this.integrationService.toolRunIntegrationDryRun(targetId)',
    'toolRunIntegrationDryRun'
  ],
  [
    '  private async toolRunRecordedSiteSyncDryRun(paramsJson: string): Promise<string> {',
    '  private async toolRunRecordedSiteSyncPlan(',
    'return await this.integrationService.toolRunRecordedSiteSyncDryRun(paramsJson)',
    'toolRunRecordedSiteSyncDryRun'
  ],
  [
    '  private async toolRunRecordedSiteSyncPlan(paramsJson: string): Promise<string> {',
    '  private async toolRunRecordedSiteSyncApply(',
    'return await this.integrationService.toolRunRecordedSiteSyncPlan(paramsJson)',
    'toolRunRecordedSiteSyncPlan'
  ],
  [
    '  private async toolRunRecordedSiteSyncApply(paramsJson: string): Promise<string> {',
    '  private async toolRunIntegrationMigration(',
    'return await this.integrationService.toolRunRecordedSiteSyncApply(paramsJson)',
    'toolRunRecordedSiteSyncApply'
  ],
  [
    '  private async toolRunIntegrationMigration(paramsJson: string): Promise<string> {',
    '  private async toolRunIntegrationReportReadiness(',
    'return await this.integrationService.toolRunIntegrationMigration(paramsJson)',
    'toolRunIntegrationMigration'
  ],
  [
    '  private async toolRunIntegrationReportReadiness(paramsJson: string): Promise<string> {',
    '  private async toolSetIntegrationSchedule(',
    'return await this.integrationService.toolRunIntegrationReportReadiness(paramsJson)',
    'toolRunIntegrationReportReadiness'
  ],
  [
    '  private async toolSetIntegrationSchedule(paramsJson: string): Promise<string> {',
    '  private async toolListIntegrationMappings(',
    'return await this.integrationService.toolSetIntegrationSchedule(paramsJson)',
    'toolSetIntegrationSchedule'
  ],
  [
    '  private async toolListIntegrationMappings(paramsJson: string): Promise<string> {',
    '  private async toolUpsertIntegrationMapping(',
    'return await this.integrationService.toolListIntegrationMappings(paramsJson)',
    'toolListIntegrationMappings'
  ],
  [
    '  private async toolUpsertIntegrationMapping(paramsJson: string): Promise<string> {',
    '  private async toolDeleteIntegrationMapping(',
    'return await this.integrationService.toolUpsertIntegrationMapping(paramsJson)',
    'toolUpsertIntegrationMapping'
  ],
  [
    '  private async toolDeleteIntegrationMapping(paramsJson: string): Promise<string> {',
    '  async ensurePersistedCaptureRecordsLoaded(',
    'return await this.integrationService.toolDeleteIntegrationMapping(paramsJson)',
    'toolDeleteIntegrationMapping'
  ]
]
for (const [start, end, statement, name] of controllerDelegates) {
  assertExactDelegate(controller, start, end, statement, name)
}

const findRecordedSiteTab = boundedSource(
  controller,
  '  async findRecordedSiteTab(target: IntegrationTarget): Promise<OperationTab | undefined> {',
  '  async runIntegrationMigration(',
  'Maestro controller should keep a bounded live-tab bridge'
)
for (const needle of [
  'recordedSiteHostMatches(activeHost, expected)',
  'tab = this.tabs.find((item) => {',
  'const wc = item.view?.webContents',
  'wc && !wc.isDestroyed() ? wc.getURL() : item.url',
  'recordedSiteHostMatches(host, expected)'
]) {
  assert(findRecordedSiteTab.includes(needle), `findRecordedSiteTab should preserve ${needle}`)
}
assert(
  count(findRecordedSiteTab, 'tab = this.tabs.find((item) => {') === 1,
  'findRecordedSiteTab should search background tabs exactly once after the active-tab check'
)
assertOrdered(
  findRecordedSiteTab,
  [
    'tab = this.tabs.find((item) => {',
    'if (!tab.view || tab.view.webContents.isDestroyed()) await this.warmAndLoad(tab)',
    'await tab.capture?.attach()',
    'return tab.replay ? tab : undefined'
  ],
  'findRecordedSiteTab warm/attach/replay'
)

const createBody = boundedSource(
  controller,
  '  create(): BrowserWindow {',
  '  async whenReady(): Promise<void> {',
  'Maestro controller should keep a bounded create lifecycle'
)
assert(count(createBody, 'integrationScheduler.start({') === 1, 'Maestro create should start the integration scheduler exactly once')
assert(
  createBody.includes('emit: (event) => this.handleIntegrationSchedulerEvent(event)') &&
    createBody.includes('runRecordedSiteDryRun: (target) => this.runIntegrationRecordedSiteDryRun({ targetId: target.id })'),
  'Maestro create should route scheduler callbacks through controller facades'
)

const shutdownBody = boundedSource(
  controller,
  '  async shutdown(): Promise<void> {',
  '  async replayRecipe(',
  'Maestro controller should keep a bounded shutdown lifecycle'
)
assert(
  count(shutdownBody, 'await integrationScheduler.stop()') === 1,
  'Maestro shutdown should stop the integration scheduler exactly once'
)
assertOrdered(
  shutdownBody,
  [
    'await integrationScheduler.stop()',
    'await this.captureService.shutdown()',
    'this.resetWindowScopedViews()',
    'super.destroy()'
  ],
  'Maestro shutdown scheduler/view teardown'
)

for (const stale of [
  'private async buildRecordedSiteDryRun',
  'private async buildRecordedSiteApply',
  'private async fetchRecordedSiteRowDetails',
  'function recordedSiteDryRunUrl',
  'function recordedSiteAiCrmsBody',
  'integrationTargetStore.',
  'integrationMappingStore.',
  'runMicromeetCli('
]) {
  assert(!controller.includes(stale), `Maestro controller should not retain extracted integration implementation: ${stale}`)
}

includes('main/windows/main/maestroWindow.controller.ts', "name: 'list_integration_targets'")
includes('main/windows/main/maestroWindow.controller.ts', "name: 'create_integration_target_from_capture'")
includes('main/windows/main/maestroWindow.controller.ts', "name: 'create_ai_crms_migration_target'")
includes('main/windows/main/maestroWindow.controller.ts', "name: 'run_integration_dry_run'")
includes('main/windows/main/maestroWindow.controller.ts', "name: 'run_recorded_site_sync_dry_run'")
includes('main/windows/main/maestroWindow.controller.ts', "name: 'plan_recorded_site_sync'")
includes('main/windows/main/maestroWindow.controller.ts', "name: 'apply_recorded_site_sync'")
includes('main/windows/main/maestroWindow.controller.ts', "name: 'run_integration_migration'")
includes('main/windows/main/maestroWindow.controller.ts', "name: 'run_integration_report_readiness'")
includes('main/windows/main/maestroWindow.controller.ts', "name: 'set_integration_schedule'")
includes('main/windows/main/maestroWindow.controller.ts', "name: 'list_integration_mappings'")
includes('main/windows/main/maestroWindow.controller.ts', "name: 'upsert_integration_mapping'")
includes('main/windows/main/maestroWindow.controller.ts', "name: 'delete_integration_mapping'")
includes('main/xpc/coach.handler.ts', 'listIntegrationTargets()')
includes('main/xpc/coach.handler.ts', 'createAiCrmsMigrationTarget')
includes('main/xpc/coach.handler.ts', 'runIntegrationRecordedSiteDryRun')
includes('main/xpc/coach.handler.ts', 'runIntegrationRecordedSitePlan')
includes('main/xpc/coach.handler.ts', 'runIntegrationRecordedSiteApply')
includes('main/xpc/coach.handler.ts', 'runIntegrationMigration')
includes('main/xpc/coach.handler.ts', 'runIntegrationReportReadiness')
includes('main/xpc/coach.handler.ts', 'setIntegrationTargetSchedule')
includes('main/xpc/coach.handler.ts', 'listIntegrationMappings')
includes('main/xpc/coach.handler.ts', 'upsertIntegrationMapping')
includes('main/xpc/coach.handler.ts', 'deleteIntegrationMapping')
includes('main/agent/hostToolCatalog.ts', "name: 'list_integration_targets'")
includes('main/agent/hostToolCatalog.ts', "name: 'create_ai_crms_migration_target'")
includes('main/agent/hostToolCatalog.ts', "name: 'run_recorded_site_sync_dry_run'")
includes('main/agent/hostToolCatalog.ts', "name: 'plan_recorded_site_sync'")
includes('main/agent/hostToolCatalog.ts', "name: 'apply_recorded_site_sync'")
includes('main/agent/hostToolCatalog.ts', 'data-map/MCU-record')
includes('main/agent/hostToolCatalog.ts', "name: 'run_integration_migration'")
includes('main/agent/hostToolCatalog.ts', "name: 'run_integration_report_readiness'")
includes('main/agent/hostToolCatalog.ts', "name: 'set_integration_schedule'")
includes('main/agent/hostToolCatalog.ts', "name: 'list_integration_mappings'")
includes('main/agent/hostToolCatalog.ts', "name: 'upsert_integration_mapping'")
includes('main/agent/hostToolCatalog.ts', "name: 'delete_integration_mapping'")
includes('main/agent/hostToolCatalog.ts', "category: 'integration'")

includes('renderer/workbench/src/workbench.router.ts', 'WorkbenchIntegrationsView')
includes('renderer/workbench/src/workbench.store.ts', "'integrations'")
includes('renderer/workbench/src/workbench.store.ts', 'runIntegrationMigrationDryRun')
includes('renderer/workbench/src/workbench.store.ts', 'runIntegrationRecordedSiteDryRun')
includes('renderer/workbench/src/workbench.store.ts', 'runIntegrationRecordedSitePlan')
includes('renderer/workbench/src/workbench.store.ts', 'runIntegrationRecordedSiteApply')
includes('renderer/workbench/src/workbench.store.ts', 'allowUpdates')
includes('renderer/workbench/src/workbench.store.ts', "'data_mapping', 'mcu_record'")
includes('renderer/workbench/src/workbench.store.ts', 'runIntegrationReportReadiness')
includes('renderer/workbench/src/workbench.store.ts', 'setIntegrationTargetSchedule')
includes('renderer/workbench/src/workbench.store.ts', 'loadIntegrationMappings')
includes('renderer/workbench/src/WorkbenchApp.vue', "integrations: 'Integrations'")
assert(existsSync(join(root, 'renderer/maestro/workbench/src/views/WorkbenchIntegrationsView.vue')), 'Workbench Integrations view should exist')
includes('renderer/workbench/src/views/WorkbenchIntegrationsView.vue', 'Readiness')
includes('renderer/workbench/src/views/WorkbenchIntegrationsView.vue', 'Migration')
includes('renderer/workbench/src/views/WorkbenchIntegrationsView.vue', 'Source Dry Run')
includes('renderer/workbench/src/views/WorkbenchIntegrationsView.vue', 'Source Plan')
includes('renderer/workbench/src/views/WorkbenchIntegrationsView.vue', 'Apply')
includes('renderer/workbench/src/views/WorkbenchIntegrationsView.vue', 'Linked updates')
includes('renderer/workbench/src/views/WorkbenchIntegrationsView.vue', 'Schedule')
includes('renderer/workbench/src/views/WorkbenchIntegrationsView.vue', 'Source Map')
includes('renderer/workbench/src/views/WorkbenchIntegrationsView.vue', 'detail.source.migration')

const feature = readProject('docs/features/maestro.md')
assert(feature.includes('integration targets') && feature.includes('dry-run/apply/readiness flows'), 'embedded feature contract should preserve integration targets and execution modes')

const cliCommands = readCli('src/commands.ts')
const cliManual = readCli('src/manual.ts')
assert(cliCommands.includes('patientCreate'), 'vendored CLI should support patient create')
assert(cliCommands.includes("moduleName === 'patients' && functionName === 'create'"), 'vendored CLI should route patient create')
assert(cliCommands.includes('mcuRecordDiagnosticDataUpdate'), 'vendored CLI should support MCU diagnostic updates')
assert(cliManual.includes('patients    list | detail | create | update | delete'), 'vendored CLI help should document patient commands')

console.log('[check-integration-target] ok')
