import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { buildBitterlessE2ELaunchArgs } from '../../e2e/electronLaunchArgs'

export type RendererName =
  | 'home'
  | 'todo'
  | 'maestroHome'
  | 'maestroControl'
  | 'maestroWorkbench'
  | 'maestroSqlite'

export interface BitterlessE2ESession {
  app: ElectronApplication
  hostPage: Page
  userDataDir: string
  mockOrigin: string
  rendererErrors: string[]
  mockRequests: string[]
  unexpectedMockRequests: string[]
  deniedNetworkRequests: () => string[]
  waitForRenderer: (name: RendererName) => Promise<Page>
  rendererCount: (name: RendererName) => number
  operationCount: () => number
  waitForOperation: () => Promise<Page>
}

interface MockServer {
  server: Server
  origin: string
  requests: string[]
  unexpected: string[]
}

interface MaestroFixtures {
  bitterless: BitterlessE2ESession
}

const projectRoot = resolve(__dirname, '..', '..', '..')
const mainEntry = join(projectRoot, 'out', 'main', 'app.main.js')

const electronExecutablePath = (): string => {
  if (process.platform === 'darwin') {
    return join(projectRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
  }
  if (process.platform === 'win32') {
    return join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
  }
  return join(projectRoot, 'node_modules', 'electron', 'dist', 'electron')
}

const assertLaunchPrerequisites = (): void => {
  const electronPath = electronExecutablePath()
  if (!existsSync(electronPath)) throw new Error(`Electron executable is missing: ${electronPath}`)
  if (!existsSync(mainEntry)) {
    throw new Error(`Built Electron main entry is missing: ${mainEntry}. Run yarn build first.`)
  }
}

const startMockServer = async (): Promise<MockServer> => {
  const requests: string[] = []
  const unexpected: string[] = []
  const server = createServer((request, response) => {
    const method = request.method || 'GET'
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const key = `${method} ${url.pathname}`
    requests.push(key)
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('access-control-allow-headers', '*')
    response.setHeader('access-control-allow-methods', 'GET, OPTIONS')

    if (url.pathname === '/auth/me' && method === 'OPTIONS') {
      response.statusCode = 204
      response.end()
      return
    }
    if (url.pathname === '/auth/me' && method === 'GET') {
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(
        JSON.stringify({
          id: 9001,
          email: 'bitterless-e2e@example.test',
          nickname: 'Bitterless E2E',
          scope: 'customer',
          status: 'active',
          has_password: true,
          must_set_password: false
        })
      )
      return
    }
    if (url.pathname === '/ai-crms' && method === 'GET') {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(
        '<!doctype html><html><head><meta charset="utf-8"><title>AI-CRMS</title></head>' +
          '<body><main id="ai-crms-e2e" aria-label="AI-CRMS E2E mock">AI-CRMS local E2E mock</main></body></html>'
      )
      return
    }

    unexpected.push(key)
    response.statusCode = 500
    response.setHeader('content-type', 'text/plain; charset=utf-8')
    response.end(`Unexpected E2E mock request: ${key}`)
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', rejectListen)
      resolveListen()
    })
  })
  const address = server.address() as AddressInfo
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    unexpected
  }
}

const closeMockServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
}

const rendererPaths: Record<RendererName, string> = {
  home: 'home',
  todo: 'todo',
  maestroHome: 'maestro/home',
  maestroControl: 'maestro/control',
  maestroWorkbench: 'maestro/workbench',
  maestroSqlite: 'maestro/sqlite'
}

const pageMatches = (page: Page, rendererName: RendererName): boolean =>
  new RegExp(`/${rendererPaths[rendererName]}/index\\.html(?:$|[?#])`).test(page.url())

const waitForPage = async (
  app: ElectronApplication,
  predicate: (page: Page) => boolean,
  description: string,
  diagnostics: () => string = () => ''
): Promise<Page> => {
  const existing = app.windows().find(predicate)
  if (existing) return existing
  return await app.waitForEvent('window', {
    predicate,
    timeout: 30_000
  }).catch(() => {
    throw new Error(
      `Timed out waiting for ${description}. Open pages: ${app.windows().map((page) => page.url()).join(', ')}\n${diagnostics()}`
    )
  })
}

const attachRendererDiagnostics = (page: Page, errors: string[]): void => {
  const prefix = (): string => page.url() || 'about:blank'
  page.on('pageerror', (error) => errors.push(`[pageerror ${prefix()}] ${error.stack || error.message}`))
  page.on('crash', () => errors.push(`[crash ${prefix()}]`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const url = prefix()
    const text = message.text()
    // The host SQLite renderer optionally starts a separately packaged Qdrant binary. The
    // source-tree E2E build intentionally has no external_resources bundle; keep every other
    // host/Maestro error visible and ignore only that exact optional-host absence.
    const isExpectedUnpackagedQdrantAbsence =
      /\/renderer\/sqlite\/index\.html(?:$|[?#])/.test(url) &&
      text.startsWith('[qdrant] failed to start: spawn ') &&
      text.endsWith('/external_resources/qdrant/qdrant ENOENT')
    const isExpectedDevToolsAutofillAbsence =
      url.startsWith('devtools://') &&
      (text.startsWith('Request Autofill.enable failed. ') ||
        text.startsWith('Request Autofill.setAddresses failed. ')) &&
      text.includes('wasn\'t found')
    if (!isExpectedUnpackagedQdrantAbsence && !isExpectedDevToolsAutofillAbsence) {
      errors.push(`[console ${url}] ${text}`)
    }
  })
}

const isolatedLaunchEnv = (paths: {
  homeDir: string
  userDataDir: string
  mockOrigin: string
}): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {}
  const allowedKeys = new Set([
    'PATH',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'DBUS_SESSION_BUS_ADDRESS',
    'XDG_RUNTIME_DIR',
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'PATHEXT',
    'CI'
  ])
  for (const [key, value] of Object.entries(process.env)) {
    if (value != null && (allowedKeys.has(key) || key.startsWith('LC_'))) env[key] = value
  }
  return {
    ...env,
    NODE_ENV: 'production',
    HOME: paths.homeDir,
    USERPROFILE: paths.homeDir,
    APPDATA: join(paths.homeDir, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(paths.homeDir, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(paths.homeDir, '.config'),
    XDG_DATA_HOME: join(paths.homeDir, '.local', 'share'),
    XDG_CACHE_HOME: join(paths.homeDir, '.cache'),
    MICROMEET_DIR: join(paths.homeDir, '.micromeet'),
    BITTERLESS_E2E: '1',
    BITTERLESS_E2E_HOME_DIR: paths.homeDir,
    BITTERLESS_E2E_USER_DATA_DIR: paths.userDataDir,
    BITTERLESS_E2E_MOCK_ORIGIN: paths.mockOrigin,
    COACH_OPEN_DEVTOOLS: '0',
    COACH_WORKBENCH_DEVTOOLS: '0',
    COACH_DEVTOOLS: '0',
    COACH_DEMO_SMOKE_OUT: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  }
}

export const test = base.extend<MaestroFixtures>({
  bitterless: async ({}, use) => {
    assertLaunchPrerequisites()
    // Keep Unix-domain socket paths below the macOS limit for every E2E bridge.
    const tempBase = process.platform === 'win32' ? tmpdir() : '/tmp'
    const tempRoot = mkdtempSync(join(tempBase, 'bl-maestro-'))
    const homeDir = join(tempRoot, 'home')
    const userDataDir = join(tempRoot, 'user-data')
    mkdirSync(homeDir, { recursive: true })
    mkdirSync(userDataDir, { recursive: true })
    mkdirSync(join(homeDir, 'AppData', 'Roaming'), { recursive: true })
    mkdirSync(join(homeDir, 'AppData', 'Local'), { recursive: true })

    const mock = await startMockServer()
    const rendererErrors: string[] = []
    const mainOutput: string[] = []
    let app: ElectronApplication | null = null
    const sentinelKey = 'BITTERLESS_E2E_PARENT_SECRET'
    const previousSentinel = process.env[sentinelKey]
    process.env[sentinelKey] = 'must-not-reach-electron'
    const launchEnv = isolatedLaunchEnv({ homeDir, userDataDir, mockOrigin: mock.origin })
    if (previousSentinel == null) delete process.env[sentinelKey]
    else process.env[sentinelKey] = previousSentinel

    try {
      app = await electron.launch({
        executablePath: electronExecutablePath(),
        args: buildBitterlessE2ELaunchArgs({
          platform: process.platform,
          applicationPath: projectRoot
        }),
        env: launchEnv,
        timeout: 60_000
      })
      for (const stream of [app.process().stdout, app.process().stderr]) {
        stream?.on('data', (chunk) => mainOutput.push(String(chunk)))
      }
      const leakedSentinel = await app.evaluate(
        (_electron, key) => process.env[key] || null,
        sentinelKey
      )
      if (leakedSentinel) throw new Error('Parent secret sentinel leaked into the Electron child')

      for (const page of app.windows()) attachRendererDiagnostics(page, rendererErrors)
      app.on('window', (page) => attachRendererDiagnostics(page, rendererErrors))

      const waitForRenderer = async (name: RendererName): Promise<Page> => {
        const page = await waitForPage(
          app!,
          (candidate) => pageMatches(candidate, name),
          `${name} renderer`,
          () =>
            `Renderer errors:\n${rendererErrors.join('\n') || '(none)'}\nMain output:\n${mainOutput.slice(-40).join('') || '(none)'}`
        )
        await page.waitForLoadState('domcontentloaded')
        return page
      }
      const hostPage = await waitForRenderer('home')
      const deniedLog = join(userDataDir, 'e2e-network-denied.log')

      await use({
        app,
        hostPage,
        userDataDir,
        mockOrigin: mock.origin,
        rendererErrors,
        mockRequests: mock.requests,
        unexpectedMockRequests: mock.unexpected,
        deniedNetworkRequests: () =>
          existsSync(deniedLog)
            ? readFileSync(deniedLog, 'utf8').split('\n').filter(Boolean)
            : [],
        waitForRenderer,
        rendererCount: (name) => app!.windows().filter((page) => pageMatches(page, name)).length,
        operationCount: () =>
          app!.windows().filter((page) => page.url().startsWith('http://crms.micromeet.ai/')).length,
        waitForOperation: async () =>
          await waitForPage(
            app!,
            (page) => page.url().startsWith('http://crms.micromeet.ai/'),
            'mocked AI-CRMS operation view'
          )
      })
    } finally {
      const cleanupErrors: unknown[] = []
      if (app) {
        try {
          await app.close()
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
      try {
        await closeMockServer(mock.server)
      } catch (error) {
        cleanupErrors.push(error)
      }
      try {
        rmSync(tempRoot, { recursive: true, force: true })
      } catch (error) {
        cleanupErrors.push(error)
      }
      if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Bitterless E2E cleanup failed')
    }
  }
})

export { expect }
