import { fetch } from 'undici'
import { moduleLog } from '@main/logging/moduleLog'
import { assertFetchableUrl, narrowForLog } from '@main/net/fetchPolicy'
import { extractArticle, type ExtractedArticle } from '@main/net/articleExtract'

/**
 * `web_fetch` 的取页层:main 进程直连 HTTP,**不带 cookie、不跑 JS、不花钱**。
 *
 * 与 `deep_fetch` 的分工:这条便宜,拿到的是服务端给的初始 HTML;SPA / 需要登录的页面
 * 会拿回空壳,那时候才升级到 `deep_fetch`。设计见 docs/features/agent-web-fetch.md `#1`。
 *
 * 三个从 OpenCode 抄来的做法(`overmind:areas/websearch/research/opencode.json`):
 *   ① Accept 带 q 值优先要 markdown —— 文档站会直接给 markdown,省掉一次有损的 HTML 转换;
 *   ② 遇到 Cloudflare challenge 用**诚实的** UA 重试一次,而不是伪装得更像浏览器;
 *   ③ 字节上限在**解码之前**执法 —— content-length 可以撒谎或缺失。
 */

const flog = moduleLog('deep-fetch')

const MAX_BYTES = 8 * 1024 * 1024
const MAX_REDIRECTS = 5
const TIMEOUT_MS = 30_000

/** 与 `deep_fetch` 一致:两个工具都不接受调用方自定义 header(闸门 11)。 */
const BASE_HEADERS: Record<string, string> = {
  accept: 'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1',
  'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8',
  'accept-encoding': 'gzip, deflate'
}
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
/** TLS 指纹与伪装的 UA 对不上时,伪装比诚实更糟 —— 很多站点直接放行自报身份的 bot。 */
const HONEST_UA = 'MicromeetCowork (+https://micromeet.ai; agent web_fetch)'

export type WebFetchFailureKind =
  | 'policy'
  | 'not-found'
  | 'forbidden'
  | 'challenge'
  | 'too-large'
  | 'unsupported-type'
  | 'timeout'
  | 'network'
  | 'http'
  | 'extract'

export class WebFetchError extends Error {
  constructor(
    readonly kind: WebFetchFailureKind,
    message: string
  ) {
    super(message)
  }
}

export interface WebFetchResult {
  requestedUrl: string
  finalUrl: string
  contentType: string
  bytes: number
  redirects: number
  /** 直接拿到 markdown/纯文本时为 true —— 没经过 HTML 抽取。 */
  servedAsText: boolean
  article: ExtractedArticle
}

/** 解码前就停:一个撒谎或缺失的 content-length 不能把内存吃光。 */
const readBounded = async (res: any): Promise<{ buf: Buffer; truncated: boolean }> => {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    throw new WebFetchError('too-large', `the page declares ${(declared / 1024 / 1024).toFixed(1)} MB, over the ${MAX_BYTES / 1024 / 1024} MB limit`)
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of res.body as any) {
    const buf = Buffer.from(chunk)
    total += buf.length
    if (total > MAX_BYTES) {
      // 中途放弃并如实说,而不是把已收到的部分当完整页面交出去。
      try {
        res.body?.destroy?.()
      } catch {
        /* 流已经关了 */
      }
      throw new WebFetchError('too-large', `the page exceeded the ${MAX_BYTES / 1024 / 1024} MB limit while downloading`)
    }
    chunks.push(buf)
  }
  return { buf: Buffer.concat(chunks), truncated: false }
}

const isChallenge = (status: number, headers: any, body: string): boolean => {
  if (status === 403 && String(headers.get('cf-mitigated') || '').includes('challenge')) return true
  return /anomaly-modal|challenge-form|cf-browser-verification|Just a moment\.\.\./.test(body.slice(0, 4000))
}

export const fetchWebPage = async (rawUrl: string, maxChars: number, signal?: AbortSignal): Promise<WebFetchResult> => {
  signal?.throwIfAborted()
  const startedAt = Date.now()
  const start = assertFetchableUrl(rawUrl) // 抛 FetchPolicyError,调用方翻译
  let current = start
  let redirects = 0
  let usedHonestUa = false

  for (;;) {
    let res: any
    try {
      res = await fetch(current, {
        method: 'GET',
        // 手动跟随:每一跳都要重新过目的地策略,否则一个 302 就能把请求带进私网。
        redirect: 'manual',
        headers: { ...BASE_HEADERS, 'user-agent': usedHonestUa ? HONEST_UA : CHROME_UA },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS)
      })
    } catch (err) {
      signal?.throwIfAborted()
      const name = (err as Error)?.name
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new WebFetchError('timeout', `the page did not respond within ${TIMEOUT_MS / 1000}s`)
      }
      throw new WebFetchError('network', `could not reach the page: ${(err as Error).message}`)
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new WebFetchError('http', `HTTP ${res.status} with no Location header`)
      if (++redirects > MAX_REDIRECTS) throw new WebFetchError('http', `too many redirects (${MAX_REDIRECTS} max)`)
      // 相对 Location 按当前 URL 解析,然后**重新过一遍闸门**。
      const next = new URL(location, current).toString()
      try {
        current = assertFetchableUrl(next)
      } catch (err) {
        flog.warn(`web_fetch blocked redirect`, { tool: 'web_fetch', to: narrowForLog(next), reason: (err as Error).message })
        throw err
      }
      continue
    }

    const contentType = String(res.headers.get('content-type') || '').toLowerCase()
    const { buf } = await readBounded(res)
    const body = buf.toString('utf8')

    if (isChallenge(res.status, res.headers, body)) {
      if (!usedHonestUa) {
        // 一次机会:换成自报身份的 UA 重试(OpenCode 的做法),不是换个更像浏览器的假 UA。
        flog.info(`web_fetch challenged, retrying with an honest UA`, { tool: 'web_fetch', url: narrowForLog(current.toString()) })
        usedHonestUa = true
        continue
      }
      throw new WebFetchError('challenge', 'the site served an anti-bot challenge instead of the page')
    }

    if (res.status === 404 || res.status === 410) throw new WebFetchError('not-found', `the page does not exist (HTTP ${res.status})`)
    if (res.status === 401 || res.status === 403) {
      throw new WebFetchError('forbidden', `access denied (HTTP ${res.status}) — the page may need a signed-in session`)
    }
    if (res.status >= 400) throw new WebFetchError('http', `HTTP ${res.status} from the page`)

    // 二进制一律不接:PDF/图片/压缩包应该走 read_file(下载后本地解析)那条路,不是这里。
    if (/^(image|audio|video|font)\//.test(contentType) || /(pdf|zip|octet-stream|msword|excel|sheet)/.test(contentType)) {
      throw new WebFetchError(
        'unsupported-type',
        `this is a ${contentType.split(';')[0] || 'binary'} file, not a web page — download it and use read_file instead`
      )
    }

    const servedAsText = /text\/(markdown|x-markdown|plain)/.test(contentType)
    const finalUrl = current.toString()
    /** 每次取页**恰好一条**成功行。失败由工具层统一记(见 webFetchTools),免得同一次失败记两遍。 */
    const logOk = (article: { text: string; fullLength: number; fallback: boolean }): void => {
      flog.info(`web_fetch ok ${narrowForLog(start.toString())}`, {
        tool: 'web_fetch',
        // requested 与 final 都记:重定向可能换了源,只记一个等于记错。
        requested: narrowForLog(start.toString()),
        final: narrowForLog(finalUrl),
        redirects,
        contentType: contentType.split(';')[0] || '',
        bytes: buf.length,
        chars: article.text.length,
        fullChars: article.fullLength,
        fallback: article.fallback,
        servedAsText,
        honestUaRetry: usedHonestUa,
        ms: Date.now() - startedAt
      })
    }
    if (servedAsText) {
      const text = body.replace(/\r/g, '').trim()
      const article = {
        title: '',
        byline: null,
        publishedTime: null,
        siteName: null,
        text: text.length > maxChars ? text.slice(0, maxChars) : text,
        truncated: text.length > maxChars,
        fullLength: text.length,
        fallback: false
      }
      logOk(article)
      return {
        requestedUrl: start.toString(),
        finalUrl,
        contentType,
        bytes: buf.length,
        redirects,
        servedAsText: true,
        article
      }
    }

    const article = extractArticle(body, finalUrl, maxChars)
    logOk(article)
    return {
      requestedUrl: start.toString(),
      finalUrl,
      contentType,
      bytes: buf.length,
      redirects,
      servedAsText: false,
      article
    }
  }
}
