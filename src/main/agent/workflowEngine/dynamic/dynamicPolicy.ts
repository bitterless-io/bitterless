import { buildDefaultTierConfig, getModelTierConfigPath, loadModelTierConfig, saveModelTierConfig } from '@quintinshaw/pi-dynamic-workflows'

/**
 * The host's own limits on a dynamic workflow run.
 *
 * The engine's defaults are generous by design — up to 1000 agents, 16 concurrent, **no** per-agent
 * timeout. Those are right for a CLI a developer is watching; they are not right for a desktop app
 * where the same run competes with the chat the owner is typing into. The previous engine's host
 * bounded every one of these, so accepting the library defaults here would not be "using the
 * package as intended", it would be a silent regression from bounded to unbounded.
 */
export const DYNAMIC_RUN_BOUNDS = {
  /** Concurrent agents. Matches what the retired host allowed per run. */
  concurrency: 4,
  /** Hard ceiling per run. A fan-out driven by model output must not be able to open a thousand. */
  maxAgents: 100,
  /** 10 minutes, as before. `null` — the engine's default — means an agent can hang forever. */
  agentTimeoutMs: 600_000,
  /** One retry for a recoverable failure, as before. */
  agentRetries: 1
} as const

/**
 * Name of the toolset every run's subagents get: coding tools plus web search/fetch.
 *
 * A NAME rather than an array because `ExecOptions.tools` cannot be persisted — it is functions — so
 * a run resumed after a restart would come back with the default coding tools and no web access,
 * silently weaker than the run that was interrupted. The tag is what survives on disk and is
 * re-resolved on resume.
 */
export const DYNAMIC_TOOLSET = 'workflow-default'

/**
 * Read-only tools, for a workflow whose whole contract is that it changes nothing.
 *
 * The engine's `agent()` options have no per-call tool list — the package's own contract names
 * label/phase/schema/model/thinking/tier/isolation/cwd/thread/agentType/timeoutMs/retries and
 * nothing else — so a single agent cannot be narrowed the way the retired engine's `tools: ['read',
 * 'grep', 'find', 'ls']` did. The toolset is per EXECUTION, which is the right grain here anyway:
 * the planner produces a proposal, so no agent in that run has any business writing a file or
 * running a command. A prompt saying so is not a permission boundary.
 */
export const READONLY_TOOLSET = 'workflow-readonly'

/** `provider/model`, the spec shape the engine and `createAgentSession` both speak. */
export const modelSpec = (runtime: { providerId: string; modelId: string }): string => `${runtime.providerId}/${runtime.modelId}`

/**
 * Make sure tier routing has something to route to.
 *
 * **A relay is just another provider** (Ral 2026-09-20:「relay 也只是个 provider,另外可以配置默认
 * medium」). An earlier version of this file special-cased AI-CRMS with a pre-spawn resolver that
 * rewrote or rejected each agent's model. That was solving a problem the package already solves, and
 * it made the host disagree with Pi about what a provider is.
 *
 * How the package actually resolves a subagent's model, most specific first:
 *
 * 1. an explicit `model` on the call or agent type,
 * 2. `tier` → the model-tiers config,
 * 3. **untagged → the `medium` tier**, but only when a tiers config exists,
 * 4. otherwise the session's `mainModel`.
 *
 * So with no config at all everything already lands on `mainModel` — including a relayed session,
 * whose main model is the one the owner selected. The only thing worth doing is step 3: seed a tiers
 * file once, from the models this machine can actually authenticate, so `{ tier: 'small' }` in a
 * script means something and untagged agents get a deliberate default rather than silently inheriting
 * the main model.
 *
 * Seeded **once and never overwritten**: the file is the owner's, shared with their own Pi CLI use.
 * Rewriting it on every launch would quietly undo a hand-edited tier on the next boot.
 */
export const ensureModelTiers = (mainModel?: string): 'seeded' | 'kept' | 'unavailable' => {
  try {
    if (loadModelTierConfig()) return 'kept'
    const config = buildDefaultTierConfig(mainModel)
    // `saveModelTierConfig` refuses a degenerate map (every tier empty), which is what
    // `buildDefaultTierConfig` returns when no registry and no main model are available. Calling it
    // anyway would write a file the loader then rejects on the next read.
    if (!Object.values(config.tiers ?? {}).some(spec => typeof spec === 'string' && spec.trim())) return 'unavailable'
    saveModelTierConfig(config)
    return 'seeded'
  } catch {
    // Tier routing degrades to `mainModel`, which is a working configuration. Failing a run because
    // a convenience file could not be written would be the wrong trade.
    return 'unavailable'
  }
}

/** Where the tiers file lives, for the log line that tells the owner what to edit. */
export const modelTiersPath = (): string => {
  try { return getModelTierConfigPath() } catch { return '' }
}
