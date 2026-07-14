import type { HeaderMap } from '@cowork-shared/trace.types'

// HH:mm:ss (24h) for the record's right-side timestamp.
export function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// Status pill color by HTTP range (2xx ok, 4xx client, 5xx server).
export function statusBadge(status?: number): string {
  if (status && status >= 500) return 'bg-red-100 text-red-700'
  if (status && status >= 400) return 'bg-amber-100 text-amber-700'
  if (status && status >= 200 && status < 300) return 'bg-emerald-100 text-emerald-700'
  return 'bg-gray-100 text-gray-600'
}

// Headers → one "key: value" per line (array values joined). '' when none.
export function fmtHeaders(headers?: HeaderMap): string {
  if (!headers) return ''
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join('\n')
}

// Kind-label color for the record header.
export function kindClass(kind: string): string {
  if (kind === 'net.request') return 'text-[#1d4f91]'
  if (kind === 'net.response') return 'text-[#0f766e]'
  if (kind === 'action') return 'text-[#b45309]'
  if (kind === 'snapshot') return 'text-[#7c3aed]'
  if (kind === 'error') return 'text-[#b91c1c]'
  return 'text-gray-500'
}

// Path (+ query) of a URL, for the snapshot record. Full URL falls back if unparseable.
export function urlPath(url?: string): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}
