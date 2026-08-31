// The live-task registry. Contract: docs/features/maestro.md.
//
// One owner for "what long-running work is happening right now": the Workbench running-tasks display
// reads it, the agent reads it through `task_list` / `task_output`, and a built-in procedure (探站)
// writes to it as it goes.
//
// In-memory and per-process ON PURPOSE (decision 8): a task describes LIVE work, while the durable
// record of a finished 探站 already exists as sites/<siteId>/runs/<ts>.json. Persisting tasks too
// would create a second, diverging history of the same event.

import { xpcMain } from 'electron-xpc/main'
import {
  MAX_FINISHED_TASKS,
  MAX_TASK_OUTPUT,
  TASK_STALL_MS,
  isTaskLive,
  stallHint,
  type MaestroTask,
  type MaestroTaskKind,
  type MaestroTaskConfirm,
  type MaestroTaskSnapshot
} from '@maestro-shared/task.api'
import type { TaskHandle } from '@maestro-main/tasks/taskRegistry.types'

export const TASKS_CHANNEL = 'coach/tasks'

// Operator prompts execute inside a BaseAgent tool call. Resolve them before that wrapper's wall
// clock so a timed-out tool cannot remain alive underneath and execute after a late Allow click.
const operatorConfirmTimeoutMs = (): number => {
  const raw = Number(process.env.COACH_TOOL_TIMEOUT_MS)
  const toolMs = Number.isFinite(raw) && raw > 0 ? raw : 120_000
  return Math.max(1, Math.floor(toolMs * 0.9))
}

class TaskRegistry {
  private tasks = new Map<string, MaestroTask>()
  private order: string[] = []
  private seq = 0
  private watchdog: NodeJS.Timeout | null = null
  // 每个待确认请求的 resolver,键 = confirmId。renderer 回 respondTaskConfirm 时用它 resolve 那个
  // requestConfirm 的 Promise。用 confirmId(不是 taskId)锚定 → 过期卡片点了也不会误 resolve 新的一问。
  private confirmResolvers = new Map<string, (confirm: boolean) => void>()
  private confirmSeq = 0
  /** 每个任务一个取消控制器 —— `cancel()` 触发它,跑这个任务的流程靠 `handle.signal` 收到。 */
  private aborters = new Map<string, AbortController>()

  start(params: {
    name: string
    kind?: MaestroTaskKind
    title: string
    input?: Record<string, unknown>
    callId?: string
    sessionId?: string
    messageId?: string
    /** 只是一次挂起,不是一段要展示的工作 —— 时间线不建卡片(见 MaestroTask.transient)。 */
    transient?: boolean
  }): TaskHandle {
    const now = Date.now()
    const id = `task-${++this.seq}-${now.toString(36)}`
    const task: MaestroTask = {
      id,
      name: params.name,
      kind: params.kind || 'builtin',
      callId: params.callId,
      sessionId: params.sessionId,
      messageId: params.messageId,
      input: params.input || {},
      ...(params.transient ? { transient: true } : {}),
      state: {
        status: 'running',
        title: params.title,
        time: { start: now, update: now },
        output: [],
        droppedLines: 0
      }
    }
    this.tasks.set(id, task)
    this.aborters.set(id, new AbortController())
    this.order.push(id)
    this.trim()
    this.armWatchdog()
    this.publish()
    return this.handleFor(id)
  }

  /**
   * 【无任务也能问人】—— 任何主进程调用方都能发一次确认,不需要先有一个 task。
   *
   * 为什么要有它(Ral 2026-08-17:「confirm ……应该都放到 actionsheet 里」):
   * 决策类确认原来有**两条完全不同的面**——
   *   · 预算(token / 时长)走 `task.requestConfirm` → 应用内卡片;
   *   · API 写闸、agent 工具审批、浏览器拦截规则走 `dialog.showMessageBox(browserWindow, …)`
   *     → **挂在窗口上的原生模态**。
   *
   * 后者有两个毛病:一是它根本不进应用内的确认流,actionsheet 收不到;二是**模态会挡住窗口** ——
   * CDP 操作全打在对话框上,钻探就地卡死,而外面只看到「没有新进展」。
   * 这正是本仓为文件对话框建立的那条纪律(拦掉模态、别让它弹出来)在审批路径上的漏项。
   *
   * 实现刻意走**临时任务**而不是新建一套挂起状态:确认的发布、confirmId 锚定、看门狗跳过、
   * 渲染层订阅全都已经围绕 task 建好了。复用它,actionsheet 只要接一个数据源。
   */
  async askOperator(params: {
    title: string
    detail?: string
    confirmLabel?: string
    cancelLabel?: string
    /** 任务名,决定 UI 上的标签。默认 `approval`。 */
    name?: string
    /** 要执行的动作的 payload,逐字段摊开给人看(含来源判定)。 */
    payload?: MaestroTaskConfirm['payload']
    /** Defaults just below BaseAgent's tool-call timeout. */
    timeoutMs?: number
  }): Promise<boolean> {
    const task = this.start({ name: params.name || 'approval', kind: 'builtin', title: params.title, transient: true })
    let allowed = false
    let timer: NodeJS.Timeout | undefined
    try {
      const pending = task.requestConfirm({
        title: params.title,
        detail: params.detail,
        confirmLabel: params.confirmLabel,
        cancelLabel: params.cancelLabel,
        payload: params.payload
      })
      const timeoutMs = params.timeoutMs ?? operatorConfirmTimeoutMs()
      timer = setTimeout(() => {
        this.cancel({ taskId: task.id, reason: 'operator confirmation timed out' })
      }, timeoutMs)
      timer.unref?.()
      allowed = await pending
      return allowed
    } finally {
      if (timer) clearTimeout(timer)
      // 问完就收 —— 审批任务的全部意义就是那一问,留在册上只会占着"还有任务在跑"的位置,
      // 而状态条的 roster 是按 live 任务数出现的。
      task.complete(allowed ? 'approved' : 'denied')
    }
  }

  private handleFor(id: string): TaskHandle {
    const push = (text: string, level: 'info' | 'warn' | 'error'): void => {
      const task = this.tasks.get(id)
      if (!task) return
      task.state.output.push({ ts: Date.now(), level, text })
      // Bounded ring. The count of what fell off is kept so the tail is never silently short —
      // an agent reading a truncated tail must be able to tell.
      while (task.state.output.length > MAX_TASK_OUTPUT) {
        task.state.output.shift()
        task.state.droppedLines += 1
      }
    }
    const touch = (task: MaestroTask): void => {
      task.state.time.update = Date.now()
      // Any report is proof of life — clear a previous stall verdict rather than leaving it stuck on.
      if (task.state.stalled) task.state.stalled = false
    }
    // 一个任务被 trim 掉之后 handle 仍可能被持有(引用还在闭包里)。这时给一个【已中止】的信号:
    // 任务都不在册了,继续跑它没有意义,而返回一个永不触发的信号会让那段流程永远停不下来。
    const gone = new AbortController()
    gone.abort('task no longer registered')
    const ctl = (): AbortController => this.aborters.get(id) || gone
    return {
      id,
      get signal() { return ctl().signal },
      get aborted() { return ctl().signal.aborted },
      update: (patch) => {
        const task = this.tasks.get(id)
        if (!task || !isTaskLive(task)) return
        if (patch.title) task.state.title = patch.title
        if (patch.progress) task.state.progress = { ...task.state.progress, ...patch.progress }
        if (patch.metadata) task.state.metadata = { ...task.state.metadata, ...patch.metadata }
        if (patch.line) push(patch.line, patch.level || 'info')
        touch(task)
        this.publish()
      },
      log: (text, level = 'info') => {
        const task = this.tasks.get(id)
        if (!task || !isTaskLive(task)) return
        push(text, level)
        touch(task)
        this.publish()
      },
      artifact: (artifact) => {
        const task = this.tasks.get(id)
        if (!task) return
        ;(task.artifacts ||= []).push(artifact)
        touch(task)
        this.publish()
      },
      setWaiting: (what: string | null): void => {
        const t = this.tasks.get(id)
        if (!t) return
        if (what) { t.state.waitingFor = what; t.state.stalled = false } else delete t.state.waitingFor
        touch(t)
        this.publish()
      },
      complete: (result, metadata) => {
        const task = this.tasks.get(id)
        if (!task || !isTaskLive(task)) return
        task.state.status = 'completed'
        task.state.result = result
        task.state.stalled = false
        if (metadata) task.state.metadata = { ...task.state.metadata, ...metadata }
        task.state.time.end = Date.now()
        task.state.time.update = task.state.time.end
        this.publish()
      },
      fail: (error) => {
        const task = this.tasks.get(id)
        if (!task || !isTaskLive(task)) return
        task.state.status = 'error'
        task.state.error = error
        task.state.stalled = false
        task.state.time.end = Date.now()
        task.state.time.update = task.state.time.end
        push(error, 'error')
        this.publish()
      },
      requestConfirm: (req) =>
        new Promise<boolean>((resolve) => {
          const task = this.tasks.get(id)
          if (!task || !isTaskLive(task)) {
            resolve(false)
            return
          }
          const confirmId = `confirm-${++this.confirmSeq}-${Date.now().toString(36)}`
          this.confirmResolvers.set(confirmId, resolve)
          task.state.pendingConfirm = {
            id: confirmId,
            title: req.title,
            detail: req.detail,
            confirmLabel: req.confirmLabel || 'Continue',
            cancelLabel: req.cancelLabel || 'Stop',
            createdAt: Date.now(),
            payload: req.payload
          }
          push(`waiting on you: ${req.title}`, 'warn')
          touch(task) // 别让"等你点"被误判成 stalled —— touch 一下,且下面 watchdog 也会跳过带 pendingConfirm 的任务
          this.publish()
          // 最佳努力自动续跑(登录成功检测):轮询谓词,第一次为真就当作 Confirm 自动放行。自清:用户先点了
          // (resolver 被删)/卡片换了 → 下一 tick 退出。人工点 Continue 始终是可靠主路径,这个只是顺带。
          if (req.autoConfirmWhen) {
            const poll = setInterval(() => {
              void (async () => {
                if (this.confirmResolvers.get(confirmId) !== resolve || task.state.pendingConfirm?.id !== confirmId) { clearInterval(poll); return }
                let done = false
                try { done = await req.autoConfirmWhen!() } catch { done = false }
                if (this.confirmResolvers.get(confirmId) !== resolve || task.state.pendingConfirm?.id !== confirmId) { clearInterval(poll); return }
                if (done) { clearInterval(poll); this.resolveConfirm({ taskId: id, confirmId, confirm: true }) }
              })()
            }, 4000)
          }
        })
    }
  }

  /**
   * Renderer → main: the user clicked Cancel/Confirm on a task's pending-confirm card. Resolve the
   * blocked `requestConfirm` promise and clear `pendingConfirm`. Keyed by confirmId so a stale card
   * (from an earlier ask on the same task) is a no-op. Returns whether it matched a live request.
   */
  /**
   * 请求取消一个还在跑的任务(agent 的 `task_control` 与 UI 共用)。
   *
   * 语义是【请求】不是【强杀】:没有取消通道的内置流程(摄取的 LLM 往返、CDP 操作)不会立刻停,
   * 所以这里只做三件事 —— 标 error、把还挂着的确认卡按"否"了结、留痕。这和本仓一贯口径一致:
   * 从外面看,"慢"和"挂"长得一样,所以宁可如实说"已请求取消",不谎称"已停止"。
   */
  cancel(params: { taskId: string; reason?: string }): { ok: boolean; message: string } {
    const task = this.tasks.get(params.taskId)
    if (!task) return { ok: false, message: `no task ${params.taskId}` }
    if (!isTaskLive(task)) return { ok: false, message: `task ${params.taskId} already ${task.state.status}` }
    const pending = task.state.pendingConfirm
    if (pending) this.resolveConfirm({ taskId: task.id, confirmId: pending.id, confirm: false })
    task.state.status = 'error'
    task.state.error = `cancelled: ${params.reason || 'requested'}`
    task.state.time.end = Date.now()
    delete task.state.waitingFor
    // **先发信号,再 publish。** 标状态只是让界面变样;真正让流程停下来的是这一发 ——
    // 没有它,取消就只是个说法(钻探停止后续跑循环照样合成下一轮,人看到"停了"而它还在点页面)。
    this.aborters.get(task.id)?.abort(`cancelled: ${params.reason || 'requested'}`)
    this.publish()
    return { ok: true, message: `cancel requested for ${task.id} (${task.name}) — anything already in flight may still finish` }
  }

  /** Stop/timeout must atomically deny every transient approval before the agent runtime unwinds. */
  cancelTransient(reason = 'active turn stopped'): number {
    let cancelled = 0
    for (const task of this.tasks.values()) {
      if (!task.transient || !isTaskLive(task)) continue
      if (this.cancel({ taskId: task.id, reason }).ok) cancelled += 1
    }
    return cancelled
  }

  resolveConfirm(params: { taskId: string; confirmId: string; confirm: boolean }): { ok: boolean } {
    const resolve = this.confirmResolvers.get(params.confirmId)
    const task = this.tasks.get(params.taskId)
    if (!resolve || !task || task.state.pendingConfirm?.id !== params.confirmId) return { ok: false }
    this.confirmResolvers.delete(params.confirmId)
    task.state.pendingConfirm = undefined
    task.state.time.update = Date.now()
    if (task.state.stalled) task.state.stalled = false
    task.state.output.push({ ts: Date.now(), level: 'info', text: `you chose: ${params.confirm ? 'confirm' : 'cancel'}` })
    this.publish()
    resolve(params.confirm)
    return { ok: true }
  }

  get(id: string): MaestroTask | null {
    return this.tasks.get(id) || null
  }

  list(): MaestroTask[] {
    return this.order.map((id) => this.tasks.get(id)).filter((t): t is MaestroTask => !!t)
  }

  snapshot(): MaestroTaskSnapshot {
    return { tasks: this.list(), ts: Date.now() }
  }

  /**
   * Keep every live task plus the last N finished ones. Finished tasks are retained so the UI can
   * still show what just happened and a late `task_output` read still works.
   */
  private trim(): void {
    const finished = this.order.filter((id) => {
      const t = this.tasks.get(id)
      return t && !isTaskLive(t)
    })
    const excess = finished.slice(0, Math.max(0, finished.length - MAX_FINISHED_TASKS))
    for (const id of excess) {
      this.tasks.delete(id)
      // 控制器跟着任务一起走,否则每轮钻探都往这张表里留一个永不回收的 AbortController。
      // 之后 handle.signal 会退回 handleFor 里那个【已中止】的信号 —— 见那里的注释。
      this.aborters.delete(id)
      this.order = this.order.filter((x) => x !== id)
    }
  }

  /**
   * Marks a silent task `stalled`. It never kills anything: from outside, "slow" and "hung" are not
   * distinguishable, and killing a slow-but-working traversal is worse than reporting it. The verdict
   * is cleared by the next report, so a task that resumes stops claiming to be stuck.
   */
  private armWatchdog(): void {
    if (this.watchdog) return
    this.watchdog = setInterval(() => {
      const now = Date.now()
      let changed = false
      let live = 0
      for (const task of this.tasks.values()) {
        if (!isTaskLive(task)) continue
        live += 1
        // 正在等用户点 Cancel/Confirm 的任务不算 stalled —— 它是【等你】,不是挂了。
        if (task.state.pendingConfirm) continue
        // 同理:在等别的任务(钻探等摄取队列)也不算 stalled —— 它是【在等】,不是挂了。
        if (task.state.waitingFor) continue
        const silent = now - task.state.time.update
        if (silent > TASK_STALL_MS && !task.state.stalled) {
          task.state.stalled = true
          task.state.output.push({
            ts: now,
            level: 'warn',
            text: `no progress for ${Math.round(silent / 1000)}s — ${stallHint(task.name).en}`
          })
          changed = true
        }
      }
      if (!live && this.watchdog) {
        clearInterval(this.watchdog)
        this.watchdog = null
      }
      if (changed) this.publish()
    }, 5_000)
    // Never let the interval hold the process open at quit.
    this.watchdog.unref?.()
  }

  private publish(): void {
    this.trim()
    try {
      xpcMain.broadcast(TASKS_CHANNEL, this.snapshot())
    } catch {
      /* no renderer listening yet — the pull path (listTasks) still works */
    }
  }
}

export const taskRegistry = new TaskRegistry()

/** Agent-facing digest of one task: status, progress, the bounded tail. NEVER the artifact. */
export const renderTaskOutput = (task: MaestroTask, tailLines = 40): string => {
  const s = task.state
  const dur = Math.round(((s.time.end || Date.now()) - s.time.start) / 1000)
  const head = [
    `task ${task.id} · ${task.name} · ${s.status}${s.stalled ? ' · STALLED' : ''}`,
    `title: ${s.title}`,
    s.progress ? `progress: ${s.progress.done ?? '?'}/${s.progress.total ?? '?'}${s.progress.stage ? ` · ${s.progress.stage}` : ''}` : '',
    `elapsed: ${dur}s${s.time.end ? '' : ' (running)'}`,
    s.droppedLines ? `NOTE: ${s.droppedLines} earlier output line(s) dropped (bounded tail)` : ''
  ].filter(Boolean)
  const tail = s.output.slice(-tailLines).map((l) => `[${l.level}] ${l.text}`)
  const foot = [
    s.result ? `result: ${s.result}` : '',
    s.error ? `error: ${s.error}` : '',
    task.artifacts?.length ? `artifacts: ${task.artifacts.map((a) => `${a.label}=${a.path}`).join(' · ')}` : '',
    s.stalled
      ? `STALLED — it has stopped reporting. ${stallHint(task.name).en} Tell the user; do not start a second run of the same task.`
      : ''
  ].filter(Boolean)
  return [...head, '', ...tail, '', ...foot].filter((l) => l !== undefined).join('\n')
}
