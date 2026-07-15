import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
const replayEngineSource = readFileSync(join(root, 'main/maestro/drive/replayEngine.ts'), 'utf8')
const maestro = readFileSync(join(root, 'main/maestro/windows/maestroWindow.helper.ts'), 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const loadReplayInternals = () => {
  const source = `${replayEngineSource}\nexport const __checkBrowserExecAuth = { apiFetchRunner, commandRunner, multiCallRunner, apiReplayRunner, filterReplayHeaders, isUnsafeExplicitHeader }\n`
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    fileName: 'replayEngine.ts'
  }).outputText
  const mod = { exports: {} }
  const wrapped = vm.runInThisContext(
    `(function(exports, require, module, __filename, __dirname) {\n${output}\n})`,
    { filename: 'replayEngine.ts' }
  )
  wrapped(mod.exports, () => ({}), mod, 'replayEngine.ts', root)
  return mod.exports.__checkBrowserExecAuth
}

const makeStorage = (values) => {
  const entries = Object.entries(values)
  return {
    get length() {
      return entries.length
    },
    key(index) {
      return entries[index]?.[0] || null
    },
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null
    }
  }
}

const makeDocument = () => {
  const resultPanel = { textContent: '' }
  const metas = [
    {
      getAttribute(name) {
        if (name === 'name') return 'meta-token'
        if (name === 'content') return 'LIVE_META'
        return null
      }
    }
  ]
  return {
    cookie: 'visible_cookie=COOKIE_VALUE; other=123',
    querySelectorAll(selector) {
      return selector.includes('meta') ? metas : []
    },
    querySelector(selector) {
      return selector === 'meta[name="meta-token"]' ? metas[0] : null
    },
    getElementById(id) {
      return id === 'result' ? resultPanel : null
    },
    __resultPanel: resultPanel
  }
}

const withFakePage = async (fn) => {
  const previous = {
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    document: globalThis.document,
    location: globalThis.location,
    fetch: globalThis.fetch
  }
  const fetchCalls = []
  globalThis.localStorage = makeStorage({ access_token: 'LIVE_ACCESS_TOKEN', unrelated: 'noise' })
  globalThis.sessionStorage = makeStorage({ csrf_token: 'LIVE_CSRF_TOKEN' })
  globalThis.document = makeDocument()
  globalThis.location = { href: 'https://clinic.example.test/booking' }
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options })
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ ok: true, url, auth: options.headers.Authorization || '', csrf: options.headers['x-csrf-token'] || '' })
      }
    }
  }
  try {
    await fn(fetchCalls)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (typeof value === 'undefined') delete globalThis[key]
      else globalThis[key] = value
    }
  }
}

const { apiFetchRunner, commandRunner, multiCallRunner, apiReplayRunner, filterReplayHeaders, isUnsafeExplicitHeader } = loadReplayInternals()

assert(typeof apiFetchRunner === 'function', 'apiFetchRunner should be loadable for behavior checks')
assert(typeof commandRunner === 'function', 'commandRunner should be loadable for behavior checks')
assert(typeof multiCallRunner === 'function', 'multiCallRunner should be loadable for legacy replay behavior checks')
assert(typeof apiReplayRunner === 'function', 'apiReplayRunner should be loadable for legacy replay behavior checks')
assert(typeof filterReplayHeaders === 'function', 'filterReplayHeaders should be loadable for replay header checks')
assert(isUnsafeExplicitHeader('Authorization'), 'Authorization should be considered unsafe')
assert(isUnsafeExplicitHeader('Cookie'), 'Cookie should be considered unsafe')
assert(isUnsafeExplicitHeader('x-csrf-token'), 'CSRF header should be considered unsafe')
assert(!isUnsafeExplicitHeader('x-client-version'), 'ordinary app headers should be allowed')

const filteredHeaders = filterReplayHeaders({
  Authorization: 'Bearer RECORDED_SHOULD_NOT_PASS',
  Cookie: 'sid=RECORDED_SHOULD_NOT_PASS',
  'x-csrf-token': 'RECORDED_SHOULD_NOT_PASS',
  'x-api-key': 'RECORDED_SHOULD_NOT_PASS',
  'x-client-version': 'coach-test',
  'content-type': 'application/json'
}, true, true)
assert(filteredHeaders.Authorization === undefined, 'recorded Authorization should be dropped from replay headers')
assert(filteredHeaders.Cookie === undefined, 'recorded Cookie should be dropped from replay headers')
assert(filteredHeaders['x-csrf-token'] === undefined, 'recorded CSRF should be dropped from replay headers')
assert(filteredHeaders['x-api-key'] === undefined, 'recorded API key should be dropped from replay headers')
assert(filteredHeaders['x-client-version'] === 'coach-test', 'safe x-client headers should survive replay filtering')
assert(filteredHeaders['content-type'] === 'application/json', 'content-type should survive replay filtering')

await withFakePage(async (fetchCalls) => {
  const result = await apiFetchRunner(
    {
      url: '/api/bookings',
      method: 'POST',
      query: { department: 'cardio', active: true },
      headers: {
        Authorization: 'Bearer RECORDED_SHOULD_NOT_PASS',
        Cookie: 'sid=RECORDED_SHOULD_NOT_PASS',
        'x-csrf-token': 'RECORDED_SHOULD_NOT_PASS',
        'x-client-version': 'coach-test',
        accept: 'application/json'
      },
      body: { patient: 'Jane', count: 1 }
    },
    [
      { header: 'Authorization', candidateKeys: ['access_token'], prefix: 'Bearer ' },
      { header: 'x-csrf-token', candidateKeys: ['csrf_token'] },
      { header: 'x-meta-token', candidateKeys: ['meta-token'] }
    ]
  )

  assert(result.ok && result.status === 200, 'apiFetchRunner should return the fetch result')
  assert(fetchCalls.length === 1, 'apiFetchRunner should issue one fetch')
  const call = fetchCalls[0]
  assert(String(call.url).startsWith('https://clinic.example.test/api/bookings?'), 'relative URLs should resolve against the live page')
  assert(String(call.url).includes('department=cardio') && String(call.url).includes('active=true'), 'query params should be attached')
  assert(call.options.credentials === 'include', 'fetch should include current browser credentials/cookies')
  assert(call.options.method === 'POST', 'method should be normalized')
  assert(call.options.headers.Authorization === 'Bearer LIVE_ACCESS_TOKEN', 'Authorization should be resolved live from localStorage')
  assert(call.options.headers['x-csrf-token'] === 'LIVE_CSRF_TOKEN', 'CSRF should be resolved live from sessionStorage')
  assert(call.options.headers['x-meta-token'] === 'LIVE_META', 'meta auth should be resolved live')
  assert(call.options.headers.Cookie === undefined, 'explicit Cookie should be ignored')
  assert(!String(JSON.stringify(call.options.headers)).includes('RECORDED_SHOULD_NOT_PASS'), 'recorded token-like header values should never pass through')
  assert(call.options.headers['x-client-version'] === 'coach-test', 'ordinary explicit headers should pass through')
  assert(call.options.headers['content-type'] === 'application/json', 'object bodies should get JSON content-type')
  assert(call.options.body === JSON.stringify({ patient: 'Jane', count: 1 }), 'object body should be JSON encoded')
  assert(Array.isArray(result.auth) && result.auth.every((item) => item.applied), 'auth result should report applied live sources')
  assert(!JSON.stringify(result).includes('LIVE_ACCESS_TOKEN'), 'tool result should not return token values')
})

await withFakePage(async () => {
  const result = await commandRunner([
    { command: 'read_context', id: 'auth_probe', keys: ['token', 'cookie'] },
    { command: 'fetch', id: 'departments read', url: '/api/departments', method: 'GET' },
    { command: 'read_context', id: 'token=LIVE_ACCESS_TOKEN', keys: ['token'] }
  ])
  assert(result.ok, 'read_context should succeed')
  assert(result.results?.[0]?.id === 'auth_probe', 'read_context should echo stable command ids')
  assert(result.results?.[1]?.id === 'departments_read', 'fetch should echo normalized stable command ids')
  assert(result.results?.[2]?.id === undefined, 'secret-like command ids should be dropped')
  const text = JSON.stringify(result)
  assert(text.includes('"present":true') && text.includes('"length":17'), 'read_context should report only presence/length metadata')
  assert(!text.includes('LIVE_ACCESS_TOKEN') && !text.includes('COOKIE_VALUE'), 'read_context must not expose raw auth values')
})

await withFakePage(async (fetchCalls) => {
  const result = await commandRunner([
    {
      command: 'parallel',
      id: 'lookup batch',
      commands: [
        { command: 'fetch', id: 'departments', url: '/api/departments', method: 'GET' },
        {
          command: 'parallel',
          id: 'nested lookups',
          commands: [{ command: 'fetch', id: 'pricing', url: '/api/pricing-list', method: 'HEAD' }]
        }
      ]
    }
  ])
  assert(result.ok, 'in-page commandRunner should execute read-only parallel groups')
  assert(fetchCalls.length === 2, 'parallel read-only group should issue both fetches')
  assert(result.results.length === 2, 'parallel groups should flatten nested command results')
  assert(result.results.every((item) => item.command.startsWith('parallel.')), 'parallel results should be labeled as parallel output')
  assert(result.results.some((item) => item.id === 'departments'), 'parallel result should preserve child command ids')
  assert(result.results.some((item) => item.id === 'pricing'), 'nested parallel result should preserve nested child command ids')
})

await withFakePage(async () => {
  const result = await commandRunner([
    {
      command: 'parallel',
      id: 'unsafe batch',
      commands: [{ command: 'fetch', id: 'write', url: '/api/bookings', method: 'POST', body: { ok: true } }]
    }
  ])
  assert(!result.ok, 'in-page commandRunner should reject mutating fetches inside parallel groups')
  assert(result.results[0]?.command === 'parallel', 'parallel rejection should return a parallel result')
  assert(result.results[0]?.error?.includes('read-only'), 'parallel rejection should explain the read-only boundary')
})

await withFakePage(async (fetchCalls) => {
  const run = await multiCallRunner([
    {
      method: 'POST',
      url: '/api/legacy',
      headers: {
        Authorization: 'Bearer RECORDED_SHOULD_NOT_PASS',
        Cookie: 'sid=RECORDED_SHOULD_NOT_PASS',
        'x-api-key': 'RECORDED_SHOULD_NOT_PASS',
        'x-client-version': 'coach-test',
        'content-type': 'application/json'
      },
      headerPolicy: [
        { header: 'Authorization', kind: 'bearer-token', storageKeys: ['access_token'], cookieNames: [], prefix: 'Bearer ', fallback: 'Bearer RECORDED_FALLBACK_SHOULD_NOT_PASS' },
        { header: 'x-api-key', kind: 'storage-or-cookie', storageKeys: ['missing-api-key'], cookieNames: [], fallback: 'RECORDED_FALLBACK_SHOULD_NOT_PASS' }
      ],
      body: '{"ok":true}'
    }
  ])
  assert(run.ok, 'legacy multiCallRunner should succeed')
  assert(fetchCalls.length === 1, 'legacy multiCallRunner should issue one fetch')
  const headers = fetchCalls[0].options.headers
  assert(headers.Authorization === 'Bearer LIVE_ACCESS_TOKEN', 'legacy replay should resolve Authorization live')
  assert(headers.Cookie === undefined, 'legacy replay should not send recorded Cookie')
  assert(headers['x-api-key'] === undefined, 'legacy replay should not send recorded fallback API key')
  assert(headers['x-client-version'] === 'coach-test', 'legacy replay should keep safe static headers')
  assert(!JSON.stringify(headers).includes('RECORDED'), 'legacy replay headers should not include recorded auth values')
  assert(!JSON.stringify(run).includes('LIVE_ACCESS_TOKEN'), 'legacy multiCallRunner result should not expose live token values')
  assert(!JSON.stringify(run).includes('RECORDED'), 'legacy multiCallRunner result should not expose recorded auth values')
})

await withFakePage(async (fetchCalls) => {
  const run = await apiReplayRunner([
    {
      method: 'POST',
      url: '/api/replay-plan',
      headers: {
        Authorization: 'Bearer RECORDED_SHOULD_NOT_PASS',
        Cookie: 'sid=RECORDED_SHOULD_NOT_PASS',
        'x-client-version': 'coach-test',
        'content-type': 'application/json'
      },
      headerPolicy: [
        { header: 'Authorization', kind: 'bearer-token', storageKeys: ['access_token'], cookieNames: [], prefix: 'Bearer ', fallback: 'Bearer RECORDED_FALLBACK_SHOULD_NOT_PASS' },
        { header: 'x-csrf-token', kind: 'csrf-token', storageKeys: ['csrf_token'], cookieNames: [], fallback: 'RECORDED_FALLBACK_SHOULD_NOT_PASS' }
      ],
      body: '{"ok":true}'
    }
  ])
  assert(run.ok, 'legacy apiReplayRunner should succeed')
  assert(fetchCalls.length === 1, 'legacy apiReplayRunner should issue one fetch')
  const headers = fetchCalls[0].options.headers
  assert(headers.Authorization === 'Bearer LIVE_ACCESS_TOKEN', 'apiReplayRunner should resolve Authorization live')
  assert(headers['x-csrf-token'] === 'LIVE_CSRF_TOKEN', 'apiReplayRunner should resolve CSRF live')
  assert(headers.Cookie === undefined, 'apiReplayRunner should not send recorded Cookie')
  assert(!JSON.stringify(headers).includes('RECORDED'), 'apiReplayRunner headers should not include recorded auth values')
  assert(!JSON.stringify(run).includes('LIVE_ACCESS_TOKEN'), 'apiReplayRunner result should not expose live token values')
  assert(!JSON.stringify(run).includes('RECORDED'), 'apiReplayRunner result should not expose recorded auth values')
  assert(run.responseText.includes('<redacted>'), 'apiReplayRunner responseText should redact sensitive response fields')
})

assert(
  replayEngineSource.includes('auth?: AuthHint | AuthHint[] | null'),
  'BrowserCommand.fetch should accept value-free auth hints'
)
assert(
  maestro.includes('auth: normalizeBrowserExecAuth(rec.auth ?? rec.header_policy ?? rec.headerPolicy)'),
  'browser_exec should parse auth/header_policy/headerPolicy from fetch commands'
)
assert(
  maestro.includes('const id = normalizeBrowserCommandId(rec.id)') && maestro.includes('id: cmd.id'),
  'browser_exec should sanitize ids and echo them on main-executed fetch results'
)
assert(
  maestro.includes('headers: sanitizeReplayHeaders(rec.headers)'),
  'browser_exec should sanitize raw fetch headers before dispatch'
)
assert(
  maestro.includes('mergeAuthHints(domainAuth, cmd.auth)'),
  'browser_exec should merge domain auth profile with per-call auth hints'
)
assert(
  maestro.includes('function normalizeBrowserExecAuth') &&
    maestro.includes('candidate_keys') &&
    maestro.includes('Direct Authorization/Cookie/token-like values in `headers` are ignored'),
  'browser_exec tool description and parser should expose value-free auth usage'
)

console.log('[check-browser-exec-auth] ok')

