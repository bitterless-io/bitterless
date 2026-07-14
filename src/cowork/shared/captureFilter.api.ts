import type { ConfigRule } from './config.api'

// Dedicated `capture_filter` table: GLOBAL capture rules, applied to EVERY captured site (no
// per-site scoping). One row = one rule.
//   - type:  'whitelist' (only record matches, when the whitelist toggle is on) |
//            'blacklist' (never record matches)
//   - rule:  'domain-suffix' (host == value or ends with '.'+value) | 'url-prefix' (url starts with value)
//   - value: the match target for the rule
// Filters affect ONLY whether a network event becomes a record — they NEVER cancel requests.
export type CaptureFilterType = 'whitelist' | 'blacklist'

export interface CaptureRule {
  type: CaptureFilterType
  rule: ConfigRule['rule']
  value: string
}

// electron-xpc handler contract implemented by CaptureFilterDao (sqlite preload) and consumed
// via createXpcRendererEmitter<CaptureFilterApi>('CaptureFilterDao').
export interface CaptureFilterApi {
  // The full global rule set — used by both the runtime filter and the Settings editor.
  listAll(): Promise<CaptureRule[]>
  // Replace the entire global rule set (delete-then-insert in a transaction).
  replaceAll(params: { rules: CaptureRule[] }): Promise<{ ok: boolean }>
}
