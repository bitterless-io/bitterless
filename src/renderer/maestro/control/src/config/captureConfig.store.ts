import { reactive } from 'vue'
import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import type { ConfigApi } from '@maestro-shared/config.api'
import { CAPTURE_DOMAIN, CAPTURE_WHITELIST_ENABLED_KEY } from '@maestro-shared/config.api'
import type { CaptureFilterApi, CaptureRule } from '@maestro-shared/captureFilter.api'

// Global network capture filter mirror. Workbench loads/saves these rules through sqlite and
// syncs them to main, where network events are actually accepted/rejected before they hit trace.
const config = createXpcRendererEmitter<ConfigApi>('ConfigDao') as ConfigApi
const filterApi = createXpcRendererEmitter<CaptureFilterApi>('CaptureFilterDao') as CaptureFilterApi

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

// Match one rule against an EVENT url (and its host):
//   - 'domain-suffix': host equals value OR ends with '.value' (so `micromeet.ai` matches
//     `crms.micromeet.ai`);
//   - 'url-prefix':    the full URL starts with value.
function matchRule(rule: CaptureRule, url: string, host: string): boolean {
  const v = (rule.value || '').trim().toLowerCase()
  if (!v) return false
  if (rule.rule === 'domain-suffix') return !!host && (host === v || host.endsWith('.' + v))
  if (rule.rule === 'url-prefix') return url.toLowerCase().startsWith(v)
  return false
}

class CaptureConfigStore {
  whitelist: CaptureRule[] = []
  blacklist: CaptureRule[] = []
  // Global toggle (config table). Off by default → whitelist is NOT applied.
  whitelistEnabled = false
  loaded = false

  // Load the global rule set + whitelist toggle. Call on capture-view startup and after the
  // Settings editor saves.
  async load(): Promise<void> {
    try {
      const [rules, toggle] = await Promise.all([
        filterApi.listAll(),
        config.get({ domain: CAPTURE_DOMAIN, key: CAPTURE_WHITELIST_ENABLED_KEY })
      ])
      this.whitelist = rules.filter((r) => r.type === 'whitelist').map((r) => ({ type: 'whitelist', rule: r.rule, value: r.value }))
      this.blacklist = rules.filter((r) => r.type === 'blacklist').map((r) => ({ type: 'blacklist', rule: r.rule, value: r.value }))
      this.whitelistEnabled = toggle?.options === true
      this.loaded = true
    } catch {
      // DB unreachable (earliest startup) → stay permissive (record everything).
      this.whitelist = []
      this.blacklist = []
      this.whitelistEnabled = false
    }
  }

  // Fold one rule into the global set and persist it (idempotent by rule + value, per type).
  // Reloads the mirror from sqlite afterward. Returns false only for an empty value. The caller
  // is responsible for pushing the refreshed set to main (e.g. via the Workbench syncCaptureOptions).
  async addRule(rule: CaptureRule): Promise<boolean> {
    const value = (rule.value || '').trim()
    if (!value) return false
    await this.load()
    const list = rule.type === 'whitelist' ? this.whitelist : this.blacklist
    if (list.some((r) => r.rule === rule.rule && r.value.trim().toLowerCase() === value.toLowerCase())) return true
    const rules: CaptureRule[] = [
      ...this.whitelist.map((r) => ({ type: 'whitelist' as const, rule: r.rule, value: r.value })),
      ...this.blacklist.map((r) => ({ type: 'blacklist' as const, rule: r.rule, value: r.value })),
      { type: rule.type, rule: rule.rule, value }
    ]
    await filterApi.replaceAll({ rules })
    await this.load()
    return true
  }

  // Whether a network event URL should become a record:
  //   1. no URL (e.g. error events) → kept (not URL-filtered);
  //   2. whitelist enabled + no whitelist rule matches → reject (whitelist runs FIRST);
  //   3. any blacklist rule matches → reject;
  //   4. otherwise → kept.
  // NEVER cancels the network request.
  passes(url: string): boolean {
    if (!url) return true
    const host = hostnameOf(url)
    if (this.whitelistEnabled && !this.whitelist.some((r) => matchRule(r, url, host))) return false
    if (this.blacklist.some((r) => matchRule(r, url, host))) return false
    return true
  }
}

export const captureConfig = reactive(new CaptureConfigStore())
