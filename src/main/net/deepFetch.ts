import { BrowserWindow, session, type WebContents } from 'electron'
import { moduleLog } from '@main/logging/moduleLog'
import { assertFetchableUrl, narrowForLog } from '@main/net/fetchPolicy'
import { extractArticle, MAX_HTML_BYTES, type ExtractedArticle } from '@main/net/articleExtract'
import { DebuggerCapture } from '@main/maestro/capture/debuggerCapture'

/**
 * `deep_fetch` —— 用临时浏览器载体打开网页、等 JS 渲染完,再读结果。
 *
 * 三件事决定了这个文件的形状,设计与依据见 docs/features/agent-web-fetch.md `#2`/`#3`:
 *
 * ① **不依赖外部 Chrome**(Ral 2026-09-02)。用的是 Electron 自带的 Chromium 与自带的 CDP,
 *    没有 puppeteer / playwright / 外部浏览器二进制。
 * ② **和主浏览器同 session**,所以能读登录后的页面 —— session 从
 *    `browserTargetFor(resolveBrowserProfile(url))` 取,与操作 tab 完全同一条解析路径。
 * ③ **绝不走 `BLBaseWindow`**。基类恒定挂 preload,而那个 preload 会把 `window.xpcRenderer`
 *    暴露给页面(配上「XPC 无 sender 校验」= 把主进程 handler 面交给任意网页);它的
 *    `setWindowOpenHandler` 还会 `shell.openExternal` 任意 scheme。这里照
 *    `artifactWriter.service.ts` 的 `renderPdfBuffer` 写:裸窗口、**无 preload**、`finally` destroy。
 */

const dlog = moduleLog('deep-fetch')

const SETTLE_MS = 1400
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_REDIRECTS = 5

/**
 * 哪些 webContents 属于 deep_fetch。用 WeakSet 而不是 id 集合 —— 窗口销毁后自动清掉,
 * 不会有一个复用的 id 让别人的 webContents 意外命中「deep_fetch」这条最严格的分支。
 */
const deepFetchContents = new WeakSet<WebContents>()
export const isDeepFetchContents = (wc?: WebContents | null): boolean => !!wc && deepFetchContents.has(wc)

/**
 * 权限处理器:**session 级控制是单槽的**(装第二个会顶掉第一个),而 deep_fetch 与操作 tab
 * 共用 session,所以这里必须一次装好、对两类调用者都给出答案:
 *   · deep_fetch 的 webContents → 一律拒
 *   · 其他人 → **复现今天的行为**(Electron 默认自动批准全部)
 *
 * ⚠️ 本仓在此之前**全局没有任何权限处理器**(`grep setPermissionRequestHandler` 命中 0),
 * 也就是说操作 tab 今天就在自动获批 clipboard-read / media / openExternal / fileSystem。
 * 这不是 deep_fetch 引入的问题,但 deep_fetch 会让它变成 agent 可触发,所以必须先补上这道闸。
 * 收紧操作 tab 的权限是另一件事,不在本次范围 —— 那需要 Ral 决定拒哪些。
 */
const permissionedPartitions = new Set<string>()
const installPermissionHandlers = (target: Electron.Session, key: string): void => {
  if (permissionedPartitions.has(key)) return
  permissionedPartitions.add(key)
  target.setPermissionRequestHandler((wc, permission, callback) => {
    if (isDeepFetchContents(wc)) {
      dlog.warn(`deep_fetch permission denied`, { tool: 'deep_fetch', permission })
      return callback(false)
    }
    callback(true) // 操作 tab:与今天(无处理器 = 全批)一字不差
  })
  target.setPermissionCheckHandler((wc, permission) => {
    // 同步检查路径不经过上面那个 handler,必须单独拦;跨源子框架时 wc 可能是 null。
    if (isDeepFetchContents(wc)) {
      dlog.warn(`deep_fetch permission check denied`, { tool: 'deep_fetch', permission })
      return false
    }
    return true
  })
}

export type DeepFetchFailureKind = 'policy' | 'timeout' | 'load-failed' | 'extract' | 'crashed' | 'busy'

export class DeepFetchError extends Error {
  constructor(
    readonly kind: DeepFetchFailureKind,
    message: string
  ) {
    super(message)
  }
}

export interface DeepFetchResult {
  requestedUrl: string
  /** 实际落点 —— 重定向可能把它换成了另一个源,回执必须如实报告。 */
  finalUrl: string
  article: ExtractedArticle
  /** 无障碍树快照(YAML),来自既有的 `DebuggerCapture.snapshot`。拿不到时为 null。 */
  snapshotYaml: string | null
  snapshotNodes: number
  /** 页面 HTML 过大、走了整页文本兜底。 */
  htmlTooLarge: boolean
}

/** 页内脚本:**我们自己写的字面量**,不是页面提供的代码。只读,不改页面。 */
const READ_PAGE_SRC = (htmlCap: number, textCap: number) => `(function () {
  var el = document.documentElement;
  var html = el ? el.outerHTML : '';
  var body = document.body;
  return {
    htmlLength: html.length,
    // 超过上限就**不带回来** —— 截断的 HTML 交给解析器只会走进更奇怪的分支。
    html: html.length <= ${htmlCap} ? html : '',
    title: document.title || '',
    textFallback: ((body && body.innerText) || '').slice(0, ${textCap})
  };
})()`

/** 单飞:一次只允许一个 deep_fetch 在跑。隐藏渲染进程堆积是这条路最现实的资源风险。 */
let inFlight: Promise<unknown> | null = null

/**
 * deep_fetch 用来渲染页面的**载体**。
 *
 * 2026-09-11 由 Ral 改成真实 tab(原来是 `new BrowserWindow({ show: false })`):
 *   · **共用浏览器 session** —— 内置浏览器登录过的站点直接可读,不必再登一次;
 *   · **看得见** —— 页面在 tab 里渲染,配合 chip 上的动画,人知道 agent 正在动哪一个。
 *
 * 代价写明白:真实 tab 用的是浏览器 tab 的常规配置(有 preload、有注入按钮那一套),
 * 不再是原来那个 `sandbox + contextIsolation + 无 preload` 的隔离窗口。这不是新增的暴露面 ——
 * 任何一个用户自己打开的页面本来就是这个配置 —— 但它确实**不再比普通 tab 更严**,
 * 所以 URL 闸(fetchPolicy)、权限拒绝、window.open 拒绝、下载拒绝这几道仍然一条不少地留着。
 */
export interface DeepFetchSurface {
  /**
   * 开一个**空白的**受控 tab 并返回它的 webContents。
   *
   * **必须是空白的**:下面几道 handler(重定向闸、window.open 拒绝、下载拒绝)都必须装在
   * `loadURL` 之前 —— 由载体顺手导航会让第一跳绕过全部闸门。
   *
   * `url` 只用来让 chip 先有个占位(cowork 那边还用它挑 session profile),不许拿它导航。
   */
  open(url: string): Promise<{ wc: WebContents; done: () => Promise<void> }>
}

export const deepFetchPage = async (
  rawUrl: string,
  maxChars: number,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  surface?: DeepFetchSurface
): Promise<DeepFetchResult> => {
  if (inFlight) throw new DeepFetchError('busy', 'another deep_fetch is still running — wait for it to finish')
  const startedAt = Date.now()
  const run = (async (): Promise<DeepFetchResult> => {
    const start = assertFetchableUrl(rawUrl)
    /**
     * **开始行是必须的**,不是可选的:deep_fetch 会开一个渲染进程、最长跑 timeoutMs,
     * 而它挂住时成功行永远不会出现 —— 那时日志里唯一能证明"它确实开始了"的就是这一行。
     */
    dlog.info(`deep_fetch start ${narrowForLog(start.toString())}`, {
      tool: 'deep_fetch',
      requested: narrowForLog(start.toString()),
      timeoutMs
    })
    /**
     * **bl 移植说明**:cowork 那边按 host 解析 browser profile(`browserTargetFor(resolveBrowserProfile(url))`),
     * 为的是和它的操作 tab 走同一条 session 解析路径。bl 没有 per-host profile 这套东西,
     * 所以直接用默认 session —— `deep_fetch` 的价值(**用用户自己的登录态渲染**)靠的就是它。
     */
    const sess = session.defaultSession
    installPermissionHandlers(sess, 'default')

    /**
     * 载体二选一(见 DeepFetchSurface):
     *   · 给了 surface → **真实 tab**,与浏览器共用 session(登录过的站点直接可读),人看得见;
     *   · 没给 → 退回隐藏窗口。保留这条不是为了兼容,是为了**没有窗口可用时仍能工作**
     *     (主窗口还没建、或调用方就是不想动用户的 tab 条)。
     */
    let closeSurface: (() => Promise<void>) | null = null
    let win: BrowserWindow | null = null
    let wc: WebContents
    if (surface) {
      const opened = await surface.open(start.toString())
      wc = opened.wc
      closeSurface = opened.done
    } else {
      win = new BrowserWindow({
        show: false,
        webPreferences: {
          // 无 preload —— 这一行是隐藏窗口这条路上最重要的安全属性(见文件头 ③)。
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInSubFrames: false,
          webviewTag: false,
          // 同源策略**必须开着**:关掉它,页面就能读你已登录站点的响应体。
          webSecurity: true,
          allowRunningInsecureContent: false,
          // 正确性而非安全:show:false 的窗口会被后台节流,JS 页面永远 settle 不了。
          backgroundThrottling: false
        }
      })
      wc = win.webContents
    }
    deepFetchContents.add(wc)

    let redirects = 0
    const onWillDownload = (event: Electron.Event, _item: Electron.DownloadItem, from: WebContents): void => {
      // 只拦自己这个窗口 —— 既有的 downloadGuard 只在**录制期间**拦,不录制时下载会静默落盘。
      if (from === wc) {
        event.preventDefault()
        dlog.warn('deep_fetch download blocked', { tool: 'deep_fetch', note: 'downloadGuard only blocks while recording, so this listener is the one that matters' })
      }
    }

    /**
     * **超时也必须关掉窗口** —— Ral 2026-09-02:「查完关闭进程并设超时,超时也要关闭进程防止
     * 异常导致进程爆炸」。
     *
     * 所以这里是一条**总墙钟**,覆盖 加载 + settle + 抽取 + 快照 的全过程,而不是只竞速加载:
     * 抽取或 CDP 快照挂住时,只竞速加载的写法会让渲染进程永久留着 —— 而且单飞标志永不释放,
     * 之后每次 deep_fetch 都返回 busy。计时器一响就先 destroy 窗口,再让 promise 失败。
     */
    let killTimer: NodeJS.Timeout | undefined
    const cleanup = (): void => {
      if (killTimer) clearTimeout(killTimer)
      try {
        sess.removeListener('will-download', onWillDownload as never)
      } catch {
        /* session 可能已经没了 */
      }
      deepFetchContents.delete(wc)
      // tab 这条路由载体收尾(取消受控标记 + 关 tab);隐藏窗口这条自己销毁。
      if (closeSurface) void closeSurface().catch(() => undefined)
      else if (win && !win.isDestroyed()) win.destroy()
    }

    try {
      sess.on('will-download', onWillDownload as never)
      // 必须在 loadURL 之前:没有 handler 时 window.open 会真的弹出一个可见窗口。
      wc.setWindowOpenHandler(() => ({ action: 'deny' }))
      wc.on('will-redirect', (event, url) => {
        if (++redirects > MAX_REDIRECTS) {
          event.preventDefault()
          return
        }
        try {
          assertFetchableUrl(url) // 每一跳重查:一个 302 就能把请求带进私网或换成别的 scheme
        } catch {
          dlog.warn(`deep_fetch blocked redirect`, { tool: 'deep_fetch', to: narrowForLog(url), redirects })
          event.preventDefault()
        }
      })

      const deadline = new Promise<never>((_resolve, reject) => {
        killTimer = setTimeout(() => {
          // 先杀窗口:超时的本意就是别让它继续占着渲染进程。
          if (closeSurface) void closeSurface().catch(() => undefined)
          else if (win && !win.isDestroyed()) win.destroy()
          dlog.warn(`deep_fetch timed out — window destroyed`, {
            tool: 'deep_fetch',
            requested: narrowForLog(start.toString()),
            timeoutMs,
            ms: Date.now() - startedAt
          })
          reject(new DeepFetchError('timeout', `the page did not finish within ${timeoutMs / 1000}s`))
        }, timeoutMs)
      })

      const loaded = new Promise<void>((resolve, reject) => {
        wc.once('did-finish-load', () => resolve())
        wc.once('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
          // 子资源失败不算失败 —— 只有主框架加载不出来才是。
          if (isMainFrame) reject(new DeepFetchError('load-failed', `could not load the page (${desc || code})`))
        })
        wc.once('render-process-gone', (_e, details) => {
          if (details.reason !== 'clean-exit') reject(new DeepFetchError('crashed', `the page crashed the renderer (${details.reason})`))
        })
      })
      const doWork = async (): Promise<DeepFetchResult> => {
        await wc
          .loadURL(start.toString())
          .then(() => loaded)
          .catch((err) => {
            if (err instanceof DeepFetchError) throw err
            throw new DeepFetchError('load-failed', `could not load the page: ${(err as Error).message}`)
          })

        // 固定 settle:did-finish-load 只保证主文档到位,SPA 的首屏数据往往还在飞。
        await new Promise((r) => setTimeout(r, SETTLE_MS))

        const finalUrl = wc.getURL() || start.toString()
        const page = (await wc.executeJavaScriptInIsolatedWorld(1, [
          { code: READ_PAGE_SRC(MAX_HTML_BYTES, maxChars * 2) }
        ])) as { htmlLength: number; html: string; title: string; textFallback: string }

        // 快照是**附加值**,不是主产物 —— 它失败不能拖垮整次取页。
        let snapshotYaml: string | null = null
        let snapshotNodes = 0
        try {
          const cap = new DebuggerCapture(
            wc,
            () => undefined, // 不往 capture 会话里 emit 任何事件:这不是一次录制
            () => false // 永不截图
          )
          await cap.attach()
          const snap = await cap.snapshot({ shot: false })
          if (snap.ok) {
            snapshotYaml = snap.yaml
            snapshotNodes = snap.nodeCount
          }
        } catch (err) {
          dlog.warn(`deep_fetch snapshot unavailable`, { tool: 'deep_fetch', reason: (err as Error).message })
        }

        const htmlTooLarge = !page.html && page.htmlLength > 0
        const article = htmlTooLarge
          ? {
              title: page.title,
              byline: null,
              publishedTime: null,
              siteName: null,
              text: page.textFallback.slice(0, maxChars),
              truncated: page.textFallback.length > maxChars,
              fullLength: page.textFallback.length,
              fallback: true
            }
          : extractArticle(page.html, finalUrl, maxChars)

        dlog.info(`deep_fetch ok ${narrowForLog(finalUrl)}`, {
          tool: 'deep_fetch',
          requested: narrowForLog(start.toString()),
          final: narrowForLog(finalUrl),
          redirects,
          chars: article.text.length,
          fullChars: article.fullLength,
          fallback: article.fallback,
          htmlTooLarge,
          snapshotNodes,
          snapshotChars: snapshotYaml ? snapshotYaml.length : 0,
          ms: Date.now() - startedAt
        })
        return {
          requestedUrl: start.toString(),
          finalUrl,
          article,
          snapshotYaml,
          snapshotNodes,
          htmlTooLarge
        }
      }

      return await Promise.race([doWork(), deadline])
    } finally {
      cleanup()
    }
  })()

  inFlight = run
  try {
    return await run
  } finally {
    inFlight = null
  }
}
