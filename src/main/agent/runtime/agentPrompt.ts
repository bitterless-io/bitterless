import moment from 'moment'
import { renderChainPathLine } from '@main/agent/userChainStore.service'
import { DEEP_FETCH_BROWSER_WORKFLOW } from '@main/agent/deepFetch.skill'
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
 * This intentionally keeps Bitterless' rich, relevance-ranked skill briefs. Cowork's newer slim
 * catalog is not behavior-compatible with the current Maestro prompt contract.
 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
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
            `  scope: ${brief.scope || 'shared'}; institution: ${brief.institutionId || 'none'}; reference: ${brief.reference || brief.id}; path: ${brief.path || 'builtin'}`,
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
  // 只留**指导**;路径那条事实归 D2(见下面的动态前缀),否则同一个路径在提示词里出现两次。
  const workspaceContext = workspace?.path
    ? [
        'Use workspace tools for project files: workspace_context, list_workspace_files, search_files, read_file, write_file, create_artifact, open_workspace_folder, list_archive, extract_archive, create_archive.',
        'You may create/update files and generated artifacts inside this workspace. Do not delete, rename, move, or target the workspace directory itself.',
        'Folders are listed/searched before individual files are read. Archives are listed or extracted into a new or empty folder rather than passed to read_file; extraction refuses links/special entries and password-protected archive creation is refused.',
        'If a workspace tool reports workspace-not-found / workspace-not-directory, the app clears the stale reference; ask the user to choose the new location.'
      ].join('\n')
    : [
        'No workspace selected: every workspace tool works in the ONE shared default workspace instead — write_file and create_artifact included.',
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
      : '- Active workspace: none selected — the ONE shared default workspace is in use',
    describeActiveTabLine(params.activeTab),
    'Open tabs when this message was sent:',
    JSON.stringify(params.openTabs ?? []),
    // C —— 会话级、路径固定。放在动态快照之后:它是这个会话的坐标。
    ...(params.userChainPath ? [renderChainPathLine(params.userChainPath)] : [])
  ].join('\n')
  return [
    dynamicPrefix,
    '',
    `Built-in text skills and recorded skills for THIS site (${domain}) — recorded skills from other domains are not available here:`,
    list,
    '',
    'If the user explicitly asks for a chat-only answer, a model-token test, or says not to use browser tools,',
    'answer directly in chat and do not call browser tools (including deep_fetch, open_tab, page_snapshot or ui_act) for that turn.',
    'Browser-use status: start_browser_use/end_browser_use require an exact tab_id and only change this task\'s use marker. They never select/show/navigate a page or change drill recording. Page tools automatically begin use; end it explicitly when finished with a tab. Historical targets are not active-use markers.',
    '',
    'When the task needs current or sourced information, a failed web_search does not remove the need to verify it.',
    'Follow retry guidance for that service only, then use the built-in browser workflow below. Try public sources before asking the user to repair search.',
    DEEP_FETCH_BROWSER_WORKFLOW,
    '',
    'For builtin: text skills, follow their supplied steps directly; they have no recorded recipe. get_skill_contract is for recorded skills only.',
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
    '钻探 (DRILL) an unfamiliar site — the user may ask for this as 钻探 / 探站 / drill / explore / map / probe this site (中文或英文都算). There is no one-shot tool; YOU run the flow:',
    '1. start_recording {"mode":"api"} — 钻探 needs the traffic recorded, or there is nothing to ingest. SKIP this only if a recording is already running (the Capture 钻探 button starts it for you — explore_session state shows the recording dir). ' +
      'ONE recording spans the WHOLE drill. The host ingests it in WINDOWS as you go — a window closes when you mark a module done, and drilling continues into the SAME recording afterwards. So never stop or restart the recording between modules: a restart would orphan the traffic the next window is supposed to cover. ' +
      'If start_recording comes back with capturing:false it now tells you WHY in "error" — report that to the operator and stop; do not keep drilling into a recording that never started, because every endpoint you would have captured is lost silently.',
    '2. explore_session {"action":"begin"}, then run a perception→action LOOP: OBSERVE the page (snapshot) → DECIDE → ACT with',
    '   ui_act → OBSERVE the new page → repeat. NAVIGATE BY CLICKING menu items / buttons (ui_act the [ref]), NOT by changing the',
    '   url. USE INPUTS too: fill a search/filter with a value the page shows and apply it — it only re-reads, and it exercises',
    '   the list/query APIs. Say',
    '   briefly what you LEARNED each step. Full loop in the begin guidance.',
    // Ral 2026-09-10:「这种反问不该出现,cowork 会自行判断的」—— 他收到的是
    // 「已进入 X。目前可继续查看:A / B / C ── 你想先钻探哪一项?」。
    // 那不是一次澄清,而是**把决策推回给人**:候选就是 frontier,顺序由主机的队列决定,
    // 人没有比 agent 更多的信息可以拿来回答。而钻探能跑两小时,每一次这样的反问都让它**停在那里**
    // 等一个不必要的回答 —— 覆盖率因此永远到不了。
    '   NEVER ask the operator which place/module to drill next, or whether to continue. The frontier IS the answer and the host',
    '   orders it — you have strictly more information than they do, so a question like "which one first?" only stalls the drill',
    '   (it can run for two hours; every such question freezes it until someone happens to look). Pick the next place and go.',
    '   Ask ONLY when you are BLOCKED and the block needs a human: a login wall (use explore_session {"action":"need_login"}),',
    '   or a control you must not activate. Narrate what you chose in one line instead of offering a menu.',
    '   COMPLETION IS COVERAGE OF PLACES, NOT LABELS. A place = anywhere the site can take you; the host harvests them from the',
    '   links on every page you open, collapsing repeats. Your job: OPEN EVERY PLACE. Each one usually reveals more — there is NO',
    '   depth limit, the tree is as deep as this site actually is. Two kinds the harvester cannot see, so they are on you:',
    '   entries that are not links (JS nav / buttons / tabs), and anything behind a control that does not change the url. Count a',
    '   page\'s sub-entries and pass {"module":{...,"expectedChildren":N}} — the host reports the gap vs what it harvested, and',
    '   that gap IS the non-link nav to click. {module} / {"module_done"} are LABELS that organise the sitemap; they never end the',
    '   drill. DONE (mechanical) = no branch open AND the host\'s harvested queue empty (or each leftover settled with',
    '   {"uncovered":{"url","reason"}}). Taking longer is fine; finishing early is not. The ONE control you never activate is a COMMIT CONTROL — one whose activation itself persists a change.',
    '   That is about what it DOES, never what it is called; anything that only opens or loads is fair game, and those loads are',
    '   where most endpoints live. Which controls count depends on PAGE STATE: with nothing typed into a page, activate anything',
    '   (an untouched form has nothing to persist); once you HAVE typed, anything that could persist it is a commit control —',
    '   leave it and navigate away. Never activate the final confirmation step of an irreversible action.',
    '   explore_visit {"url"}/{"tab"} is RECOVERY ONLY (go "back", reach a same-site tab) — not your main way to move; move by',
    '   clicking. explore_session {"action":"state"} whenever unsure where you are.',
    '   LOGIN WALL: if the app requires login and you are BLOCKED from its content (a login page you cannot get past, a session-expired screen, an SSO redirect — a password field is a hint), do NOT wander or try to log in yourself. Call explore_session {"action":"need_login"} — it PAUSES the drill and asks the user to log in; it returns once they have (they click "继续", or it auto-detects login). Then continue from where you are. (Only if you are genuinely blocked — visiting a login link while already signed in elsewhere is not blocked; switch to the signed-in tab instead.)',
    '   NEW TABS = BRANCH DRILL: some controls open a NEW TAB. When a click does, the host tells you so in the ui_act result, switches you to that tab, and opens a BRANCH. Drill the branch NOW — but a branch is ONE PAGE, not a second way into the site: explore_record {module} for it, work through THAT PAGE\'s own controls (buttons, forms, expandable sections — observe→click/fill→observe), then explore_record {"module_done":{"url"}}. Do NOT navigate its menus or wander into other sections from there: such a tab carries the same sidebar as the main line, and the main line reaches those on its own — the host does not even queue links harvested inside a branch. If a branch genuinely opens a whole sub-system that the main line cannot reach, record its url with worklist_add and let it be drilled as a normal place instead. The host then CLOSES that tab and returns you to the main line by itself — do not close or switch away yourself, and do not leave a branch open (end is refused while one is). Off-site new tab → explore_visit {"tab":"home"} to return (NOT "back": a fresh tab has no history); it goes on the off-site list.',
    '   NARRATE AS YOU GO: pass note ".." with every explore_record — one short sentence, in the operator\'s language, on what you just learned or are about to do. The operator watches those live; a single summary at the end is not enough.',
    '3. explore_session {"action":"end"} — writes the sitemap.',
    '4. ingest_recording {"api": true, "ui": false} — API-ONLY: turn the recorded traffic into the apidoc. Do NOT ask for ui — a drill builds the apidoc, not UI skills, and ui-ingest would run an LLM pass over the WHOLE recording (HTML/JS included). It ingests only API requests (fetch/xhr/json/api-path), in batches, and judges auth BEFORE extracting. It runs in the BACKGROUND and returns a task id immediately.',
    '   Most drills document the traffic AS THEY GO (a window per module), so this call usually answers "already ingested" instead of starting anything — that is SUCCESS, not a failure, and the completion report is posted either way. Call it exactly once regardless; never call it a second time to "make sure".',
    'COMPLETION: the drill is complete ONLY when the API ingest finishes — NOT when the sitemap is written. The ingest is a background task, so after you call ingest_recording just report briefly that the sitemap is done and the apidoc ingest has started (with its task id) + any black/whitelist advice. Do NOT write a "完成钻探" summary yourself — the SYSTEM posts the fixed-format 完成钻探 report (target site · sitemap modules/functions · API count) automatically when the ingest actually finishes. Your job ends at "ingest started".',
    // 「完成」只能有一个发布者 —— 宿主的机械判定(地点台账)。agent 说了不算,因为它拿不到那份台账:
    // 续跑次数用完时宿主会单方面兜底收尾,而 agent 记得的最后一件事是"我调了 end",于是照自己的理解
    // 播报"钻探已完成",同一屏上进度却写着 88/125、气泡还是红色错误样式。三处互相矛盾时人只信正文。
    'WHO SAYS "DONE": never you. Whether the site was fully covered is the HOST\'s mechanical verdict from its own ledger of places — you cannot see that ledger, so any completion claim from you is a guess. Describe only what YOU did ("sitemap written, ingest started as task-N"). Do not write 钻探已完成 / drill complete / fully explored / 站点地图已生成并完成 — not even when end succeeded, because end also succeeds when the host wraps up a run that did NOT finish. If the host tells you a run was wrapped up incomplete, say exactly that and repeat its numbers; do not soften it.',
    'A FAILED TURN IS NOT A FINISHED DRILL: if this turn ends with an error (replay-failed, aborted, provider error), say the run ended abnormally and what is unfinished. Never end an errored turn with wording that reads like success.',
    'That is 钻探: sitemap first, apidoc second, and it OVERWRITES the site\'s existing sitemap + apidoc. Report progress briefly the whole way.',
    'DO NOT STOP until every harvested place is opened (or settled with uncovered) and no branch is open (or the 120-min budget',
    'trips) — do NOT conclude after a few. This is',
    'ENFORCED: explore_session {"action":"end"} is REFUSED while any of those is outstanding (and while you have',
    'discovered zero) — keep discovering + drilling + marking done. NEVER end your turn with a text summary while explore_session',
    'is open (that skips the apidoc); if anything is left, call the next tool.',
    'Finish ONLY via explore_session {"action":"end"} → ingest_recording. (If you stop early the host RE-PROMPTS you to keep going',
    'until every module is done — so there is no point stopping.)',
    // 「接着钻某几块」是常见的第二轮诉求(第一轮预算到顶/被兜底收尾之后)。不给它一个显式入口的话,
    // agent 只能重钻整站,把已经探过的地方再走一遍(Ral 2026-08-14)。
    'CONTINUING PART OF A SITE: when the user names which parts to drill ("接着钻 Settings 和 Billing", "只钻 Reports 相关的", "钻一下权限那块"), pass them as focus: explore_session {"action":"begin","focus":"Settings, Billing"}. RESOLVE THEIR WORDING TO REAL LABELS FIRST: read the page, find the entries they actually mean, and pass those entries\' own text verbatim — the host matches focus as plain substrings against each place\'s name and url, so a paraphrase that appears nowhere on the site matches nothing and you would drill an empty scope. If their wording is ambiguous between two entries, take both. That SCOPES the run — a place counts only if it matches one of those or was reached by clicking through one that did, so the named parts still get drilled to full depth while the rest of the site is skipped. The begin output tells you the run is scoped; when it is, "no places left" means THAT FOCUS is covered, not the site. Say so when you report. Omit focus for a normal full drill — and never invent a focus to make a run finish sooner.',
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
