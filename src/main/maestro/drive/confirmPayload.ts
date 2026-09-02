import type { MaestroConfirmField, MaestroTaskConfirm } from '@maestro-shared/task.api'

const VALUE_CAP = 120
const FIELD_CAP = 40

const render = (value: unknown): string => {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') {
    return value.length > VALUE_CAP
      ? `${value.slice(0, VALUE_CAP)}…(+${value.length - VALUE_CAP})`
      : value
  }
  if (typeof value === 'object') {
    const json = JSON.stringify(value) ?? String(value)
    return json.length > VALUE_CAP ? `${json.slice(0, VALUE_CAP)}…` : json
  }
  return String(value)
}

/**
 * Maestro has no response-exchange ledger. It can still show the exact payload fields, but
 * every provenance verdict must stay `unknown` rather than pretending a value is grounded.
 */
export const buildUnknownConfirmPayload = (params: {
  summary: string
  intent?: string
  query?: Record<string, unknown> | null
  body?: unknown
}): NonNullable<MaestroTaskConfirm['payload']> => {
  const fields: MaestroConfirmField[] = []
  let truncated = 0

  const walk = (prefix: string, node: unknown): void => {
    if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        walk(prefix ? `${prefix}.${key}` : key, value)
      }
      return
    }
    if (Array.isArray(node)) {
      node.forEach((value, index) => walk(`${prefix}[${index}]`, value))
      return
    }
    if (fields.length >= FIELD_CAP) {
      truncated += 1
      return
    }
    fields.push({ path: prefix, value: render(node), provenance: 'unknown' })
  }

  if (params.query && Object.keys(params.query).length) walk('query', params.query)
  if (params.body !== undefined && params.body !== null) walk('body', params.body)
  if (truncated) {
    fields.push({
      path: '…',
      value: `${truncated} more fields are omitted (limit ${FIELD_CAP})`,
      provenance: 'unknown'
    })
  }

  return {
    intent: params.intent?.trim() || undefined,
    summary: params.summary,
    fields
  }
}
