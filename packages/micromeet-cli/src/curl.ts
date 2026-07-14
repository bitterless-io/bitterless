import { readFileSync, writeFileSync } from 'fs'
import { optionBoolean, optionNumber, optionString, optionValues } from './args'
import { CliError } from './errors'
import { printJson } from './format'
import { coreRawRequest, type CoreRawResponse } from './http'
import type { CommandContext, ParsedArgv } from './types'

const httpMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

export const curlHelp = (): string => `micromeet curl [method] <url-or-path> [options]

Examples:
  micromeet curl /share/user/profile/detail
  micromeet curl POST /mcu/record/list -d '{"page":1,"page_size":10}'
  micromeet curl -X PATCH /medical/settings/detail -H 'x-debug: 1' -d @body.json
  micromeet curl --no-auth https://example.com/status -i

Options:
  -X, --request <method>   HTTP method override.
  -H, --header <k: v>      Add a request header. Repeatable.
  -d, --data <body>        Request body. Repeatable; @file reads a file, @- reads stdin.
      --data-raw <body>    Alias for --data.
      --data-binary <body> Alias for --data.
  -G, --get                Send data as query parameters and use GET unless -X is set.
      --query <k=v>        Add a query parameter. Repeatable.
  -i, --include            Print response status and headers before the body.
  -I, --head               Use HEAD.
      --auth               Force Micromeet auth headers.
      --no-auth            Do not add Micromeet auth headers.
      --timeout <ms>       Axios timeout in milliseconds.
      --fail               Exit non-zero for HTTP status >= 400.
  -o, --output <file>      Write response body to a file.
      --raw                Print string bodies as-is.
      --json               Print a JSON envelope with status, headers, and body.`

const isHttpMethod = (value: string | undefined): boolean => !!value && httpMethods.has(value.toUpperCase())

const isAbsoluteUrl = (value: string): boolean => /^https?:\/\//i.test(value)

const appendParam = (params: Record<string, string | string[]>, key: string, value: string): void => {
  const existing = params[key]
  if (existing === undefined) {
    params[key] = value
    return
  }
  if (Array.isArray(existing)) {
    existing.push(value)
    return
  }
  params[key] = [existing, value]
}

const appendQueryEntry = (params: Record<string, string | string[]>, entry: string): void => {
  const eq = entry.indexOf('=')
  const key = (eq >= 0 ? entry.slice(0, eq) : entry).trim()
  const value = eq >= 0 ? entry.slice(eq + 1) : ''
  if (!key) throw new CliError(`Invalid query entry: ${entry}`)
  appendParam(params, key, value)
}

const appendQueryString = (params: Record<string, string | string[]>, value: string): void => {
  const query = new URLSearchParams(value)
  let usedSearchParams = false
  for (const [key, item] of query.entries()) {
    usedSearchParams = true
    appendParam(params, key, item)
  }
  if (!usedSearchParams) appendQueryEntry(params, value)
}

const parseHeaders = (values: string[]): Record<string, string> => {
  const headers: Record<string, string> = {}
  for (const value of values) {
    const colon = value.indexOf(':')
    if (colon <= 0) throw new CliError(`Header must use "Name: value" syntax: ${value}`)
    const name = value.slice(0, colon).trim()
    if (!name) throw new CliError(`Header name cannot be empty: ${value}`)
    headers[name] = value.slice(colon + 1).trimStart()
  }
  return headers
}

const findHeader = (headers: Record<string, string>, name: string): string | undefined => {
  const lower = name.toLowerCase()
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === lower)
  return match?.[1]
}

const readBodyValue = (value: string): string => {
  if (value === '@-') return readFileSync(0, 'utf8')
  if (value.startsWith('@')) return readFileSync(value.slice(1), 'utf8')
  return value
}

const collectDataValues = (argv: ParsedArgv): string[] => [
  ...optionValues(argv, 'data'),
  ...optionValues(argv, 'data-raw'),
  ...optionValues(argv, 'data-binary'),
  ...optionValues(argv, 'body')
]

const looksLikeJson = (value: string): boolean => {
  const trimmed = value.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

const parseJsonBody = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown
  } catch (err) {
    throw new CliError(`Invalid JSON request body: ${(err as Error).message}`)
  }
}

const buildBody = (argv: ParsedArgv, headers: Record<string, string>): unknown => {
  const values = collectDataValues(argv).map(readBodyValue)
  if (!values.length) return undefined
  const raw = values.join('&')
  const contentType = findHeader(headers, 'content-type')
  if (contentType?.toLowerCase().includes('json')) return parseJsonBody(raw)
  if (!contentType && looksLikeJson(raw)) {
    headers['Content-Type'] = 'application/json'
    return parseJsonBody(raw)
  }
  if (!contentType) headers['Content-Type'] = 'application/x-www-form-urlencoded'
  return raw
}

const buildQuery = (argv: ParsedArgv): Record<string, string | string[]> => {
  const params: Record<string, string | string[]> = {}
  for (const entry of optionValues(argv, 'query')) appendQueryEntry(params, entry)
  if (optionBoolean(argv, 'get')) {
    for (const value of collectDataValues(argv).map(readBodyValue)) appendQueryString(params, value)
  }
  return params
}

const resolveAuth = (ctx: CommandContext, target: string): boolean => {
  if (optionBoolean(ctx.argv, 'auth')) return true
  if (optionBoolean(ctx.argv, 'no-auth')) return false
  if (!isAbsoluteUrl(target)) return true
  return target.replace(/\/+$/, '').startsWith(ctx.config.baseUrl.replace(/\/+$/, ''))
}

const serializeBody = (data: unknown): string => {
  if (data === undefined) return ''
  if (typeof data === 'string') return data
  return JSON.stringify(data, null, 2)
}

const printResponse = (response: CoreRawResponse, argv: ParsedArgv): void => {
  if (optionBoolean(argv, 'silent')) return
  const output = optionString(argv, 'output')
  if (optionBoolean(argv, 'json')) {
    const envelope = {
      status: response.status,
      statusText: response.statusText,
      method: response.method,
      url: response.url,
      headers: response.headers,
      data: response.data
    }
    if (output) writeFileSync(output, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8')
    else printJson(envelope)
    return
  }

  if (optionBoolean(argv, 'include')) {
    console.log(`HTTP ${response.status} ${response.statusText}`.trim())
    for (const [key, value] of Object.entries(response.headers)) console.log(`${key}: ${value}`)
    console.log('')
  }

  const body = serializeBody(response.data)
  if (output) writeFileSync(output, body, 'utf8')
  else if (body && (optionBoolean(argv, 'raw') || typeof response.data === 'string')) console.log(body)
  else if (body) printJson(response.data)
}

export const runCurl = async (ctx: CommandContext): Promise<void> => {
  const curlArgs = ctx.argv.positionals.slice(1)
  if (optionBoolean(ctx.argv, 'help')) {
    console.log(curlHelp())
    return
  }

  let method = (optionString(ctx.argv, 'request') || optionString(ctx.argv, 'method') || '').toUpperCase()
  if (optionBoolean(ctx.argv, 'head')) method = 'HEAD'

  let target = curlArgs[0]
  if (isHttpMethod(target)) {
    method = target.toUpperCase()
    target = curlArgs[1]
  }
  if (!target) throw new CliError('micromeet curl requires a URL or API path')
  if (method && !httpMethods.has(method)) throw new CliError(`Unsupported HTTP method: ${method}`)

  const dataValues = collectDataValues(ctx.argv)
  const hasBodyInput = dataValues.length > 0
  if (!method) method = optionBoolean(ctx.argv, 'get') ? 'GET' : hasBodyInput ? 'POST' : 'GET'

  const headers = parseHeaders(optionValues(ctx.argv, 'header'))
  const params = buildQuery(ctx.argv)
  const body = optionBoolean(ctx.argv, 'get') ? undefined : buildBody(ctx.argv, headers)
  const timeout = optionNumber(ctx.argv, 'timeout', 0, { min: 0 })
  const response = await coreRawRequest(ctx.config, {
    method,
    pathOrUrl: target,
    headers,
    params,
    body,
    auth: resolveAuth(ctx, target),
    timeoutMs: timeout || undefined
  })

  printResponse(response, ctx.argv)
  if (optionBoolean(ctx.argv, 'fail') && response.status >= 400) {
    throw new CliError(`HTTP ${response.status}`, { exitCode: 22 })
  }
}
