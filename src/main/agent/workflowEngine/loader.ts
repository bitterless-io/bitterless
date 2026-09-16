import { createJiti } from 'jiti'
import { createRequire } from 'node:module'
import { isAbsolute } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { forEachNode, type WorkflowDefinition } from '@kimchi-dev/kimchi-workflows/flow'
import type { WorkflowStartRequest } from '../../../shared/agentWorkflow.api'
import { builtinWorkflow } from './builtins'

export const WORKFLOW_ENGINE_VERSION = 'kimchi-0.0.9'
export interface LoadedWorkflow { definition: WorkflowDefinition; sourceHash: string; engineVersion: typeof WORKFLOW_ENGINE_VERSION }
/** Validate the public committed-definition contract and capabilities this desktop host actually supports. */
export function validateWorkflow(value: unknown): WorkflowDefinition {
  if (!value || typeof value !== 'object' || !('nodes' in value) || !Array.isArray(value.nodes) || !('name' in value) || typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error('Invalid workflow: default export must be a committed Kimchi WorkflowDefinition (createWorkflow(...).commit())')
  }
  const workflow = value as WorkflowDefinition
  if (!Number.isInteger(workflow.maxConcurrency) || workflow.maxConcurrency < 1 || workflow.maxConcurrency > 16) throw new Error('Workflow maxConcurrency must be from 1 to 16')
  forEachNode(workflow.nodes, node => {
    if (node.kind !== 'step') return
    const step = node.step
    if (step.kind === 'interactive' || step.kind === 'questionnaire') throw new Error('Interactive/questionnaire steps require a resume host; this desktop release supports run and rerun only')
    if (step.kind === 'agent') {
      if (step.asks || step.resumable) throw new Error('Agent asks/resumable is not enabled in this desktop host')
      if (step.maxDurationMs !== undefined) throw new Error('Use createAgentTask({timeoutMs}) so timeout waits for confirmed Agent cleanup; native Agent maxDurationMs is not supported')
    }
  })
  return workflow
}

/** Worker-only; fresh Jiti cache for every run, including relative imports. Never called in main. */
export async function loadWorkflow(request: WorkflowStartRequest): Promise<LoadedWorkflow> {
  if (request.entry.kind === 'builtin') {
    const definition = validateWorkflow(builtinWorkflow(request.entry.name))
    const sourceHash = createHash('sha256').update(`${WORKFLOW_ENGINE_VERSION}:${definition.name}:${JSON.stringify(definition)}`).digest('hex')
    return { definition, sourceHash, engineVersion: WORKFLOW_ENGINE_VERSION }
  }
  if (!isAbsolute(request.entry.path) || !/\.(?:ts|mts)$/.test(request.entry.path)) throw new Error('Workflow path must be an absolute .ts or .mts file')
  const require = createRequire(import.meta.url)
  const alias: Record<string, string> = {}
  for (const name of ['typebox', 'typebox/value', 'typebox/compile', '@kimchi-dev/kimchi-workflows', '@kimchi-dev/kimchi-workflows/flow', '@kimchi-dev/kimchi-workflows/engine']) alias[name] = require.resolve(name)
  const bundledAuthor = new URL('./workflow-author.mjs', import.meta.url)
  alias['@bitterless/workflow'] = fileURLToPath(existsSync(bundledAuthor) ? bundledAuthor : new URL('./author.ts', import.meta.url))
  const jiti = createJiti(import.meta.url, { alias, moduleCache: false, fsCache: false })
  const module = await jiti.import<{ default?: unknown }>(request.entry.path)
  const definition = validateWorkflow(module.default)
  // Entry fingerprint is provenance, not a transitive dependency hash or permission for crash-resume.
  const sourceHash = createHash('sha256').update(await readFile(request.entry.path)).digest('hex')
  return { definition, sourceHash, engineVersion: WORKFLOW_ENGINE_VERSION }
}
