import { assert, readMaestro } from './_harness.mjs'

const controller = readMaestro('main/windows/main/maestroWindow.controller.ts')
const services = [
  {
    className: 'MaestroLlmService',
    property: 'llmService',
    stateName: 'MaestroLlmServiceState',
    source: readMaestro('main/llm/maestroLlm.service.ts')
  },
  {
    className: 'MaestroBrowserViewService',
    property: 'browserView',
    stateName: 'MaestroBrowserViewServiceState',
    source: readMaestro('main/windows/main/maestroBrowserView.service.ts')
  },
  {
    className: 'MaestroControlViewService',
    property: 'controlView',
    stateName: 'MaestroControlViewServiceState',
    source: readMaestro('main/windows/main/maestroControlView.service.ts')
  },
  {
    className: 'MaestroWorkbenchViewService',
    property: 'workbenchView',
    stateName: 'MaestroWorkbenchViewServiceState',
    source: readMaestro('main/windows/main/maestroWorkbenchView.service.ts')
  },
  {
    className: 'WorkspaceFileService',
    property: 'workspaceFile',
    stateName: 'WorkspaceFileServiceState',
    source: readMaestro('main/windows/main/workspaceFile.service.ts')
  },
  {
    className: 'IntegrationService',
    property: 'integrationService',
    stateName: 'IntegrationServiceState',
    source: readMaestro('main/integration/integration.service.ts')
  },
  {
    className: 'CaptureService',
    property: 'captureService',
    stateName: 'CaptureServiceState',
    source: readMaestro('main/capture/capture.service.ts')
  },
  {
    className: 'SkillService',
    property: 'skillService',
    stateName: 'SkillServiceState',
    source: readMaestro('main/skills/skill.service.ts')
  },
  {
    className: 'RequestExecService',
    property: 'requestExec',
    stateName: 'RequestExecServiceState',
    source: readMaestro('main/drive/requestExec.service.ts')
  },
  {
    className: 'MaestroAgentService',
    property: 'agentService',
    stateName: 'MaestroAgentServiceState',
    source: readMaestro('main/agent/maestroAgent.service.ts')
  }
]

const count = (source, text) => source.split(text).length - 1
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const boundedSource = (source, start, end, message) => {
  const startIndex = source.indexOf(start)
  const endIndex = startIndex < 0 ? -1 : source.indexOf(end, startIndex + start.length)
  assert(startIndex >= 0 && endIndex > startIndex, message)
  return source.slice(startIndex, endIndex)
}

const constructorMatch = controller.match(
  /constructor\(([\s\S]*?)\n  \) \{([\s\S]*?)\n  \}\n\n  operationView/
)
assert(constructorMatch, 'Maestro controller should keep one bounded IoC constructor')
const constructorParams = constructorMatch?.[1] || ''
const constructorBody = constructorMatch?.[2] || ''

const bindMatch = controller.match(
  /export const maestroWindowHelper = iocHelper\.bind\(\{\s*controller: MaestroWindowController,\s*services: \[([\s\S]*?)\]\s*\}\) as MaestroWindowController/
)
assert(bindMatch, 'Maestro controller should keep one bounded iocHelper.bind registration')
const boundServices = bindMatch?.[1] || ''

for (const service of services) {
  const injection = new RegExp(
    `@inject\\(Symbol\\.for\\(${escapeRegex(service.className)}\\.name\\)\\)\\s*public readonly ${escapeRegex(service.property)}: ${escapeRegex(service.className)}`
  )
  assert(
    injection.test(constructorParams),
    `${service.className} should have one explicit Symbol.for constructor injection`
  )
  assert(
    count(constructorBody, `this.${service.property}.setState(this)`) === 1,
    `${service.className} should receive controller state exactly once`
  )
  assert(
    count(boundServices, service.className) === 1,
    `${service.className} should appear exactly once in iocHelper.bind services`
  )
  assert(
    controller.includes(service.stateName),
    `Maestro controller should implement ${service.stateName}`
  )
  assert(
    service.source.includes(`export interface ${service.stateName}`),
    `${service.className} should declare its local state interface`
  )
  assert(
    service.source.includes(`extends CommonService<${service.stateName}>`),
    `${service.className} should use its local CommonService state contract`
  )
  assert(
    !service.source.includes('maestroWindow.controller'),
    `${service.className} must remain a leaf service without importing the controller`
  )
  assert(
    !service.source.includes('iocHelper.bind(') && !service.source.includes('.setState('),
    `${service.className} must not bind or set service state itself`
  )
}

const createMatch = controller.match(/create\(\): BrowserWindow \{([\s\S]*?)\n  \}\n\n  async whenReady/)
assert(createMatch, 'Maestro controller should keep one bounded create flow')
const createBody = createMatch?.[1] || ''
const activateIndex = createBody.indexOf('this.agentService.activate()')
const ensureServicesIndex = createBody.indexOf('this.ensureServices()')
assert(activateIndex >= 0, 'Maestro create should activate AgentService')
assert(ensureServicesIndex >= 0, 'Maestro create should resolve runtime services')
assert(
  activateIndex < ensureServicesIndex,
  'Maestro create should activate AgentService before resolving agents'
)
for (const call of [
  'this.browserView.createPinnedHomeTab()',
  'this.controlView.create()',
  'this.workbenchView.create()'
]) {
  assert(count(createBody, call) === 1, `Maestro create should invoke ${call} exactly once`)
}

for (const seam of [
  /get capturing\(\): boolean \{\s*return this\.captureService\.capturing\s*\}/,
  /get captureTargetTabId\(\): string \| null \{\s*return this\.captureService\.captureTargetTabId\s*\}/,
  /get browserInterceptionRules\(\): NetworkInterceptionRule\[\] \{\s*return this\.requestExec\.browserInterceptionRules\s*\}/,
  /getOperationTabs\(\): OperationTab\[\] \{\s*return this\.tabs\s*\}/,
  /getActiveOperationTabId\(\): string \| null \{\s*return this\.activeTabId\s*\}/
]) {
  assert(seam.test(controller), `Maestro controller should keep bounded capture state seam: ${seam}`)
}
const resetWindowScopedViewsBody = boundedSource(
  controller,
  '  private resetWindowScopedViews(): void {',
  '  create(): BrowserWindow {',
  'Maestro controller should keep a bounded window-scoped reset implementation'
)
for (const service of ['captureService', 'browserView', 'controlView', 'workbenchView']) {
  assert(
    count(resetWindowScopedViewsBody, `this.${service}.reset()`) === 1,
    `Maestro window reset should invoke ${service}.reset() exactly once`
  )
}
for (const statement of [
  'this.operationView = null',
  'this.capture = null',
  'this.replayEngine = null',
  'this.opBounds = null',
  'this.tabsOpenedThisTurn = []'
]) {
  assert(
    count(resetWindowScopedViewsBody, statement) === 1,
    `Maestro window reset should clear ${statement} exactly once`
  )
}
const shutdownBody = boundedSource(
  controller,
  '  async shutdown(): Promise<void> {',
  '  async replayRecipe(',
  'Maestro controller should keep a bounded shutdown implementation'
)
assert(
  shutdownBody.indexOf('await this.agentService.shutdown()') >= 0 &&
    shutdownBody.indexOf('await this.agentService.shutdown()') <
      shutdownBody.indexOf('await this.captureService.shutdown()'),
  'Maestro shutdown should dispose AgentService in the original pre-capture order'
)
assert(
  shutdownBody.indexOf('await this.captureService.shutdown()') >= 0 &&
    shutdownBody.indexOf('this.captureService.shutdown()') < shutdownBody.indexOf('this.resetWindowScopedViews()'),
  'Maestro shutdown should release CaptureService before resetting native views'
)
assert(
  count(shutdownBody, 'this.resetWindowScopedViews()') === 1,
  'Maestro shutdown should invoke the bounded window-scoped reset exactly once'
)
assert(
  !controller.includes('browserInterceptionRules: NetworkInterceptionRule[] = []') &&
    !controller.includes('browserInterceptionSeq'),
  'RequestExecService should exclusively own mutable browser interception state'
)

console.log('[check-ioc-composition] ok')
