import type {
  MaestroTaskArtifact,
  MaestroTaskConfirm,
  MaestroTaskProgress
} from '@maestro-shared/task.api'

/** Handle handed to whoever runs the task. Deliberately narrow: it can report, it cannot re-key itself. */
export interface TaskHandle {
  readonly id: string
  /**
   * **取消信号 —— 长流程要自己去看它**(Ral 2026-08-14:「点击 stop 停止了钻探,但实际钻探并没有
   * 被停止 …… 可以增加一个信号,在钻探的过程中通过这个信号去终止钻探中的各种操作」)。
   *
   * 在此之前 `cancel()` 只是**标个状态**:任务卡变成 error,而真正在跑的那个流程什么都不知道,
   * 照常往下走。钻探尤其明显 —— 停止只中断了当前那一发 LLM,宿主的续跑循环紧接着合成下一轮,
   * 于是"停了"之后它还在点页面。**没有传递取消的通道,取消就只是个说法。**
   *
   * 语义仍然是【请求】不是【强杀】:已经飞出去的 CDP 操作、正在跑的 LLM 往返不会凭空消失。
   * 但有了它,每个循环的下一次迭代、每个工具的入口都能自己停下 —— 这是"请求"能落地的唯一方式。
   */
  readonly signal: AbortSignal
  /** `signal.aborted` 的便捷读法 —— 循环里逐次判,不用到处解构 signal。 */
  readonly aborted: boolean
  /** Progress + optional log line. Every call refreshes `time.update`, which is what un-stalls it. */
  update(patch: { title?: string; progress?: MaestroTaskProgress; metadata?: Record<string, unknown>; line?: string; level?: 'info' | 'warn' | 'error' }): void
  log(text: string, level?: 'info' | 'warn' | 'error'): void
  artifact(artifact: MaestroTaskArtifact): void
  /** 进入/退出「在等别的东西」态 —— 传字符串写明在等什么,传 null 恢复。等待中豁免 stalled 看门狗。 */
  setWaiting(what: string | null): void
  complete(result: string, metadata?: Record<string, unknown>): void
  fail(error: string): void
  /**
   * Block on a user Cancel/Confirm. Sets `state.pendingConfirm` (→ running-tasks card renders the
   * buttons), and resolves true=Confirm / false=Cancel when the renderer calls `respondTaskConfirm`.
   * The task stays `running` and is exempt from the stall watchdog while it waits.
   *
   * `autoConfirmWhen`: optional best-effort predicate — while the card is pending, the registry polls
   * it; the first time it returns true the card auto-resolves as Confirm (used by the login pause:
   * human clicking "继续" is the reliable path, auto-detect of login success is the bonus).
   */
  requestConfirm(req: { title: string; detail?: string; confirmLabel?: string; cancelLabel?: string; payload?: MaestroTaskConfirm['payload']; autoConfirmWhen?: () => Promise<boolean> }): Promise<boolean>
}
