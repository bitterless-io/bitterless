import type { AgentRuntimePrompt } from './agentRuntime.types'

/**
 * 可被打断的 `bash` —— 让「人在 tooling 期间发的那句话」有机会送到模型手上。
 *
 * ## 为什么要这个
 *
 * pi 只在**工具边界**投递 steering(`agent-loop.js:158`:`executeToolCalls` 整批跑完才读队)。
 * 一条不返回的命令 ⇒ 没有边界 ⇒ 排队的消息永远投不出去。2026-09-22 实录:一条
 * `grep -rli … .`(93 GB 工作区)跑了 11 分钟没回来,Ral 那句「我是指网页中找」再也送不进去,
 * 最后只能去终端 `kill`(`docs/issues/bash-tool-has-no-timeout-and-wedges-the-turn.md`)。
 *
 * Ral 2026-09-22 定的要求是:**「当我发消息干涉的时候,ai 判断要不要停止这个 bash 并重新判断
 * 该如何操作」** —— 注意判断权在模型,宿主只负责把「打断」这件事变成一个**工具边界**,
 * 让消息有机会被读到。
 *
 * ## 为什么不用重写 bash
 *
 * pi 的 bash 工具本来就是可插拔的(`core/tools/bash.d.ts`:「Pluggable operations for the bash
 * tool」)。`createLocalBashOperations()` 是 pi 自己的本地实现 —— spawn、`killProcessTree`、
 * 输出截断全在里面。这里只把它的 `exec` **包一层**,拿到一个宿主自己的 `AbortController`。
 * 宿主这边一行 shell 逻辑都不写。
 *
 * ## 为什么不需要 excludeTools
 *
 * pi 组装工具表时,先放 builtin 再用 customTools **按名字覆盖**
 * (`agent-session.js:2119` `definitionRegistry.set(tool.definition.name, …)`)。
 * 所以注册一个同样叫 `bash` 的自定义工具就够了。**不要**改用 `excludeTools: ['bash']` ——
 * 它过滤的是「活跃工具名单」(`sdk.js:144`),会把我们自己这一个也一起关掉。
 *
 * ## 它不做什么
 *
 * **不 abort 整个回合。** 回合、上下文、已完成的工具结果全部保留,只有那一条命令被杀掉;
 * 模型在下一次 LLM 调用时同时看到「用户说了什么」和「刚才那条命令被打断了」。
 * 也**不设默认超时** —— Ral 2026-09-22:「60s 不可以,超时设置先不做」。没人干涉时它照旧跑到完。
 */

/** pi `BashOperations` 上我们用到的那一小片(本仓对 pi 一贯手写最小结构)。 */
export interface PiBashExecOptions {
  onData: (data: Buffer) => void
  signal?: AbortSignal
  timeout?: number
  env?: NodeJS.ProcessEnv
}

export interface PiBashOperations {
  exec: (command: string, cwd: string, options: PiBashExecOptions) => Promise<{ exitCode: number | null }>
}

export interface InterruptibleBash {
  /** 交给 `createBashToolDefinition(cwd, { operations })` 的那份。 */
  operations: PiBashOperations
  /**
   * 打断当前正在跑的那条命令。没有在跑时返回 `false` —— 调用方据此知道「这次没有边界可造」。
   * `reason` 会出现在工具结果里,模型看得见。
   */
  interrupt: (reason: string) => boolean
  /** 当前命令已经跑了多久(毫秒);没有在跑时为 `undefined`。给界面说人话用。 */
  runningForMs: () => number | undefined
}

/** 一行给模型看的说明 —— 说清「被谁打断、跑了多久、原来在跑什么」,不加解释也不替它决定。 */
const interruptedNote = (reason: string, command: string, elapsedMs: number): string =>
  `\n[interrupted after ${Math.round(elapsedMs / 1000)}s] ${reason}\n` +
  `The command was: ${command}\n` +
  'It was killed (whole process tree). Nothing about its result is known — ' +
  'decide whether to run it again, narrow it, or do something else.\n'

export const createInterruptibleBash = (local: PiBashOperations): InterruptibleBash => {
  let current: { controller: AbortController; startedAt: number; command: string; reason?: string } | undefined

  const operations: PiBashOperations = {
    exec: async (command, cwd, options) => {
      const controller = new AbortController()
      const running: { controller: AbortController; startedAt: number; command: string; reason?: string } =
        { controller, startedAt: Date.now(), command }
      current = running
      // 合并两个 signal:回合自己的(Stop / 超时)与我们这一个(被人打断)。少了前者,Stop 就杀不掉
      // 正在跑的命令;少了后者,本文件就没有存在的意义。
      const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
      try {
        return await local.exec(command, cwd, { ...options, signal })
      } catch (error) {
        // 只认领**我们自己**这一次打断。回合级的 abort 与命令自身的错误原样抛回去 ——
        // 把别人的失败说成「被操作者打断」是另一种撒谎。
        if (!controller.signal.aborted) throw error
        options.onData(Buffer.from(interruptedNote(running.reason || 'interrupted by the operator', command, Date.now() - running.startedAt)))
        // `exitCode: null` 是 pi 对「被杀掉」的既有表示(`BashOperations.exec` 的注释:
        // 「null if killed」)—— 不自造新值。
        return { exitCode: null }
      } finally {
        if (current === running) current = undefined
      }
    }
  }

  return {
    operations,
    interrupt: (reason: string): boolean => {
      const running = current
      if (!running || running.controller.signal.aborted) return false
      running.reason = reason
      running.controller.abort()
      return true
    },
    runningForMs: (): number | undefined => (current ? Date.now() - current.startedAt : undefined)
  }
}

/** 打断的理由文案 —— 只有一处,免得日志、工具结果、界面三处各说各话。 */
export const steeringInterruptReason = (message: Pick<AgentRuntimePrompt, 'text'>): string =>
  `The operator sent a message while this command was running: ${JSON.stringify(message.text.slice(0, 200))}`
