import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src', 'cowork')
const moduleCache = new Map()

const resolveTsModule = (specifier, parentDir = root) => {
  if (specifier.startsWith('@cowork-main/')) return join(root, 'main', `${specifier.slice('@cowork-main/'.length)}.ts`)
  if (specifier.startsWith('@cowork-shared/')) return join(root, 'shared', `${specifier.slice('@cowork-shared/'.length)}.ts`)
  if (specifier.startsWith('.')) {
    const base = join(parentDir, specifier)
    for (const candidate of [`${base}.ts`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.js')]) {
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

const loadTsModule = (specifier, parentDir = root) => {
  const file = resolveTsModule(specifier, parentDir)
  if (!file) return require(specifier)
  if (moduleCache.has(file)) return moduleCache.get(file).exports

  const mod = { exports: {} }
  moduleCache.set(file, mod)
  const source = readFileSync(file, 'utf8')
  const output = ts.transpileModule(source, {
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
    (childSpecifier) => loadTsModule(childSpecifier, dirname(file)),
    mod,
    file,
    dirname(file)
  )
  return mod.exports
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const {
  fetchHeaderEntriesToMap,
  findMatchingInterceptionRule,
  hasHeader,
  headerEntriesForFetch,
  interceptionStagesForRules,
  mergeHeaders,
  normalizeNetworkInterceptionRule,
  publicInterceptionRule,
  ruleMatchesPausedRequest
} = loadTsModule('@cowork-main/capture/networkInterception')

const normalized = normalizeNetworkInterceptionRule(
  {
    command: 'add',
    action: 'mock_response',
    url_contains: '/api/departments',
    method: 'get',
    status: 202,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'debug=1' },
    body: { ok: true }
  },
  'r1',
  123
)
assert(normalized.ok && normalized.rule, 'valid mock_response should normalize')
assert(normalized.rule.method === 'GET', 'method should be normalized')
assert(normalized.rule.once === true, 'rules should default to once')
assert(normalized.rule.headers['content-type'] === 'application/json', 'response header should normalize')
assert(normalized.rule.headers['set-cookie'] === 'debug=1', 'response rewrite may set response headers')
assert(normalized.rule.body === '{"ok":true}', 'object body should stringify')
assert(interceptionStagesForRules([normalized.rule]).join(',') === 'request', 'mock_response should pause request stage')
assert(ruleMatchesPausedRequest(normalized.rule, { stage: 'request', method: 'GET', url: 'https://x.test/api/departments' }), 'mock rule should match request')
assert(!ruleMatchesPausedRequest(normalized.rule, { stage: 'response', method: 'GET', url: 'https://x.test/api/departments' }), 'mock rule should not match response stage')

const rewrite = normalizeNetworkInterceptionRule(
  {
    action: 'rewrite_request',
    url_contains: '/api/bookings',
    request_headers: { 'X-Debug': '1', Authorization: 'Bearer secret', Cookie: 'a=b' },
    once: false
  },
  'r2',
  124
)
assert(rewrite.ok && rewrite.rule, 'valid rewrite_request should normalize')
assert(rewrite.rule.once === false, 'once=false should be respected')
assert(rewrite.rule.rewriteHeaders['x-debug'] === '1', 'non-sensitive request header should stay')
assert(!rewrite.rule.rewriteHeaders.authorization, 'authorization rewrite should be filtered')
assert(!rewrite.rule.rewriteHeaders.cookie, 'cookie rewrite should be filtered')

const responseRewrite = normalizeNetworkInterceptionRule(
  { action: 'rewrite_response', url_contains: '/api/bookings', body: '[]' },
  'r3',
  125
)
assert(responseRewrite.ok && responseRewrite.rule, 'rewrite_response with body should normalize')
assert(interceptionStagesForRules([rewrite.rule, responseRewrite.rule]).sort().join(',') === 'request,response', 'stages should include request and response')
assert(findMatchingInterceptionRule([rewrite.rule, responseRewrite.rule], { stage: 'response', method: 'GET', url: 'https://x.test/api/bookings' })?.id === 'r3', 'response rule should match response stage')

const headerOnlyResponseRewrite = normalizeNetworkInterceptionRule(
  { action: 'rewrite_response', url_contains: '/api/bookings', headers: { 'X-Debug': 'yes' } },
  'r4',
  126
)
assert(headerOnlyResponseRewrite.ok && headerOnlyResponseRewrite.rule, 'rewrite_response with headers only should normalize')
assert(headerOnlyResponseRewrite.rule.body === undefined, 'header-only rewrite should not invent a body')
assert(publicInterceptionRule(headerOnlyResponseRewrite.rule).has_body === false, 'header-only public rule should show no body')
const pausedHeaders = fetchHeaderEntriesToMap([{ name: 'Content-Type', value: 'application/json' }])
const mergedResponseHeaders = mergeHeaders(pausedHeaders, headerOnlyResponseRewrite.rule.headers)
assert(mergedResponseHeaders['content-type'] === 'application/json', 'paused response headers should normalize')
assert(mergedResponseHeaders['x-debug'] === 'yes', 'rewrite response header should merge')
assert(hasHeader(mergedResponseHeaders, 'Content-Type'), 'hasHeader should be case-insensitive')

const invalid = normalizeNetworkInterceptionRule({ action: 'block' }, 'bad')
assert(!invalid.ok, 'url_contains should be required')

const publicRule = publicInterceptionRule(normalized.rule)
assert(publicRule.has_body === true, 'public rule should show body presence')
assert(!('body' in publicRule), 'public rule should not expose body')
assert(headerEntriesForFetch({ a: '1' })[0].name === 'a', 'headers should convert for Fetch')

console.log('[check-network-interception] ok', JSON.stringify({
  rules: 4,
  stages: interceptionStagesForRules([rewrite.rule, responseRewrite.rule, headerOnlyResponseRewrite.rule]).sort()
}))
