/**
 * 钻探在 bl 这一侧的**宿主适配器**（`drill-001`，契约见 `docs/plan/tasks/drill-001.md`）。
 *
 * 分工:`ExploreSessionService`（3,014 行，从 cowork 逐字搬入、**一行未改**）不认识 bl ——
 * 它跟宿主说话全部经过 `ExploreSessionDeps` 那 17 个注入函数。本文件就是那 17 个口子在 bl 的接法。
 * 这也是整次移植可行的原因:换宿主只需要重写这一个文件，不动那 3,014 行。
 *
 * **直接落在解耦形态上,不重演 cowork 走过的弯路。** cowork 最初把钻探的手接成
 * 「激活 tab 的 view 镜像」,代价是每个动作前都要把激活 tab 钉回钻探那只(`pinActiveTabToDrillTab`)——
 * 人在钻探期间因此看不了别的 tab,2026-09-09 的 `conn-009` 才解耦。所以这里从第一版起:
 *  · `webContentsForTab` 按 tab id 取,不经过激活;
 *  · `activateTab` 这个历史依赖名只准备操作目标,不改变人的前台;
 *  · `retargetCapture` 让录制目标跟着钻探锚点走 —— 少了它,边钻边摄会录成人正在看的那个 tab
 *    的流量,摄出来的接口文档是错的而且一声不响(那一处是 cowork 的守卫抓出来的)。
 */

import type { WebContents } from 'electron'
import { ExploreSessionService } from '@maestro-main/sitemap/exploreSession.service'
import type { ExploreSessionDeps } from '@maestro-main/sitemap/exploreSession.types'
import { SitemapService } from '@maestro-main/sitemap/sitemap.service'
import type { SiteSitemap } from '@maestro-shared/sitemap.types'
import type { AgentBrowserTabState, CodexDebugEvent } from '@maestro-shared/coach.api'

/** 适配器要从宿主拿的东西 —— 全部是 bl 侧**已经存在**的真源，本文件不新建状态。 */
export interface DrillHostState {
  describeTab?(id: string): AgentBrowserTabState | undefined
  onTabScopeChanged?(ids: string[] | null): Promise<void>
  onMainTabUnavailable?(error: string): void
  onBrowserUsePaused?(): void
  currentUrl(): string
  getOperationTabs(): { id: string; url: string }[]
  getActiveOperationTabId(): string | null
  /** 按 tab id 取 live webContents（不经过激活）—— `capture.service.webContentsForTab`。 */
  webContentsForTab(tabId: string): WebContents | null
  /** 录制目标移到某个 tab —— `capture.service.retargetCaptureToTab`。 */
  retargetCaptureToTab(tabId: string): Promise<void>
  /** 绕开录制闸的 a11y 快照 —— `capture.service.pageSnapshotForAgent`（探站跑在 API 模式）。 */
  pageSnapshotForAgent(tabId?: string): Promise<{ yaml: string; nodeCount: number; walkControls?: string[] } | null>
  captureSessionDir(): string | null
  recordingStartedAt(): Promise<number | undefined>
  activateTab(tabId: string): Promise<void>
  closeTab(tabId: string): Promise<void>
  /** 边钻边摄的一轮 —— 接 bl 既有的 `ingest_recording`。 */
  ingestWindow(params: {
    sinceTs: number
    untilTs: number
    moduleUrl: string
    moduleName: string
    snapshot: string | null
  }): Promise<{ text: string; documented?: number; created?: number; lost?: number; createdKeys?: string[] }>
  /**
   * 钻探的活动播报。
   *
   * 阶段用 `'tool'` 而不是新加一个 `'drill'`:bl 的 `AgentActivityStep['phase']` 是个封闭枚举
   * (api / skill / observe / act / tab / tool / think / api-read / api-call),
   * 为钻探单开一档要改共享契约 + 渲染端的图标映射,而钻探的每一步本来就是一次工具调用。
   */
  broadcastActivity(phase: 'tool', label: string, ok?: boolean): void
  debugCodex(event: CodexDebugEvent): void
  /** 钻探中途要人知道的一件事 —— 播成聊天里的一条留痕。 */
  noteDuringDrill(text: string): void
}

export class DrillHostService {
  private session: ExploreSessionService | null = null
  private readonly sitemap: SitemapService

  constructor(private readonly host: DrillHostState) {
    this.sitemap = new SitemapService({
      onDebug: (event) =>
        this.host.debugCodex({
          scope: 'agent',
          phase: `sitemap:${event.phase}`,
          level: event.level,
          message: event.message,
          detail: event.detail,
          ts: event.ts
        })
    })
  }

  /** 探索阶段在跑吗 —— 建 tab 的那一刻要问它。 */
  get isExploring(): boolean {
    return Boolean(this.session?.isExploring)
  }

  /** 钻探此刻的锚点 tab —— 免于 LRU 冷却要用它（少了这条保护，按 id 取到 null，钻探失明）。 */
  get anchorTabId(): string {
    return this.session?.anchorTabId || ''
  }

  /** 已经建出来的那一个（可能还没建）—— 收尾路径要它，且**不该顺手把它建出来**。 */
  exploreSessionOrNull(): ExploreSessionService | null {
    return this.session
  }

  ensureSession(): ExploreSessionService {
    if (!this.session) this.session = new ExploreSessionService(this.deps())
    return this.session
  }

  /**
   * 17 个 dep 的接法。刻意写成一个方法而不是散在各处:**这是宿主与钻探的唯一接缝**,
   * 一眼能看完「钻探能碰 bl 的哪些东西」，也就一眼能看出越界。
   */
  private deps(): ExploreSessionDeps {
    const host = this.host
    return {
      describeTab: host.describeTab,
      onTabScopeChanged: host.onTabScopeChanged,
      onMainTabUnavailable: host.onMainTabUnavailable,
      onBrowserUsePaused: host.onBrowserUsePaused,
      // 钻探认领自己的 tab **之前**那几步才用激活 view;之后一律走 webContentsForTab。
      webContents: () => {
        const active = host.getActiveOperationTabId()
        return active ? host.webContentsForTab(active) : null
      },
      webContentsForTab: (tabId) => host.webContentsForTab(tabId),
      retargetCapture: (tabId) => host.retargetCaptureToTab(tabId),
      currentUrl: () => host.currentUrl(),
      captureSessionDir: () => host.captureSessionDir(),
      // 主输入是 a11y 快照(Ral 2026-08-10「先读 A11Y」)。**必须**走绕闸的那一个 ——
      // `captureSnapshot()` 在 API 模式下返回 'Action capture is off',而探站就跑在 API 模式。
      pageSnapshot: (tabId) => host.pageSnapshotForAgent(tabId),
      previousSitemap: (siteId: string): Promise<SiteSitemap | null> => this.sitemap.readSitemap(siteId),
      activeTabId: () => host.getActiveOperationTabId(),
      listTabs: async () => host.getOperationTabs().map((tab) => ({ id: tab.id, url: tab.url })),
      // Historical port name: prepare/warm the exact target; foreground display stays separate.
      activateTab: async (id: string) => {
        await host.activateTab(id)
      },
      closeTab: (id: string) => host.closeTab(id),
      ingestWindow: (params) => host.ingestWindow(params),
      recordingStartedAt: () => host.recordingStartedAt(),
      onWaiting: (what) => host.broadcastActivity('tool', what ? `waiting: ${what}` : 'waiting', true),
      onActivity: (text, ok) => host.broadcastActivity('tool', text, ok),
      onNote: (text) => host.noteDuringDrill(text),
      onDebug: (event) =>
        host.debugCodex({
          scope: 'agent',
          phase: `drill:${event.phase}`,
          level: event.level,
          message: event.message,
          detail: event.detail,
          ts: event.ts
        })
    }
  }
}
