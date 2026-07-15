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
  base64DecodedLength,
  classifyResponseBodyCapture,
  isProbablyBinaryBuffer,
  isStreamingResponseMime,
  isTextLikeResponseMime
} = loadTsModule('@maestro-main/capture/responseBodyPolicy')

const policy = (mime, encodedDataLength) => classifyResponseBodyCapture({ mime, encodedDataLength, bodyLimit: 20_000 })

assert(policy('application/json; charset=utf-8', 120).captureBody, 'json should be captured')
assert(policy('application/vnd.api+json', 120).mode === 'text', '+json should be text')
assert(policy('image/svg+xml', 120).mode === 'text', 'svg should be captured as text')
assert(policy('image/png', 512).mode === 'image-data-url', 'small image should capture preview')
assert(policy('image/png', 40_000).omittedReason === 'too-large-image', 'large image should be omitted as too-large-image')
assert(policy('application/pdf', 4000).omittedReason === 'binary', 'pdf should be binary')
assert(policy('application/octet-stream', 4000).omittedReason === 'binary', 'octet-stream should be binary')
assert(policy('text/event-stream', undefined).omittedReason === 'streaming', 'sse should be streaming')
assert(policy('application/x-ndjson', 120).omittedReason === 'streaming', 'ndjson should be streaming')
assert(policy('application/grpc-web+proto', 120).omittedReason === 'streaming', 'grpc-web should be streaming')
assert(policy('application/x-custom', 4000).omittedReason === 'unsupported-mime', 'unknown mime should be unsupported')
assert(policy('application/json', 0).omittedReason === 'empty', 'zero-length response should be empty')
assert(isTextLikeResponseMime('application/graphql-response+json'), 'graphql + json should be text-like')
assert(isStreamingResponseMime('text/event-stream; charset=utf-8'), 'sse should be streaming-like')
assert(!isTextLikeResponseMime('text/event-stream'), 'sse should not be captured as text preview')
assert(base64DecodedLength('SGVsbG8=') === 5, 'base64 decoded length should account for padding')
assert(isProbablyBinaryBuffer(Buffer.from([0, 1, 2, 3, 4])), 'nul byte should be binary')
assert(!isProbablyBinaryBuffer(Buffer.from('{"ok":true}\\n', 'utf8')), 'json text should not be binary')

console.log('[check-response-body-policy] ok', JSON.stringify({
  binaryReason: policy('application/pdf', 4000).omittedReason,
  imageMode: policy('image/png', 512).mode,
  streamingReason: policy('text/event-stream', undefined).omittedReason,
  textMode: policy('application/json', 120).mode
}))
