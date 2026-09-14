/**
 * 三个钻探工具的执行体（`drill-001` 阶段四）—— 把 `DrillRunService`（谁在钻 / 哪一次 / 能不能开）
 * 与 `ExploreSessionService`（怎么走站点）接在一起。
 *
 * **闸的顺序就是这个文件的全部要点。** `begin` 分支里每一步的位置都不是风格：
 *
 *  1. `refuseIfBusyElsewhere` 必须在**任何赋值、任何动录制的动作之前** ——
 *     `clearCaptureSession()` 对正在录的会话是「换目录」，第一轮还在往里写而窗口游标已指向
 *     被换掉的目录，那段流量成孤儿且**没有任何报错**；`drillOwnerSessionId` 一旦被覆盖，
 *     第一轮之后所有播报都盖上第二个会话的章。
 *  2. 上一轮已作废但 `open` 还是 true → 先 `abandonRun`，否则 `begin` 会走幂等短路，
 *     把新一轮接到那个死掉的运行上（连它 abort 过的 TaskHandle 一起）——
 *     「停止后立刻重开」于是变成「新一轮一开始就是被停止的」。
 *  3. 再 `claimRun()` 铸新代次 + 认领归属。**在任何长流程开始之前** ——
 *     旧一轮遗留的异步工作从这一刻起就过期了。
 *  4. 重入（同一个站再 begin）**不建第二张任务卡**，判据借 `svc.reentersRun()`，
 *     与 `begin` 内部同一份，不在这里重写一遍。
 *
 * 出处：cowork `docs/issues/drill-must-be-global-singleton.md` ·
 * `drill-run-epoch-and-stop-gates.md`。
 */

import { xpcMain } from 'electron-xpc/main'
import { currentChatSessionId } from '@main/agent/runtime/agentSessionContext'
import { taskRegistry } from '@maestro-main/tasks/taskRegistry.service'
import type { DrillHostService } from '@maestro-main/sitemap/drillHost.service'
import { DrillRunService } from '@maestro-main/sitemap/drillRun.service'
import type { AgentConversationContext, AgentReply, CodexDebugEvent } from '@maestro-shared/coach.api'

export interface DrillToolsHostState {
  currentUrl(): string
  /** 激活的 operation tab —— `begin` 要拒 mini-app 面（它们不是可探索的站点）。 */
  activeTabKind(tabId?: string): { kind: string; miniappId?: string } | null
  setAutoDismissFileDialogs(on: boolean): Promise<void>
  /** 对一次录制电平：红点只吃 started/stopped 两个沿，钻探开始正是"灯必须是对的"那一刻。 */
  announceCaptureState(): void
  debugCodex(event: CodexDebugEvent): void
  /**
   * 合成一条 turn 发给 agent —— **续跑循环靠它把钻探一轮一轮推下去**。
   * 少了这条,agent 讲完"我进入了 X"就停在那里(Ral 2026-09-10 报的正是这个)。
   */
  sendAgentMessage(params: { sessionId?: string; message: string }): Promise<AgentReply>
  /** 把这一轮的产物落到 sitemap.json —— 落不了盘等于探了没探。 */
  persistAgentRun(params: {
    siteId: string
    host: string
    modules: unknown
    uncovered: unknown
    offsite: unknown
    visited: number
  }): Promise<{ ok: boolean; error?: string }>
}

/** 一轮里最多合成多少次「继续钻探」。40 是 cowork 实测的上限,再多就是空转。 */
const DRILL_MAX_CONTINUATIONS = 40

export class DrillToolsHost {
  constructor(
    private readonly host: DrillToolsHostState,
    private readonly drillHost: DrillHostService,
    private readonly run: DrillRunService
  ) {}

  async toolExploreSession(params: {
    action: string
    startUrl?: string
    tabId?: string
    focus?: string[]
    sessionKey?: string
  }): Promise<string> {
    const svc = this.drillHost.ensureSession()
    const action = (params.action || 'state').toLowerCase()

    if (action === 'begin') {
      /**
       * **agent 工具路径的门。** 按钮那条路有两道天然拒（`/^https?:/` 与「钻探依赖录制」），
       * 这条路**两道都没有** —— 它直接进 `exploreSession.begin()`，而 `begin()` 只校验
       * wc 存在 + startUrl 非空。所以「入口层面禁止 mini-app」必须在这里再挡一次。
       *
       * 返回的是给 agent 读的文本，所以要说清**为什么**+**怎么办**，否则它原样重试。
       */
      const active = this.host.activeTabKind(params.tabId)
      if (active?.kind === 'miniapp') {
        return (
          `REFUSED: the active tab is a mini-app ('${active.miniappId ?? '?'}'). ` +
          'Mini-app tabs never participate in recording or drilling (they are first-party local apps, not sites to explore). ' +
          'Switch to a website tab first, or pass an explicit startUrl for a site that is open in one.'
        )
      }

      // 主人 = 开钻的那个聊天会话。退化键在这里等于没有主人。
      const owner = currentChatSessionId() ?? undefined

      // ① 单例闸 —— 在任何赋值与任何动录制的动作**之前**。
      const refusal = this.run.refuseIfBusyElsewhere(owner)
      if (refusal) return refusal

      // ② 上一轮已作废但还没收摊 → 就地放弃它，让 `begin` 走**完整重置**而不是幂等短路。
      if (!this.run.isRunLive(this.run.currentRunId) && svc.isExploring) {
        await svc.abandonRun('上一轮已被停止/作废,这里开的是新一轮')
        this.run.setExploreTask(null)
      }

      // ③ 新一轮 → 新代次 + 认领归属。在任何长流程开始之前。
      this.run.claimRun({ sessionKey: params.sessionKey, owner })

      /**
       * 钻探开始 → 打开「自动取消文件框」。由流程自己开，**不做成 agent 工具** ——
       * 让模型去记得开一个安全开关，等于把它变成可选项。
       *
       * 放在这里而不是 `startRecording`：常见时序是**录制先起来**（人按 Capture、钻探随后 begin），
       * 只在开录时读一次标志的话，钻探全程都是关着的。
       */
      void this.host.setAutoDismissFileDialogs(true)
      this.host.announceCaptureState()

      // ④ 重入的 begin（同一个站已经在钻）**不建第二张任务卡**。判据借 svc 的，
      //    与 begin 内部同一份 —— 两处各自推导迟早不一致。
      if (svc.reentersRun(params.startUrl)) {
        return await svc.begin({ startUrl: params.startUrl, tabId: params.tabId, focus: params.focus })
      }

      const task = taskRegistry.start({
        // 钻探自己的任务**一律显式盖章** —— 续跑循环跑在 `runInAgentSession` 之外，
        // 那时 ALS 的默认值是 undefined。
        sessionId: this.run.ownerSessionId ?? owner,
        name: 'explore_session',
        kind: 'builtin',
        // 限定范围要写进标题 —— 否则 12 个模块的站点跑出 3 个模块的 sitemap 看起来像 bug。
        title: params.focus?.length
          ? `agent exploring ${params.startUrl || this.host.currentUrl()} · 只钻 ${params.focus.join(' / ')}`
          : `agent exploring ${params.startUrl || this.host.currentUrl()}`,
        input: { startUrl: params.startUrl || this.host.currentUrl(), focus: params.focus || [] }
      })
      this.run.setExploreTask(task)
      const text = await svc.begin({ startUrl: params.startUrl, tabId: params.tabId, task, focus: params.focus })
      if (text.startsWith('ERROR')) task.fail(text)
      return text
    }

    if (action === 'end') {
      /**
       * end 闸：完成 = 机械的「已钻模块 == 已发现模块」。判据**只有一处**
       * （`continueState().shouldContinue`）—— end 闸和续跑循环一旦各自推导，
       * 就会出现"end 放行但循环还想跑"这种自相矛盾的状态。
       */
      const st = svc.continueState()
      if (st?.shouldContinue) {
        this.host.debugCodex({
          scope: 'agent',
          phase: 'drill:end-refused',
          level: 'info',
          message: `模块 ${st.drilled}/${st.discovered} 已钻 · frontier 剩 ${st.worklistLeft} · 支线未收 ${st.openBranches} · ${st.remainingText} 预算 —— 拒绝提前 end`,
          ts: Date.now()
        })
        return svc.endRefusal()
      }
      // frontier 空但还有没钻的同站 tab → 拒绝 end，催去钻它（它的流量也需要被录）。
      if (st && !st.overBudget) {
        const nextTab = await svc.firstUndrilledSameSiteTab()
        if (nextTab) {
          this.host.debugCodex({
            scope: 'agent',
            phase: 'drill:end-refused',
            level: 'info',
            message: `还有未钻同站 tab ${nextTab.id} → ${nextTab.url} —— 拒绝提前 end`,
            ts: Date.now()
          })
          return (
            `REFUSED: cannot end — there is still a same-site tab you have not drilled: ${nextTab.url}. ` +
            `explore_visit {"tab":"${nextTab.id}"} to drill it (its traffic also needs recording), then end.\n${svc.stateText()}`
          )
        }
      }
      return await this.finalizeExploreSession()
    }

    if (action === 'need_login') {
      // 登录暂停：agent 判定被登录墙挡住 → 暂停 + 请人登录，人点继续（或自动检测到登录）后返回。
      await svc.pauseForLogin('agent 判断需要登录')
      return `登录暂停已结束(用户已登录 / 已确认继续)。继续钻探。\n${svc.stateText()}`
    }

    return svc.stateText()
  }

  async toolExploreVisit(params: { url?: string; tab?: string; from?: string }): Promise<string> {
    return await this.drillHost.ensureSession().visit(params)
  }

  /**
   * **snake_case → camelCase 的翻译不能省。** 工具契约对外是 snake_case（与其它工具一致），
   * 内部是 camelCase。不翻的后果是**静默失效**，不是报错：
   *  · `expected_children` 被当成"没给" ⇒ 子模块承诺闸失效；
   *  · `renamed_from` 被当成"没给" ⇒ 每一次改名认领都被那道闸拒掉。
   *
   * `plan.skip` 收两种写法（`[{name,reason}]` 和 `["名字"]`）：模型两种都会给，而一个只写了
   * 名字的 skip **仍然是有效的分诊**（它表态了），不该因为少个 reason 就掉回"未分诊"那一格。
   */
  async toolExploreRecord(findingsJson: string): Promise<string> {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(findingsJson) as Record<string, unknown>
    } catch (err) {
      return `ERROR: findings_json is not valid JSON (${(err as Error).message}).`
    }
    const asRecord = (value: unknown): Record<string, unknown> => (value || {}) as Record<string, unknown>
    return await this.drillHost.ensureSession().record({
      module: (parsed.module
        ? {
            ...asRecord(parsed.module),
            expectedChildren: asRecord(parsed.module).expectedChildren ?? asRecord(parsed.module).expected_children
          }
        : undefined) as never,
      functions: (Array.isArray(parsed.functions) ? parsed.functions : []).map((raw) => {
        const f = asRecord(raw)
        return {
          ...f,
          functionId: f.function_id ?? f.functionId,
          renamedFrom: f.renamed_from ?? f.renamedFrom,
          rowLevel: f.row_level ?? f.rowLevel,
          moduleUrl: f.module_url ?? f.moduleUrl
        }
      }) as never,
      worklistAdd: (parsed.worklist_add ?? parsed.worklistAdd) as never,
      retired: parsed.retired as never,
      dontClick: (parsed.dont_click ?? parsed.dontClick) as never,
      dontVisit: (parsed.dont_visit ?? parsed.dontVisit) as never,
      searchValues: (parsed.search_values ?? parsed.searchValues) as never,
      observedWrite: (parsed.observed_write ?? parsed.observedWrite) as never,
      disagreement: parsed.disagreement as never,
      uncovered: parsed.uncovered as never,
      moduleDone: (parsed.module_done ?? parsed.moduleDone) as never,
      plan: (() => {
        const p = (parsed.plan ?? parsed.triage) as Record<string, unknown> | undefined
        if (!p || typeof p !== 'object') return undefined
        const skip = Array.isArray(p.skip) ? p.skip : []
        return {
          click: (Array.isArray(p.click) ? p.click : []).map((v) => String(v ?? '')),
          skip: skip.map((raw) => (typeof raw === 'string' ? { name: raw } : asRecord(raw) as { name: string; reason?: string }))
        }
      })() as never,
      note: parsed.note as never
    })
  }

  async continueAfterTurn(
    params: { message: string; sessionId?: string; context?: AgentConversationContext },
    initialReply: AgentReply
  ): Promise<AgentReply> {
    let reply = initialReply
    // 这一条被**并入了一个还在跑的回合**(回合内 steering)—— 续跑的整个前提「上一个回合已经结束」
    // 不成立,原样退回去。少了这一行:每次 `sendAgentMessage` 都秒回 `ok:true`(回合还占着 busy,
    // 消息只是排进它的队),`if (!reply.ok) break` 不断,于是最多 40 条合成「[继续钻探]」被灌进
    // 那个活回合的队列;更糟的是循环出口的 `finalizeExploreSession()` 是**无条件**的,会给一个
    // 还在跑的钻探写 sitemap、播 drill-complete、清 exploreTask。
    if (reply.mergedIntoTurn) return reply
    // Ordinary chats may finish while another chat owns the singleton drill.
    if (this.run.ownerSessionId !== params.sessionId) return reply
    // **进循环之前抓一份代次。** 之后每一次迭代拿它来问"我还是当前这一轮吗" —— 这就是
    // Ral 2026-09-04 要的那个判据:停止、以及"停完立刻重开"造成的新旧两轮重叠,是同一个答案。
    const runId = this.run.currentRunId
    if (this.drillHost.exploreSessionOrNull()?.isExploring) {
      // 【提示词落日志】(Ral 2026-08-17)。续跑分支说的话,是整个循环里最有影响力的输入 ——
      // 它决定 agent 下一步去干什么。而原来一个字都不进日志:`force-continue` 只记统计
      // (剩几个地点、标注多少、预算多少)。于是钻探打转时,查不出它当时被告知了什么。
      //
      // 排查时被这个卡住过一次:想回答「agent 为什么在 08:33 突然去了结那 8 个导航壳、而不是 07:15」
      // —— 查不到,只看得见数字不变。那也正是把「前沿排不空」判断错的直接原因。
      //
      // 记【分支名 + 全文】:分支名回答「走了哪条路」,全文回答「到底说了什么」。
      // 全文截到 400 字防日志膨胀 —— 分支之间的差异都在开头,截尾不影响归因。
      const logDrillPrompt = (branch: string, text: string): void => {
        this.host.debugCodex({
          scope: 'agent',
          phase: 'drill:continue-prompt',
          level: 'info',
          message: `续跑话术 · 分支 ${branch} · ${text.length} 字`,
          detail: { branch, chars: text.length, prompt: text.slice(0, 400) },
          ts: Date.now()
        })
      }
      let lastTab = '' // 防同一个 tab 反复被 re-prompt 却没被钻(agent 不切)→ 空转
      let controlNudged = false // 「地点走空但控件没点完」只催一轮,不反复
      for (let i = 0; i < DRILL_MAX_CONTINUATIONS; i++) {
        // **停止的实际落点就是这里。** 续跑是宿主驱动的:它不看上一发 LLM 是不是被 abort 了,
        // 只看自己的判据。少了这一行,人按下停止之后循环照样合成下一轮,页面接着被点。
        // (continueState().shouldContinue 也已经带上 !aborted,但那一路只覆盖"还有地点"的分支;
        //  地点走空时还有控件补催、切 tab 两条支路,所以闸要放在循环口。)
        // **代次闸 —— 这一条同时挡住两件事**(`docs/issues/drill-run-epoch-and-stop-gates.md`):
        //   ① 这一轮被停了;② 这已经是**下一轮**了(人停完立刻又开了一轮),而我还是上一轮
        //      遗留的循环 —— 继续下去就是两个循环同时往同一个 exploreSession 里灌合成 turn。
        // `isStopped` 只能回答 ①,而且在没有 TaskHandle 时连 ① 都答错(读出 false)。
        if (!this.run.isRunLive(runId) || this.drillHost.ensureSession().isStopped) {
          this.host.debugCodex({ scope: 'agent', phase: 'drill:continuation-halted', level: 'warn', message: `钻探代次 #${runId} 已停止/被取代 —— 续跑循环在第 ${i + 1} 次迭代前退出`, detail: { runId, current: this.run.currentRunId, valid: this.run.isRunLive(this.run.currentRunId) }, ts: Date.now() })
          break
        }
        const st = this.drillHost.ensureSession().continueState()
        let msg = ''
        if (st.shouldContinue) {
          // 还有【地点】没走完 → 催继续「观察→点击/输入→再观察」的循环。
          // 判定口径已从模块改成地点(Ral 2026-08-13):模块是标签,不参与判定 —— 分母跟着 agent 的
          // 措辞走时,它挑个粗粒度就能提前收工(janeapp:42 个子模块塌成 1 个,7/7 全绿)。
          const led = this.drillHost.ensureSession().moduleLedger()
          this.host.debugCodex({ scope: 'agent', phase: 'drill:force-continue', level: 'info', message: `地点还剩 ${st.worklistLeft} 个未开 · 标注 ${st.drilled}/${st.discovered} · ${st.remainingText} 预算 —— 合成 turn 续跑 #${i + 1}`, ts: Date.now() })
          // 未点控件也要**说出来**(Ral 2026-08-14:编辑/新增按钮没被点)。规则是干净的、提示词也对,
          // 真正的原因是控件不在完成判定里 —— 地点没开完会被硬催,控件没点过则无人过问,agent 自然
          // 朝真正约束它的那个闸优化。先把它接进续跑话术(便宜、不会死锁),硬闸看这一轮的实测再定。
          // 「说了要点却没点」排在前面 —— 它是漏斗里唯一归因明确的一格,催它不需要再讲道理。
          const owed = this.drillHost.ensureSession().plannedNotClicked()
          const pending = this.drillHost.ensureSession().untouchedByModule()
          const controlNote = owed.length
            ? ` 另外你**自己说了要点**、但还没点的控件:${owed
                .map((m) => `${m.name}:${m.controls.slice(0, 6).map((c) => `「${c}」`).join('')}`)
                .join(' · ')} —— 先把这些补上。`
            : pending.length
              ? ` 另外这些模块里还有没点过的控件 —— 顺手点开看看(没输入过的页面,点什么都不会写数据;只有【已经输入之后】那种可能提交的才不点):${pending
                  .map((m) => `${m.name}:${m.controls.slice(0, 6).map((c) => `「${c}」`).join('')}`)
                  .join(' · ')}。`
              : ''
          msg = st.openBranches > 0
            ? `[继续钻探] 有 ${st.openBranches} 条支线没收:点击开出来的新标签页还没钻完。在里面走完它的地点(观察→点击/填写→再观察),然后 explore_record {"moduleDone":{"url"}} 标一下 —— 系统会自动关掉那个 tab 并把你送回主线。支线没收完不能 end。${controlNote}`
            : `[继续钻探] 站点自己的链接里还有 ${st.worklistLeft} 个地方你从没打开过 —— 这就是没探完。用【点击】一个个进去(别改 url),每进一个都可能再冒出新的地方,那是正常的,这个站有多深就走多深。侧栏/页签里那些不是链接的入口(JS 导航)只能靠点,收割看不见它们。确实打不开或不该打开的,才用 explore_record {"uncovered":{"url","reason"}} 逐个了结 —— 只有这个能把它从台账里清掉。慢没关系,完整才是目的。预算剩 ${st.remainingText}。${led.discovered ? `(标注 ${st.drilled}/${st.discovered} 个模块 —— 标签不决定何时结束,覆盖才决定。)` : ''}${controlNote}`
        } else {
          // 地点走空了,但控件还有没点过的 → **补一次**(只补一次)。这一下是给「表格操作列里的编辑/
          // 新增从来没被点开」准备的:那些按钮打开的表单往往带着只读接口,不点就永远录不到。
          // 只催一轮:没进展的刹车会在下一轮兜住,不会因为 agent 不肯点就空转下去。
          // 优先催「自己说了要点却没点」的:那一格没有任何解释空间。没有这种欠账时,再催未分诊的。
          const owedControls = controlNudged ? [] : this.drillHost.ensureSession().plannedNotClicked()
          const pendingControls = controlNudged || owedControls.length ? owedControls : this.drillHost.ensureSession().untouchedByModule()
          if (pendingControls.length) {
            controlNudged = true
            this.host.debugCodex({ scope: 'agent', phase: 'drill:control-nudge', level: 'info', message: `地点走空,但还有 ${pendingControls.reduce((n, m) => n + m.controls.length, 0)} 个控件没点过(${owedControls.length ? '自己计划过的' : '未分诊的'})—— 催一轮`, detail: { modules: pendingControls.map((m) => m.name), owed: owedControls.length > 0 }, ts: Date.now() })
            const nudgeMsg =
                (owedControls.length
                  ? `[继续钻探] 地点都走过了,但这些控件是**你自己在 plan 里说了要点**、结果没点的 —— 没有解释,只能是漏了:`
                  : `[继续钻探] 地点都走过了,但这些模块里还有**没点过的控件** —— 表格操作列里的按钮尤其容易漏,它们打开的表单常常带着只读接口,不点就永远录不到:`) +
                `${pendingControls
                  .map((m) => `${m.name}:${m.controls.slice(0, 8).map((c) => `「${c}」`).join('')}`)
                  .join(' · ')}。` +
                `逐个点开看看。判据只有一条:**没往页面里输入过东西的时候,点什么都不会写数据**,放心点;` +
                `只有在你已经填过内容、而某个按钮可能把它提交上去时,才别点、直接离开这一页。点完再 end。`
            logDrillPrompt(owedControls.length ? 'control-nudge/owed' : 'control-nudge/untriaged', nudgeMsg)
            reply = await this.host.sendAgentMessage({ sessionId: params.sessionId, message: nudgeMsg })
            // 合成的这一条也被并进了别人还在跑的回合 → 它没有回合终点可等,**别 break**:
            // break 会掉进出口那个无条件 finalize,等于给一个还在跑的钻探写收尾。
            if (reply.mergedIntoTurn) return reply
            if (!reply.ok) break
            continue
          }
          // 模块都钻完 → 还有没钻过的【同站】tab?系统化切过去(它里面的模块也要发现+钻完)。
          const nextTab = await this.drillHost.ensureSession().firstUndrilledSameSiteTab()
          if (!nextTab || nextTab.id === lastTab) break // 没有未钻同站 tab / 上轮已催同一个还没钻 → 停
          lastTab = nextTab.id
          this.host.debugCodex({ scope: 'agent', phase: 'drill:next-tab', level: 'info', message: `模块都钻完,还有未钻同站 tab ${nextTab.id} → ${nextTab.url},合成 turn 催切过去 #${i + 1}`, ts: Date.now() })
          msg = `[继续钻探] 当前 tab 的模块都钻完了,但还有一个额外的【同站】tab 没钻:explore_visit {"tab":"${nextTab.id}"} 切过去,发现并钻完它里面的模块(它的流量也要录)。所有同站 tab 都钻完再 end。`
        }
        logDrillPrompt(
          st.openBranches > 0 ? 'open-branches' : st.shouldContinue ? 'worklist-left' : 'next-tab',
          msg
        )
        reply = await this.host.sendAgentMessage({ sessionId: params.sessionId, message: msg })
        if (reply.mergedIntoTurn) return reply // 并进了还在跑的回合 → 同上,连出口的 finalize 一起跳过
        if (!reply.ok) break // 出错/被取消 → 停,别硬续
        const after = this.drillHost.exploreSessionOrNull()?.continueState()
        if (!after || !after.open) break // 期间 agent 自己 end 了 → 停
        // 零进展 = 没发现新模块、没钻完新模块、没访问新页、frontier 也没往下走 → 停,别空转。
        // worklistLeft 变小也算进展:清一个"确实到不了"的队列项同样是把这轮往终点推。
        if (
          st.shouldContinue &&
          after.discovered <= st.discovered &&
          after.drilled <= st.drilled &&
          after.visited <= st.visited &&
          after.worklistLeft >= st.worklistLeft
        ) break
      }
    }
    // 续跑到出口后仍开着(worklist 空 / 预算到 / 无进展)→ 收尾写 sitemap;正常收尾的钻探 exploreTask 已空 → no-op。
    // 这个 finalize 是【无条件】的:循环打满 40 次、上下文被压缩、零进展刹车,都会走到这里。所以必须留痕
    // 到底是"闸满足了才收"还是"没跑完被兜底收了"—— 否则一轮跑崩和一轮跑完在 run journal 里长得一模一样。
    // 出口的 finalize 也要过代次闸:这个 finalize 是**无条件**的,而"我已经不是当前这一轮了"
    // 意味着它会去给**别人**那一轮写 sitemap、播 drill-complete、清 exploreTask。
    if (this.run.exploreTaskHandle && this.run.isRunLive(runId)) {
      const exitSt = this.drillHost.exploreSessionOrNull()?.continueState()
      // 被人停掉的一轮**不算"兜底收尾"**:它没跑完是因为人叫停了,不是闸出了问题。
      // 走同一条播报会写成「本轮由宿主兜底收尾」,读起来像出了故障 —— 而停止已经自己播过一条了。
      if (exitSt?.shouldContinue && !this.drillHost.exploreSessionOrNull()?.isStopped) {
        this.host.debugCodex({
          scope: 'agent', phase: 'drill:finalize-incomplete', level: 'warn', ts: Date.now(),
          message: `兜底收尾但闸未满足:模块 ${exitSt.drilled}/${exitSt.discovered} · frontier 剩 ${exitSt.worklistLeft} · 支线 ${exitSt.openBranches} · 预算 ${exitSt.remainingText} —— 这轮没跑完`
        })
        // **强制收尾必须回灌**(drill-agent-claims-complete-on-forced-finalize.md)。这是宿主单方面的
        // 动作;不说出来的话,agent 记得的最后一件事就是"我调了 end",于是照自己的理解播报「钻探已
        // 完成」,而同一屏上进度写着 88/125、气泡还是红色错误样式。两个声音说相反的话,人只会信正文。
        //
        // 播到聊天(给人看),不改提示词 —— 这一轮已经走完了,再喂模型也没有下一轮能用上它。
        xpcMain.broadcast('coach/drill-note', {
          text:
            `⚠ 本轮由宿主兜底收尾,**没有跑完**:地点 ${exitSt.visited}/${exitSt.visited + exitSt.worklistLeft} 已打开,` +
            `还剩 ${exitSt.worklistLeft} 个没打开${exitSt.openBranches ? ` · 还有 ${exitSt.openBranches} 条支线没收` : ''}。` +
            `sitemap 与 apidoc 都是增量合并的,已探到的内容不会丢;但**下一轮钻探是从头开始**,不接着这一轮的进度走(Ral 2026-08-17 定)。`,
          sessionId: this.run.ownerSessionId,
          ts: Date.now()
        })
      }
      await this.finalizeExploreSession('钻探续跑到出口(worklist 空/预算到/无进展)后收尾').catch((err) =>
        this.host.debugCodex({ scope: 'agent', phase: 'explore:auto-finalize-failed', level: 'warn', message: (err as Error).message, ts: Date.now() })
      )
    }
    return reply
  }

  /**
   * 收尾。
   *
   * **不在这里停录制**（Ral 2026-08-16 推翻 2026-08-12）：流程早就是**边钻边摄** ——
   * 钻一段 → 摄一窗 → **接着钻**，finalize 于是不是终点，而是一轮里反复经过的一站。
   * 在这里停录的后果是：① 摄完这一窗之后，后续钻探的流量**全部没被录**，而那正是下一窗要摄的；
   * ② 停录会 revert 目标 tab 的 `Runtime.enable`，下一次 `start_recording` 连
   * `isCapturableTab` 都过不了 —— 「下一轮开不起来」。
   * 录制的生命周期归人（Capture 按钮）或显式 `stop_recording`，不归单轮 finalize。
   */
  async finalizeExploreSession(reason?: string): Promise<string> {
    const svc = this.drillHost.exploreSessionOrNull()
    if (!svc) return ''
    // 先把"还剩多少地点"取下来 —— end 之后 session 就关了，取不到了。
    const finalState = svc.continueState()
    // 收尾那一摄：最后一个模块之后到现在的尾巴也要摄掉，否则那段流量谁都不管
    // （边钻边摄按模块切，最后一段没有"下一个模块完成"来触发它）。
    try {
      await svc.ingestTailWindow()
    } catch (err) {
      this.host.debugCodex({
        scope: 'agent',
        phase: 'sitemap:v2:tail-ingest-failed',
        level: 'warn',
        message: (err as Error).message,
        ts: Date.now()
      })
    }
    // **钻探结束 → 把文件框开关关回去。** 录制可能还开着，而人接着自己操作时不该再被取消文件框 ——
    // 开关的语义是"这一段是 agent 在开"，不是"录制期间一律拦"。
    void this.host.setAutoDismissFileDialogs(false)
    const out = await svc.end()
    await svc.finishTabScope()
    const task = this.run.exploreTaskHandle
    this.run.setExploreTask(null)
    task?.artifact({ label: 'run', path: out.runPath })
    let persisted = ''
    try {
      const r = await this.host.persistAgentRun({
        siteId: out.siteId,
        host: out.siteId,
        modules: out.modules,
        uncovered: out.uncovered,
        offsite: out.offsite,
        visited: out.visited
      })
      if (!r.ok) persisted = `\n⚠ sitemap 落盘失败:${r.error || 'unknown'}`
    } catch (err) {
      persisted = `\n⚠ sitemap 落盘失败:${(err as Error).message}`
    }
    task?.complete(`explored ${out.siteId} · ${out.visited} pages`)
    // 本轮结束 → 作废代次。之后可以正常开下一轮，而旧一轮遗留的异步工作会自行退出。
    this.run.invalidateDrillRun(reason || '本轮钻探结束')
    return `${out.text}${persisted}${finalState?.worklistLeft ? `\n(还剩 ${finalState.worklistLeft} 个地点没打开)` : ''}`
  }
}
