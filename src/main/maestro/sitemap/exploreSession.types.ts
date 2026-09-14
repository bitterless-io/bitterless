import type { WebContents } from 'electron'
import type { NavExtractResult } from '@maestro-main/sitemap/navExtract'
import type { AgentBrowserTabState } from '@maestro-shared/coach.api'
import type { SiteSitemap } from '@maestro-shared/sitemap.types'

export interface DrillTabState {
  id: string
  url: string
  role: 'main' | 'branch'
  parentTabId?: string
  status: 'active' | 'closed' | 'unavailable'
  error?: string
}

export interface ExploreSessionDeps {
  describeTab?(id: string): AgentBrowserTabState | undefined
  onTabScopeChanged?(ids: string[] | null): Promise<void>
  onMainTabUnavailable?(error: string): void
  onBrowserUsePaused?(): void
  /**
   * 激活 tab 的 view。**钻探认领自己的 tab 之前**才用它(启动那几步),之后一律走
   * `webContentsForTab` —— 见 `ExploreSessionService.drillWc()` 与契约 PQ-5 / conn-009。
   */
  webContents(): WebContents | null
  /** 按 tab id 取它自己的 live webContents,**不经过激活**。null = tab 不在了或被冷却了。 */
  webContentsForTab(tabId: string): WebContents | null
  /** 把录制目标移到这个 tab —— 不经过激活。不在录制时是空操作(conn-009)。 */
  retargetCapture(tabId: string): Promise<void>
  currentUrl(): string
  captureSessionDir(): string | null
  /**
   * 计算态无障碍快照(`page_snapshot` 背后那一份)。**这是 agent 感知页面的主输入**
   * (Ral 2026-08-10:「先读 A11Y,然后去看从哪里开始探索」)。
   *
   * 为什么由主输入换成它、而不是继续用锚点提取:快照带 role + 可读名称 + `[ref=eN]` 句柄 +
   * `/url:`,是模型既能读懂、又能回指去操作的唯一一种表示;锚点表只有 href,点不了非链接控件。
   */
  /**
   * a11y 快照。`walkControls` 是【折叠前】walk 自己数出的控件键,**只用于对账**
   * (#12:漏斗分母目前来自另一次枚举,先量三个口径再换源)。
   */
  pageSnapshot(tabId?: string): Promise<{ yaml: string; nodeCount: number; walkControls?: string[] } | null>
  /**
   * 此刻还有几发请求在飞(0 = 网络安静)。**读页面之前要等它归零。**
   *
   * 为什么(Ral 2026-08-14):原来的 settle 只等 `did-stop-loading` —— 那是**文档**加载事件。
   * SPA 换路由不触发它,表格数据那一发 XHR 它也看不见。于是快照常常在数据回来之前就读了:
   * 表格是空的,操作列的「编辑」还没渲染出来 —— agent 不是不想点,是那一刻页面上根本没有。
   * 接不上就退化成只等文档(老行为)。
   */
  inFlightRequests?(): number
  /**
   * 上一次探这个站留下的 sitemap —— 功能点身份的【候选来源】
   * (docs/features/function-identity-semantic.md 决定 2)。
   * 没有上一次就返回 null,那时所有功能点都是新铸的。
   */
  previousSitemap(siteId: string): Promise<SiteSitemap | null>
  /** 多 tab 钻探(drill-multi-tab)。当前激活 tab 的 id / 全部 tab / 切换激活 tab。 */
  activeTabId(): string | null
  listTabs(): Promise<{ id: string; url: string }[]>
  activateTab(id: string): Promise<void>
  /** 支线钻探:钻完就关掉那个 tab(Ral 2026-08-13「钻探结束要关闭」)。 */
  closeTab?(id: string): Promise<void>
  /**
   * 边钻边摄:一个模块钻完就把【这段时间窗内】录到的流量摄成接口文档,然后再继续下一个模块
   * (Ral 2026-08-13 大改)。
   *
   * 为什么要带 `snapshot`:文档生成现在只看得见流量,看不见"这个页面是干什么的"。把模块落地时的
   * 那份快照一起喂进去,先总结模块内容、再据此解释接口,能明显减少"参数不知道什么意思"的空描述。
   * 为什么要按【时间窗】切:窗口 = 上次摄到哪儿 → 这个模块判定完成的时刻。整轮跑完再摄的老做法
   * 一次要吞 458KB body / 13 批,实测反复 `output overflow` 重试;按模块切天然更小更同质。
   *
   * 由控制器接上(它持有 skill/apiDoc 与任务卡);没接就整段跳过,钻探照常。
   */
  /**
   * 摄一窗。回一句人读的话 **+ 结构化计数** —— 计数不能靠解析那句话反推
   * (自己渲染的文本再自己正则回来,文案一改就静默失真)。
   */
  ingestWindow?(params: { sinceTs: number; untilTs: number; moduleUrl: string; moduleName: string; snapshot: string | null }): Promise<{ text: string; documented?: number; created?: number; lost?: number; createdKeys?: string[] }>
  /**
   * 当前录制是【什么时候开的】。游标从这里起算,而不是从 begin 起算 —— 流程是「先 start_recording、
   * 再 begin」,中间那段(以及 begin 之前页面就在跑的 XHR)本来会落在所有窗口之外,永远没人摄。
   * 取不到就退回 begin 的时刻。
   */
  recordingStartedAt?(): Promise<number | undefined>
  /**
   * 钻探进入/退出「等待」态(等摄取队列)。传字符串 = 在等什么,传 null = 恢复。
   *
   * 为什么需要它:摄取那几分钟钻探本来就不该有动作,而看门狗只认 `task.update/log`(45s),
   * 于是会误报 stalled(Ral 2026-08-14:「非常误导人」)。**不能靠打假心跳糊过去** ——
   * 那会把真挂起也一起掩盖,把假阳性换成假阴性。正确做法和"等用户点确认卡"一样:
   * 明确进入等待态并写明在等什么,由任务侧豁免看门狗。
   */
  onWaiting?(what: string | null): void
  /**
   * 驱动本次探站的那个 agent 回合、到目前为止的累计 token 与金额(runtime/usageLedger.ts)。
   * 探站自己看不见模型往返 —— 它只是那个 ReAct 循环调用的一个工具,所以用量必须由外面喂进来。
   * 没接这条(测试/旧调用点)就返回 0,token 预算随之失效、时间预算照常 —— 不该因此炸掉探站。
   */
  turnUsage?(): { totalTokens: number; costUsd: number }
  onDebug?(e: { scope: 'sitemap'; phase: string; level: 'info' | 'warn' | 'error'; message: string; detail?: Record<string, unknown>; ts: number }): void
  /**
   * 聊天侧的活动行。没有它,agent 主导的探站在 cowork 的对话里【什么都不显示】——
   * 任务条和 Log 面板有,聊天没有,而聊天正是操作者看着 agent 干活的地方。
   */
  onActivity?(text: string, ok?: boolean): void
  /**
   * 钻探进展的【文字播报】(Ral 2026-08-13:「钻探过程中要通过文字的方式同步钻探进展,
   * 而不是钻探完了给句话」)。onActivity 那条走的是工具活动行,聊天里会被折叠进
   * "93 earlier steps" —— 等于没说。这条落成聊天里真正的一条消息。
   */
  onNote?(text: string): void
}

/** 上一次探索留下的一个功能点 —— 作为本次的认领候选。 */
export interface KnownFunction {
  handle: string
  verb: string
  object: string
  name: string
  moduleUrl: string
}

/**
 * 一次身份断言。**每一条都进 journal**(决定 5)—— 这是错误合并唯一会被人抓到的地方。
 * 错误分裂只会产生孤儿(看得见),错误合并是静默的,所以它必须留痕。
 */
export interface IdentityAssertion {
  at: string
  moduleUrl: string
  handle: string
  action: 'continued' | 'minted' | 'retired'
  name: string
  renamedFrom?: string
  why?: string
}

export interface WorkItem {
  url: string
  name: string
  /** Which module queued it — the agent sets this so the tree can be assembled at `end`. */
  parent?: string
  note?: string
  /** 菜单深度:home=0、其链接=1、再下一层=2。auto-seed 用它封顶(>2 不入队)。 */
  depth?: number
  /**
   * 【搁置】—— 看起来是导航壳,不计入"探完了没"的判定,但**仍然留在前沿里让 agent 能打开它**。
   *
   * 为什么是搁置而不是删除(2026-08-24 实测教训):原来这里直接 filter 掉,结果
   * `#patients` 被删,而它**从没被打开过** —— 它的子页恰恰是打开它才会被枚举出来的。
   * agent 从菜单直接进了其中一个子页,满足了"有 ≥1 个已钻子页"→ 父页被判成覆盖完 →
   * `worklistLeft: 0` → 钻探认为干完了。practice members 下面一整支子模块因此从未被发现。
   *
   * 当初要解决的问题是「菜单壳点了不导航,前沿永远排不空,agent 开始编造工作」。
   * 那个问题要的是**不阻塞完成判定**,不是**从台账上消失** —— 两件事被我合成了一件,
   * 而合并的代价是静默丢覆盖。
   */
  parked?: { reason: string; at: number }
}

/** One recorded non-GET seen during exploration. Decision 3: an audit, never a gate. */
export interface ObservedWrite {
  method: string
  url: string
  /** What the agent had just clicked, if it told us. */
  after?: string
  at: string
}

/**
 * 控件漏斗的一格(Ral 2026-08-14:「看你分析了多少可以点击的按钮,以及实际又点了多少 …… 通过这个
 * 漏斗模型,可以判断有些按钮没有被点击,到底是哪个环节的问题」)。
 *
 * 三个阶段**各有各的产生者**,这正是它能定位环节的原因:
 *   · 看见 —— 这条记录存在本身。main 从快照机械枚举,不问 agent。
 *   · 判定 `planned` / `skipReason` —— **只能由 agent 报**(`explore_record.plan`)。缺了这一格,
 *     「没点」就只有一个数字,分不清是它没认出来、认出来判定不该点、还是认出来了就是没点。
 *   · 点了 `exercised` —— main 从 `ui_act` 的 ref 还原,不认 agent 的自述。
 *
 * 两头都由 main 掌握、中间一格必须由 agent 填,所以这个漏斗**测得出 agent 的判断力**,
 * 而不只是测它干了多少活。
 */
export interface ControlEntry {
  name: string
  role: string
  inRow: boolean
  exercised: boolean
  /** 站点规则禁点(dontClick)—— 它一开始就不在分母里,不算漏。 */
  forbidden?: string
  /** agent 判定「这个我要点」。 */
  planned?: boolean
  /** agent 判定「这个我不点」+ 理由。planned 与它互斥;两个都没有 = 还没分诊。 */
  skipReason?: string
}

export interface PageEvidence {
  url: string
  host: string
  title: string
  /**
   * 主输入:计算态无障碍快照。结构、可读名称、`[ref=eN]` 句柄、链接的 `/url:` 都在这里,
   * 表格重复行已被机械折叠(决定 11),所以一页大约 1.4k token 而不是 41k。
   */
  snapshot: string | null
  /** EVERY anchor on the page — complete and unfiltered (decision 6). */
  anchors: { name: string; href: string; depth: number }[]
  /** Clickable controls with the evidence the agent needs to judge write-risk (decision 2). */
  controls: { name: string; role: string; inRow: boolean; forbidden?: string }[]
  /**
   * 【对账用】a11y walk 折叠前自己数出的控件键(`role|name|row|page`)。
   *
   * **不是** `controls`(那是 `navExtract` 的手写选择器给的、也是漏斗的分母)。
   * 两套并存正是 #12 要消掉的东西 —— 先量三个口径,跑一轮再换源。
   */
  walkControls?: string[]
  /** 枚举总数/上限,让"页面就这么点"与"我们截断了"可区分。 */
  totals: NavExtractResult['totals']
  /** Extraction diagnostics, so "why did it find nothing" is answerable. */
  diag: NavExtractResult['diag']
}
