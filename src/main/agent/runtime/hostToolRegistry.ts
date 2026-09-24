import type { HostToolPolicyMap, HostToolPolicyMode, HostToolScope } from '@maestro-shared/coach.api'
import { HOST_TOOL_CATALOG } from '../hostToolCatalog'
import type { AgentToolSpec } from '@main/agent/runtime/agentRuntime.types'
import { inputBudget, subjectOf } from '@main/agent/runtime/inputBudget'
import { modelIoLog } from '@main/agent/runtime/modelIoLog'

export interface HostToolConfirmRequest {
  scope: HostToolScope
  toolName: string
  mode: HostToolPolicyMode
  args: Record<string, unknown>
}

export interface HostToolRegistryOptions {
  scope: HostToolScope
  policies?: HostToolPolicyMap
  onWarning?: (message: string, detail?: unknown) => void
  onConfirm?: (request: HostToolConfirmRequest) => Promise<boolean>
}

export class HostToolRegistry {
  private readonly tools = new Map<string, AgentToolSpec>()

  constructor(private readonly options: HostToolRegistryOptions) {}

  add(...tools: AgentToolSpec[]): this {
    for (const tool of tools) {
      if (!tool?.name) continue
      if (this.tools.has(tool.name)) {
        this.options.onWarning?.('duplicate host tool ignored', { scope: this.options.scope, tool: tool.name })
        continue
      }
      const mode = this.options.policies?.[tool.name]?.mode || 'bypass'
      if (mode === 'disabled') continue
      this.tools.set(tool.name, mode === 'confirm' ? this.confirmedTool(tool, mode) : tool)
    }
    return this
  }

  /**
   * 只套策略(disabled / confirm),不包计量壳。给不是聊天 agent 自己模型输入的调用:
   * - 界面直接调用(Skills 页的 `manageSkillInstallation`):计量了会在 agent-io 的 `unattributed` 桶里
   *   多出记录,还会算进正在跑的回合的统计;
   * - 工作流子 agent 的工具:结果已由工作流 worker 记进聊天那一份 agent-io,再计量就是同一次调用记两份。
   * 聊天 agent 的工具一律走 `toRuntimeTools()`。
   */
  toUnmeasuredTools(): AgentToolSpec[] {
    this.checkCatalogCoverage()
    return Array.from(this.tools.values())
  }

  toRuntimeTools(): AgentToolSpec[] {
    this.checkCatalogCoverage()
    // **每个**工具都过一层计量,不只是需要确认的那些。上下文是所有工具结果堆起来的,
    // 只量一部分等于量不到(2026-08-20 那次 context_length_exceeded 就是无从定位)。
    return Array.from(this.tools.values()).map((tool) => this.measuredTool(tool))
  }

  /**
   * 计量壳:结果产生的那一刻记两笔 —— `inputBudget` 记字节数和一个短标签(`turn_end` 那行
   * 「本轮工具结果 X tok / N 次」就是它的汇总),agent-io(`modelIoLog`)记原文。
   *
   * 为什么在这里:聊天 agent 的宿主工具都经 `toRuntimeTools()` 交给 runtime。原来没有这一层,聊天回合的
   * 宿主工具结果一条都不进 agent-io,`turn_end` 一直是「0 tok / 0 次」
   * (docs/issues/builtin-tools-skip-host-result-hooks.md)。pi 自带工具(bash / read / …)不经这里,
   * 那一半见同一个 issue。
   *
   * 包在 `confirmedTool` **外面**:操作员拒绝也是一段回到模型的文本,和别的抛错一样要记。
   * 三个参数原样透传:这是透明的计量层,签名与 `AgentToolSpec` 相同。confirm 策略下 `deferConfirmation`
   * 工具的 `context.confirm` 由里层 `confirmedTool` 生成,不经过这一层。
   *
   * 记的是工具自己的结果;`executeHostTool` 之后才追加的下载 NOTE 不在里面(issue 里的已知残留)。
   */
  private measuredTool(tool: AgentToolSpec): AgentToolSpec {
    return {
      ...tool,
      execute: async (args, signal, context) => {
        const subject = subjectOf(args)
        try {
          const out = await tool.execute(args, signal, context)
          const text = typeof out === 'string' ? out : JSON.stringify(out ?? '')
          inputBudget.record(tool.name, Buffer.byteLength(text, 'utf8'), subject)
          // **原文落盘**(Ral 2026-08-20:「给大模型输入的内容,哪怕超出窗口,也应该留在 jsonl 里面」)。
          // 账本只有构成,而结构化数据的分片方案要看原始数据 —— 光有分布定不出怎么切。
          modelIoLog.append({ kind: 'tool_result', name: tool.name, subject, text, turn: inputBudget.turnIndexNow })
          return out
        } catch (err) {
          const msg = (err as Error)?.message || String(err)
          inputBudget.record(tool.name, Buffer.byteLength(msg, 'utf8'), subject)
          // 失败的工具照样把错误文本塞进上下文,所以它也要留痕。
          modelIoLog.append({ kind: 'tool_result', name: tool.name + ' (threw)', subject, text: msg, turn: inputBudget.turnIndexNow })
          throw err
        }
      }
    }
  }

  private checkCatalogCoverage(): void {
    const catalogNames = new Set(
      HOST_TOOL_CATALOG.filter((tool) => tool.scopes.includes(this.options.scope)).map((tool) => tool.name)
    )
    for (const name of this.tools.keys()) {
      if (catalogNames.has(name)) continue
      this.options.onWarning?.('host tool missing catalog entry', { scope: this.options.scope, tool: name })
    }
  }

  private confirmedTool(tool: AgentToolSpec, mode: HostToolPolicyMode): AgentToolSpec {
    return {
      ...tool,
      execute: async (args, signal) => {
        signal?.throwIfAborted()
        const confirm = async (resolvedArgs: Record<string, unknown>): Promise<boolean> => {
          signal?.throwIfAborted()
          const allowed = await this.options.onConfirm?.({
            scope: this.options.scope,
            toolName: tool.name,
            mode,
            args: resolvedArgs
          })
          signal?.throwIfAborted()
          return allowed === true
        }
        if (tool.deferConfirmation) return await tool.execute(args, signal, { confirm })
        const allowed = await confirm(args)
        if (!allowed) throw new Error(`Tool "${tool.name}" was denied by the operator.`)
        signal?.throwIfAborted()
        return await tool.execute(args, signal)
      }
    }
  }
}
