import { basename } from 'node:path'
/** Persist a bounded work label, never the whole argument object, command, URL query or credentials. */
export function toolActivity(toolName: string, args: unknown): string {
  const values = args && typeof args === 'object' ? args as Record<string, unknown> : {}
  if (['read', 'write', 'edit', 'grep', 'find', 'ls'].includes(toolName) && typeof values.path === 'string') return `${toolName} · ${basename(values.path).slice(0, 120)}`
  if (toolName === 'web_search' && typeof values.query === 'string') return `${toolName} · ${values.query.replace(/\s+/g, ' ').slice(0, 160)}`
  if (toolName === 'web_fetch' && typeof values.url === 'string') {
    try { const url = new URL(values.url); return `${toolName} · ${url.hostname}${url.pathname}`.slice(0, 200) } catch { /* Use the tool label for invalid URLs. */ }
  }
  return toolName
}
