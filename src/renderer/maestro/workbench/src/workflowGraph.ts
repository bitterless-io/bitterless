import type { WorkflowManifest } from '@shared/workflowLibrary.type'

/** Finite layout for authored metadata, including cycles. It never loads executable workflow code. */
export const layoutWorkflowGraph = (graph: WorkflowManifest['graph']) => {
  const visiting = new Set<string>(), finished = new Set<string>()
  const backEdges = new Set<WorkflowManifest['graph']['edges'][number]>()
  const visit = (id: string): void => {
    if (finished.has(id)) return
    visiting.add(id)
    for (const edge of graph.edges.filter(item => item.from === id)) {
      if (visiting.has(edge.to)) backEdges.add(edge)
      else visit(edge.to)
    }
    visiting.delete(id)
    finished.add(id)
  }
  for (const node of graph.nodes) visit(node.id)
  const levels = new Map<string, number>()
  const incoming = new Map(graph.nodes.map(node => [node.id, 0]))
  const outgoing = new Map(graph.nodes.map(node => [node.id, [] as string[]]))
  for (const edge of graph.edges.filter(edge => !backEdges.has(edge))) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
    outgoing.get(edge.from)?.push(edge.to)
  }
  const queue = graph.nodes.filter(node => incoming.get(node.id) === 0).map(node => node.id)
  for (const id of queue) levels.set(id, 0)
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    for (const to of outgoing.get(id) ?? []) {
      levels.set(to, Math.max(levels.get(to) ?? 0, (levels.get(id) ?? 0) + 1))
      incoming.set(to, incoming.get(to)! - 1)
      if (incoming.get(to) === 0) queue.push(to)
    }
  }
  const visited = new Set(queue)
  let cycleLevel = Math.max(0, ...levels.values())
  for (const node of graph.nodes) if (!visited.has(node.id)) levels.set(node.id, cycleLevel++)
  const columns = new Map<number, typeof graph.nodes>()
  for (const node of graph.nodes) {
    const level = levels.get(node.id) ?? 0
    columns.set(level, [...(columns.get(level) ?? []), node])
  }
  const height = Math.max(280, 100 + Math.max(1, ...[...columns.values()].map(nodes => nodes.length)) * 122)
  const nodes = graph.nodes.map(node => {
    const level = levels.get(node.id) ?? 0
    const column = columns.get(level)!
    return { ...node, x: 44 + level * 256, y: (height - column.length * 122) / 2 + column.indexOf(node) * 122, width: 184, height: 82 }
  })
  const byId = new Map(nodes.map(node => [node.id, node]))
  const graphBottom = Math.max(0, ...nodes.map(node => node.y + node.height))
  const edges = graph.edges.map((edge, index) => {
    const from = byId.get(edge.from)!
    const to = byId.get(edge.to)!
    const x1 = from.x + from.width, y1 = from.y + 41, x2 = to.x, y2 = to.y + 41
    const backwards = x2 <= x1
    const routeY = graphBottom + 24 + (index % 3) * 12
    return { ...edge, key: `${edge.from}-${edge.to}-${index}`, path: backwards ? `M ${x1} ${y1} C ${x1 + 32} ${y1}, ${x1 + 32} ${routeY}, ${x1} ${routeY} L ${x2 - 24} ${routeY} Q ${x2 - 38} ${routeY}, ${x2 - 24} ${y2} L ${x2} ${y2}` : `M ${x1} ${y1} C ${x1 + 36} ${y1}, ${x2 - 36} ${y2}, ${x2} ${y2}`, labelX: (x1 + x2) / 2, labelY: backwards ? routeY - 8 : (y1 + y2) / 2 - 12 }
  })
  return { nodes, edges, width: Math.max(340, 272 + Math.max(0, ...levels.values()) * 256), height }
}
