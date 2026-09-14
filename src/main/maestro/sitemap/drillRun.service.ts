/**
 * 钻探的**编排状态机**（`drill-001` 阶段三）。
 *
 * 这个文件里没有一条"业务逻辑" —— 钻探怎么走站点全在 `ExploreSessionService`。
 * 这里只管三件互相纠缠的事：**谁在钻（归属）**、**哪一次钻（代次）**、**能不能开（单例）**。
 *
 * 它是整次移植里唯一**不能快搬**的一段。三条不变量各有一份 cowork issue 文档，
 * 每一条都是真出过 bug 才写下来的，而三个 bug **全是静默的**：
 *
 * | 不变量 | 搬错的后果 | 出处（cowork docs/issues） |
 * |---|---|---|
 * | 全局单例 | 第二次 `begin` **夺舍**正在跑的那一轮：归属被覆盖、第一轮的录制目录被换掉、状态机互踩 | `drill-must-be-global-singleton.md` |
 * | 运行代次 | 停止**静默失效**：判据挂在一个可能不存在的 TaskHandle 上，"没有任务"和"没被停止"读出同一个值 | `drill-run-epoch-and-stop-gates.md` |
 * | 归属戳 | 活动播报盖上**别的会话**的章 | `drill-activity-bleeds-into-another-session.md` |
 *
 * 所以每一处闸都带着"为什么在这里、为什么是这个顺序"的注释。**改之前先读那三份文档。**
 */

import { xpcMain } from 'electron-xpc/main'
import { DEFAULT_AGENT_SESSION_KEY, currentChatSessionId } from '@main/agent/runtime/agentSessionContext'
import { taskRegistry } from '@maestro-main/tasks/taskRegistry.service'
import type { TaskHandle } from '@maestro-main/tasks/taskRegistry.types'
import type { ExploreSessionService } from '@maestro-main/sitemap/exploreSession.service'
import type { CodexDebugEvent } from '@maestro-shared/coach.api'

export type DrillPhase = 'exploring' | 'ingesting'

export interface DrillRunHost {
  debugCodex(event: CodexDebugEvent): void
  /** 钻探期间自动取消文件选择框 —— 人叫停就立刻关回去。 */
  setAutoDismissFileDialogs(on: boolean): Promise<void>
  /**
   * 收掉**钻探自己开起来的**那份录制；人自己开的不动。
   *
   * 「录制的生命周期归人」那条规矩(Ral 2026-08-16)**保留** —— 它保护的是人开的录制，
   * 而且它的理由只对 finalize 成立(finalize 是一轮里反复经过的一站，在那儿停录会让后续
   * 钻探流量没被录)。**停止是终点**，后面没有"后续钻探"，理由不适用。
   * 而钻探这份录制本来就不是人开的(钻探第一步的 `start_recording` 是 agent 工具调用)，
   * 从人的视角他从没打开录制，只是启停了一次钻探，灯却留在那亮着。
   */
  stopCaptureIfAgentStarted(reason: string): Promise<boolean>
  /** 已经建出来的 explore session（懒建、永不释放的单实例）。 */
  exploreSession(): ExploreSessionService | null
}

export class DrillRunService {
  /** 毫秒时间戳 = 「哪一次钻探」。 */
  private drillRunId = 0
  /** 「这一次还有效吗」。 */
  private drillRunValid = false
  /** 摄取阶段在跑 —— 它活得比回合长（15–20 分钟），也算占位。 */
  private drillIngesting = false
  /** 本轮的 explore 任务卡。可能缺席（重入的 begin 不建卡、摄取阶段没有它）。 */
  private exploreTask: TaskHandle | null = null
  /**
   * 账本的键 —— **可以是退化键** `'default'`。与 `drillOwnerSessionId` 刻意分成两个字段：
   * 一个用来记账，一个用来盖归属章，而后者绝不能是退化键。
   */
  private drillUsageKey: string = DEFAULT_AGENT_SESSION_KEY
  /**
   * 这一轮的主人（聊天会话 id）。**永不为 `'default'`** —— `currentChatSessionId()` 已经把
   * 退化键映成 `undefined`。宁可无主（被丢弃且留日志），也不要一个会骗人的主人。
   *
   * **finalize 不清它** —— 摄取活得比回合长，完成报告在几分钟后才从后台任务的 `.then()` 里发出；
   * 清掉的话，一旦接收端改成 fail-closed，那份完成报告就从所有时间线上消失。
   */
  private drillOwnerSessionId: string | undefined

  constructor(private readonly host: DrillRunHost) {}

  get ownerSessionId(): string | undefined {
    return this.drillOwnerSessionId
  }

  get usageKey(): string {
    return this.drillUsageKey
  }

  get currentRunId(): number {
    return this.drillRunId
  }

  /**
   * 铸一个新代次。**单调** —— `max(Date.now(), prev + 1)`：同一毫秒内的两次 `begin` 也必须不同，
   * 否则「停止后立刻重开」这个场景本身就退化成两轮共用一个身份。
   */
  beginDrillRun(): number {
    this.drillRunId = Math.max(Date.now(), this.drillRunId + 1)
    this.drillRunValid = true
    this.host.debugCodex({
      scope: 'agent',
      phase: 'drill:run-begin',
      level: 'info',
      message: `钻探代次 #${this.drillRunId} 开始`,
      detail: { runId: this.drillRunId },
      ts: Date.now()
    })
    return this.drillRunId
  }

  /** 作废。**幂等** —— 重复调不再刷日志。 */
  invalidateDrillRun(reason: string): void {
    if (!this.drillRunValid) return
    this.drillRunValid = false
    this.host.debugCodex({
      scope: 'agent',
      phase: 'drill:run-invalidated',
      level: 'warn',
      message: `钻探代次 #${this.drillRunId} 作废 —— ${reason}`,
      detail: { runId: this.drillRunId, reason },
      ts: Date.now()
    })
  }

  /**
   * 一个判据同时回答两件事：**这一轮被停了** 与 **这已经是下一轮了**。
   *
   * 每个关键节点都在进入时抓一份 `runId`，之后逐步比对 —— 因为那些节点是长流程
   * （续跑循环、一发点击、一窗摄取），它们启动时有效不代表落地时还有效。
   */
  isRunLive(runId: number): boolean {
    return runId > 0 && runId === this.drillRunId && this.drillRunValid
  }

  /**
   * 单一占位判据。口径 = `exploreSession.isExploring` 或 `drillIngesting`，
   * 与 `isDrilling` 同源（Ral 2026-08-12：`isDrilling = exploring | ingesting`，
   * 摄取那 15–20 分钟**同样占位**）。
   *
   * **作废的一轮不占位。** 它已经死了，只是 `exploreSession.open` 还停在 true
   * （重入被做成幂等而非拒绝，否则会死锁）。让它继续占位就等于「停止之后要等一个死掉的运行让位」，
   * 与 Ral 要的「快速停止重新发起钻探不容易冲突」正好相反。
   * 旧一轮遗留的异步工作靠**代次**挡住，不靠占位挡住。
   */
  busyWith(): { ownerSessionId?: string; phase: DrillPhase } | null {
    if (!this.drillRunValid) return null
    if (this.host.exploreSession()?.isExploring) {
      return { ownerSessionId: this.drillOwnerSessionId, phase: 'exploring' }
    }
    if (this.drillIngesting) return { ownerSessionId: this.drillOwnerSessionId, phase: 'ingesting' }
    return null
  }

  get isDrilling(): boolean {
    return !!this.busyWith()
  }

  static describeDrillPhase(phase: DrillPhase): string {
    return phase === 'exploring' ? 'the exploration phase' : 'the apidoc ingest phase'
  }

  /**
   * `begin` 的**单例闸**。必须在**任何赋值与任何动录制的动作之前**调用。
   *
   * 顺序不是风格问题：`clearCaptureSession()` 对正在录的会话是「换目录」，
   * 第一轮钻探还在往里写而窗口游标已经指向被换掉的目录 —— 那段流量成为孤儿，**且没有任何报错**。
   * 同理 `drillOwnerSessionId` 一旦被覆盖，第一轮之后所有播报都盖上第二个会话的章。
   *
   * 返回 `null` = 放行；返回字符串 = 给 agent 读的拒绝文案（要说清**谁在钻**和**怎么办**，
   * 否则它会原样重试）。
   */
  refuseIfBusyElsewhere(owner: string | undefined): string | null {
    const busy = this.busyWith()
    if (!busy || busy.ownerSessionId === owner) return null
    this.host.debugCodex({
      scope: 'agent',
      phase: 'drill:refused-not-singleton',
      level: 'warn',
      message: `另一个会话正在钻探(owner=${busy.ownerSessionId ?? 'unknown'} phase=${busy.phase}),拒绝 begin`,
      ts: Date.now()
    })
    return (
      `REFUSED: a site drill is already running in ANOTHER chat — it is in ${DrillRunService.describeDrillPhase(busy.phase)}. ` +
      'A drill is a GLOBAL singleton: it owns the recording, the browser tabs and the sitemap/apidoc artifacts, ' +
      "so a second one would silently destroy the first one's recording window. " +
      'Do NOT retry this tool. Tell the operator that a drill is already in progress and that they must wait for it ' +
      'to finish, or open that chat and press Stop first.'
    )
  }

  /**
   * 认领这一轮。**只在 `refuseIfBusyElsewhere` 放行之后调。**
   *
   * `owner` 用 `currentChatSessionId()` 而不是 `sessionKey`：后者可能是退化键。
   * 第二道断言性早退（有主人且不是自己就不写）—— 闸已经拒过，这里是第二层。
   */
  claimRun(params: { sessionKey?: string; owner?: string }): number {
    const owner = params.owner ?? currentChatSessionId()
    if (this.drillOwnerSessionId && owner && this.drillOwnerSessionId !== owner && this.isDrilling) {
      return this.drillRunId
    }
    const runId = this.beginDrillRun()
    this.drillUsageKey = params.sessionKey || DEFAULT_AGENT_SESSION_KEY
    this.drillOwnerSessionId = owner
    return runId
  }

  /** 本轮的 explore 任务卡（可能缺席：重入不建卡、摄取阶段没有它）。 */
  get exploreTaskHandle(): TaskHandle | null {
    return this.exploreTask
  }

  setExploreTask(task: TaskHandle | null): void {
    this.exploreTask = task
  }

  setIngesting(on: boolean): void {
    this.drillIngesting = on
  }

  /**
   * 操作者按了停止。
   *
   * **只能停自己会话的钻探** —— A 会话按停止把 B 的 explore_session 取消掉，
   * B 那张卡就变成一张没人动手的 `failed`。
   *
   * 归属对不上时**仍然拒，但要留痕**（Ral 2026-09-04：「我明明点击 stop 并 confirm，
   * 但是钻探没有停止」）：这条早退原来完全静默，而渲染层的 `forceStop()` 是本地的、
   * 界面照样写 Stopped —— 于是"对不上主人"和"停止成功"在人眼里一模一样，而钻探还在点页面。
   * 归属戳错本身可能是另一个 bug，不留一行就永远查不到。
   */
  stopByOperator(sessionId?: string): void {
    const owner = this.drillOwnerSessionId
    if (!sessionId || !owner || sessionId !== owner) {
      if (this.busyWith()) {
        this.host.debugCodex({
          scope: 'agent',
          phase: 'drill:stop-ignored',
          level: 'error',
          message: `停止被忽略:请求来自会话 ${sessionId ?? '(无)'},而这一轮的主人是 ${owner ?? '(无)'} —— 钻探仍在进行`,
          detail: { requested: sessionId, owner, runId: this.drillRunId },
          ts: Date.now()
        })
      }
      return
    }
    /**
     * **先作废代次，再做别的。** 作废是无条件的，而下面取消任务那一段有三个前置条件
     * （`exploreTask` 存在、`isExploring`、还没被停过）—— 任何一个不成立，原来的代码就整段跳过：
     * 不取消任务、不关文件框开关、一条播报都没有，而续跑循环读的正是那个可能不存在的任务的
     * abort 位，于是它判定"没被停止"、合成下一条继续钻探，页面接着被点。
     * **代次不依赖任何别的对象还活着，这就是它存在的理由。**
     */
    this.invalidateDrillRun('操作者按了停止')
    void this.host.setAutoDismissFileDialogs(false)
    void this.host.stopCaptureIfAgentStarted('操作者停止了钻探')
    const session = this.host.exploreSession()
    if (this.exploreTask && session?.isExploring && !session.isStopped) {
      const r = taskRegistry.cancel({ taskId: this.exploreTask.id, reason: '操作者按了停止' })
      this.host.debugCodex({
        scope: 'agent',
        phase: 'drill:stopped-by-operator',
        level: 'warn',
        message: `停止:取消钻探任务 ${this.exploreTask.id} —— ${r.message}`,
        ts: Date.now()
      })
    }
    void session?.finishTabScope()
    // 播报在闸**外面**:被停掉的这一轮值得一条回执,而它是否恰好还挂着一个可取消的任务
    // 与"人按了停止"无关 —— 原来绑在一起,于是没有任务时人什么反馈都收不到。
    xpcMain.broadcast('coach/drill-note', {
      text: '⏹ 已停止钻探 —— 正在收尾。已经探到的地点、控件台账和接口都会照常写进本轮记录,下一轮从这里接着补。',
      sessionId: this.drillOwnerSessionId,
      ts: Date.now()
    })
  }
}
