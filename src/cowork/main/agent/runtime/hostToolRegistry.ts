import type { HostToolPolicyMap, HostToolPolicyMode, HostToolScope } from '@cowork-shared/coach.api'
import { HOST_TOOL_CATALOG } from '../hostToolCatalog'
import type { AgentToolSpec } from './agentRuntime.types'

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

  toRuntimeTools(): AgentToolSpec[] {
    this.checkCatalogCoverage()
    return Array.from(this.tools.values())
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
      execute: async (args) => {
        const allowed = await this.options.onConfirm?.({
          scope: this.options.scope,
          toolName: tool.name,
          mode,
          args
        })
        if (!allowed) throw new Error(`Tool "${tool.name}" was denied by the operator.`)
        return await tool.execute(args)
      }
    }
  }
}
