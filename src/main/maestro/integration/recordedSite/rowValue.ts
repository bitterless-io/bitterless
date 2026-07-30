/** Value coercion shared by the recorded-site body builders and integration orchestration. */
export const stringFrom = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return ''
}

export const putUnknownIfPresent = (body: Record<string, unknown>, key: string, value: unknown): void => {
  if (value === null || value === undefined) return
  if (typeof value === 'string' && !value.trim()) return
  if (Array.isArray(value) && !value.length) return
  if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value as Record<string, unknown>).length) return
  body[key] = value
}

export const stableJson = (value: unknown): string => {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (typeof value === 'object') {
    const raw = value as Record<string, unknown>
    return `{${Object.keys(raw)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(raw[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
