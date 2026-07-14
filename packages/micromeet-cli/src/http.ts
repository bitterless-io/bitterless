import { requireToken } from './config'
import { CliError } from './errors'
import type { RuntimeConfig } from './types'
import axios from 'axios'

interface WrappedResponse<T> {
  code?: number
  message?: string
  data?: T
}

interface ErrHelperEnvelope {
  code?: string
  msg?: string
  message?: string
  success?: false
}

export interface CoreRawRequest {
  method: string
  pathOrUrl: string
  body?: unknown
  headers?: Record<string, string>
  params?: Record<string, string | string[]>
  auth?: boolean
  timeoutMs?: number
}

export interface CoreRawResponse<T = unknown> {
  status: number
  statusText: string
  headers: Record<string, string>
  data: T
  url: string
  method: string
}

export interface CoreRequestOptions {
  headers?: Record<string, string>
  params?: Record<string, string | string[]>
  auth?: boolean
  timeoutMs?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const isErrHelperEnvelope = (payload: unknown): payload is ErrHelperEnvelope => {
  if (!isRecord(payload)) return false
  return typeof payload.code === 'string' || payload.success === false
}

const unwrapPayload = <T>(payload: unknown, status: number, ok: boolean): T => {
  if (isErrHelperEnvelope(payload)) {
    throw new CliError(payload.msg || payload.message || 'Request failed', {
      code: payload.code,
      exitCode: status === 401 ? 2 : 1
    })
  }
  if (isRecord(payload) && ('code' in payload || 'data' in payload)) {
    const wrapped = payload as WrappedResponse<T>
    if (!ok || (wrapped.code !== undefined && wrapped.code !== 0)) {
      throw new CliError(wrapped.message || 'Request failed', {
        code: wrapped.code,
        exitCode: status === 401 ? 2 : 1
      })
    }
    return wrapped.data as T
  }
  if (!ok) {
    const message = isRecord(payload)
      ? Array.isArray(payload.message)
        ? payload.message.map(String).join('; ')
        : typeof payload.message === 'string'
          ? payload.message
          : `HTTP ${status}`
      : `HTTP ${status}`
    throw new CliError(message, { exitCode: status === 401 ? 2 : 1 })
  }
  return payload as T
}

const isAbsoluteUrl = (value: string): boolean => /^https?:\/\//i.test(value)

const buildUrl = (config: RuntimeConfig, pathOrUrl: string): string => {
  if (isAbsoluteUrl(pathOrUrl)) return pathOrUrl
  return new URL(pathOrUrl.replace(/^\/+/, ''), `${config.baseUrl}/`).toString()
}

const normalizeHeaders = (headers: unknown): Record<string, string> => {
  if (!isRecord(headers)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) out[key] = value.map(String).join(', ')
    else if (value !== undefined) out[key] = String(value)
  }
  return out
}

const hasHeader = (headers: Record<string, string>, name: string): boolean => {
  const lower = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === lower)
}

const isJsonBody = (body: unknown): boolean => isRecord(body) || Array.isArray(body)

export const coreRawRequest = async <T = unknown>(
  config: RuntimeConfig,
  request: CoreRawRequest
): Promise<CoreRawResponse<T>> => {
  const token = request.auth === false ? undefined : requireToken(config)
  const url = buildUrl(config, request.pathOrUrl)
  const authHeaders: Record<string, string> =
    request.auth === false
      ? {}
      : {
          Authorization: `Bearer ${token}`,
          'x-region': config.region,
          lang: 'en'
        }
  if (request.auth !== false && config.workspaceId) authHeaders['x-workspace-id'] = config.workspaceId
  const headers: Record<string, string> = {
    ...authHeaders,
    ...(request.headers || {})
  }
  if (request.body !== undefined && isJsonBody(request.body) && !hasHeader(headers, 'content-type')) {
    headers['Content-Type'] = 'application/json'
  }

  try {
    const res = await axios.request<T>({
      url,
      method: request.method,
      headers,
      params: request.params,
      data: request.body,
      timeout: request.timeoutMs,
      validateStatus: () => true
    })
    return {
      status: res.status,
      statusText: res.statusText,
      headers: normalizeHeaders(res.headers),
      data: res.data,
      url,
      method: request.method.toUpperCase()
    }
  } catch (err) {
    if (axios.isAxiosError(err)) {
      throw new CliError(err.message, { code: err.code })
    }
    throw err
  }
}

export const coreRequest = async <T>(
  config: RuntimeConfig,
  method: string,
  path: string,
  body?: unknown,
  options: CoreRequestOptions = {}
): Promise<T> => {
  const res = await coreRawRequest<unknown>(config, {
    method,
    pathOrUrl: path,
    body,
    params: options.params,
    auth: options.auth,
    timeoutMs: options.timeoutMs,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  })
  return unwrapPayload<T>(res.data, res.status, res.status >= 200 && res.status < 300)
}

export const corePost = async <T>(
  config: RuntimeConfig,
  path: string,
  body: unknown = {},
  options: CoreRequestOptions = {}
): Promise<T> => coreRequest<T>(config, 'POST', path, body ?? {}, options)

export const coreGet = async <T>(
  config: RuntimeConfig,
  path: string,
  params?: Record<string, string | string[]>,
  options: CoreRequestOptions = {}
): Promise<T> => coreRequest<T>(config, 'GET', path, undefined, { ...options, params })
