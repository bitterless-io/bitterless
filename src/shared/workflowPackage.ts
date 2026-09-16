import type { WorkflowManifest, WorkflowNodeKind } from './workflowLibrary.type'

export const WORKFLOW_LIMITS = { compressed: 20 * 1024 * 1024, expanded: 100 * 1024 * 1024, files: 500, manifest: 256 * 1024, nodes: 200, edges: 500 } as const
const kinds = new Set<WorkflowNodeKind>(['function', 'agent', 'parallel', 'branch', 'foreach', 'loop', 'workflow'])
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Workflow manifest must contain objects.')
  return value as Record<string, unknown>
}
const text = (value: unknown, field: string, max: number, empty = false): string => {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new Error(`Invalid workflow ${field}.`)
  return value
}
export const safePackagePath = (value: string): string => {
  if (!value || value.length > 240 || /[\\\x00-\x1f:<>"|?*]/.test(value) || value.startsWith('/') || value.endsWith('/')) throw new Error('Unsafe workflow archive path.')
  const parts = value.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Unsafe workflow archive path.')
  return value
}
export const parseWorkflowManifest = (value: unknown): WorkflowManifest => {
  const data = object(value)
  if (data.format !== 'kimchi-workflow-package' || data.version !== 1 || data.engine !== 'kimchi-0.0.9') throw new Error('Unsupported workflow package. Expected Kimchi 0.0.9 package version 1.')
  const entry = safePackagePath(text(data.entry, 'entry', 240))
  if (!/\.(ts|mts)$/.test(entry)) throw new Error('Workflow entry must be a .ts or .mts file.')
  const graph = object(data.graph)
  if (!Array.isArray(graph.nodes) || graph.nodes.length > WORKFLOW_LIMITS.nodes || !Array.isArray(graph.edges) || graph.edges.length > WORKFLOW_LIMITS.edges) throw new Error('Workflow graph exceeds 200 nodes or 500 edges, or is malformed.')
  const ids = new Set<string>()
  const nodes = graph.nodes.map(value => {
    const node = object(value)
    const id = text(node.id, 'node ID', 64)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id) || ids.has(id)) throw new Error('Workflow node IDs must be unique safe identifiers.')
    ids.add(id)
    if (!kinds.has(node.kind as WorkflowNodeKind)) throw new Error('Unsupported workflow node kind.')
    return { id, label: text(node.label, 'node label', 160), kind: node.kind as WorkflowNodeKind, ...(node.description === undefined ? {} : { description: text(node.description, 'node description', 4000, true) }) }
  })
  const edges = graph.edges.map(value => {
    const edge = object(value)
    if (typeof edge.from !== 'string' || typeof edge.to !== 'string' || !ids.has(edge.from) || !ids.has(edge.to)) throw new Error('Workflow edges must reference existing nodes.')
    return { from: edge.from, to: edge.to, ...(edge.label === undefined ? {} : { label: text(edge.label, 'edge label', 160, true) }) }
  })
  return { format: 'kimchi-workflow-package', version: 1, engine: 'kimchi-0.0.9', entry, name: text(data.name, 'name', 200), description: text(data.description, 'description', 8000, true), graph: { nodes, edges } }
}
