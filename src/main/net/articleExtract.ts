import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'

/**
 * HTML → 正文。`web_fetch`(HTTP 拿到的 HTML)与 `deep_fetch`(渲染后的 outerHTML)**共用这一段**。
 *
 * 为什么用 Readability 而不是 `innerText`:现代页面的 `innerText` 出来是导航 + cookie 横幅 +
 * 页脚的汤,正文占比常常不到三成。Readability 是浏览器阅读模式的那套启发式,直接给文章主体。
 * 既有用法参考 `projects/bitterless` 的 `searchWeb.skill.ts`(同一对依赖)。
 *
 * ⚠️ **这里解析的是攻击者控制的 HTML**,跑在 main 进程里。所以尺寸闸门在**解析之前**
 * (`docs/features/agent-web-fetch.md` `DWF3`)—— 解析完再限长就已经把 OOM/ReDoS 的代价付掉了。
 */

/** 解析前的硬上限。超过就拒,不截断后再解析 —— 截断的 HTML 会让解析器走进更奇怪的分支。 */
export const MAX_HTML_BYTES = 2 * 1024 * 1024

/** 低于这个长度就认为 Readability 没识别出文章主体(它自己的 charThreshold 也是这个量级)。 */
const MIN_ARTICLE_CHARS = 200

export interface ExtractedArticle {
  title: string
  byline: string | null
  publishedTime: string | null
  siteName: string | null
  /** 正文纯文本(已按 maxChars 截断)。 */
  text: string
  truncated: boolean
  /** 原始正文字符数(截断前),让调用方能如实说「读了多少分之多少」。 */
  fullLength: number
  /** Readability 没能识别出文章主体时为 true —— 此时 text 是整页文本的兜底。 */
  fallback: boolean
}

export class ExtractError extends Error {
  constructor(
    readonly reason: 'too-large' | 'empty' | 'parse-failed',
    message: string
  ) {
    super(message)
  }
}

const squeeze = (s: string): string =>
  String(s ?? '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/**
 * @param html 完整 HTML 文档
 * @param baseUrl 用于把相对链接解析成绝对链接(Readability 需要它,否则链接全丢)
 */
export const extractArticle = (html: string, baseUrl: string, maxChars: number): ExtractedArticle => {
  if (!html || !html.trim()) throw new ExtractError('empty', 'the page returned no HTML')
  // Buffer.byteLength 而不是 .length:2MB 的判据是**字节**,而 CJK 页面一个字符占 3 字节 ——
  // 按字符数放行会让一个 6MB 的中文页面通过。
  const bytes = Buffer.byteLength(html, 'utf8')
  if (bytes > MAX_HTML_BYTES) {
    throw new ExtractError(
      'too-large',
      `the page is ${(bytes / 1024 / 1024).toFixed(1)} MB of HTML, over the ${MAX_HTML_BYTES / 1024 / 1024} MB limit`
    )
  }

  let document: any
  try {
    ;({ document } = parseHTML(html))
  } catch (err) {
    throw new ExtractError('parse-failed', `could not parse the page: ${(err as Error).message}`)
  }
  if (!document?.documentElement) {
    // linkedom 的 head/body getter 在没有根节点时会抛 TypeError。
    throw new ExtractError('parse-failed', 'the page has no HTML document element')
  }

  // Readability 靠 baseURI 解析相对链接;linkedom 不从 HTML 推断它,所以显式注入一个 <base>。
  // 少了这步,文章里的链接会变成无法回访的相对路径。
  try {
    if (!document.querySelector('base') && document.head) {
      const base = document.createElement('base')
      base.setAttribute('href', baseUrl)
      document.head.insertBefore(base, document.head.firstChild)
    }
  } catch {
    // 没有 head 的畸形文档 —— 不致命,链接可能是相对的,继续。
  }

  let parsed: any = null
  try {
    // Readability 会**改写传入的 document**(设计如此),我们不复用这个 document,所以无妨。
    parsed = new Readability(document, { charThreshold: 200 }).parse()
  } catch {
    parsed = null
  }

  const articleText = squeeze(parsed?.textContent ?? '')
  const fallbackText = squeeze(document?.body?.textContent ?? '')

  /**
   * Readability 对列表页/看板/首页这类「没有文章主体」的页面会返回 null 或很短的结果 ——
   * 那不是失败,是页面本来就不是文章。
   *
   * **「有没有识别出正文」与「用哪段文本」是两个独立判断**,不能合成一个条件:
   * 合成之后,一个短页面上两段文本恰好相同,`fallback` 就不会被标记,于是模型被告知
   * 它看到的是正文 —— 而它看到的其实是导航加一个 div。所以这里先判有没有正文(它决定
   * 回执怎么说),再判用哪段(它只决定内容)。
   */
  const noArticle = !parsed || articleText.length < MIN_ARTICLE_CHARS
  const chosen = noArticle && fallbackText.length > articleText.length ? fallbackText : articleText
  const useFallback = noArticle

  if (!chosen) throw new ExtractError('empty', 'the page has no readable text (it may be an app shell or a login wall)')

  return {
    title: squeeze(parsed?.title ?? document?.title ?? ''),
    byline: parsed?.byline ? squeeze(parsed.byline) : null,
    publishedTime: parsed?.publishedTime ?? null,
    siteName: parsed?.siteName ? squeeze(parsed.siteName) : null,
    text: chosen.length > maxChars ? chosen.slice(0, maxChars) : chosen,
    truncated: chosen.length > maxChars,
    fullLength: chosen.length,
    fallback: useFallback
  }
}
