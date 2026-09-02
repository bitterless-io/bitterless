import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  MAESTRO_OPEN_STAGES,
  MAX_MAESTRO_OPEN_DURATION_MS,
  MaestroOpenDiagnostics,
  MaestroOpenTimeoutError,
  classifyMaestroOpenFailure
} from '../../src/main/maestro/diagnostics/maestroOpenDiagnostics.service.ts'

const root = resolve(import.meta.dirname, '../..')
const read = (path) => readFileSync(join(root, path), 'utf8')

test('allowlisted records clamp monotonic timings and drop every private field', () => {
  const lines = []
  let time = 100
  const diagnostics = new MaestroOpenDiagnostics({
    clock: () => time,
    write: (line) => lines.push(line)
  })
  const request = diagnostics.startRequest()
  const boot = diagnostics.startBoot()

  time = 80
  const backwards = boot.mark()
  assert.equal(boot.completeStage('runtime', backwards), true)
  assert.equal(
    diagnostics.emit('route', {
      openId: request.id,
      route: 'cold-boot',
      bootId: boot.id,
      url: 'https://private.example/secret',
      path: '/Users/private/account',
      session: 'customer-session',
      token: 'do-not-log',
      tabId: 'tab-secret',
      webContentsId: 42,
      error: new Error('private')
    }),
    true
  )
  time = 100 + MAX_MAESTRO_OPEN_DURATION_MS + 99_999
  assert.equal(boot.completeStage('proxy', 0), true)

  assert.match(lines[1], /stage=runtime elapsedMs=0 stageMs=0$/)
  assert.match(
    lines[2],
    new RegExp(`^\\[maestro-open\\] event=route openId=${request.id} route=cold-boot bootId=${boot.id}$`)
  )
  assert.match(
    lines[3],
    new RegExp(`elapsedMs=${MAX_MAESTRO_OPEN_DURATION_MS} stageMs=${MAX_MAESTRO_OPEN_DURATION_MS}$`)
  )
  assert.doesNotMatch(lines.join('\n'), /private|secret|url=|path=|session=|token=|tabId|webContents|error=/)
  assert.equal(diagnostics.emit('unknown-event', { body: 'secret' }), false)
  assert.equal(diagnostics.emit('stage', { bootId: boot.id, stage: 'renderer-data' }), false)
})

test('request IDs are unique and cold plus join routes share one boot ID', () => {
  const lines = []
  let time = 1
  const diagnostics = new MaestroOpenDiagnostics({
    clock: () => time,
    write: (line) => lines.push(line)
  })
  const coldRequest = diagnostics.startRequest()
  const boot = diagnostics.startBoot()
  coldRequest.cleanupWait('none', coldRequest.mark())
  coldRequest.route('cold-boot', boot)

  time += 4
  const joinedRequest = diagnostics.startRequest()
  joinedRequest.cleanupWait('none', joinedRequest.mark())
  joinedRequest.route('join-boot', boot)

  assert.equal(coldRequest.id, 'o1')
  assert.equal(joinedRequest.id, 'o2')
  assert.equal(boot.id, 'b1')
  const routes = lines.filter((line) => line.includes('event=route'))
  assert.deepEqual(routes, [
    '[maestro-open] event=route openId=o1 route=cold-boot bootId=b1',
    '[maestro-open] event=route openId=o2 route=join-boot bootId=b1'
  ])
})

test('boot and request terminals emit once with only fixed pending stage names', () => {
  const lines = []
  let time = 10
  const diagnostics = new MaestroOpenDiagnostics({
    clock: () => time,
    write: (line) => lines.push(line)
  })
  const request = diagnostics.startRequest()
  const boot = diagnostics.startBoot()
  request.route('cold-boot', boot)
  boot.completeStage('runtime', boot.mark())
  time = 25

  assert.equal(boot.terminal('failure', 'timeout'), true)
  assert.equal(boot.terminal('failure', 'failed'), false)
  assert.equal(boot.completeStage('proxy', boot.mark()), false)
  assert.equal(request.terminal('failure', 'timeout'), true)
  assert.equal(request.terminal('success', 'ready'), false)

  const bootTerminals = lines.filter((line) => line.includes('event=boot-terminal'))
  const requestTerminals = lines.filter((line) => line.includes('event=request-terminal'))
  assert.equal(bootTerminals.length, 1)
  assert.equal(requestTerminals.length, 1)
  assert.match(bootTerminals[0], /outcome=failure reason=timeout elapsedMs=15/)
  assert.match(
    bootTerminals[0],
    new RegExp(`pending=${MAESTRO_OPEN_STAGES.filter((stage) => stage !== 'runtime').join(',')}$`)
  )
  assert.ok(bootTerminals[0].length <= 240)
  assert.doesNotMatch(bootTerminals[0], /pending=[^\n]*runtime(?:,|$)/)
})

test('clock and writer failures never escape or change fixed failure classification', () => {
  const diagnostics = new MaestroOpenDiagnostics({
    clock: () => {
      throw new Error('clock path /private')
    },
    write: () => {
      throw new Error('writer path /private')
    }
  })
  const request = diagnostics.startRequest()
  const boot = diagnostics.startBoot()
  assert.equal(request.cleanupWait('blocked', request.mark()), false)
  assert.equal(request.route('cold-boot', boot), false)
  assert.equal(boot.completeStage('runtime', boot.mark()), false)
  assert.equal(boot.terminal('failure', 'failed'), false)
  assert.equal(request.terminal('failure', 'failed'), false)
  assert.equal(classifyMaestroOpenFailure(new MaestroOpenTimeoutError('private')), 'timeout')
  assert.equal(classifyMaestroOpenFailure(new Error('timed out at /private')), 'failed')
})

test('Main lifecycle wires every fixed route and cold-boot stage without private payloads', () => {
  const handler = read('src/main/xpc/maestroWindow.handler.ts')
  const controller = read('src/main/maestro/windows/main/maestroWindow.controller.ts')
  const diagnostics = read('src/main/maestro/diagnostics/maestroOpenDiagnostics.service.ts')

  assert.match(diagnostics, /write \?\? \(\(line\) => console\.info\(line\)\)/)
  assert.doesNotMatch(diagnostics, /electron-log|transports\.file|writeFile/)
  assert.match(handler, /cleanupWait\([\s\S]*?route\('join-boot'/)
  assert.match(handler, /route\('reuse'\)/)
  assert.match(handler, /route\('join-boot', requestBootDiagnostics\)/)
  assert.match(handler, /route\('cold-boot', requestBootDiagnostics\)/)
  assert.match(handler, /activeBootDiagnostics = requestBootDiagnostics/)
  assert.match(controller, /create\(\): BrowserWindow/)

  for (const stage of [
    'runtime',
    'proxy',
    'sqlite-window',
    'sqlite-preload',
    'session',
    'controller',
    'show'
  ]) {
    assert.match(handler, new RegExp(`completeStage\\('${stage}'`))
  }
  for (const stage of [
    'shell',
    'home-mount',
    'home-tab',
    'startup-tab',
    'control',
    'workbench',
    'all-ready'
  ]) {
    assert.match(controller, new RegExp(`'${stage}'`))
  }
  assert.match(handler, /diagnostics\.terminal\('failure', classifyMaestroOpenFailure\(err\)\)/)
  assert.match(handler, /requestBootDiagnostics\.terminal\('success', 'ready'\)/)
  assert.match(handler, /requestDiagnostics\.terminal\('success', 'ready'\)/)

  const diagnosticCalls = [handler, controller]
    .flatMap((source) => source.match(/(?:requestDiagnostics|requestBootDiagnostics|diagnostics)\.(?:cleanupWait|route|completeStage|terminal)\([^\n]*/g) ?? [])
    .join('\n')
  assert.doesNotMatch(
    diagnosticCalls,
    /\b(url|path|tab|session|webContents|token|renderer|error|err)\s*[:,=]/i
  )
})
