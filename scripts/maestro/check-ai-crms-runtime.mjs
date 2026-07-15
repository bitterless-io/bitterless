import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
const moduleCache = new Map()

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

let mockSession = {
  jwt_token: 'runtime-jwt-token',
  tenant_id: 'workspace-runtime',
  region: 'ID',
  ts: Date.now()
}

const mocks = {
  'electron-xpc/main': {
    createXpcMainEmitter: () => ({
      getSession: async () => mockSession
    })
  }
}

const resolveTsModule = (specifier, parentDir = root) => {
  if (specifier.startsWith('@maestro-main/')) return join(root, 'main', 'maestro', `${specifier.slice('@maestro-main/'.length)}.ts`)
  if (specifier.startsWith('@maestro-shared/')) return join(root, 'shared', 'maestro', `${specifier.slice('@maestro-shared/'.length)}.ts`)
  if (specifier.startsWith('.')) {
    const base = join(parentDir, specifier)
    for (const candidate of [`${base}.ts`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.js')]) {
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

const loadTsModule = (specifier, parentDir = root) => {
  if (Object.hasOwn(mocks, specifier)) return mocks[specifier]
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

const requests = []
const server = createServer((req, res) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8')
    const body = text ? JSON.parse(text) : {}
    requests.push({
      method: req.method,
      url: req.url,
      auth: req.headers.authorization || '',
      region: req.headers['x-region'] || '',
      workspace: req.headers['x-workspace-id'] || '',
      body
    })
    const index = requests.length
    if (index === 1) return respondToolCall(res)
    if (index === 2) return respondFinalSse(res)
    if (index === 3) return respondJsonFallback(res)
    if (index === 4) return respondHttpError(res)
    if (index === 5) return respondSecretToolCall(res)
    return respondFinalSse(res)
  })
})

const respondToolCall = (res) => {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  writeSse(res, { choices: [{ delta: { reasoning_content: 'Need department id. ' } }] })
  writeSse(res, { choices: [{ delta: { content: 'Checking department. ' } }] })
  writeSse(res, {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_department',
              function: { name: 'lookup_department', arguments: '{"query":"car' }
            }
          ]
        }
      }
    ]
  })
  writeSse(res, {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              function: { arguments: 'dio"}' }
            }
          ]
        },
        finish_reason: 'tool_calls'
      }
    ]
  })
  res.end('data: [DONE]\n\n')
}

const respondFinalSse = (res) => {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  writeSse(res, { choices: [{ delta: { content: 'Booked via API.' }, finish_reason: 'stop' }] })
  res.end('data: [DONE]\n\n')
}

const respondSecretToolCall = (res) => {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  writeSse(res, {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_secret',
              function: { name: 'fail_secret', arguments: '{"query":"secret"}' }
            }
          ]
        },
        finish_reason: 'tool_calls'
      }
    ]
  })
  res.end('data: [DONE]\n\n')
}

const writeSse = (res, payload) => {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

const respondJsonFallback = (res) => {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ choices: [{ message: { content: 'JSON fallback ok.' }, finish_reason: 'stop' }] }))
}

const respondHttpError = (res) => {
  res.statusCode = 500
  res.setHeader('Content-Type', 'application/json')
  res.end(
    JSON.stringify({
      error: 'upstream failed',
      authorization: 'Bearer runtime-jwt-token',
      jwt_token: 'eyJaaaaaaaaaaaa.bbbbbbbbbbbb.cccccccccccc'
    })
  )
}

const listen = await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => resolve(server.address()))
})

const previousRelay = process.env.COACH_AI_CRMS_RELAY_BASE_URL
process.env.COACH_AI_CRMS_RELAY_BASE_URL = `http://127.0.0.1:${listen.port}/v1`

try {
  const { CoachRuntimeAdapter } = loadTsModule('@maestro-main/agent/runtime/coachRuntimeAdapter')
  const adapter = new CoachRuntimeAdapter()
  assert(await adapter.checkTarget({ providerId: 'ai-crms', modelId: 'qwen3.7-plus', authPath: '' }), 'Coach runtime router should select the native AI-CRMS adapter')

  const events = []
  const debug = []
  const toolArgs = []
  const session = await adapter.createSession({
    target: { providerId: 'ai-crms', modelId: 'qwen3.7-plus', thinkingLevel: 'low' },
    authPath: '',
    tools: [
      {
        name: 'lookup_department',
        description: 'Find a department id by natural-language query.',
        params: [{ name: 'query', type: 'string', required: true, description: 'Department query' }],
        execute: async (args) => {
          toolArgs.push(args)
          return 'department_id=cardiology-id'
        }
      }
    ],
    scope: 'agent',
    onDebug: (event) => debug.push(event)
  })
  session.subscribe((event) => events.push(event))

  await session.prompt({
    text: 'Book Jane with the attached screenshot.',
    media: [
      { kind: 'image', url: 'https://cdn.example.test/screen.png', mimeType: 'image/png', name: 'screen.png' },
      { kind: 'image', url: 'data:image/png;base64,SHOULD_NOT_SEND', mimeType: 'image/png', name: 'inline.png' }
    ],
    images: [
      { kind: 'image', url: 'https://cdn.example.test/screen.png', mimeType: 'image/png', name: 'screen.png' },
      { kind: 'image', url: 'data:image/png;base64,SHOULD_NOT_SEND', mimeType: 'image/png', name: 'inline.png' }
    ]
  })

  assert(requests.length === 2, 'tool loop should make two relay requests')
  assert(requests[0].method === 'POST' && requests[0].url === '/v1/chat/completions', 'runtime should POST to /chat/completions')
  assert(requests[0].auth === 'Bearer runtime-jwt-token', 'runtime should use the live bearer token')
  assert(requests[0].region === 'ID' && requests[0].workspace === 'workspace-runtime', 'runtime should pass region/workspace headers')
  assert(requests[0].body.stream === true && requests[0].body.enable_thinking === true, 'runtime should request streaming and enable qwen thinking')
  assert(requests[0].body.tools?.[0]?.function?.name === 'lookup_department', 'runtime should expose Coach tools as OpenAI function tools')
  const firstBodyText = JSON.stringify(requests[0].body)
  assert(firstBodyText.includes('"type":"image_url"'), 'runtime should send images as image_url parts')
  assert(firstBodyText.includes('https://cdn.example.test/screen.png'), 'runtime should include the downloadable image URL')
  assert(!firstBodyText.includes('base64') && !firstBodyText.includes('data:image'), 'runtime should not inline base64/data URLs')
  const firstUserContent = requests[0].body.messages?.[0]?.content || []
  const imageParts = Array.isArray(firstUserContent) ? firstUserContent.filter((item) => item?.type === 'image_url') : []
  assert(imageParts.length === 1, 'runtime should drop inline image URLs and de-duplicate image refs')
  assert(imageParts[0]?.image_url?.url === 'https://cdn.example.test/screen.png', 'runtime should forward only downloadable image URLs')
  assert(toolArgs[0]?.query === 'cardio', 'runtime should assemble streamed tool-call arguments')
  const secondBodyText = JSON.stringify(requests[1].body)
  assert(secondBodyText.includes('"role":"tool"') && secondBodyText.includes('department_id=cardiology-id'), 'runtime should feed tool observations back to the relay')
  assert(events.some((event) => event.type === 'thinking_delta' && event.delta.includes('Need department id')), 'runtime should emit thinking deltas')
  assert(events.some((event) => event.type === 'text_delta' && event.delta.includes('Checking department')), 'runtime should emit streamed text deltas before tool use')
  assert(events.some((event) => event.type === 'tool_start' && event.toolName === 'lookup_department'), 'runtime should emit tool_start')
  assert(events.some((event) => event.type === 'tool_end' && event.toolName === 'lookup_department' && !event.isError), 'runtime should emit successful tool_end')
  assert(events.some((event) => event.type === 'assistant_message_end' && event.text === 'Booked via API.'), 'runtime should emit the final assistant message')
  assert(debug.some((event) => event.phase === 'ai-crms-request') && debug.some((event) => event.phase === 'ai-crms-response'), 'runtime should emit request/response debug events')
  const requestDebug = debug.find((event) => event.phase === 'ai-crms-request')
  assert(requestDebug?.detail?.url === `http://127.0.0.1:${listen.port}/v1/chat/completions`, 'request debug should expose the relay chat.completions URL')
  assert(requestDebug?.detail?.hasAuthorizationHeader === true, 'request debug should confirm Authorization header presence')
  assert(!Object.hasOwn(requestDebug?.detail || {}, 'tokenLength'), 'request debug should not expose token material or its length')
  assert(requestDebug?.detail?.region === 'ID' && requestDebug?.detail?.hasWorkspaceId === true, 'request debug should expose only safe region/workspace routing metadata')

  await session.prompt({ text: 'Return through JSON fallback.' })
  assert(requests.length === 3, 'JSON fallback prompt should make a third request')
  assert(events.some((event) => event.type === 'assistant_message_end' && event.text === 'JSON fallback ok.'), 'runtime should support non-streaming JSON fallback')
  const debugText = JSON.stringify(debug)
  assert(!debugText.includes('runtime-jwt-token') && !debugText.includes('eyJaaaaaaaaaaaa'), 'debug events should not expose live tokens')

  let sanitizedError = ''
  try {
    await session.prompt({ text: 'Trigger sanitized HTTP error.' })
  } catch (err) {
    sanitizedError = err instanceof Error ? err.message : String(err)
  }
  assert(requests.length === 4, 'HTTP error prompt should make a fourth request')
  assert(sanitizedError.includes('AI-CRMS relay HTTP 500'), 'HTTP relay errors should still report status')
  assert(debug.some((event) => event.phase === 'ai-crms-response-error' && event.detail?.status === 500), 'HTTP relay errors should emit response-error debug events')
  assert(sanitizedError.includes('[REDACTED]'), 'HTTP relay errors should include redaction markers for sensitive fields')
  assert(!sanitizedError.includes('runtime-jwt-token') && !sanitizedError.includes('eyJaaaaaaaaaaaa'), 'HTTP relay errors should not leak live token values')

  const secretSession = await adapter.createSession({
    target: { providerId: 'ai-crms', modelId: 'qwen3.7-plus', thinkingLevel: 'off' },
    authPath: '',
    tools: [
      {
        name: 'fail_secret',
        description: 'Throw a sensitive error.',
        params: [{ name: 'query', type: 'string', required: true, description: 'query' }],
        execute: async () => {
          throw new Error('tool failed with Bearer runtime-jwt-token and eyJaaaaaaaaaaaa.bbbbbbbbbbbb.cccccccccccc')
        }
      }
    ],
    scope: 'agent',
    onDebug: (event) => debug.push(event)
  })
  secretSession.subscribe((event) => events.push(event))
  await secretSession.prompt({ text: 'Trigger sanitized tool error.' })
  assert(requests.length === 6, 'tool error prompt should make two more relay requests')
  const toolObservationText = JSON.stringify(requests[5].body)
  assert(toolObservationText.includes('[REDACTED'), 'tool error observations should include redaction markers')
  assert(!toolObservationText.includes('runtime-jwt-token') && !toolObservationText.includes('eyJaaaaaaaaaaaa'), 'tool error observations should not leak token values')
  assert(!JSON.stringify(debug).includes('runtime-jwt-token') && !JSON.stringify(debug).includes('eyJaaaaaaaaaaaa'), 'tool error debug events should not leak token values')

  console.log('[check-ai-crms-runtime] ok')
} finally {
  server.close()
  if (previousRelay === undefined) delete process.env.COACH_AI_CRMS_RELAY_BASE_URL
  else process.env.COACH_AI_CRMS_RELAY_BASE_URL = previousRelay
}
