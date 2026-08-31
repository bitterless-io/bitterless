import { extname } from 'path'
import { clipText, summarizeActionApiCorrelations } from '@maestro-main/capture/traceTimeline'
import type {
  AgentCompactRequest,
  AgentConversationContext,
  HostToolPolicyMap,
  HostToolPolicyMode,
  IngestRecord,
  SkillSummary
} from '@maestro-shared/coach.api'

/**
 * Pure prompt and payload shaping for Maestro agent turns.
 *
 * This intentionally keeps Bitterless' rich, relevance-ranked skill briefs. Cowork's newer slim
 * catalog is not behavior-compatible with the current Maestro prompt contract.
 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const AI_CRMS_ASR_MODEL = 'fun-asr-flash-2026-06-15'
export const MAX_ASR_AUDIO_BYTES = 16 * 1024 * 1024
export const MAX_AGENT_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_AGENT_IMAGES = 8
export const MAX_AGENT_MEDIA_REFS = 16

const MAX_AGENT_SKILL_BRIEFS = 40
const MAX_AGENT_SKILL_INPUTS = 32
const MAX_AGENT_SKILL_TRIGGERS = 16
const MAX_AGENT_SKILL_DESCRIPTION_CHARS = 420
const MAX_AGENT_SKILL_INLINE_CHARS = 600

export const safeUrlForDebug = (value: string): string => {
  try {
    const url = new URL(value)
    const hadSearch = Boolean(url.search)
    const hadHash = Boolean(url.hash)
    url.search = ''
    url.hash = ''
    return `${url.toString()}${hadSearch ? '?...' : ''}${hadHash ? '#...' : ''}`
  } catch {
    return value ? '[invalid-url]' : ''
  }
}

export const bailianMultimodalGenerationUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (/\/multimodal-generation\/generation$/i.test(trimmed)) return trimmed
  return `${trimmed}/multimodal-generation/generation`
}

export const normalizeAsrFormat = (format?: string, mime?: string): string => {
  const raw = String(format || '')
    .trim()
    .toLowerCase()
  if (raw === 'wav' || raw === 'mp3' || raw === 'mpeg' || raw === 'opus') {
    return raw === 'mpeg' ? 'mp3' : raw
  }
  const normalizedMime = String(mime || '')
    .trim()
    .toLowerCase()
  if (normalizedMime.includes('mpeg') || normalizedMime.includes('mp3')) return 'mp3'
  if (normalizedMime.includes('opus')) return 'opus'
  return 'wav'
}

export const readAssistantContent = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const record = part as Record<string, unknown>
      return typeof record.text === 'string' ? record.text : ''
    })
    .filter(Boolean)
    .join('')
}

export const readScribeText = (body: unknown): string => {
  if (!body || typeof body !== 'object') return ''
  const record = body as Record<string, any>
  const nativeText =
    record.output?.text || record.output?.sentence?.text || record.text || record.sentence?.text
  if (typeof nativeText === 'string') return nativeText.trim()
  const dashscopeText = readAssistantContent(record.output?.choices?.[0]?.message?.content)
  if (dashscopeText) return dashscopeText.trim()
  const choiceText = readAssistantContent(record.choices?.[0]?.message?.content)
  return choiceText.trim()
}

export const AGENT_IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

export const AGENT_FILE_MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.log': 'text/plain'
}

export const buildTrainerTurnPrompt = (params: {
  message: string
  skills: string
  recording: string
  currentUrl: string
}): string => {
  let domain = params.currentUrl
  try {
    domain = new URL(params.currentUrl).hostname
  } catch {
    /* keep raw */
  }
  return [
    `Current URL: ${params.currentUrl}`,
    `You train skills for THIS site only (${domain}). The skills below and any you create/optimize/delete belong to this domain; new skills are saved under it automatically.`,
    '',
    `Existing skills for ${domain}:`,
    params.skills,
    '',
    'Current capture quick index (not full evidence; use capture_timeline / capture_search / capture_event_detail for details before creating non-trivial skills):',
    params.recording,
    '',
    'User message:',
    params.message
  ].join('\n')
}

export const summarizeRecordsForTrainer = (records: IngestRecord[]): string => {
  const events = records.map((record) => record.event)
  const actions = events.filter((event) => event.kind === 'action').length
  const net = events.filter(
    (event) => event.kind === 'net.request' || event.kind === 'net.response'
  ).length
  if (actions === 0 && net === 0) {
    return '(no active capture — Capture first to create a skill from a capture)'
  }
  const lines = records
    .slice(-40)
    .map((record) => {
      const event = record.event
      const prefix = record.flagged ? '* ' : ''
      const suffix = record.spec?.trim() ? ` — ${record.spec.trim()}` : ''
      if (event.kind === 'action') return `${prefix}[ui] ${event.desc}${suffix}`
      if (event.kind === 'net.request') {
        return `${prefix}[req] ${event.method} ${event.url}${suffix}`
      }
      if (event.kind === 'net.response') {
        return `${prefix}[res] ${event.status} ${event.url}${suffix}`
      }
      if (event.kind === 'snapshot') {
        return `${prefix}[snapshot] ${event.title || event.url}${suffix}`
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
  const correlations = summarizeActionApiCorrelations(records, 8)
  return `${actions} UI steps, ${net} network events.\n${lines}${correlations ? `\nLikely UI→API links:\n${correlations}` : ''}`
}

export const normalizeHostToolPolicies = (value: unknown): HostToolPolicyMap => {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const out: HostToolPolicyMap = {}
  for (const [key, itemValue] of Object.entries(raw)) {
    const item =
      itemValue && typeof itemValue === 'object' && !Array.isArray(itemValue)
        ? (itemValue as Record<string, unknown>)
        : {}
    const toolName = String(item.toolName || key || '').trim()
    if (!toolName) continue
    out[toolName] = {
      toolName,
      mode: normalizeHostToolPolicyMode(item.mode),
      updatedAt:
        Number.isFinite(Number(item.updatedAt)) && Number(item.updatedAt) > 0
          ? Number(item.updatedAt)
          : Date.now()
    }
  }
  return out
}

export const normalizeHostToolPolicyMode = (value: unknown): HostToolPolicyMode => {
  if (value === 'disabled') return 'disabled'
  if (value === 'confirm') return 'confirm'
  return 'bypass'
}

const COMPACT_CONTEXT_SYSTEM_PROMPT = [
  'SYSTEM: You are a context compaction engine for an ongoing coding/browser agent chat.',
  'Your job is to rewrite older conversation context into one cumulative memory summary that can replace those older turns.',
  'Use only the supplied previous summary and message excerpts. Do not invent facts, tool results, account state, URLs, IDs, or decisions.',
  'If a newer raw message conflicts with the previous summary, prefer the newer raw message and note the correction briefly.',
  'The previous summary is cumulative historical context. Merge it with the newly compacted range instead of appending duplicates.',
  'Preserve the previous summary as much as possible. It is acceptable for the cumulative summary to grow over time and consume more of the context window, as long as it stays within the hard output budget.',
  'Recent bridge messages are provided only to orient the boundary with newer uncompressed turns; do not over-summarize details that will remain verbatim.',
  'Preserve user goals, decisions, constraints, important data, browser/app state, unresolved tasks, failed attempts, and assumptions.',
  'Discard greetings, acknowledgements, duplicated wording, low-level token filler, and messages marked as stopped or unavailable.',
  'Output only the summary. No preface, no code fence.'
].join('\n')

export const buildConversationCompactPrompt = (params: AgentCompactRequest): string => {
  const maxSummaryChars = Math.max(
    800,
    Math.min(500_000, Math.round(params.maxSummaryChars || 6000))
  )
  return [
    COMPACT_CONTEXT_SYSTEM_PROMPT,
    '',
    `Target context window: ${params.targetContextLabel || 'unknown'}`,
    `Hard output budget: ${maxSummaryChars} characters.`,
    '',
    'Required output shape:',
    '# Compact Summary',
    '## Durable Facts',
    '- ...',
    '## Current User Goal',
    '- ...',
    '## Decisions And Constraints',
    '- ...',
    '## Open Threads',
    '- ...',
    '## Recent Handoff Notes',
    '- ...',
    '',
    'Previous cumulative summary:',
    params.previousSummary?.trim() || '(none)',
    '',
    'Messages to compact, chronological:',
    formatCompactMessages(params.messages || []),
    '',
    'Recent bridge messages that remain verbatim after this compact, chronological:',
    formatCompactMessages(params.bridgeMessages || []),
    '',
    'Rewrite the previous summary plus messages-to-compact into the required shape. Keep it concise and bounded.'
  ].join('\n')
}

const formatCompactMessages = (messages: AgentCompactRequest['messages']): string => {
  if (!messages.length) return '(none)'
  return messages
    .map((message, index) => {
      const role = message.role === 'human' ? 'Human' : 'Assistant'
      const ts = message.ts ? new Date(message.ts).toISOString() : 'unknown-time'
      return `### ${index + 1}. ${role} (${ts})\n${clipText(message.content || '', 3000)}`
    })
    .join('\n\n')
}

export const normalizeCompactSummary = (text: string, maxChars: number): string => {
  let out = String(text || '').trim()
  out = out
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/```$/i, '')
    .trim()
  return clipText(out, maxChars).trim()
}

export interface AgentSkillBrief {
  id: string
  name: string
  triggers: string[]
  description: string
  inputs: SkillSummary['inputs']
  seed: Record<string, string>
  missing: string[]
}

export const buildAgentTurnPrompt = (params: {
  message: string
  context?: AgentConversationContext
  includeConversationMemory?: boolean
  nowIso: string
  currentUrl: string
  briefs: AgentSkillBrief[]
}): string => {
  let domain = params.currentUrl
  try {
    domain = new URL(params.currentUrl).hostname
  } catch {
    /* keep raw */
  }
  const selectedBriefs = selectAgentSkillBriefs(params.briefs, params.message)
  const omittedSkillCount = Math.max(0, params.briefs.length - selectedBriefs.length)
  const list = selectedBriefs.length
    ? selectedBriefs
        .map((brief) => {
          const inputs = brief.inputs.length
            ? brief.inputs
                .slice(0, MAX_AGENT_SKILL_INPUTS)
                .map((input) => {
                  const required = input.required ? 'required' : 'optional'
                  const label = clipInline(input.label || input.name, 120)
                  const example = input.example
                    ? `; example=${clipInline(JSON.stringify(input.example), 140)}`
                    : ''
                  return `${clipInline(input.name, 100)} (${required}; label=${JSON.stringify(label)}${example})`
                })
                .concat(
                  brief.inputs.length > MAX_AGENT_SKILL_INPUTS
                    ? [`... +${brief.inputs.length - MAX_AGENT_SKILL_INPUTS} more inputs`]
                    : []
                )
                .join(', ')
            : 'none'
          const seed = Object.keys(brief.seed).length
            ? clipInline(JSON.stringify(brief.seed), MAX_AGENT_SKILL_INLINE_CHARS)
            : 'none'
          const missing = brief.missing.length
            ? brief.missing
                .slice(0, MAX_AGENT_SKILL_INPUTS)
                .map((item) => clipInline(item, 100))
                .join(', ')
            : 'none'
          const triggers =
            brief.triggers
              .slice(0, MAX_AGENT_SKILL_TRIGGERS)
              .map((item) => clipInline(item, 80))
              .join(', ') || 'none'
          return [
            `- id: ${clipInline(brief.id, 160)}`,
            `  name: ${clipInline(brief.name, 160)}`,
            `  triggers: ${triggers}${brief.triggers.length > MAX_AGENT_SKILL_TRIGGERS ? `, ... +${brief.triggers.length - MAX_AGENT_SKILL_TRIGGERS} more` : ''}`,
            `  inputs: ${inputs}`,
            `  message_seed: ${seed}`,
            `  missing_after_seed: ${missing}`,
            `  description: ${clipInline(brief.description, MAX_AGENT_SKILL_DESCRIPTION_CHARS)}`
          ].join('\n')
        })
        .concat(
          omittedSkillCount
            ? [
                `- ${omittedSkillCount} lower-relevance skills omitted from this turn's compact index. If no listed skill fits, use browser_use or ask the user to narrow the task.`
              ]
            : []
        )
        .join('\n')
    : `(none recorded for ${domain})`
  const recentMessages = params.context?.recentMessages || []
  const recentContext = recentMessages.length
    ? recentMessages
        .map((item) => {
          const role = item.role === 'human' ? 'Human' : 'Assistant'
          return `- ${role} (${new Date(item.ts || Date.now()).toISOString()}): ${item.content}`
        })
        .join('\n')
    : '(none)'
  const compactSummary = params.context?.compactSummary?.trim() || '(none)'
  const workspace = params.context?.workspace
  const workspaceContext = workspace?.path
    ? [
        `Selected workspace: ${workspace.path}`,
        'Use workspace tools for project files: workspace_context, list_workspace_files, search_files, read_file, write_file, create_artifact, open_workspace_folder, list_archive, extract_archive, create_archive.',
        'You may create/update files and generated artifacts inside this workspace. Do not delete, rename, move, or target the workspace directory itself.',
        'Folders are listed/searched before individual files are read. Archives are listed or extracted into a new or empty folder rather than passed to read_file; extraction refuses links/special entries and password-protected archive creation is refused.',
        'If a workspace tool reports workspace-not-found / workspace-not-directory, the app clears the stale reference; ask the user to choose the new location.'
      ].join('\n')
    : [
        'No workspace selected. create_artifact writes generated files to the app userData artifacts directory.',
        'extract_archive, create_archive, and open_workspace_folder use this chat’s safe default workspace; do not ask the user to select one for those operations.'
      ].join('\n')
  const memoryBlock = params.includeConversationMemory
    ? [
        'Conversation memory restored for this agent session:',
        'Compacted older context (summary of older turns):',
        compactSummary,
        '',
        'Recent conversation kept verbatim (newer turns override older summary if they conflict):',
        recentContext
      ]
    : ['Conversation memory: use the live pi session history for prior turns.']
  return [
    `Context — now: ${params.nowIso} | page: ${params.currentUrl}`,
    `Recorded skills for THIS site (${domain}) — skills from other domains are not available here:`,
    list,
    '',
    'If the user explicitly asks for a chat-only answer, a model-token test, or says not to use browser tools,',
    'answer directly in chat and do not call page_snapshot or ui_act for that turn.',
    '',
    'If a recorded skill above fits the request, load and run it (the fast path). If NONE fit — or none',
    'are recorded — do NOT refuse: fall back to browser_use, i.e. page_snapshot to observe the page then',
    'ui_act to operate it, looping observe→act until the goal is reached.',
    '',
    'Workspace:',
    workspaceContext,
    '',
    ...memoryBlock,
    '',
    'User message:',
    params.message
  ].join('\n')
}

const selectAgentSkillBriefs = (briefs: AgentSkillBrief[], message: string): AgentSkillBrief[] => {
  if (briefs.length <= MAX_AGENT_SKILL_BRIEFS) return briefs
  const scored = briefs.map((brief, index) => ({
    brief,
    index,
    score: scoreAgentSkillBrief(brief, message)
  }))
  return scored
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_AGENT_SKILL_BRIEFS)
    .map((item) => item.brief)
}

const scoreAgentSkillBrief = (brief: AgentSkillBrief, message: string): number => {
  let score = 0
  const seedCount = Object.keys(brief.seed).length
  if (seedCount) score += 80 + seedCount * 8
  if (brief.inputs.some((input) => input.required) && !brief.missing.length && seedCount) {
    score += 80
  }
  const queryTokens = tokenizeSkillCatalogText(message)
  const haystack = tokenizeSkillCatalogText(
    [
      brief.name,
      brief.description,
      brief.triggers.join(' '),
      brief.inputs.map((input) => `${input.name} ${input.label || ''}`).join(' ')
    ].join(' ')
  )
  for (const token of queryTokens) {
    if (haystack.has(token)) score += 6
  }
  const lowerMessage = message.toLowerCase()
  for (const trigger of brief.triggers) {
    const text = String(trigger || '')
      .trim()
      .toLowerCase()
    if (text && (lowerMessage.includes(text) || text.includes(lowerMessage))) score += 30
  }
  return score
}

const tokenizeSkillCatalogText = (text: string): Set<string> =>
  new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9_\u4e00-\u9fff]+/i)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
  )

const clipInline = (value: unknown, max: number): string => {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 3)) + '...'
}

export const summarizeApprovalArgs = (value: unknown): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const keys = Object.keys(value as Record<string, unknown>)
    .filter(
      (key) => !/(body|headers?|token|secret|cookie|password|credential|authorization)/i.test(key)
    )
    .slice(0, 8)
  return keys.length ? `args: ${keys.join(', ')}` : 'args omitted'
}

export const agentMediaMimeForPath = (path: string): string => {
  const ext = extname(path).toLowerCase()
  return AGENT_IMAGE_MIME_BY_EXT[ext] || AGENT_FILE_MIME_BY_EXT[ext] || 'application/octet-stream'
}
