import { createSyntheticSourceInfo, formatSkillsForPrompt } from '@maestro-main/skills/piSkillSdk'
import { dirname, join } from 'node:path'
import moment from 'moment'
import { renderChainPathLine } from '@main/agent/userChainStore.service'
import { DEEP_FETCH_BROWSER_WORKFLOW } from '@main/agent/deepFetch.skill'
import { DRILL_ROUTE } from '@main/agent/drill.skill'
import { extname } from 'path'
import { clipText, summarizeActionApiCorrelations } from '@maestro-main/capture/traceTimeline'
import type {
  ActiveTabContent,
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
 * Skills retain the complete three-source inventory; relevance never removes an entry.
 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const MAX_AGENT_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_AGENT_IMAGES = 8
export const MAX_AGENT_MEDIA_REFS = 16


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
  scope?: 'shared' | 'institution'
  layer?: 'global' | 'workspace' | 'institution'
  skillRevision?: string
  allowImplicitInvocation?: boolean
  institutionId?: string
  reference?: string
  path?: string
  id: string
  name: string
  triggers: string[]
  description: string
  inputs: SkillSummary['inputs']
  seed: Record<string, string>
  missing: string[]
}

/** D3 is exactly one foreground value, kept with this user message in history. */
export const describeActiveTabLine = (content: ActiveTabContent | null): string =>
  'Active tab when this message was sent:\n' + JSON.stringify(content)

/**
 * **D1 的取值 —— 本地时间。**
 *
 * Ral 2026-09-11:「D1 我确定是 local time 了,主要表达用户什么时候发了这个消息」。
 * 所以它表达的是**这条 user 消息的发出时刻**,随消息一起进历史 —— 于是会话历史里天然留下
 * 一串时间戳,模型能据此推算"上一句是多久以前说的"。
 *
 * 此前这里是 `new Date().toISOString()`(UTC)。UTC 对"用户此刻是上午还是深夜"这种判断没用,
 * 而那正是本地时间要回答的事。
 *
 * 格式用 `moment`(项目规则:Node/Electron 侧用 moment,web 侧用 dayjs);
 * **IANA 时区名用原生 `Intl`** —— moment 本体给不了它(要 moment-timezone,本仓没装),
 * 而带上 `Asia/Shanghai` 这种名字才能让模型判断作息,光有 `+08:00` 不够。
 */
export const localNow = (): string => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return `${moment().format('YYYY-MM-DD HH:mm:ss Z')} (${zone})`
}

/**
 * 没有指定位置时,新资源该落在工作区的哪里(Ral 2026-09-20)。
 *
 * 规则**只在上下文没点名位置时生效** —— 用户或前文给了路径就按那个走,这段是兜底,不是改写他的选择。
 *
 * 为什么要「先列树再归位」:不看现有目录就分类,分出来的是模型自带的那套分类法,不是这个工作区的。
 * 按 DDD 的领域分类去找位置 —— 先看业务领域,再看它在领域内的角色(entity/service/repository/api/
 * docs/tests),而不是按文件类型堆一起,更不是一律丢根目录。
 *
 * **两个分支都要挂** —— 共享默认工作区也是工作区,「没选工作区」不等于「可以随便扔」。
 * bitterless 与 micromeet-cowork 逐字相同。
 */
const NEW_FILE_PLACEMENT = [
  'Where a new file goes: when the request does not name a location, do NOT default to the workspace root and do NOT invent a scratch folder. List the tree first (list_workspace_files / search_files), then put the resource where this workspace already keeps that KIND of thing.',
  'Classify it the way a domain-driven layout does — by the business domain it belongs to, and by the role it plays inside that domain (entity/model, service, repository, api, docs, tests) — never by file type alone. Mirror the existing folder names and language conventions rather than introducing your own. If nothing in the tree fits, create the smallest new folder named for the business concept, and say in one line where you put it and why.'
].join('\n')

export const buildAgentTurnPrompt = (params: {
  message: string
  context?: AgentConversationContext
  includeConversationMemory?: boolean
  /** D1 —— 这条 user 消息的发出时刻,本地时间。见 `localNow()`。 */
  nowLocal: string
  /**
   * D3 —— 当前 tab 激活的内容(文件 / miniapp / 网页)。`null` = 没有活动 tab。
   *
   * **与 `currentUrl` 是两个东西,别合并。** `currentUrl` 是 `displayUrl(tab)` 的结果,
   * 它只特判 `home` 与 `onlypreview`,composite tab(trench/zellij)落到 `tab.url` ——
   * 而那个字段出生就是空串且永不被写,所以 `currentUrl` 在那两种 tab 上是**空串**。
   * 它同时还是下面技能段 `domain` 的输入(`listSkillsForDomain` 按 `domain` 严格相等筛),
   * 所以不能改它去承载 D3。技能段自己那个毛病是独立问题。
   */
  activeTab: ActiveTabContent | null
  /** D4: every user-facing tab in UI order, sampled together with activeTab. */
  openTabs?: readonly ActiveTabContent[]
  /**
   * C —— 这个会话的用户原话历史文件(`<userData>/chain/<sessionId>.jsonl`)的**绝对路径**。
   *
   * 归 C 不归 D:它在一个会话内**不变**。每轮仍然重拼只是因为今天还没有独立的 C 层落点 ——
   * 有了就该搬过去,那样它不再每轮参与拼装。
   *
   * **从 newchat 起就注入,哪怕文件是空的**(Ral 2026-09-11)。空文件读出来是空,
   * 不存在的文件读出来是错误 —— 后者会让模型以为自己用错了工具。
   */
  userChainPath?: string
  currentUrl: string
  catalog?: string
  /**
   * The installed workflow packages, resident rather than behind `workflow_list`
   * (docs/features/workflow-catalog-in-prompt.md ①). Without it the model only learns a workflow
   * exists if it guesses to call the tool — so it does the work itself and never routes.
   */
  workflows?: string
  skillAuthoring?: { globalRoot: string; bunPath: string }
  /**
   * The directory actually in use when no workspace is selected (Ral 2026-09-18:
   * 「默认 workspace 要进系统提示词」).
   *
   * The line used to say a default workspace was in use without naming it, so the model could not
   * tell where its files landed or report the path back. The UI still shows "none selected" — this
   * is an implicit fallback, not a selection. Paired with micromeet-cowork.
   */
  defaultWorkspacePath?: string
  briefs: AgentSkillBrief[]
}): string => {
  let domain = params.currentUrl
  try {
    domain = new URL(params.currentUrl).hostname
  } catch {
    /* keep raw */
  }
  const list = formatSkillsForPrompt(params.briefs.map(brief => ({
    name: brief.name, description: brief.description, filePath: brief.path || brief.reference || brief.id,
    baseDir: brief.path ? dirname(brief.path) : '',
    sourceInfo: createSyntheticSourceInfo(brief.path || brief.id, { source: brief.layer || 'global' }),
    disableModelInvocation: brief.allowImplicitInvocation === false
  })), 'read') + (params.briefs.length ? '\nHost skill references and recording inputs:\n' + JSON.stringify(params.briefs) : `(none recorded for ${domain})`)
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
  // 只留**指导**;路径那条事实归 D2(见下面的动态前缀),否则同一个路径在提示词里出现两次。
  const workspaceContext = workspace?.path
    ? [
        'Use workspace tools for project files: workspace_context, list_workspace_files, search_files, read_file, write_file, create_artifact, preview_file, open_workspace_folder, list_archive, extract_archive, create_archive.',
        // A7 说「open it for the user with the preview tool」,这里就是那个工具的名字。
        // 2026-09-21 起 bl 也有 `preview_file`(Ral 指定要补),它比 `open_workspace_folder` 多两件事:
        // 够得到工作区**外**的路径,以及能带行号。所以 A7 那条纪律现在指向它。
        // `open_workspace_folder` 保留原样 —— 它仍是「把工作区本身摆出来」的那个动作。
        'To SHOW the user a file or folder, call preview_file on its path — it opens in OnlyPreview, the local preview app, and takes an optional 1-based line. Do not read a file and retell it when they asked to look at it.',
        'You may create/update files and generated artifacts inside this workspace. Do not delete, rename, move, or target the workspace directory itself.',
        NEW_FILE_PLACEMENT,
        'Folders are listed/searched before individual files are read. Archives are listed or extracted into a new or empty folder rather than passed to read_file; extraction refuses links/special entries and password-protected archive creation is refused.',
        'If a workspace tool reports workspace-not-found / workspace-not-directory, the app clears the stale reference; ask the user to choose the new location.'
      ].join('\n')
    : [
        'No workspace selected: every workspace tool works in the ONE shared default workspace instead — write_file and create_artifact included. Its path is the Active workspace line above.',
        'To SHOW the user a file or folder, call preview_file on its path — it opens in OnlyPreview, the local preview app, and takes an optional 1-based line.',
        NEW_FILE_PLACEMENT,
        'Never ask the user to select a workspace for a file operation; every write reports its absolute destination, which is how they find it.'
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
  /**
   * **表 3 · 动态前缀(D1/D2/D3/D4)。**
   *
   * 四项的共同点:**在一个会话里都会变**,所以一个都不能进 system 槽位(表 1/表 2)——
   * 进去就会让缓存前缀(system → tools → 会话历史)每轮作废。
   * 它们随 user 消息一起注入、**一起进历史**,于是历史里留下一串快照:
   * 「用户说这句话时,时间是几点、在哪个 workspace、在看哪个 tab」。
   *
   * 留痕这件事是有必要的,不是顺带:**用户在 UI 里切 workspace 或自己点浏览器,
   * 一条聊天记录都不会插**(`message.store.ts:694` 那条路不调 `pushLocalNote`,
   * 而 `pushLocalNote` 本身又是 `promptExcluded: true`)。所以除了这串快照,
   * 模型没有任何别的途径知道"之前曾在 workspace A 干过活"。
   *
   * 分层与判据见 `overmind:areas/agent-runtime/chat/prompt-structure.html` #1 表 3。
   */
  const dynamicPrefix = [
    'Context for THIS message (each line is re-read when the message is sent):',
    `- Message sent at: ${params.nowLocal}`,
    workspace?.path
      ? `- Active workspace: ${workspace.path}`
      : `- Active workspace: none selected — the ONE shared default workspace is in use${params.defaultWorkspacePath ? `: ${params.defaultWorkspacePath}` : ''}`,
    describeActiveTabLine(params.activeTab),
    'Open tabs when this message was sent:',
    JSON.stringify(params.openTabs ?? []),
    // C —— 会话级、路径固定。放在动态快照之后:它是这个会话的坐标。
    ...(params.userChainPath ? [renderChainPathLine(params.userChainPath)] : [])
  ].join('\n')
  return [
    // 开头先说一遍这一轮要做什么。
    //
    // 底部那道围栏是**结构**判据,它没解决**位置**问题:指令仍然在 76,030 字符里的最后 144 字符,
    // 占 0.189%。实测(2026-09-21)模型两次栽在这上面 —— 一次直接回「only page context and no
    // instruction」(指令就在末尾),一次从上面的参考材料里抓了个绝对路径当成任务目标。
    //
    // 复述而不是重排:重排 76KB 会动到每一个已经调好的块(skills / tabs / workflows),回归面太大;
    // 复述是纯增量,最坏多花一行。**必须说明哪一份是权威**,否则模型可能把它当成两件事。
    ...(params.message.trim()
      ? [
          `This turn's request, verbatim: ${clipText(params.message.trim(), 600)}`,
          'That is a preview so it is not buried at the end; the authoritative copy is inside <user_message> below. Same request, not two.',
          ''
        ]
      : []),
    dynamicPrefix,
    '',
    `Complete Skills inventory (current execution domain: ${domain}). Recorded Skills remain listed across domains but execute only on their original site:`,
    list,
    ...(params.skillAuthoring ? [
      'Create or update reusable skills with Pi read/write/edit tools as standard SKILL.md packages; use bash for scripts.',
      'For a new reusable skill, use skill_creator init (instruction or script template), fill its SKILL_CREATOR_TODO markers with existing file tools, then skill_creator check. Ask only essential missing task details. Sidecars are optional; add resources only when useful. For existing packages, inspect before editing and check afterward.',
      'Choose representative input and the expected observable outcome when useful; verify it with existing tools only when appropriate and authorized. Report generated, format-checked and behavior-verified separately with evidence. A passed format check never proves behavior; if no behavior was executed, report not verified.',
      'For a new skill in this conversation, use ' + JSON.stringify(params.context?.workspace?.path ? join(params.context.workspace.path, '.agents', 'skills') : params.skillAuthoring.globalRoot) + ' as the package root. An explicitly selected workspace takes priority; otherwise use the Global root. Create a named subdirectory with SKILL.md and any scripts/resources. Never guess an institution destination.',
      'Run skill JavaScript/TypeScript scripts with the bundled Bun executable ' + "'" + params.skillAuthoring.bunPath.replaceAll("'", "'\\''") + "'" + ' through bash, followed by the quoted absolute script path and arguments. Other scripts follow the commands declared by the skill. Read the current package before executing it.',
      'Use skill_diagnose with the exact skill_ref to inspect a declared entry, interpreter and dependencies before execution or when runtime conditions are missing. It does not install software or verify behavior; follow its concrete repair guidance only within the user-authorized task.',
      'After creating or editing a skill with file tools, use the existing Skills refresh action or start a new Chat to reload the catalog before its first turn; ordinary chat turns keep the loaded snapshot. No custom registration is required.',
      'Skill installer guidance: use skill_install inspect for a requested source or pasted skills add command, then select exact candidate paths and install under its returned scope. Use list/update/remove for managed sources; do not bypass local-edit protection. Prefer existing tools, bundled Bun and direct HTTPS retrieval; avoid installing extra software when those suffice. Treat an npx command as installation intent: identify the exact source, requested version/ref and CLI behavior before choosing an execution path; do not run it verbatim by default.',
      'If the original source CLI is necessary, use bundled Bun only after verifying compatibility. Consider app-private Node/npm/Git when a required runtime is missing; automatic runtime preparation is not implemented. Use skill_install for supported GitHub archives, npm tarballs and HTTPS Git sources; it records a local source ledger without executing a CLI. Installing necessary dependencies is allowed when existing capabilities are insufficient; never default to global installs or PATH changes.',
      'Preserve the complete legal skill package, including scripts/references/assets and binary files, in the authoring root above (selected workspace first, otherwise Shared); never overwrite an existing package implicitly. Use skill_creator check for format evidence, keep behavior verification separate, and use Skills Refresh or a new Chat after file-tool edits. Local installation does not require an institution. If the available tools cannot retrieve, unpack or execute the source, report the exact missing capability rather than claiming installation succeeded.'
    ] : []),
    '',
    // 逃生阀原来只挡「用户明确说别用浏览器工具」,也只挡浏览器那一组。一句 hi 不触发它的任何一个
    // 条件,于是模型照着上面的指令墙自己编了个任务、连跑 41 步
    // (issues/turn-prompt-buries-the-user-message.md,cowork 实录,本仓同一条路径)。
    // 现在它按**请求本身**判,并覆盖全部工具。
    'GREETINGS AND SMALL TALK GET A PLAIN REPLY. If the request is a greeting, an acknowledgement, a',
    'thank-you, a question about you, or anything else that needs no file, no page and no command —',
    'just answer it in chat and call NO tool at all. The material above describes what you CAN do; it',
    'never says you must do any of it. Doing "a bit of research first" on a greeting is wrong, not thorough.',
    'If the user explicitly asks for a chat-only answer, a model-token test, or says not to use browser tools,',
    'answer directly in chat and do not call browser tools (including deep_fetch, open_tab, page_snapshot or ui_act) for that turn.',
    'Browser-use status: start_browser_use/end_browser_use require an exact tab_id and only change this task\'s use marker. They never select/show/navigate a page or change drill recording. Page tools automatically begin use; end it explicitly when finished with a tab. Historical targets are not active-use markers.',
    '',
    'When the task needs current or sourced information, a failed web_search does not remove the need to verify it.',
    'Follow retry guidance for that service only, then use the built-in browser workflow below. Try public sources before asking the user to repair search.',
    DEEP_FETCH_BROWSER_WORKFLOW,
    '',
    'For builtin: text skills, follow their supplied steps directly; they have no recorded recipe. get_skill_contract reads both Markdown Skills and recording contracts; follow next_offset for long bodies.',
    'If a recorded skill above fits the request, load and run it (the fast path). If NONE fit — or none',
    'are recorded — do NOT refuse: fall back to browser_use, i.e. page_snapshot to observe the page then',
    'ui_act to operate it, looping observe→act until the goal is reached.',
    '',
    '',
    // ── 钻探（drill-001）。从 cowork 逐字搬入,**话术一字未改** —— 它是被多轮实测调出来的:
    //    完成判定按"地点覆盖"而不是"模块标签"、支线要收、控件欠账要补、focus 要落到站点上真实
    //    存在的字样。改动任何一句之前先读 cowork 的 `check-auto-explore` 与那几份 drill issue。
    //    其中「永不反问下一个钻哪个」那几条是 Ral 2026-09-10 加的:那不是澄清,是把决策推回给人,
    //    而钻探能跑两小时,每一次反问都让它停在那里等一个不必要的回答。
    DRILL_ROUTE,
    '',
    'Workspace:',
    workspaceContext,
    '',
    ...memoryBlock,
    '',
    params.catalog || '',
    params.workflows || '',
    // 用户那句话是这条消息的**最后 0.02%** —— 2026-09-18 在 cowork 同一条路径上实测 74,547 字符里
    // 的 2 个字符,`User message:` 落在第 74,531 位。没有围栏时模型分不出「参考资料」和「这一轮要我
    // 做的事」,一句 hi 就能让它把指令墙当成任务(issues/turn-prompt-buries-the-user-message.md)。
    //
    // 围栏不改 pi 边界(`session.prompt(text)` 只收一个字符串),但它给了模型一个**结构判据**,
    // 而不是靠它在 74k 字符里注意到一行字面量。
    'Everything above is REFERENCE MATERIAL for this session — your capabilities, the catalogs and the',
    'current state. None of it is a request, and it is not a task list. The ONLY thing you were asked to',
    'do is between the two markers below. If it needs none of the material above, use none of it.',
    '<user_message>',
    params.message,
    '</user_message>'
  ].join('\n')
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
