// Encrypted config store contract. The store is intentionally generic and repurposed:
//   - `domain` is a CATEGORY (e.g. 'capture'),
//   - `key`    is a sub-setting within it (e.g. 'whitelist-enabled:<site>'),
//   - `options` is an arbitrary JSON payload (e.g. a boolean toggle).
// (domain, key) is unique. The DB lives in the sqlite window's preload (ConfigDao) and is
// reached from other windows via electron-xpc — see record/config/captureConfig.store.ts.

// A single match rule:
//   - 'domain-suffix': hostname equals `value` or ends with `.value`
//     (so `micromeet.ai` matches `crms.micromeet.ai`) — used by the record display filter.
//   - 'url-prefix': full URL starts with `value` — used by the network request blocklist
//     (matching requests are CANCELLED, not just hidden from records).
export interface ConfigRule {
  rule: 'domain-suffix' | 'url-prefix' | string
  value: string
}

export interface ConfigEntry {
  domain: string
  key: string
  options: unknown
}

// The electron-xpc handler contract implemented by ConfigDao (preload) and consumed by
// renderers as createXpcRendererEmitter<ConfigApi>('ConfigDao').
export interface ConfigApi {
  // All entries for a category, e.g. list({ domain: 'capture' }).
  list(params: { domain: string }): Promise<ConfigEntry[]>
  get(params: { domain: string; key: string }): Promise<ConfigEntry | null>
  upsert(params: { domain: string; key: string; options: unknown }): Promise<{ ok: boolean }>
  remove(params: { domain: string; key: string }): Promise<{ ok: boolean }>
}

// Capture-filter coordinates in the generic config table. The whitelist/blacklist RULES live
// in the dedicated `capture_filter` table (see captureFilter.api.ts) — only the single global
// "whitelist enabled" toggle stays here (options = boolean).
export const CAPTURE_DOMAIN = 'capture'
export const CAPTURE_WHITELIST_ENABLED_KEY = 'whitelist-enabled'

// Workbench ▸ Models stores the active provider/model/effort as one JSON object so provider
// switches are atomic and easy to migrate.
export const LLM_CONFIG_DOMAIN = 'llm'
export const LLM_TARGET_KEY = 'active-target'
export const LLM_COMPRESSION_REMAINING_KEY = 'compression-remaining-percent'

// App-wide default project workspace. Individual chat sessions may store their own
// workspace in cowork_chat_session.detail_json; this value seeds new chats and lets
// the selected workspace survive when there is no persisted conversation yet.
export const WORKSPACE_CONFIG_DOMAIN = 'workspace'
export const WORKSPACE_DEFAULT_KEY = 'default'

// Host tool permission policy. Default mode is bypass, matching the app's local-agent posture.
// `confirm` asks the operator before each call, and `disabled` removes tools from the runtime
// surface while keeping them visible in Workbench for recovery.
export const HOST_TOOL_CONFIG_DOMAIN = 'host-tools'
export const HOST_TOOL_POLICY_KEY = 'policy'
export const HOST_APPROVAL_HISTORY_KEY = 'approval-history'

// `integration-targets` / `integration-mappings` 两个 domain 随 Integration 子系统于 2026-09
// 退役。它们的存量孤儿行由一次性清理删除(见 docs/features/maestro-crms-retirement.md #6.7),
// domain 名只在那段清理代码里还写着一次,不再是本契约的一部分。

// apidoc 摄取自己的 config 域(drill-001)。与 cowork 同名同值 —— 两边的库虽然各自独立,
// 但域名对齐能让同一份文档/排查经验在两侧都成立。
export const APIDOC_CONFIG_DOMAIN = 'apidoc'

// Decision settings —— agent 回路里的结构化判断由谁来做。今天只有 Jev 这一行开关
// (options = boolean;读不到 / 读失败一律当作关)。插入点见 overmind
// `areas/agent-runtime/decision/browser-use.html` #1。
// **域名与 key 与 cowork 完全一致** —— 两边库各自独立,但对齐后同一份排查经验两侧都成立。
export const DECISION_CONFIG_DOMAIN = 'decision'
export const DECISION_JEV_ENABLED_KEY = 'jev-enabled'
