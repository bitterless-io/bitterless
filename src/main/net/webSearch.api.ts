import { fetch } from 'undici'
import { customerSessionService, revalidateRejectedCustomerSession } from '@main/auth/customerSession.service'

/**
 * `web_search` 的 Core 客户端。
 *
 * **应用里没有任何搜索厂商的 key** —— Exa 的凭据只在服务端(bitterless-private `apps/core`
 * 的 `search` 模块),这里只带登录态。鉴权走 Bitterless 自己的登录:
 * Core 读 `-x-bl-token` 头(不是 Authorization),token 由渲染层登录成功后经 xpc 推给主进程
 * (`customerSession.service.ts`)。契约见 bitterless-private `docs/features/relay-web-search.md`。
 *
 * 请求体与响应与 micromeet relay 的 `/v1/search/web` 逐字一致,差别只在鉴权方式与路径前缀。
 */

const TOKEN_HEADER = '-x-bl-token'

/**
 * 应用侧超时下限的**不变式**:必须大于服务端最坏耗时
 * = `EXA_TIMEOUT_MS`(默认 20s)+ 闸门读库 + 余量。45s 满足且有富余。
 */
const REQUEST_TIMEOUT_MS = 45_000

/**
 * 默认值**显式发送,不继承服务端默认**:服务端的 `SEARCH_DEFAULTS` 是运维旋钮,
 * 它一动就会改变应用这边按这两个数算出来的上下文预算。
 */
export const WEB_SEARCH_DEFAULT_RESULTS = 8
export const WEB_SEARCH_DEFAULT_MAX_CHARS = 1200

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.trunc(value)))

export interface WebSearchApiResult {
  rank: number
  title: string
  url: string
  domain: string
  published_at: string | null
  author: string | null
  snippet: string
  truncated: boolean
}

export interface WebSearchApiResponse {
  query: string
  provider: string
  results: WebSearchApiResult[]
  empty: boolean
  cost_micro_usd: number
  latency_ms: number
}

/** 工具层要按 kind 分流成不同的模型可读文本,所以失败必须是**类型化**的,不是一个字符串。 */
export type WebSearchFailureKind =
  | 'not-signed-in'
  | 'not-deployed'
  | 'unavailable'
  | 'rate-limited'
  | 'budget-exhausted'
  | 'upstream'
  | 'timeout'
  | 'network'
  | 'bad-request'

export class WebSearchError extends Error {
  constructor(
    readonly kind: WebSearchFailureKind,
    message: string,
    readonly retryAfterMs?: number
  ) {
    super(message)
  }
}

export interface WebSearchApiParams {
  query: string
  numResults?: number
  maxChars?: number
  includeDomains?: string[]
  excludeDomains?: string[]
  publishedAfter?: string
  /** 调用方(工具层)算出的有效期限。省略则用 REQUEST_TIMEOUT_MS。 */
  timeoutMs?: number
  signal?: AbortSignal
}

export const searchWebThroughCore = async (params: WebSearchApiParams): Promise<WebSearchApiResponse> => {
  const session = customerSessionService.current
  if (!session) {
    throw new WebSearchError('not-signed-in', 'web search needs you to be signed in to Bitterless')
  }
  const query = String(params.query || '').trim()
  if (!query) throw new WebSearchError('bad-request', 'web_search needs a "query"')

  // 数值一律在这里收敛后再上线:模型可能传字符串 "6",而服务端 DTO 用 `@IsInt()` 校验
  // `plainToInstance` 的产物 —— 一个字符串会换来一条应用侧没有对应分支的裸 400。
  const body: Record<string, unknown> = {
    query,
    num_results: clamp(Number(params.numResults) || WEB_SEARCH_DEFAULT_RESULTS, 1, 10),
    max_chars: clamp(Number(params.maxChars) || WEB_SEARCH_DEFAULT_MAX_CHARS, 200, 3000)
  }
  if (params.includeDomains?.length) body.include_domains = params.includeDomains
  if (params.excludeDomains?.length) body.exclude_domains = params.excludeDomains
  if (params.publishedAfter) body.start_published_date = params.publishedAfter

  const deadlineMs = params.timeoutMs && params.timeoutMs > 0 ? params.timeoutMs : REQUEST_TIMEOUT_MS
  let res: Awaited<ReturnType<typeof fetch>>
  try {
    res = await fetch(`${session.baseUrl}/search/web`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        [TOKEN_HEADER]: session.token
      },
      body: JSON.stringify(body),
      // 应用侧超时必须**长于**服务端的 20s,否则请求在后台跑完(并照样计费)而模型已判它失败。
      signal: params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(deadlineMs)]) : AbortSignal.timeout(deadlineMs)
    })
  } catch (err) {
    params.signal?.throwIfAborted()
    const name = (err as Error)?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new WebSearchError('timeout', `the search request timed out after ${Math.round(deadlineMs / 1000)}s`)
    }
    throw new WebSearchError('network', `could not reach the search service: ${(err as Error).message}`)
  }

  const raw = await res.text()
  let parsed: any = {}
  try {
    parsed = raw ? JSON.parse(raw) : {}
  } catch {
    parsed = {}
  }

  // 401 是**这台服务器不认这个 token**(过期/被吊销),与"搜索失败"完全不同 ——
  // 重试解决不了,得让用户重新登录。
  if (res.status === 401) {
    await revalidateRejectedCustomerSession(session)
    throw new WebSearchError('not-signed-in', 'your Bitterless session has expired')
  }
  // 老版本 Core 没有这条路由 —— 必须与「搜索失败」区分开,否则模型会一直重试一个不存在的端点。
  if (res.status === 404) {
    throw new WebSearchError('not-deployed', 'this server does not have web search yet (Core has not been updated)')
  }
  if (res.status === 503 || parsed?.code === 'search_unavailable') {
    throw new WebSearchError('unavailable', 'web search is not configured on this server')
  }
  if (parsed?.code === 'budget_exhausted') {
    throw new WebSearchError('budget-exhausted', String(parsed.message || 'the web-search budget is used up'))
  }
  if (parsed?.code === 'rate_limited') {
    throw new WebSearchError('rate-limited', 'the search provider is rate limiting', Number(parsed.retry_after_ms) || undefined)
  }
  if (parsed?.code === 'upstream_error' || parsed?.code === 'unauthorized') {
    throw new WebSearchError('upstream', String(parsed.message || 'the search provider returned an error'))
  }
  // 参数被服务端 DTO 拒掉:把约束消息原样带给模型,让它自己改参数重试。
  if (res.status === 400) {
    const detail = String(parsed?.message || '').slice(0, 200)
    throw new WebSearchError('bad-request', detail ? `the search service rejected a parameter: ${detail}` : 'the search service rejected a parameter')
  }
  if (!res.ok) {
    throw new WebSearchError('upstream', `search failed with HTTP ${res.status}`)
  }

  return {
    query: String(parsed.query ?? query),
    provider: String(parsed.provider ?? 'unknown'),
    results: Array.isArray(parsed.results) ? parsed.results : [],
    empty: Boolean(parsed.empty),
    cost_micro_usd: Number(parsed.cost_micro_usd) || 0,
    latency_ms: Number(parsed.latency_ms) || 0
  }
}
