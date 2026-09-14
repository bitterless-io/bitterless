import type { DrillTabState } from './exploreSession.types'
// Agent-driven exploration session (v2). Contract: docs/features/agent-driven-exploration.md.
//
// Main owns STATE, the agent owns CONTROL FLOW (decision 1). The v1 walker's `while (queue.length)`
// is precisely what made recovery impossible: a deterministic loop has no concept of "I have lost the
// menu", which is the standalone-page case Ral hit. So there is no loop in here — only a worklist the
// agent pushes and pops, and a page-evidence reader.
//
// State lives here rather than in the prompt (decision 8): a 200-URL worklist cannot live in context.
//
// Everything is logged (Ral: 「你只需要开发和 log 打点」). Every action emits a debug event AND an
// output line on the task, so a session can be reconstructed after the fact from either side.

import { app } from 'electron'
import type { WebContents } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { NAV_EXTRACT, type NavExtractResult } from '@maestro-main/sitemap/navExtract'
import type { ControlEntry, ExploreSessionDeps, IdentityAssertion, KnownFunction, ObservedWrite, PageEvidence, WorkItem } from '@maestro-main/sitemap/exploreSession.types'
import { addSiteRules, isClickForbidden, isVisitForbidden, loadSiteRules, renderSiteRules } from '@maestro-main/sitemap/siteRules.service'
import type { SiteRules } from '@maestro-main/sitemap/siteRules.types'
import type { TaskHandle } from '@maestro-main/tasks/taskRegistry.types'
import type { SitemapFunction, SitemapModule, SitemapOffsiteExit, SitemapUncovered } from '@maestro-shared/sitemap.types'

/**
 * 一次 agent 主导探站的墙钟预算。**按时间不按 token**(Ral 2026-08-10:「录制时间先限制为
 * 120min,而不是 token 限制」)—— 时间是操作者能直观判断的量,token 不是;而且 v2 的成本本来
 * 就摊在几十次独立的工具调用上,没有哪一次能代表整轮。
 *
 * 触顶不是硬杀:`visit`/`record` 会拒绝并要求 `end`,产物照样落盘(sitemap 取并集,下次可续)。
 */
const SESSION_BUDGET_MS = 120 * 60_000

/**
 * 一次探站的 token 预算(Ral 2026-08-13:「10M 和 120min,到达任何一点限制,都得结束钻取」)。
 *
 * 与 `SESSION_BUDGET_MS` 是【或】的关系 —— 两条任一触顶都算 over budget,收敛路径完全相同
 * (软触顶:`visit`/`record` 拒绝并要求 `end`,产物照样落盘)。**不是硬杀** —— 硬杀会让 `end`
 * 不被调用,该轮探索全丢,那正是「停止钻探」要二次确认的理由。
 *
 * 为什么 10M 是个合理的数:一页折叠后约 1.4k token,但每轮工具循环都要重发整个上下文,
 * 所以主导项是累计 input。10M ÷ 200 轮(COWORK_CHAT_MAX_TOOL_ROUNDS)≈ 每轮 50k 上下文 ——
 * 和轮次上限差不多同时触顶。实践中它很可能**先于 120min 触发**。
 *
 * 口径 = `totalTokens`(input + output + cache),即 pi SDK `Usage.totalTokens`。
 * 金额(`Usage.cost.total`)一并记录但不参与判定 —— 以后要改成按钱设预算,通道已经在了。
 */
const SESSION_BUDGET_TOKENS = 10_000_000

/**
 * 防跑飞的深度上限 —— **不是**"菜单只有几级"的判断。
 *
 * 【2026-08-13 推翻了原来的 MENU_DEPTH_CAP = 2】。那个数是对着 test-dsh 定的(它恰好两级:
 * `#order` → `/#/order/mall`),于是在它身上永远不出错;换到 welladjustedhk.janeapp.com 就废了 ——
 * 实测 frontier 里 107/113 条链接【已经在 depth 2】,也就是它们内部的一切结构上就到不了,
 * 而且 `return 0` 还是静默的,砍掉整棵子树不留一点痕迹。Settings 侧栏真有 42 个子模块,
 * sitemap 只记下 1 个模块 + 3 个进去过的子页。
 *
 * Ral 2026-08-13 定调:「之前最多两层的限制是错误的,需要更依靠 Agent 的判断,去决定是否停止
 * 某一个模块的状态」。所以深度不再是判据 —— **终止靠"不再见到新模板"**(templateOf/paramize 收敛),
 * 靠 agent 判断"这个模块还有没有子模块",靠时间预算。这里只留一个远高于任何真实站点的护栏,
 * 防的是无限深的动态路由,不是业务层级;而且触顶【必须报数】(见 autoSeedFrontier 的 depthCapped)。
 */
const RUNAWAY_DEPTH_GUARD = 12
/** 空表格重读前再等多久。比一次普通 settle 短 —— 这是补一刀,不是从头等一遍。 */
const EMPTY_TABLE_RETRY_MS = 3000

/**
 * 连续多少步"原地打转"就报无进展。
 *
 * 这不是 `TASK_STALL_MS` 那种静默检测 —— 实测(2026-08-10)撞到的失败是**吵闹的**:测试账号
 * 掉线后模型停在登录页,连打 18 次 `type` 猜密码(admin / 123456),一路都在报进度,快照恒定
 * 114 字符,没有任何机制发现它在原地打转。静默看门狗对这种情况完全无效,因为它一直在说话。
 *
 * 3 步:两次重复可能是正当的(展开菜单 → 再读一次),第三次就该换策略了。
 */
const NO_PROGRESS_LIMIT = 3

/** 探索路径摘要给 agent 时的模块上限。有界 —— 摘要本身不能变成第二个吃上下文的东西。 */
const SUMMARY_MODULES = 24

/**
 * `begin` 末尾附给 agent 的一段话。刻意放在【工具返回值】里而不是只写在系统提示里:
 * 系统提示离动手那一刻隔着几十轮,而这段话就贴在它要做的第一个决定旁边。
 *
 * 注意这里【不】告诉它哪个是一级菜单 —— 那正是被删掉的判据(见 navExtract.ts)。
 * 只交代目标、边界和记账方式,起点由它自己从快照里挑。
 */
/**
 * 叫停之后,所有【会推进钻探】的工具统一这一句。
 *
 * 为什么要明说而不是静默返回:模型收到一个空结果只会重试或换个方式接着走 —— 我们要的是它**停下**,
 * 所以必须告诉它发生了什么、以及不要再试。记录类的工具(explore_record)**不拦** —— 那些只是把
 * 已经看到的东西落账,而收尾的 journal 正要用它们;拦掉只会让这一轮的产物更少。
 */
const STOPPED_BY_OPERATOR =
  'STOPPED: the operator stopped this drill. Do not navigate, click or continue exploring — the host is finalising the run right now. ' +
  'Say briefly what you had covered when it stopped; the sitemap and apidoc are written incrementally, so a later run continues from here.'

const BEGIN_GUIDANCE = [
  'HOW TO DRILL — a perception→action LOOP. You drive it by LOOKING at the page and ACTING on its UI, not by editing urls:',
  '1. OBSERVE: read the accessibility snapshot above (roles, names, [ref=eN] handles, /url: on links). Work out what this page is',
  '   and what it offers (a menu? a list? a form?).',
  '2. DECIDE + ACT with ui_act — this is how you move and go deep. NAVIGATE BY CLICKING a menu item / button (ui_act its [ref]),',
  '   NOT by changing the url. And USE INPUTS: fill a search / filter field with a value the page already shows, then apply it',
  '   (ui_act fill, then activate the control that runs it) — that exercises the list / query APIs, a big part of the surface,',
  '   and it is always safe: applying a filter only re-reads. One meaningful interaction per step.',
  '3. OBSERVE AGAIN: after each action read the new page (page_snapshot) and say briefly what you LEARNED (new module? a list?',
  '   an individual item? a filtered result?). Then loop back to step 2. Observe → act → observe is the whole mechanism.',
  '3b. TRIAGE THE CONTROLS BEFORE YOU ACT ON THEM. Each page read lists every clickable control the host could see. Answer it',
  '   with explore_record {"plan":{"click":["…"],"skip":[{"name":"…","reason":"…"}]}} — every listed control lands in exactly one',
  '   of the two lists, by its exact name. Then work the click list.',
  '   WHY THIS EXISTS, AND WHY IT IS NOT BUSYWORK: the host counts what it SHOWED you (seen) and what you actually CLICKED, and',
  '   the operator reads those two numbers side by side. Without your verdict in between, "31 controls seen, 1 clicked" has three',
  '   completely different explanations — you never noticed them, you judged them unsafe, or you simply moved on — and they need',
  '   three different fixes. Your plan is the only thing that tells them apart. A control you leave in neither list is recorded as',
  '   "never considered", which is the one outcome that cannot be reviewed at all.',
  '   Skipping is a legitimate verdict, not a failure — but it must carry a reason, and per step 8 a name alone is never one.',
  '4. WHAT FINISHES THE DRILL IS COVERAGE OF PLACES — not how you label them.',
  '   A PLACE is anywhere this site can take you. The host harvests them mechanically from the links on every page you open,',
  '   collapsing repeats (a hundred rows of the same shape = one place). Your job is simple and it is the whole job: OPEN EVERY PLACE.',
  '   Each place you open usually reveals more places. THERE IS NO DEPTH LIMIT — how deep this site goes is a fact about the',
  '   site, and only you can see it. (A "two levels is enough" rule was hard-coded once and silently lost 39 of 42 sub-pages',
  '   on a real site. It is gone. Do not re-invent it by deciding for yourself that a section is "done enough".)',
  '   Two things the harvester CANNOT see, so they are on you:',
  '     · entries that are not links (JS-driven nav, buttons, tabs) — reachable only by CLICKING;',
  '     · anything behind a control that does not change the url (a dialog, a drawer, an expanding panel).',
  '   When you arrive somewhere, COUNT its sub-entries and pass {"module":{...,"expectedChildren":N}}. The host compares N to',
  '   what it harvested and tells you the gap — that gap is exactly the non-link nav you must click.',
  '   Taking longer is fine. Finishing early is not: completeness is the point.',
  '5. MODULES ARE LABELS, NOT THE GATE — but they now also PACE THE INGEST. {"module":{...}} and {"module_done":{...}}',
  '   organise the sitemap so it reads well (name, parentUrl for nesting, its functions). Label at whatever grain reads',
  '   naturally; a wrong label can never make the drill finish sooner, because the gate counts PLACES, not labels.',
  '   NEW: when you mark a module done, the host immediately turns the traffic recorded WHILE YOU DRILLED IT into API docs,',
  '   using that screen\'s snapshot as context — and drilling PAUSES until that finishes. So mark a module done once you have',
  '   actually worked through it, not before: the ingest is scoped to exactly the window you just recorded.',
  '6. DONE (mechanical, NOT when you "feel" finished) = no branch open AND the host\'s',
  '   queue of links it harvested from the site\'s own pages is empty. That queue is the point: it is grown by main from what the',
  '   pages link to, so it is what stops "I discovered one module, drilled it, so I am done". explore_session {"action":"end"}',
  '   is REFUSED until all three hold, and if you stop the host RE-PROMPTS you. So there is no point stopping early — keep',
  '   observing, clicking, discovering and marking modules done until it is actually empty.',
  '7. Do NOT re-open a place you already opened — those are REFUSED by main. A page you passed through but have not finished',
  '   is still open to you: you can go back to it.',
  '8. THE ONLY CONTROL YOU NEVER ACTIVATE IS A **COMMIT CONTROL**.',
  '   COMMIT CONTROL = one whose activation ITSELF persists a change — after it, the stored data is different. That is a',
  '   statement about what a control DOES, never about what it is CALLED. Anything that only opens, loads, reveals, filters or',
  '   navigates is not one, however its label reads. Names are a trap: the controls most worth activating are often the ones',
  '   whose names sound the most dangerous, and skipping them on that basis is the most expensive mistake available to you.',
  '   Which controls are commit controls is decided by the PAGE STATE, and the host tracks that state for you:',
  '   · Nothing typed into this page yet → activate anything. An untouched form has nothing to persist, and opening one is the',
  '     only moment its load endpoints ever fire — that is where most of the surface you are here for actually lives.',
  '   · You HAVE typed into this page → from here, anything that could persist what you typed IS a commit control; leave those',
  '     alone. Read what the page offers, then walk away: navigating away persists nothing.',
  '   In either state, never activate the final confirmation step of an irreversible action.',
  '   (Every non-GET is audited. Record a dont_click rule ONLY for a control you actually SAW persist a change.)',
  '9. explore_visit {"url"} / {"tab"} is a RECOVERY tool ONLY — to go "back", or reach a same-site tab that opened. Do NOT use it',
  '   as your main way to move; move by clicking UI. If a submenu only appears after expanding its parent, ui_act to expand it.',
  '10. If the app requires login and you are BLOCKED from its content, explore_session {"action":"need_login"} (pauses + asks the',
  '   user).',
  '11. NEW TAB = BRANCH DRILL. If a click opens a new same-site tab, the host says so, switches you there, and opens a branch.',
  '    Drill it right then: {module} → observe/click/fill loop → {"module_done":{"url"}}. The host CLOSES that tab and puts you',
  '    back on the main line automatically. Do not close or switch away yourself; end is refused while a branch is open.',
  '12. DO NOT RELY ON YOUR HISTORY — ASK. Everything about progress lives in the host, not in your memory:',
  '    explore_session {"action":"state"} returns, at any moment, where you are, which places are still unopened, which',
  '    modules you labelled, what is still unexercised on this page, and how much budget/token is left. Use it whenever you',
  '    are unsure what to do next, and after anything that interrupted you (a login pause, an ingest, a re-prompt).',
  '    Scrolling back through earlier snapshots is the expensive way to answer a question the host answers for free —',
  '    and older snapshots are stale anyway: the page has moved on.',
  '13. NARRATE: pass note ".." with every explore_record — one short sentence, in the operator\'s language, on what you just',
  '    learned or are about to do. The operator watches these live while you work.'
].join('\n')

export class ExploreSessionService {
  private open = false
  private siteId = ''
  private host = ''
  private startUrl = ''
  private rules: SiteRules | null = null
  private task: TaskHandle | null = null
  /**
   * **这一轮被人叫停了吗**(Ral 2026-08-14:「我点击 stop 停止了钻探,但是 response status 还是显示
   * 钻探中,而且实际钻探并没有被停止」)。
   *
   * 真相是停止只掐掉了**当前那一发 LLM**:`abortAgent` 中断 pi 会话,而宿主的续跑循环紧接着合成
   * 下一轮 —— 那是一发全新的请求,不受上一次 abort 影响。于是页面继续被点,任务卡继续是 running,
   * 状态条继续写「钻探中」。**每一环都在按自己的逻辑正确工作,只是没有任何一环知道人已经喊停了。**
   *
   * 信号挂在【任务】上而不是新造一个字段:`task_control {"action":"cancel"}` 和界面上的停止因此
   * 走同一条路,不会出现"从这里停得掉、从那里停不掉"。
   */
  private get aborted(): boolean {
    return Boolean(this.task?.aborted || this.tabPauseError)
  }
  private startedAt = 0
  // 开钻那一刻的回合累计用量 —— token 花费按【差值】算。钻探工具是在回合中途被调用的,
  // 那之前(系统提示、意图路由那几轮)的用量不属于这次探站的预算。
  private startTokens = 0
  private startCostUsd = 0
  private worklist: WorkItem[] = []
  private visited = new Set<string>()
  /**
   * 结构优先覆盖(drill-structure-first-coverage.md)。分母 = 同站 nav 模板集合,自动收割而非靠 agent 逐个加。
   * `seenTemplates` = 已访问或已入队的【ID 归一化 path 模板】—— 去重键把 100 个详情行折叠成 1 个节点,
   * 也防重复入队。`depthByTemplate` = 每个模板的菜单深度(home=0),用来对孩子封顶 2 级。
   * 台账逻辑只在这里,`navExtract` 一行不改(它照旧只枚举、不判断)。
   */
  private seenTemplates = new Set<string>()
  private depthByTemplate = new Map<string, number>()
  /**
   * 工具调用计数,落进 run journal 供评估用(drill-eval.mjs)。uiActs=0 一眼看出这轮"只导航没点击"——
   * 那正是 read 覆盖卡在 ~40% 的信号(详情/getById 接口只在点开某行时触发)。visits/records 由本服务记,
   * uiActs 由控制器在 ui_act 时 noteUiAct()。
   */
  private counts = { visits: 0, records: 0, uiActs: 0 }
  /**
   * 每页深度(drill-structure-first-coverage.md,Ral 2026-08-12「per-page interaction」)。detail/getById/search
   * 这类接口只在点开某行时触发。曾把"每个列表页必须点开一个详情"做成【硬闸】,实测反噬 —— 空数据/只写行/
   * 规则禁点的页做不到,agent 只能标 uncovered 逃、放弃页面(37→16 页、47→30 API)。所以【软化】成机会型:
   * listNeedsClick 只作软提示 + 度量(nav_state 显示),【不挡 end、不驱动续跑】。列表页判据 = 表格结构
   * (grids/tableRows,纯 DOM 事实,域无关)。真 ui_act(noteUiAct)时清当前页。
   */
  private currentPageUrl = ''
  private listNeedsClick = new Set<string>()
  /**
   * 写安全的判据 = 【页面状态】,不是按钮名字(Ral 2026-08-13)。
   *
   * 「新增/编辑这类都能点,意图是看看点开后的表单里还有没有只读接口的 UI。真正的拦截规则是:
   *   在进行一系列输入后,点某个按钮如果怀疑会导致提交,才不能点;
   *   如果没有经过输入就直接点像是改变数据的按钮,那么应该能点。」
   *
   * 为什么这条是对的:**没填过东西的提交要么是空操作、要么被校验挡下**,写不进真数据;真正会落库的
   * 是"填完再提交"。而按名字拦(编辑/新增/管理/详情)拦掉的恰恰是**打开表单**这一步 —— 表单一打开就会
   * 拉字典、拉下拉选项、拉待编辑记录,那批只读接口只有这时候才发得出来,漏掉的 read 覆盖大半在这里。
   *
   * dirty = 自本页落地以来发生过输入(fill/check/select/type)。它由 main 机械跟踪,不靠模型自觉:
   * 落地清零,输入置位。dirty 时提示"这页已经有输入,别按任何可能提交的控件"。
   */
  private dirtySinceLanding = false
  private static readonly INPUT_ACTIONS = /"action"\s*:\s*"(fill|type|check|select|upload|set_value|setValue)"/i
  noteUiAct(actionsJson?: string): void {
    this.counts.uiActs += 1
    // 心跳:一次点击就是一次真实推进。少了它,纯点击钻探会被看门狗误报 stalled。
    this.touchTask(`ui_act #${this.counts.uiActs}`)
    if (this.currentPageUrl) this.listNeedsClick.delete(this.currentPageUrl)
    const raw = actionsJson || ''
    if (ExploreSessionService.INPUT_ACTIONS.test(raw)) this.dirtySinceLanding = true
    // 把这一发点到的控件按【名字】记进台账(ui_act 传的是 ref,靠快照建的 ref→name 还原)。
    for (const m of raw.matchAll(/"ref"\s*:\s*"(e\d+)"/g)) {
      const hit = this.refNames.get(m[1])
      if (!hit) continue
      const ledger = this.controlsByModule.get(this.currentModuleUrl())
      const entry = ledger?.get(hit.name)
      if (entry) entry.exercised = true
    }
  }

  /** 本页归属的模块 url —— 台账按模块聚合,页面不是模块时归到最近记录过的那个模块。 */
  private currentModuleUrl(): string {
    if (this.moduleByUrl.has(this.currentPageUrl)) return this.currentPageUrl
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const u = this.trail[i].url
      if (this.moduleByUrl.has(u)) return u
    }
    return this.currentPageUrl
  }

  /**
   * 把本页快照里的控件并进【当前模块】的台账(分母),并重建 ref→name。
   * 点开弹窗/抽屉/详情后新冒出来的控件,下一次快照就在这里被自动并进来 = 递归发现。
   */
  /**
   * 【量具】最近一次页面读取里 a11y 意义上的可交互节点总数。与 `seen` 的差 = 控件枚举的盲区。
   * 只记录、不参与任何判定 —— 先留一轮两口径并存的数据(见 navExtract 的 `diag.interactive`)。
   */
  private lastInteractive = 0
  /** a11y walk 折叠前数出的控件数 —— 对账用,不参与任何判定(#12)。 */
  private lastWalkControls = 0

  private mergeControls(evidence: PageEvidence | null): void {
    if (!evidence) return
    this.lastInteractive = evidence.diag?.interactive ?? 0
    // 第三个口径(#12 第 1 步):a11y walk 折叠前自己数出的控件数。**只观测,不进分母。**
    // 三个数并排才能判断换源是"看见得更多"还是"混进噪音"。
    this.lastWalkControls = evidence.walkControls?.length ?? 0
    this.refNames = new Map()
    for (const m of (evidence.snapshot || '').matchAll(/-\s+(\w+)\s+"([^"]*)"[^\n]*\[ref=(e\d+)\]/g)) {
      this.refNames.set(m[3], { role: m[1], name: m[2] })
    }
    const key = this.currentModuleUrl()
    if (!key) return
    let ledger = this.controlsByModule.get(key)
    if (!ledger) { ledger = new Map(); this.controlsByModule.set(key, ledger) }
    for (const c of evidence.controls || []) {
      const name = (c.name || '').trim()
      if (!name || ledger.has(name)) continue
      ledger.set(name, { name, role: c.role, inRow: c.inRow, exercised: false, ...(c.forbidden ? { forbidden: c.forbidden } : {}) })
    }
  }

  /**
   * 边钻边摄:把 (ingestCursor, now] 这一段录到的流量摄成接口文档,期间**钻探是暂停的**。
   *
   * 为什么必须暂停(Ral 2026-08-13):摄取要读的是一个【已经封口】的时间窗。一边摄一边继续点,
   * 窗口右边界就会一直往后跑,同一批流量既可能被这轮摄、也可能被下轮摄。暂停让每段流量恰好归属一轮。
   *
   * 为什么按窗口切:整轮摄完那份实测一次要吞 458KB body / 13 批,反复
   * `apidoc-batch-split — output overflow`;按模块切天然更小更同质,而且带得上这个模块的快照上下文。
   *
   * 幂等由落库层保证(apidoc.dao 是 `ON CONFLICT … DO UPDATE`),窗口重叠或重复摄都不会产生脏数据。
   */
  /**
   * 把 (ingestCursor, now] 这一窗【排队】去摄,**立刻返回**。
   *
   * 为什么不能在这里 await(2026-08-14 实测的 bug,见
   * issues/drill-ingest-concurrent-and-duplicated.md):`BaseAgent` 给每个工具调用包了 120 秒墙钟,
   * 而一轮摄取要 10 分钟。原来写成 `await` 的后果是 —— 120 秒一到 `withTimeout` 返回 ERROR 给模型
   * 但**不取消**后台 promise,模型没拿到确认就重发 `module_done`,于是第二轮开跑而第一轮还在跑:
   * 同一模块摄两遍、三张卡并发。**"暂停"必须放在不受工具超时约束的地方**(见 awaitIngestQueue,
   * 由 observeLanding 在下一次落地前调用)。
   *
   * 串行由队列保证,不由 await 保证 —— 并发本身不会脏数据(apidoc 是 ON CONFLICT DO UPDATE),
   * 但会抢 LLM,把单批拖成 180s 超时重试。
   */
  private ingestQueue: Promise<void> = Promise.resolve()
  private ingestInFlight = 0
  /** 摄取失败的窗口。游标已经推过去了,不重试这段流量就【永久丢失】(2026-08-14 发现)。 */
  private pendingWindows: { sinceTs: number; untilTs: number; moduleUrl: string; moduleName: string }[] = []
  /** 这一轮排过多少个窗口。> 0 = 这份录制已被边钻边摄覆盖,不需要再全量重摄一遍。 */
  private ingestedWindows = 0
  /**
   * 摄取窗口台账:每一段【什么时候到什么时候、属于哪个模块、结果如何】。
   *
   * Ral 2026-08-14:「什么时候开始、截图了哪些页面、录制了哪些接口,这些都是需要持久化的,
   * 用于审计和优化钻探技能」。前两项分别是 journal 的 startedAt 和 snapshotLog,这一项是第三项 ——
   * 有了它,「这一段流量到底摄没摄、摄成了什么」事后可查,而不是只能从满屏日志里拼。
   */
  private ingestLog: { sinceTs: string; untilTs: string; moduleName: string; moduleUrl: string; hasSnapshot: boolean; result: string; ok: boolean }[] = []
  /**
   * 整轮的摄取账:摄到多少 / 其中新增多少 / 丢了多少 / 新增的是哪些。
   *
   * Ral 2026-08-17 最初的问题就是这个:「钻探完成之后,展示你这一轮钻探摄入了多少个接口?
   * 有多少是已经存在的,有多少是新摄入的?」—— 收尾摘要原本有模块数、页面数、控件漏斗、
   * 非 GET 请求、跳出清单,**唯独没有 apidoc 的产出**,而那是钻探的正产物。
   */
  private ingestTally = { documented: 0, created: 0, lost: 0, keys: [] as string[] }
  private enqueueIngestWindow(moduleUrl: string, moduleName: string): void {
    if (!this.deps.ingestWindow) return // 控制器没接 → 整段跳过,钻探照常
    // 叫停后不再排【新】的摄取窗口。已经在队列里的照跑完(增量落盘,摄完是净收益),
    // 但不该因为一次 record 又给它添十分钟的活。
    if (this.aborted) return
    const sinceTs = this.ingestCursor
    const untilTs = Date.now()
    if (untilTs <= sinceTs) return
    this.placesSinceIngest = 0
    this.ingestCursor = untilTs // 游标立刻推:后续流量归下一窗。失败的那段靠 pendingWindows 补,不靠回退游标
    const snapshot = this.snapshotByModule.get(moduleUrl) || null
    this.ingestInFlight += 1
    this.ingestedWindows += 1
    this.log('ingest-enqueued', `queued ingest of the traffic recorded while "${moduleName}" was drilled (${this.fmt(untilTs - sinceTs)} window) — ${this.ingestInFlight} in queue`, { moduleUrl, sinceTs, untilTs, hasSnapshot: !!snapshot, queued: this.ingestInFlight }, 'info')
    this.deps.onNote?.(`📦 已排队:摄取「${moduleName}」这一段的接口(队列 ${this.ingestInFlight})`)
    // 等待态在【入队这一刻】就置上,不能等到 `awaitIngestQueue`(Ral 2026-08-17)。
    //
    // 为什么:`awaitIngestQueue` 由 observeLanding 在**下一次落地之前**调用 —— 也就是钻探
    // 「想继续走」的时候。而 `module_done` 到下一次落地之间可能隔着几分钟(实测一次摄取 5m33s),
    // 那几分钟里没有任何东西置过等待态,状态条的相位竞争就被「卡住了」先匹配上,
    // 把「正常,别动」显示成了「可能挂了,去看看」。实测日志里「摄取中(队列 N)」出现 **0 次**。
    this.deps.onWaiting?.(`摄取「${moduleName}」的接口(队列 ${this.ingestInFlight})`)
    // 串行:每一轮都挂在上一轮后面。catch 吞掉,队列不能被单轮失败打断。
    this.ingestQueue = this.ingestQueue.then(async () => {
      const retry = this.pendingWindows.splice(0, this.pendingWindows.length) // 顺带把之前失败的一起补
      for (const w of [...retry, { sinceTs, untilTs, moduleUrl, moduleName }]) {
        try {
          const snap = this.snapshotByModule.get(w.moduleUrl) || null
          const res = await this.deps.ingestWindow!({ ...w, snapshot: snap })
          const msg = res.text
          this.ingestTally.documented += res.documented || 0
          this.ingestTally.created += res.created || 0
          this.ingestTally.lost += res.lost || 0
          for (const k of res.createdKeys || []) if (this.ingestTally.keys.length < 60) this.ingestTally.keys.push(k)
          this.ingestLog.push({ sinceTs: new Date(w.sinceTs).toISOString(), untilTs: new Date(w.untilTs).toISOString(), moduleName: w.moduleName, moduleUrl: w.moduleUrl, hasSnapshot: !!snap, result: msg.split('\n')[0] || '', ok: true })
          this.log('ingest-window-done', `window ingest finished for "${w.moduleName}" — ${msg}`, { moduleUrl: w.moduleUrl, documented: res.documented, created: res.created, lost: res.lost }, 'info')
        } catch (err) {
          this.ingestLog.push({ sinceTs: new Date(w.sinceTs).toISOString(), untilTs: new Date(w.untilTs).toISOString(), moduleName: w.moduleName, moduleUrl: w.moduleUrl, hasSnapshot: !!this.snapshotByModule.get(w.moduleUrl), result: (err as Error).message, ok: false })
          // 失败的窗口必须留住 —— 游标已经越过它了,不补就再也没人摄(原来的日志谎称"收尾会兜底")。
          this.pendingWindows.push(w)
          this.log('ingest-window-failed', `window ingest failed for "${w.moduleName}": ${(err as Error).message} — kept in pendingWindows (${this.pendingWindows.length}) for retry; its traffic is NOT lost`, { moduleUrl: w.moduleUrl, pending: this.pendingWindows.length }, 'warn')
        }
      }
    }).finally(() => {
      this.ingestInFlight = Math.max(0, this.ingestInFlight - 1)
      // 队列真空了才撤等待态 —— 中间还有窗口在跑就撤,状态条会闪回一个陈旧的标题。
      if (this.ingestInFlight <= 0) this.deps.onWaiting?.(null)
    })
  }

  /**
   * 「钻探暂停」的正确位置(方案 C):等摄取队列排空。由 observeLanding 在**下一次落地前**调用 ——
   * 那里不在工具调用里,不受 120 秒墙钟约束,所以 await 是真的能挡住的。
   *
   * 为什么保留暂停(Ral 2026-08-14 定):窗口封口不需要它(游标已原子推进),但**LLM 争用需要** ——
   * 钻探的模型往返和摄取的 one-shot 打同一个 provider,三轮并发时正是那批 180s 超时的来源。
   * Ral 已明确速度不重要,于是"不抢 LLM + 一次只有一件事"是净赚。
   */
  private async awaitIngestQueue(): Promise<void> {
    // 叫停后不等摄取队列。**队列本身不取消** —— 摄取是边跑边落盘的增量产物,已经排进去的那几段
    // 摄完是净收益;这里只是不再拿钻探去陪它等(那一等可以是十分钟)。
    if (this.aborted) return
    if (this.ingestInFlight <= 0) return
    this.deps.onWaiting?.(`摄取中(队列 ${this.ingestInFlight})—— 钻探等它跑完`)
    const startedAt = Date.now()
    await this.ingestQueue.catch(() => undefined)
    this.log('ingest-queue-drained', `drilling resumes after waiting ${this.fmt(Date.now() - startedAt)} for the ingest queue`, { waitedMs: Date.now() - startedAt }, 'info')
    this.deps.onWaiting?.(null)
  }

  /**
   * 机械兜底:窗口不能无限长。两条界,先到先切。
   *
   * **① 开了这么多【新】地点** —— 模块是标签,agent 可能一次都不标,这条防那种退化。
   *
   * **② 窗口开了这么久** —— 2026-08-17 加的。①【量错了对象】:它只在 `fresh`(从没访问过的 url)
   * 时 +1,而那一轮里 agent 花了 14 分 41 秒在**回访**已访问页(补它自己 planned 却没点的控件),
   * `fresh` 恒假 → 计数不动 → 兜底一次都没触发,窗口滚到 309 条记录 / 20 端点 / 5 批,
   * 单次摄取冻结 5 分 33 秒。
   *
   * 而代价的第二层比冻结更贵:窗口由相邻两次切窗划界,**巨窗会把下一个模块的流量一起吃掉** ——
   * 实测紧随其后的 `/order/contract` 窗口是空的(`nothing to ingest`),那一页被记成「零接口」。
   *
   * 窗口要的性质是「每段流量恰好归属一轮摄取」,这只需要边界**封口且不重叠**,
   * **不需要边界落在 `module_done` 上**。用语义事件当流量分片器,两者合适的粒度本来就不同。
   */
  private static readonly INGEST_WINDOW_MAX_MS = 5 * 60_000
  private ingestIfFloorReached(): void {
    const openFor = Date.now() - this.ingestCursor
    const byPlaces = this.placesSinceIngest >= ExploreSessionService.PLACES_PER_INGEST_FLOOR
    // `ingestCursor` 的字段默认值是 0,由 begin() 设成真实起点。万一在 begin 完成前落地一次,
    // `openFor` 会是「从 1970 年到现在」—— 那会切出一个从 epoch 0 开始的巨窗。游标没设好就不按时长切。
    const byAge = this.ingestCursor > 0 && openFor >= ExploreSessionService.INGEST_WINDOW_MAX_MS
    if (!byPlaces && !byAge) return
    this.enqueueIngestWindow(
      this.currentModuleUrl(),
      byPlaces ? `已开 ${this.placesSinceIngest} 个地点` : `窗口已开 ${this.fmt(openFor)}`
    )
  }

  /**
   * 这一轮的窗口把录制覆盖到什么程度。**给"要不要再全量摄一遍"这个决定用。**
   *
   * 以前补齐边界残缺(跨窗口的请求/响应对、开钻前那一段)靠的是 agent 第 4 步那次**全量**
   * `ingest_recording` —— 整份录制重摄一遍,靠 apidoc 的 ON CONFLICT DO UPDATE 覆盖补齐。
   * 两个问题:① 它是 agent 的一次工具调用,**不是必然发生的**(实测 test-dsh 那轮被中断,一次都没跑);
   * ② 真跑起来是纯重复劳动(实测 janeapp 那轮把 1000+ 条记录重摄了**三遍**),而"避免整轮大批量"
   * 正是边钻边摄的初衷。
   *
   * 现在边界残缺在源头修掉了(按 requestId 配对 + 游标从录制开始起算),所以窗口没有失败时,
   * 全量重摄就是纯浪费,可以直接跳过。**有失败窗口时仍然要跑** —— 那时它是唯一的安全网。
   */
  ingestCoverage(): { windowed: boolean; unrecovered: number } {
    return { windowed: this.ingestedWindows > 0, unrecovered: this.pendingWindows.length }
  }

  /** 收尾:把尾巴排进队列,再【等队列排空】—— 包括之前失败、还挂在 pendingWindows 里的那些。 */
  async ingestTailWindow(): Promise<void> {
    if (!this.deps.ingestWindow) return
    if (Date.now() - this.ingestCursor >= 1000) this.enqueueIngestWindow(this.currentModuleUrl(), '收尾')
    await this.awaitIngestQueue()
    if (this.pendingWindows.length) {
      // 重试后仍然失败的,必须明说是哪几段没摄到 —— 不许假装兜底过了。
      this.log('ingest-windows-unrecovered', `${this.pendingWindows.length} window(s) could not be ingested even after retry — their traffic is documented nowhere: ${this.pendingWindows.map((w) => w.moduleName).join(' | ')}`, { pending: this.pendingWindows }, 'warn')
    }
  }


  /**
   * 这个模块【自己页面上采到】、但还没访问的链接 —— moduleDone 的来源闸。
   *
   * 判据是 provenance(frontier 条目的 `parent` = 采到它的那一页),不是 URL 前缀:子页未必和父页
   * 共享前缀。实测 janeapp 的 Settings,子页一半在 `/admin/settings/*`、一半在 `/admin/company/*`,
   * 前缀判不了,但它们都是从 Settings 那一页采到的。
   *
   * 递归也在这里成立:子模块被访问后,它自己的链接又以它为 parent 入队,于是它也标不了完成 ——
   * 一层一层往下,直到某一层真的采不到新链接。深度由站点决定,不由常数决定。
   */
  /**
   * 【导航父节点自动了结】子页全钻完的壳,宿主自己从前沿移除 —— 不等 agent 想明白。
   *
   * 实测代价(2026-08-17 那一轮):`worklistLeft` 在 07:11–08:26 的五个续跑检查点上**一动没动**,
   * 始终是 8,然后在 08:35 一步掉到 0。那 8 项就是八个顶层区段的壳
   * (`#statistic` `#order` `#product` `#production` `#iot` `#customer` `#enterprise` `#config`),
   * 它们的**所有子页在 07:00–08:00 之间就全钻完了**,壳本身却一直挂着,直到 08:33 agent 才
   * 反应过来、15 秒一个逐个 `uncovered` 掉。**75 分钟空转有一个机械原因**,而那段时间里
   * agent 造了 6 个幽灵模块来顶替进度。
   *
   * 壳不是页面:点「订单」只会展开子菜单或跳到第一个子页。而宿主**知道**哪些模块归属它
   * (路径前缀是纯事实),也知道它们已经 `module_done` —— 所以这件事根本不需要问 agent。
   *
   * 两条护栏,缺一不可:
   *   ① **只了结宿主从没落地过的 url。** 有些站的 `#/order` 真的是一个仪表盘页;
   *      落地过就证明它是真页面,该走正常模块流程,不能当壳消掉。
   *   ② **至少要有一个已钻的子页。** 否则任何还没被展开的父节点都会被误当成"子页全完了"
   *      而消失 —— 那是把"还没开始"读成"已经做完"。
   *
   * 记 `frontier-resolved-by-children`,**不是** `uncovered`:前者是「覆盖到了」,
   * 后者是「到不了」。两者在收尾报告里的含义完全不同,混用会让"探不到的地方"这个清单失真。
   */
  /**
   * 归一化的「路由段」—— 用来判父子。
   *
   * ⚠ 必须归一化,不能直接比 url 前缀:实测那 8 个壳是 `…/#order`(`#` 后**没有**斜杠),
   * 而真实模块是 `…/#/order/mall`(**有**斜杠)。直接 `startsWith('…#order/')` 一个都匹配不上,
   * 修法看着对、实际了结 0 个 —— 2026-08-17 拿真实 url 验的时候才发现。
   */
  private routeSegs(raw: string): string {
    const trim = (v: string): string => v.replace(/^\/+/, '').replace(/\/+$/, '')
    const h = raw.indexOf('#')
    if (h >= 0) return trim(raw.slice(h + 1))
    // 没有 hash = **路径路由**的站点。这里必须取 pathname,不能把整个 url 当路径
    // (2026-08-18 台架测出来):原来直接用整串,于是 `https://h/` 归一成 `https://h` 而不是空串,
    // 上面那条「站点根不是壳,保留」的护栏(`if (!seg)`)对路径路由的站点**永远不触发** ——
    // 哈希站的根安全、路径站的根可被当成壳丢掉,同一段代码两种行为,而且不报错。
    // 比较是两边同函数,所以带不带 host 不影响前缀匹配;只有「根」这个特例需要它真的是空串。
    try {
      return trim(new URL(raw).pathname)
    } catch {
      return trim(raw)
    }
  }

  /**
   * 把「看起来已被子页覆盖」的导航壳**搁置**(不是删除,见 WorkItem.parked)。
   *
   * 搁置的效果只有一个:不再计入完成判定。它仍然出现在前沿清单里、仍然可以被打开 ——
   * 一旦被打开(visited),下面第一条护栏就把它接回正常台账。
   */
  /**
   * 计入「探完了没」的前沿项 —— **搁置的不算**。
   *
   * 所有完成判定都必须走这里,不许再直接读 `this.worklist.length`:
   * 那个数字现在含搁置项,拿它做判定会让导航壳重新阻塞收尾(就是当初那 75 分钟空转)。
   */
  private openWork(): WorkItem[] {
    return this.worklist.filter((w) => !w.parked)
  }

  /**
   * 为一个刚被发现的模块存档一份快照。**存,不喂。**
   *
   * 三个落点,都不花上下文:
   *   · `snapshotByModule` —— 摄取时的模块上下文(先说清这个模块干什么,再解释接口)
   *   · 录制的 `ui/`(UI 模式下)—— 事后按录制复盘时有据可查
   *   · Form 提取的取材(workbench-form-module #5)
   *
   * 失败**不阻断钻探**:这是产物,不是判定。取不到就记一行 warn,继续钻。
   */
  private async snapshotModuleForArchive(moduleUrl: string, moduleName: string): Promise<void> {
    try {
      const snap = await this.deps.pageSnapshot(this.anchorTabId)
      if (!snap?.yaml) {
        this.log('module-snapshot-missing', `没能为模块「${moduleName}」存档快照(debugger 没附着?)`, { url: moduleUrl }, 'warn')
        return
      }
      // 后到覆盖先到:模块页往往要点几下才展开全,最后那份最完整。
      this.snapshotByModule.set(moduleUrl, snap.yaml)
      this.log(
        'module-snapshot-archived',
        `模块「${moduleName}」存档快照 ${Math.round(snap.yaml.length / 1024)}KB / ${snap.nodeCount} 节点`,
        { url: moduleUrl, chars: snap.yaml.length, nodeCount: snap.nodeCount },
        'info'
      )
    } catch (err) {
      this.log('module-snapshot-failed', `模块「${moduleName}」快照存档失败:${(err as Error).message}`, { url: moduleUrl }, 'warn')
    }
  }

  private resolveHubsCoveredByChildren(): void {
    if (!this.worklist.length) return
    const drilledSegs = [...this.drilledModuleUrls].map((d) => this.routeSegs(d))
    const resolved: string[] = []
    for (const w of this.worklist) {
      if (w.parked) {
        // 已搁置的:如果后来被打开了,收回搁置 —— 打开过就有了真证据,不该继续被排除在判定外。
        if (this.visited.has(w.url)) w.parked = undefined
        continue
      }
      if (this.visited.has(w.url)) continue // 护栏①:落地过 = 真页面
      const seg = this.routeSegs(w.url)
      if (!seg) continue // 站点根,不是壳
      const prefix = `${seg}/`
      const children = drilledSegs.filter((d) => d.startsWith(prefix))
      if (!children.length) continue // 护栏②:一个已钻子页都没有 → 不是"全完了",是"还没开始"
      const anyChildLeft = this.worklist.some(
        (x) => x !== w && !x.parked && this.routeSegs(x.url).startsWith(prefix) && !this.visited.has(x.url)
      )
      if (anyChildLeft) continue
      w.parked = { reason: `${children.length} 个子页已钻,且前沿里没有别的子页`, at: Date.now() }
      resolved.push(w.url)
    }
    if (!resolved.length) return
    this.log(
      'frontier-parked-as-nav-shell',
      `${resolved.length} nav parent(s) PARKED (still openable, just no longer blocking completion) — every known child is drilled: ${resolved.join(' | ')}`,
      { resolved, worklistLeft: this.openWork().length, parked: this.worklist.filter((w) => w.parked).length },
      'info',
      true
    )
  }

  private unvisitedChildrenOf(moduleUrl: string): WorkItem[] {
    const own = new Set<string>([moduleUrl])
    // 模块页面可能不止一个 URL(同模板的不同实例),用模板归一后比对。
    const tmpl = this.templateOf(moduleUrl)
    return this.worklist.filter((w) => {
      if (this.visited.has(w.url)) return false
      if (!w.parent) return false
      return own.has(w.parent) || (tmpl !== null && this.templateOf(w.parent) === tmpl)
    })
  }

  /**
   * 全站还没点过的控件,按模块分组。**给续跑循环用**(Ral 2026-08-14:「你没有点击 table 中的按钮,
   * 如编辑按钮,新增按钮也没点击」)。
   *
   * 为什么不点:规则是干净的(这个站 16 条 dontClick 全是真提交控件,没有一条是编辑/新增),提示词
   * 也已经是状态判据(没输入过就随便点)。真正的原因是 **控件不在完成判定里** —— 地点没开完 `end`
   * 会被拒、还会被合成 turn 硬催;控件没点过则什么都不会发生。agent 朝真正约束它的那个闸优化,
   * 软提示打不过硬闸。这里先把它接进【续跑的话术】(便宜、不会死锁),硬闸留到实测之后再说。
   */
  untouchedByModule(limit = 6): { name: string; controls: string[] }[] {
    const out: { name: string; controls: string[] }[] = []
    for (const [url, ledger] of this.controlsByModule) {
      const controls = [...ledger.values()].filter((c) => !c.exercised && !c.forbidden).map((c) => c.name)
      if (controls.length) out.push({ name: this.moduleByUrl.get(url)?.name || url, controls })
      if (out.length >= limit) break
    }
    return out
  }

  controlLedger(): { module: string; name: string; controls: ControlEntry[] }[] {
    const out: { module: string; name: string; controls: ControlEntry[] }[] = []
    for (const [url, ledger] of this.controlsByModule) {
      out.push({ module: url, name: this.moduleByUrl.get(url)?.name || url, controls: [...ledger.values()] })
    }
    return out
  }

  /**
   * 漏斗计数。分母**先扣掉站点规则禁点的**(那些从一开始就不该在分母里,算进去会让每个模块
   * 天生欠一截,漏斗就没有基线了)。
   */
  private funnelOf(controls: ControlEntry[]): { seen: number; planned: number; skipped: number; untriaged: number; clicked: number } {
    const live = controls.filter((c) => !c.forbidden)
    const planned = live.filter((c) => c.planned).length
    const skipped = live.filter((c) => !c.planned && c.skipReason).length
    return { seen: live.length, planned, skipped, untriaged: live.length - planned - skipped, clicked: live.filter((c) => c.exercised).length }
  }

  /** 当前模块这一刻的漏斗(落地提示 + 快照台账都用它)。 */
  private currentFunnel(): { seen: number; planned: number; skipped: number; untriaged: number; clicked: number } {
    return this.funnelOf([...(this.controlsByModule.get(this.currentModuleUrl())?.values() ?? [])])
  }

  /** 全站漏斗:总数 + 逐模块 + 操作列单列(操作列是最容易整列漏掉的一类)。 */
  controlFunnel(): {
    total: { seen: number; planned: number; skipped: number; untriaged: number; clicked: number }
    inRow: { seen: number; planned: number; skipped: number; untriaged: number; clicked: number }
    byModule: { module: string; name: string; seen: number; planned: number; skipped: number; untriaged: number; clicked: number; plannedNotClicked: string[] }[]
  } {
    const led = this.controlLedger()
    const all = led.flatMap((m) => m.controls)
    return {
      total: this.funnelOf(all),
      inRow: this.funnelOf(all.filter((c) => c.inRow)),
      byModule: led.map((m) => ({
        module: m.module,
        name: m.name,
        ...this.funnelOf(m.controls),
        // 「说了要点却没点」—— 漏斗里唯一一个**归因明确**的缺口:不是没看见,也不是判定不该点。
        plannedNotClicked: m.controls.filter((c) => !c.forbidden && c.planned && !c.exercised).map((c) => c.name)
      }))
    }
  }

  /** 全站「说了要点却没点」的控件,按模块分组 —— 续跑话术和收尾摘要都点名它。 */
  plannedNotClicked(limit = 6): { name: string; controls: string[] }[] {
    const out: { name: string; controls: string[] }[] = []
    for (const m of this.controlFunnel().byModule) {
      if (m.plannedNotClicked.length) out.push({ name: m.name, controls: m.plannedNotClicked })
      if (out.length >= limit) break
    }
    return out
  }

  /**
   * agent 的**控件分诊**:读完这一页后,逐个说「要点」还是「不点+为什么」。
   *
   * 为什么必须由 agent 报而不是 main 推:main 只能机械枚举「页面上有什么」,推不出「你认为哪些
   * 该点」。少了这一格,收尾摘要里的 `1/74` 就只是个数字 —— 分不清是没看见、看见了判定不该点、
   * 还是判定该点却没点。这三种的修法完全不同(改快照 / 改判据 / 加闸),所以必须分开量。
   *
   * 名字对不上照样收,只是**报出来**:agent 编了页面上不存在的控件名,本身就是要看的信号
   * (要么它在凭记忆写,要么快照没把这些控件读出来)。
   */
  recordPlan(plan: { click?: string[]; skip?: { name: string; reason?: string }[] }): string {
    const key = this.currentModuleUrl()
    const ledger = this.controlsByModule.get(key)
    if (!ledger) return 'plan noted, but no controls have been read on this page yet — read the page first (explore_visit / ui_act both re-read it).'
    // 名字匹配:先原样,再去空白,再忽略大小写。三步都不中才算「页面上没有」。
    const byExact = new Map<string, ControlEntry>()
    const byLoose = new Map<string, ControlEntry>()
    for (const c of ledger.values()) {
      byExact.set(c.name, c)
      byLoose.set(c.name.replace(/\s+/g, '').toLowerCase(), c)
    }
    const find = (raw: string): ControlEntry | undefined =>
      byExact.get(raw) || byExact.get(raw.trim()) || byLoose.get(raw.replace(/\s+/g, '').toLowerCase())
    const unknown: string[] = []
    const clickNames: string[] = []
    const skipNames: string[] = []
    const ruled: string[] = []
    for (const raw of plan.click || []) {
      const name = String(raw || '').trim()
      if (!name) continue
      const hit = find(name)
      if (!hit) { unknown.push(name); continue }
      // 站点规则禁点的不能被计划掉 —— 规则是永久的、跨会话继承的,单轮的判断不该翻它。
      if (hit.forbidden) { ruled.push(hit.name); continue }
      hit.planned = true
      delete hit.skipReason
      clickNames.push(hit.name)
    }
    for (const raw of plan.skip || []) {
      const name = String(raw?.name || '').trim()
      if (!name) continue
      const hit = find(name)
      if (!hit) { unknown.push(name); continue }
      if (hit.planned) continue // 同一轮里既说点又说不点 —— 以「点」为准,不静默翻案
      hit.skipReason = String(raw?.reason || '').trim() || 'no reason given'
      skipNames.push(hit.name)
    }
    const f = this.currentFunnel()
    const moduleName = this.moduleByUrl.get(key)?.name || key
    // 播到聊天里 —— Ral 要的就是「明明截图了,看你分析出多少、又点了多少」这条能对照的账。
    this.deps.onNote?.(
      [
        `🔎 **${moduleName}** 控件分诊:看见 ${f.seen} · 要点 ${f.planned} · 跳过 ${f.skipped} · 未分诊 ${f.untriaged} · 已点 ${f.clicked}`,
        clickNames.length ? `　要点:${clickNames.slice(0, 14).map((n) => `\`${n}\``).join(' ')}${clickNames.length > 14 ? ` …+${clickNames.length - 14}` : ''}` : '',
        skipNames.length ? `　跳过:${skipNames.slice(0, 8).map((n) => `\`${n}\``).join(' ')}${skipNames.length > 8 ? ` …+${skipNames.length - 8}` : ''}` : ''
      ]
        .filter(Boolean)
        .join('\n')
    )
    this.log(
      'control-triage',
      `triaged "${moduleName}": ${f.planned} to click, ${f.skipped} skipped, ${f.untriaged} still untriaged of ${f.seen} clickable`,
      // `interactive` / `blind` 是量具:分母只收 button 系,这两个数让盲区在每一页可见。
      { module: key, ...f, interactive: this.lastInteractive, walkControls: this.lastWalkControls, blind: Math.max(0, this.lastInteractive - f.seen), click: clickNames, skip: skipNames, unknown },
      'info'
    )
    return [
      `plan recorded for "${moduleName}" — ${f.planned} to click, ${f.skipped} skipped, ${f.clicked} already clicked.`,
      unknown.length
        ? `⚠ NOT on this page: ${unknown.slice(0, 8).map((n) => `"${n}"`).join(', ')}${unknown.length > 8 ? ` …+${unknown.length - 8}` : ''} — triage the controls the page read actually listed, by their exact names. If a control you can SEE is missing from that list, that is a reading gap worth reporting with disagreement.`
        : '',
      ruled.length ? `⛔ site rule forbids: ${ruled.map((n) => `"${n}"`).join(', ')} — left out of the plan (rules are permanent and outrank a single run's judgement).` : '',
      f.untriaged > 0
        ? `⚠ ${f.untriaged} control(s) here are still untriaged — every clickable control needs one of the two verdicts before you leave this page. Untriaged reads as "never looked at", which is the one outcome that cannot be reviewed.`
        : 'every clickable control on this page is triaged. Now work the click list.',
      f.planned > f.clicked ? `next: ${f.planned - f.clicked} of the controls you just said you would click are still unclicked.` : ''
    ]
      .filter(Boolean)
      .join('\n')
  }
  /**
   * 点击导航 = 一等状态转移(Ral 2026-08-13)。机制改成"点击导航、别改 url"之后,**所有**簿记
   * (visited / currentPageUrl / frontier 收割 / 列表页判定)却还只挂在 explore_visit 上,于是:
   *   ① moduleDone 要求 visited,点着到的页永远不在里面 → 被拒 → agent 只能补一发
   *      explore_visit{url} 当"簿记"(日志里那句 from:"current visited bookkeeping")→ Ral 看到的重复操作;
   *      而 explore_visit 是真 loadURL,把刚点出来的筛选态整页刷掉,再把 url 烧进 visited(以后真要回来被硬拒);
   *   ② autoSeedFrontier 只在 begin/explore_visit/tab-switch 跑 → 纯点击钻探【frontier 不再生长】,
   *      发现面直接塌掉(26→7 模块、47→15 接口)。
   * 修法就一条:点完(和每次快照)都观察真实 URL,变了就当一次到达来记。这样"点击导航"和
   * "explore_visit 导航"在状态机里等价,上面两条链一起断。
   */
  async observeLanding(reason: string): Promise<string> {
    if (!this.open || this.aborted) return ''
    const wc = this.drillWc()
    if (!wc || wc.isDestroyed()) return ''
    const landed = wc.getURL()
    if (!landed || this.hostOf(landed) !== this.host) return ''
    const url = this.normalize(landed, this.startUrl)
    if (!url) return ''
    // URL 变了 = 换页;没变【也要往下走】—— 点"编辑/新增"弹出的表单是同一个 URL,
    // 而那个弹窗里的控件正是要递归发现的东西(Ral 2026-08-13)。早退会让弹窗内的控件永远看不见。
    const moved = url !== this.currentPageUrl
    if (moved) {
      const fresh = !this.visited.has(url)
      this.visited.add(url)
      this.currentPageUrl = url
      this.dirtySinceLanding = false // 换页 = 之前那页的输入不再有提交风险
      this.worklist = this.worklist.filter((w) => w.url !== url)
      this.trail.push({ url, name: reason, at: Date.now() })
      if (fresh) {
        this.log('nav-by-click', `arrived at ${url} by clicking`, { url, visited: this.visited.size, worklist: this.worklist.length }, 'info', true)
        this.placesSinceIngest += 1
      }
      this.touchTask(url)
    }
    // 预算软限制:触顶就弹确认卡问人(await 天然形成"暂停"),不再静默停钻探。
    await this.checkBudgetSoftLimit()
    // 「钻探暂停」的正确位置:等摄取队列排空(不在工具调用里,不受 120s 墙钟约束)。
    await this.awaitIngestQueue()
    // 边钻边摄的机械兜底:agent 一次都不标模块时,别退回"全钻完再摄"。
    this.ingestIfFloorReached()
    const evidence = await this.readPage()
    if (!evidence) return ''
    if (moved) {
      this.autoSeedFrontier(url, [...evidence.anchors, ...this.snapshotLinks(evidence.snapshot)])
      this.markListIfNeeded(url, evidence)
    }
    // 留存快照:摄取时要靠它先说清"这个模块是干什么的",再去解释接口。存 currentModuleUrl 名下,
    // 后到的覆盖先到的(模块页往往要点几下才展开全,最后那份最完整)。
    if (evidence.snapshot) this.snapshotByModule.set(this.currentModuleUrl(), evidence.snapshot)
    // 先并台账再记快照:快照台账要带上**这一份快照自己揭示的**控件数,否则它记的是上一页的漏斗,
    // 事后按快照对账会整体错开一格。
    const before = this.controlsByModule.get(this.currentModuleUrl())?.size ?? 0
    this.mergeControls(evidence)
    const after = this.controlsByModule.get(this.currentModuleUrl())?.size ?? 0
    this.noteSnapshot(evidence, this.lastReadWasReread)
    this.lastReadWasReread = false
    const hints: string[] = []
    if (!moved && after > before) {
      // 点开之后页面上多出了控件(弹窗/抽屉/展开的详情)—— 这就是下一层要继续操作的东西。
      hints.push(`${after - before} NEW control(s) appeared without a page change — you opened something. Work through them before you leave.`)
    }
    if (this.dirtySinceLanding) {
      hints.push('⚠ you have TYPED into this page — so anything that could persist what you typed is now a COMMIT CONTROL. Leave those alone; to move on just navigate away, which persists nothing.')
    }
    // 控件漏斗的落地提示。**分成两句是刻意的**:「还没分诊」和「说了要点却没点」是两种不同的欠账,
    // 修法也不同(一个是没看、一个是没做),混成一句「还剩 N 个没点」就又回到了那个分不清环节的数字。
    const ledger = [...(this.controlsByModule.get(this.currentModuleUrl())?.values() ?? [])]
    const f = this.funnelOf(ledger)
    const list = (names: string[], cap = 12): string =>
      `${names.slice(0, cap).map((n) => `"${n}"`).join(' | ')}${names.length > cap ? ` | …${names.length - cap} more` : ''}`
    if (f.untriaged > 0) {
      const names = ledger.filter((c) => !c.forbidden && !c.planned && !c.skipReason).map((c) => c.name)
      hints.push(
        `CONTROL TRIAGE — ${f.seen} clickable here, ${f.untriaged} not yet triaged: ${list(names)}\n` +
          `  Report explore_record {"plan":{"click":["…"],"skip":[{"name":"…","reason":"…"}]}} covering ALL of them, then work the click list. ` +
          `The operator reviews this funnel (seen → planned → clicked) to see which step drops a control, so an untriaged control is the one outcome with no explanation attached.`
      )
    }
    const owed = ledger.filter((c) => !c.forbidden && c.planned && !c.exercised).map((c) => c.name)
    if (owed.length) hints.push(`still owed on this page (${owed.length} you said you would click): ${list(owed)}`)
    // 拦掉的下载在这里交付并清空 —— 攒着是因为拦截发生在主进程,和工具调用不同步。
    if (this.blockedUploads.length) {
      const kinds = this.blockedUploads.splice(0, this.blockedUploads.length)
      hints.push(
        `FILE UPLOAD BLOCKED (${kinds.length}): the page opened a file/directory chooser (${kinds.join(', ')}) and the host CANCELLED it — ` +
          `same as a human pressing Cancel. The dialog never appeared, the page got an empty input, and nothing was interrupted: ` +
          `the recording and this drill are still running. That control WORKED — it is just an upload entry, and uploading is a WRITE, ` +
          `which is out of scope for a drill. Nothing was sent. Move on; do NOT click it again, and do NOT add a dont_click rule for it.`
      )
    }
    if (this.blockedDownloads.length) {
      const names = this.blockedDownloads.splice(0, this.blockedDownloads.length)
      hints.push(
        `FILE DOWNLOAD BLOCKED (${names.length}): ${names.map((n) => `"${n}"`).join(' | ')}. ` +
          `That control WORKED — its request fired and was recorded, so the endpoint is captured. Only the file was dropped, on purpose: ` +
          `a save dialog is modal and would freeze the drill. Treat it as a success and move on; do NOT click it again, and do NOT add a dont_click rule for it.`
      )
    }
    return hints.join('\n')
  }
  private modules: SitemapModule[] = []
  private moduleByUrl = new Map<string, SitemapModule>()
  /**
   * 控件台账(Ral 2026-08-13:「发现模块,然后发现哪些可操作按钮和输入;点击一个按钮后又发现新的
   * 可操作按钮,继续操作」)。**分母由 main 从快照机械枚举**(navExtract 的 controls),不靠 agent 自报
   * —— 和 frontier 同一个道理:agent 自己写的分母挡不住 satisfice。点开一个按钮后新冒出来的控件
   * (弹窗/抽屉/详情里的),下一次快照会被自动并进来,这就是"递归发现"。
   *
   * 现在只做【度量 + 软提示】,不做完成硬闸:同一改动里已经动了完成闸(frontier 回归),再叠一道
   * 硬闸会让这轮的结果没法归因(而且"每个列表页必须点开详情"那种硬闸实测反噬过 47→30)。
   * 先量出"模块-按钮"的点击率,再决定要不要升成闸。
   */
  private controlsByModule = new Map<string, Map<string, ControlEntry>>()
  /** 快照里的 `[ref=eN]` → 控件名。ui_act 传的是 ref,要靠它把"点了谁"还原成名字。 */
  private refNames = new Map<string, { name: string; role: string }>()
  /**
   * 模块钻探分数(Ral 2026-08-12,感知-行动循环 + 模块分数机制)。完成判定 = 机械的【已钻模块 == 已发现模块】,
   * 而不是 agent 觉得"够了"就停(规避 satisfice 早停)。增量由 agent 判断:发现新模块 → 分母(moduleByUrl)+1;
   * agent 判定某模块钻完 → moduleDone 标记进这个 Set(分子)+1。要求该模块【已访问过】才能标完成(不可空标蒙混)。
   */
  private drilledModuleUrls = new Set<string>()
  /**
   * 别名闸拒过几次 —— 收尾报告要说「模块 N 个(其中 M 个身份可疑)」。
   *
   * 为什么必须报出来:实测一轮里 agent 造了 **7 个**同一页面的 url 变体,
   * 拒掉之后模块计数是对的,但**「它尝试过」这件事本身是信息** ——
   * 只报一个干净的数字会让下一个人以为这个通道从来没被走过。
   */
  private aliasRefused = 0
  /**
   * 边钻边摄(Ral 2026-08-13)。三样状态:
   *   · snapshotByModule —— 模块落地那一刻的快照。摄取时当上下文用(先总结模块干什么,再解释接口)。
   *   · ingestCursor —— 已经摄到哪个时刻。下一窗 = (cursor, now],按 event.ts 切。
   *   · placesSinceIngest —— 机械兜底:模块是【标签】,agent 可能一次都不标(那就退回"全钻完再摄"),
   *     所以开了这么多地点还没摄过就自动摄一轮,节奏不会退化。
   */
  private snapshotByModule = new Map<string, string>()
  /**
   * **每一次落地的页面快照**,按发生顺序,和这一轮 explore session 绑在一起(Ral 2026-08-14:
   * 「Page snapshot 需要记录下来用于 review 钻取的情况,它应该和 explore session 关联起来」)。
   *
   * `snapshotByModule` 不能替代它:那个按模块键、**后到的覆盖先到的**,只留最后一份,而且是拿去
   * 喂摄取的上下文,不是审计材料。要回答「这个页面当时到底长什么样、为什么操作列的按钮没被点」,
   * 需要的恰恰是**每一次**读到的原样。
   *
   * 写在 runs/<ts>-snapshots.json,不进主 journal —— 主 journal 是给人扫的,几十份快照会把它撑爆。
   */
  private snapshotLog: {
    at: string
    url: string
    moduleUrl: string
    title: string
    rows: number
    grids: number
    controls: number
    inRowControls: number
    reread: boolean
    /**
     * 拍下这一刻**当前模块**的漏斗。快照台账里带上它,「明明截图了却没点」才有得查:
     * 同一个模块连着五份快照、`seen` 一直 31 而 `planned` 一直 0 —— 那就是分诊这一环断的,
     * 不是快照没读到。事后翻日志能直接看出是哪一环,不用重跑一轮去猜。
     */
    funnel: { seen: number; planned: number; skipped: number; untriaged: number; clicked: number }
    yaml: string | null
  }[] = []
  private ingestCursor = 0
  private placesSinceIngest = 0
  /**
   * 「只钻这一组」(Ral 2026-08-14:「有指定一组模块继续钻探的能力才行,钻探时应该能感知到这个上下文」)。
   *
   * 语义是**限定这一轮的范围**,不只是排个序 —— 否则限定就没有意义:整站都在 worklist 里,这一轮
   * 永远不可能"跑完",覆盖判定会一直催下去。
   *
   * 范围怎么算:一个地点入选,要么它自己命中关键词,要么它是**从已入选的地点点进去的**
   * (provenance,和 moduleDone 的来源闸同一条依据)。于是"钻 Settings"= Settings 及其整棵子树,
   * 而不是只有那一页 —— 递归天然成立,这正是模块会嵌套的那个事实。
   */
  private focus: string[] = []
  /** 因为不在范围内而没入队的地点数。**丢可以,静默不行** —— 收尾要报,免得看起来像"整站都探完了"。 */
  private offFocusDropped = 0
  private static readonly PLACES_PER_INGEST_FLOOR = 8
  /** agent 自估的子模块数,标完成时对账(Ral 2026-08-13 的三步递归下钻)。 */
  private expectedChildrenByModule = new Map<string, number>()
  private uncovered: SitemapUncovered[] = []
  private offsite: SitemapOffsiteExit[] = []
  private writes: ObservedWrite[] = []
  /** Pages where the extractor and the agent disagreed — this site's confidence number (decision 7). */
  private disagreements: { url: string; extractor: number; agent: number; note?: string }[] = []
  private journal: { at: string; action: string; detail: string }[] = []
  /**
   * 已被 main 侧【硬拦】的重复访问。Ral 2026-08-10:「你需要让 agent 记住已经探索过哪些,
   * 防止重复探索」—— 实现成 main 拒绝,而不是提示模型自觉:提示是建议,拒绝是事实。
   */
  private refusedRevisits: { url: string; at: string }[] = []
  /** 按模块聚合的探索路径摘要(有界)—— 给 agent 规划下一步用,不是给它当记忆用。 */
  private trail: { url: string; name: string; module?: string; at: number }[] = []
  /** 无进展检测的指纹:同 url + 同快照 ⇒ 这一步什么都没改变。 */
  private lastFingerprint = ''
  private noProgressStreak = 0
  /**
   * 多 tab 钻探(drill-multi-tab)。钻探起点那个 tab —— 被新 tab 抢焦点后靠它切回主线。
   * exploreSession 仍是【一个会话】:状态按 URL 存、跨 tab 累积,输出全在这个会话里。
   */
  private homeTabId = ''
  private readonly tabMembers = new Map<string, DrillTabState & { wc: WebContents | null }>()
  private tabScopeActive = false
  private tabPauseError = ''

  activeTabIds(): string[] {
    return this.tabScopeActive && !this.tabPauseError
      ? [...this.tabMembers.values()].filter((tab) => tab.status === 'active').map((tab) => tab.id)
      : []
  }

  ownsActiveTab(id: string): boolean { return this.activeTabIds().includes(id) }

  tabState(): { mainTabId: string; currentTabId: string; activeTabIds: string[]; paused: string | null; tabs: DrillTabState[] } {
    return { mainTabId: this.homeTabId, currentTabId: this.currentDrillTabId,
      activeTabIds: this.activeTabIds(), paused: this.tabPauseError || null,
      tabs: [...this.tabMembers.values()].map(({ wc: _wc, ...tab }) => ({ ...tab })) }
  }

  async admitBranch(tabId: string, parentTabId: string, url: string): Promise<void> {
    if (!this.open || !this.ownsActiveTab(parentTabId) || this.tabMembers.has(tabId)) return
    this.tabMembers.set(tabId, { id: tabId, url, parentTabId, role: 'branch', status: 'active', wc: this.deps.webContentsForTab(tabId) })
    await this.deps.onTabScopeChanged?.(this.activeTabIds())
  }

  refreshTabScope(): void {
    if (!this.tabScopeActive) return
    let changed = false
    for (const tab of this.tabMembers.values()) {
      if (tab.status !== 'active') continue
      const info = this.deps.describeTab?.(tab.id)
      const wc = this.deps.webContentsForTab(tab.id)
      if (wc && !wc.isDestroyed() && !wc.isCrashed() && wc === tab.wc && (!info || ['ready', 'loading'].includes(info.status))) continue
      tab.status = this.deps.describeTab && !info ? 'closed' : 'unavailable'
      tab.error = info?.error || 'The drill page was closed, destroyed, or replaced.'
      changed = true
      if (tab.role === 'main') {
        this.tabPauseError = 'Drill paused: main tab ' + tab.id + ' is ' + tab.status + '. ' + tab.error + ' Reopen the intended page and begin a new drill explicitly.'
        this.tabScopeActive = false
        this.log('main-tab-unavailable', this.tabPauseError, { tabId: tab.id }, 'error', true)
        this.deps.onMainTabUnavailable?.(this.tabPauseError)
      } else {
        this.branchStack = this.branchStack.filter((branch) => branch.tabId !== tab.id)
        if (this.currentDrillTabId === tab.id) {
          this.currentDrillTabId = tab.parentTabId || this.homeTabId
          void this.onAnchorTabChanged(this.currentDrillTabId)
        }
      }
    }
    if (changed) void this.deps.onTabScopeChanged?.(this.activeTabIds())
  }

  async finishTabScope(): Promise<void> {
    this.open = false
    this.tabScopeActive = false
    this.restoreDrillThrottling()
    await this.deps.onTabScopeChanged?.(null)
  }
  // 钻探【当前应该在】的 tab —— 默认 home;visitTab 去探 B 时改成 B(那是钻探自己有意切的)。所有
  // tab 触碰工具(explore_visit / ui_act / page_snapshot)导航/读/点前都钉回它,这样人手动切激活 tab
  // 不会让钻探读错/点错 tab(bug 2026-08-11)。区别于人切:人切是无意的,钻探切走 currentDrillTabId 才动。
  private currentDrillTabId = ''

  /** 上一次观察到的激活 tab —— 只为给 `pinActiveTabToDrillTab` 的留痕去重。 */
  private lastObservedActiveTabId = ''

  /** 被我们关掉后台节流的 tab —— 结束时逐个还原(见 `applyDrillThrottling`)。 */
  private readonly unthrottledTabIds = new Set<string>()

  /**
   * 钻探此刻的锚点 tab —— `enforceWarmCap()` 要它才能把这个 tab 排除在 LRU 冷却之外。
   * 少了这条保护,`drillWc()` 会在钻探 tab 不再激活时拿到 null(冷却 ⇒ `view = null`),钻探失明。
   */
  get anchorTabId(): string {
    return this.currentDrillTabId || this.homeTabId
  }

  /**
   * 关/开钻探 tab 的**后台节流**(conn-009)。
   *
   * 为什么需要:解耦之后钻探 tab 通常不是激活 tab ⇒ `setVisible(false)` ⇒ 默认
   * `backgroundThrottling: true` 会节流页面侧的定时器与渲染,`settle()` 因此变慢甚至超时。
   * 钻探能跑两小时,这种慢是会累积的。
   *
   * 只对**我们动过的** tab 还原(记在 `unthrottledTabIds` 里),不去猜别人的设置。
   */
  /**
   * 锚点 tab 变了以后要跟着动的**全部**副作用,收在一处(conn-009)。
   *
   * 收敛的理由不是好看:这两件事漏任一处的症状都很隐蔽 —— 漏了 retarget,边钻边摄会录成
   * 人正在看的那个 tab 的流量(摄出来的文档是错的,但过程一声不响);漏了 unthrottle,
   * 页面侧被节流,只表现为"这一段特别慢"。三个赋值点各写两行,迟早漏一个。
   */
  private async onAnchorTabChanged(tabId: string): Promise<void> {
    if (!tabId) return
    this.applyDrillThrottling(tabId)
    await this.deps.retargetCapture(tabId).catch((err) => this.log('retarget-failed', `capture → ${tabId}: ${(err as Error).message}`, undefined, 'warn'))
  }

  private applyDrillThrottling(tabId: string): void {
    if (!tabId || this.unthrottledTabIds.has(tabId)) return
    const wc = this.deps.webContentsForTab(tabId)
    if (!wc || wc.isDestroyed()) return
    wc.setBackgroundThrottling(false)
    this.unthrottledTabIds.add(tabId)
    this.log('unthrottle', `关掉 tab ${tabId} 的后台节流 —— 它不再是激活 tab,但钻探要在上面跑`, { tab: tabId }, 'info')
  }

  private restoreDrillThrottling(): void {
    for (const tabId of this.unthrottledTabIds) {
      const wc = this.deps.webContentsForTab(tabId)
      if (wc && !wc.isDestroyed()) wc.setBackgroundThrottling(true)
    }
    this.unthrottledTabIds.clear()
  }

  /**
   * 钻探的手 = **它自己那个 tab 的 view**,不是"激活 tab"的镜像(契约 PQ-5,落地 conn-009)。
   *
   * 这是本次解耦的**唯一**改动点:全文 16 处原来直接读 `this.drillWc()`(= 激活 tab),
   * 现在一律经这里。于是人在钻探期间可以切到 connector tab 看收件箱,钻探照旧在自己那只上跑。
   *
   * **还没认领 tab 时退回激活 view** —— 钻探启动的前几步(`homeTabId` 在 start 里才被赋值)
   * 本来就该用激活 tab,那是旧行为,不在本次改动范围里。
   *
   * 拿到 null 的处理不变:各工具原本就有 `if (!wc || wc.isDestroyed()) return 'ERROR: no page is open.'`。
   * 但真正让 null 不会发生的是 `enforceWarmCap()` 里那条钻探 tab 免冷却 —— 少了它,
   * 钻探 tab 一旦不再激活就会被 LRU 冷却成 `view = null`,这条解耦会让钻探直接失明。
   */
  private drillWc(): WebContents | null {
    if (this.tabPauseError) return null
    const want = this.currentDrillTabId || this.homeTabId
    if (!want) return this.deps.webContents()
    return this.deps.webContentsForTab(want)
  }
  /**
   * 已钻过(或正在钻)的 tab(drill-extra-tabs-not-queued-and-drilled.md,Ral 2026-08-12)。有些站点在新 tab
   * 打开页面,那 tab 里也有要录的接口。当前 tab frontier 走空后,系统化切到下一个未钻的【同站】tab 继续钻。
   * begin 把 home 记为已钻;visitTab 切到某 tab 时记它。firstUndrilledSameSiteTab 找下一个该钻的。
   */
  private tabsDrilled = new Set<string>()
  /**
   * 支线钻探(Ral 2026-08-13)。点某个控件蹦出新 tab 时,旧做法是【等到 end 才发现】还有没钻的 tab
   * (firstUndrilledSameSiteTab 兜底),那时 agent 早没了"当初为什么开这个 tab"的上下文,于是切过去
   * 空转一下就把它标完成(实测:切过去→record→module_done,零次 ui_act),主线也回不去 —— 就是
   * Ral 看到的"打开后钻取就异常了无法继续"。
   *
   * 改成开即成支线:新同站 tab 一出现就压栈 + 播报 + 把钻探锚点切过去,支线那个模块标完成时
   * 【关掉这个 tab】并弹栈回主线。栈非空不准 end。tab 用完即关,不留一屏尾巴。
   */
  private branchStack: { tabId: string; url: string; parentTabId: string; openedAt: number }[] = []
  /** 支线里已经"看见过"的 tab —— 只用于开栈去重(同一个 tab 不重复开支线)。 */
  private branchSeenTabs = new Set<string>()
  /** 上次探索的功能点,按模块 URL 索引 —— 认领候选(决定 2)。 */
  private knownByModule = new Map<string, KnownFunction[]>()
  /** 本次已被认领的把手,用来发现"同一个把手被认领两次"。 */
  private claimed = new Set<string>()
  private identityLog: IdentityAssertion[] = []
  /**
   * 下一个把手的序号。**单调,不复用退休号** —— 复用会让一条旧绑定悄悄指到一个新功能上,
   * 那正是这套设计要杜绝的静默错配。
   */
  private nextHandle = 1

  constructor(private deps: ExploreSessionDeps) {}

  /**
   * `quiet` = 只进日志与聊天活动,**不进任务的输出尾巴**。逐页的 "at <url>" 属于这一类
   * (Ral 2026-08-10:「这种输出细节没必要」)—— 有界尾巴只有 200 行,被逐页噪声灌满之后
   * 真正要看的东西(警告、产物路径)就被挤出去了。明细仍完整落在 runs/<ts>.json。
   */
  /**
   * 心跳:刷新任务的 update 时间 = 解除 stalled 误判(TASK_STALL_MS = 45s)。
   *
   * 为什么需要它(Ral 2026-08-13「钻探报警了但还在继续」):看门狗只认 `task.update/log`,而钻探的
   * 逐页日志几乎都是 quiet(不进任务输出尾巴,免得 200 行的尾巴被逐页噪声灌满),真正 update 的
   * 只有 visit()。机制改成【点击导航】以后 visit() 基本不再触发 —— 于是"一直在点、一直在录"的
   * 正常钻探,在看门狗眼里就是 45 秒没动静 = STALLED。报警是假的,但它会盖掉真的挂起,所以必须修:
   * 每个真实推进步骤(落地/点击/记模块/标完成/支线开合)都心跳一次,进度也顺带写成人能读的一行。
   */
  private touchTask(stage: string): void {
    if (!this.task) return
    this.task.update({
      // 进度 = 【地点】覆盖率(已打开 / 已发现),不是模块标注数 —— 判定看什么,进度条就该显示什么。
      progress: {
        done: this.visited.size,
        total: Math.max(this.visited.size + this.openWork().length, 1),
        // token 和时间一起显示 —— 实测真正触顶的一直是 token(口径含 cache read),只显示时间会让人
        // 以为"120 分钟才用了 13 分钟,还早得很"(Ral 2026-08-13)。
        stage: `${this.visited.size}/${this.visited.size + this.openWork().length} 地点 · 还剩 ${this.openWork().length} · ${this.tokensText()} tokens · ${this.elapsedText()} · ${stage}`,
        // 结构化位:底部状态条按自己的排版拼,不从上面那句话里正则抠字段(会随文案漂)。
        tokens: this.spentTokens(),
        subject: stage
      },
      metadata: { elapsedMs: this.elapsedMs(), budgetMs: SESSION_BUDGET_MS }
    })
  }

  private log(phase: string, message: string, detail?: Record<string, unknown>, level: 'info' | 'warn' | 'error' = 'info', quiet = false): void {
    this.deps.onDebug?.({ scope: 'sitemap', phase: `v2:${phase}`, level, message, detail, ts: Date.now() })
    this.journal.push({ at: new Date().toISOString(), action: phase, detail: message })
    if (!quiet || level !== 'info') this.task?.log(message, level)
    // 三个出口各有用途:onDebug → Log 面板可追溯;task → running tasks 与 task_output;
    // onActivity → 聊天流。少任何一个,就有一处看不见探站在干什么。
    this.deps.onActivity?.(`explore: ${message}`, level !== 'error')
  }

  /**
   * 探索路径摘要 —— Ral 2026-08-10:「可以配置一个探索路径的摘要上下文,防止重复探索」。
   *
   * 按【模块】聚合而不是按页罗列:20 个页面逐条列出来,读的一方还是得自己归组才能想清楚
   * "哪个模块还没摸完";而摘要的用途就是规划下一步。有上限,超出只报数量。
   */
  private trailSummary(): string {
    if (!this.trail.length) return 'explored so far: (nothing yet)'
    const byModule = new Map<string, string[]>()
    for (const t of this.trail) {
      const key = t.module || '(no module recorded)'
      const list = byModule.get(key) || []
      if (!list.includes(t.name)) list.push(t.name)
      byModule.set(key, list)
    }
    const lines = [`explored so far — ${this.visited.size} page(s) across ${byModule.size} module(s):`]
    let shown = 0
    for (const [mod, pages] of byModule) {
      if (shown >= SUMMARY_MODULES) {
        lines.push(`  · … ${byModule.size - shown} more module(s) — full list in explore_session {"action":"state"}`)
        break
      }
      lines.push(`  · ${mod}: ${pages.slice(0, 12).join(' , ')}${pages.length > 12 ? ` … +${pages.length - 12}` : ''}`)
      shown += 1
    }
    if (this.refusedRevisits.length) {
      lines.push(
        `main REFUSED ${this.refusedRevisits.length} revisit attempt(s) — already-explored pages are blocked here, not left to your memory. ` +
          `Most recent: ${this.refusedRevisits.slice(-3).map((r) => r.url).join(' , ')}`
      )
    }
    return lines.join('\n')
  }

  /**
   * 无进展检测(决定 12)。同一个 url + 同一份快照 ⇒ 这一步没有改变任何东西。
   * 连续 NO_PROGRESS_LIMIT 次就明确告诉 agent 它在原地打转,并要求换策略或收工。
   *
   * 返回给 agent 看的警告文本(没打转就返回空串)。
   */
  private noteProgress(url: string, snapshot: string | null): string {
    // 用长度 + 头尾切片当指纹:比整串比较便宜,又足以分辨"页面变了"。
    const fp = `${url}|${snapshot ? `${snapshot.length}:${snapshot.slice(0, 120)}:${snapshot.slice(-120)}` : 'nosnap'}`
    if (fp === this.lastFingerprint) this.noProgressStreak += 1
    else {
      this.lastFingerprint = fp
      this.noProgressStreak = 0
      return ''
    }
    if (this.noProgressStreak < NO_PROGRESS_LIMIT) return ''
    this.log(
      'no-progress',
      `NO PROGRESS: ${this.noProgressStreak} consecutive steps left the page unchanged at ${url}`,
      { url, streak: this.noProgressStreak },
      'warn'
    )
    return (
      `⚠ NO PROGRESS: the last ${this.noProgressStreak} steps left this page completely unchanged (same url, same snapshot). ` +
      'Whatever you are repeating is not working. Do something different: go somewhere else with explore_visit, ' +
      'use explore_visit {"url":"back"}, or end the session with explore_session {"action":"end"} and report what blocked you. ' +
      'Do NOT repeat the same action again.'
    )
  }

  /**
   * 载入上次的功能点作为认领候选,并算出把手序号的起点。
   *
   * 序号起点取 `max(已存的最大号) + 1`,而不是"数一下有几个" —— 退休的把手仍然留在产物里
   * (决定 6),按数量算会撞号,而撞号 = 一条旧绑定悄悄指到新功能上。
   *
   * 老产物的收编(决定 8):没有 handle 的功能点,如果带着 2026-08-10 那天写下的 `fn1|…`
   * 计算键,就把那个串原样当把手;两者都没有(实测本机 94 个功能点全是这一类),它就无法被
   * 认领,只能在本次重新铸号 —— 这是可接受的一次性代价,不写迁移脚本。
   */
  /**
   * 把手序号的持久化。**光靠"扫一遍上次的 sitemap 取最大值"是不够的**:退休的功能点不会被
   * 重新记录,于是它从新产物里消失,它的号下次就会被重新发出去 —— 一条旧绑定因此悄悄指到
   * 一个毫不相干的新功能上。那正是这套设计要杜绝的静默错配,所以计数器单独落盘。
   */
  private identityFile(): string {
    return join(app.getPath('userData'), 'sites', this.siteId, 'identity.json')
  }

  private async loadHandleCounter(): Promise<number> {
    try {
      const raw = JSON.parse(await readFile(this.identityFile(), 'utf8')) as { nextHandle?: unknown }
      const n = Number(raw?.nextHandle)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1
    } catch {
      return 1
    }
  }

  private async saveHandleCounter(): Promise<void> {
    try {
      await mkdir(join(app.getPath('userData'), 'sites', this.siteId), { recursive: true })
      await writeFile(this.identityFile(), JSON.stringify({ nextHandle: this.nextHandle }, null, 2), 'utf8')
    } catch (err) {
      // 存不下计数器不该让整轮探站失败,但必须说出来 —— 下一轮可能重发号。
      this.log('identity', `could not persist the handle counter: ${(err as Error).message} — the next session may re-issue a retired handle`, undefined, 'warn')
    }
  }

  private async loadKnownFunctions(): Promise<{ candidates: number; adoptable: number; unclaimable: number }> {
    this.knownByModule = new Map()
    let maxSeq = 0
    let candidates = 0
    let adoptable = 0
    let unclaimable = 0
    const prev = await this.deps.previousSitemap(this.siteId).catch(() => null)
    if (!prev) {
      this.nextHandle = await this.loadHandleCounter()
      return { candidates, adoptable, unclaimable }
    }
    const walk = (mods: SitemapModule[]): void => {
      for (const m of mods) {
        for (const f of m.functions || []) {
          const handle = f.handle || f.functionId || ''
          if (!handle) {
            unclaimable += 1
            continue
          }
          if (!f.handle && f.functionId) adoptable += 1
          const seq = /^fnp_(\d+)$/.exec(handle)
          if (seq) maxSeq = Math.max(maxSeq, Number(seq[1]))
          const list = this.knownByModule.get(m.url) || []
          list.push({ handle, verb: f.verb, object: f.object, name: f.name, moduleUrl: m.url })
          this.knownByModule.set(m.url, list)
          candidates += 1
        }
        if (m.children?.length) walk(m.children)
      }
    }
    walk(prev.modules || [])
    // 两个下界取大:落盘的计数器(记得退休号)与产物里的最大号(计数器丢了也不至于撞号)。
    this.nextHandle = Math.max(await this.loadHandleCounter(), maxSeq + 1)
    return { candidates, adoptable, unclaimable }
  }

  private mintHandle(): string {
    return `fnp_${this.nextHandle++}`
  }

  /**
   * 渲染这个模块的认领候选。`[exact name match]` 是**机械预标**(决定 3):逐字相同才标,
   * 它只是排版,不是判断 —— agent 仍然必须显式给出 function_id 才算认领,main 绝不因为
   * 名字一样就替它绑上。定位与锚点枚举器完全相同:枚举归 main,判断归 agent。
   */
  private renderKnownFunctions(moduleUrl: string, seenNames: string[]): string {
    const known = this.knownByModule.get(moduleUrl)
    if (!known?.length) return ''
    const names = new Set(seenNames.map((n) => n.trim()))
    const lines = known.map((k) => {
      const exact = names.has(k.name.trim()) ? '  [exact name match]' : ''
      const taken = this.claimed.has(k.handle) ? '  [already claimed this session]' : ''
      return `  ${k.handle}  ${k.verb} ${k.object} — "${k.name}"${exact}${taken}`
    })
    return [
      `already known here (${known.length} function point(s) from a previous exploration):`,
      ...lines,
      'To say "this control IS one of those", record it with that function_id. To say it is NEW, omit function_id.',
      'If you claim one whose verb/object/name differs from the line above, you MUST also send renamed_from + why — otherwise it is refused.'
    ].join('\n')
  }

  private hostOf(url: string): string {
    try {
      return new URL(url).hostname.toLowerCase()
    } catch {
      return ''
    }
  }

  private normalize(raw: string, base: string): string | null {
    try {
      const u = new URL(raw, base)
      u.search = ''
      return u.href.replace(/\/$/, '')
    } catch {
      return null
    }
  }

  /**
   * 路由键:normalize 之上再把 **hash 里的 query** 也剥掉。
   *
   * 为什么需要它(2026-08-17 实测):`normalize` 剥的是 `u.search`,而**哈希路由的站点,
   * query 住在 hash 里面** —— `new URL('https://h/#/a/b?x=1').search` 是**空串**,
   * 那一行剥了个寂寞。于是 `#/order/preparingStats?branch=tab-5` 归一之后一字未变,
   * 成了一个和本体不同的键。
   *
   * **这个键只用来判「是不是同一条路由」,不当身份用。** 身份仍然是 normalize 后的完整 url ——
   * 因为 hash 里的 query 有时是真的有意义的(`#/order/contract/detail?id=14` 是一个真模块),
   * 一律剥会把不同的详情页合并成一个。两者的分工:
   *   · `normalize` → 身份(保留有意义的参数)
   *   · `routeKey`  → 「这两个 url 是不是同一条路由的两种写法」
   */
  private routeKey(raw: string, base: string): string | null {
    const norm = this.normalize(raw, base)
    if (!norm) return null
    const hash = norm.indexOf('#')
    if (hash < 0) return norm
    // 路由 = 第一个 `#` 之后、到下一个 `?` 或 `#` 为止。
    // **两个都要切**:实测 agent 造过 `?branch=` / `?tab=` / `?closeBranch=` 三种 query,
    // 也造过 `#tab-…` 这种【第二个 #】。只切 `?` 会放过最后那一种。
    return norm.slice(0, hash) + '#' + norm.slice(hash + 1).split(/[?#]/)[0]
  }

  /**
   * 去重键(结构优先覆盖):normalize 之上再把 path 里的 **ID 段归一化** —— 纯数字段 → `:id`,长 hex/uuid
   * 段 → `:hash`。所以 `/customer/detail/123` 与 `/customer/detail/456` 折叠成同一个模板,一个列表 100 行
   * 只入队一个节点。哈希路由(`#/a/b`)的路由部分也一并归一。返回 null 表示无法解析(跳过)。
   */
  /**
   * 一个路径段是【身份】还是【参数】。
   *
   * 这是取消深度封顶的前置条件:封顶一去掉,爬取的唯一终止条件就是"不再见到新模板",所以
   * 一个认不出来的参数位 = 无限新模板 = frontier 永远走不空。原来的规则只认纯数字和 16+ hex
   * —— 那是照着 test-dsh 的形状写的(它的 id 全是数字),换个站就漏:janeapp 的
   * `#schedule/staff/34/2026-08-09/2026-08-15` 里日期不归一,于是【每一周都是一个新页面】。
   *
   * 两层判据,都不带任何业务词:
   *   1. 形状可判的:纯数字 / hex / UUID / 日期 / 长随机串(字母数字混排且含数字)。
   *   2. 形状判不出的(slug,如 `/patients/john-smith`):**从数据里学** —— 同一个父路径下
   *      这个位置已经出现过 PARAM_DISTINCT_HINT 个不同取值,那它就是参数位,不是页面名。
   *      靠观测收敛,不靠预设词表,所以换站自动成立。
   */
  private static readonly PARAM_DISTINCT_HINT = 4
  private segValuesByPos = new Map<string, Set<string>>()
  private paramize(seg: string, parentPath: string): string {
    if (!seg) return seg
    if (/^\d+$/.test(seg)) return ':id'
    if (/^[0-9a-f]{16,}$/i.test(seg)) return ':hash'
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':uuid'
    if (/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(seg) || /^\d{4}\/\d{2}\/\d{2}$/.test(seg)) return ':date'
    if (seg.length >= 12 && /\d/.test(seg) && /[a-z]/i.test(seg) && !seg.includes('-') && !seg.includes('_')) return ':token'
    /**
     * **根段永远不学**(2026-08-14 修)。学习器按 `parentPath` 分桶,而顶层段的 parentPath 一律是
     * 空串 —— 于是全站所有一级路由段共用同一个桶。这个站有 order / customer / goods / config /
     * stats / finance …,`PARAM_DISTINCT_HINT = 4` 一到,**从第 5 个一级模块起全部塌成 `:var`**:
     * `#/finance/list` 的模板变成 `#/:var/list`,和早就见过的 `#/order/list` 撞上,于是整个模块
     * 在 autoSeedFrontier 里按「模板见过了」被静默丢弃 —— 连日志都没有(dropped.seen 不报数)。
     *
     * 判据本身没错,错在用错了地方:它是用来认「同一个位置上的一堆取值」的,而顶层段是**模块名**,
     * 一个站有几十个一级模块本来就正常,多 ≠ 参数。形状可判的那几条(纯数字 / hex / uuid …)在
     * 上面已经先跑过了,所以顶层真出现 `/12345` 照样归一,这里放过的只有具名段。
     */
    if (!parentPath) return seg
    // 学出来的参数位:同一父路径 + 同一层级,见过太多不同取值 → 它是参数。
    const key = `${parentPath}|${seg.length && parentPath.split('/').length}`
    let seen = this.segValuesByPos.get(key)
    if (!seen) { seen = new Set(); this.segValuesByPos.set(key, seen) }
    seen.add(seg)
    return seen.size > ExploreSessionService.PARAM_DISTINCT_HINT ? ':var' : seg
  }

  private templateOf(raw: string): string | null {
    const norm = this.normalize(raw, this.startUrl)
    if (!norm) return null
    const idify = (path: string): string =>
      path
        .split('/')
        .map((seg, i, segs) => this.paramize(seg, segs.slice(0, i).join('/')))
        .join('/')
    try {
      const u = new URL(norm)
      // 哈希路由(Vue Router hash 模式)把 query 放在 hash 里:`#/customer/list?page=2` —— 此时 u.search 是空,
      // normalize 的 u.search='' 拦不到它。所以这里把 hash 体的 `?…` 也切掉(query 是状态不是身份,翻页/筛选
      // 不算新页),再对路由段做 ID 归一(#/customer/detail/123 → #/customer/detail/:id)。
      const hashBody = u.hash ? u.hash.replace(/^#/, '').split('?')[0] : ''
      const hash = hashBody ? '#' + idify(hashBody) : ''
      return `${u.origin}${idify(u.pathname)}${hash}`.replace(/\/$/, '')
    } catch {
      return norm
    }
  }

  /** 某页的菜单深度:台账里有就用,home 用 0,其余(agent free-nav 落点)默认 1。 */
  private depthOf(url: string): number {
    const t = this.templateOf(url)
    if (t && this.depthByTemplate.has(t)) return this.depthByTemplate.get(t) as number
    const home = this.normalize(this.startUrl, this.startUrl)
    return this.normalize(url, this.startUrl) === home ? 0 : 1
  }

  /**
   * 确定性收割 frontier(drill-structure-first-coverage.md)。把当前页的同站 `a[href]` 按模板入队 ——
   * main 主导 seeding,不再依赖 agent worklist_add(那是 under-enumerate 早停的洞)。
   *   · 模板去重(seenTemplates):详情行折叠、防重复。
   *   · 无深度封顶:任意深度的同站链接都入队(2026-08-13 推翻两层限制),只有 RUNAWAY_DEPTH_GUARD 这道护栏,且触顶报数。
   *   · 仍过 same-host 与 dontVisit 规则。
   * 这不给 navExtract 加任何"什么是菜单"的判断 —— 读的是同一份 COMPLETE/UNFILTERED 锚点,只是把
   * "同站链接必须被走到"变成台账事实。返回本次新入队数。
   */
  /**
   * 从计算态快照里抠出所有 `- /url: <href>` 链接(名字取它上一行节点的引号名)。navExtract 的锚点表只含
   * 【可见】的 a[href](`visible(a)` 过滤),折叠的子菜单没有可见锚点 —— 但 a11y 快照即使折叠也带 L2 的
   * /url:(navExtract.ts 顶部实测结论)。所以 auto-seed 必须【锚点 + 快照】两路都收,否则像 #/statistic/* 这种
   * 折叠子菜单会整段漏掉(2026-08-12 实测:结构优先第一轮就漏了统计模块 5 个接口)。
   */
  private snapshotLinks(snapshot: string | null): { name: string; href: string }[] {
    if (!snapshot) return []
    const lines = snapshot.split('\n')
    const out: { name: string; href: string }[] = []
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*- \/url:\s*(\S.*)$/)
      if (!m) continue
      const href = m[1].trim()
      const nameLine = (lines[i - 1] || '').match(/"([^"]*)"/)
      out.push({ name: nameLine ? nameLine[1] : href, href })
    }
    return out
  }

  private autoSeedFrontier(pageUrl: string, anchors: { name: string; href: string }[]): number {
    const here = this.depthOf(pageUrl)
    const pageTmpl = this.templateOf(pageUrl)
    if (pageTmpl) {
      this.depthByTemplate.set(pageTmpl, Math.min(this.depthByTemplate.get(pageTmpl) ?? here, here))
      this.seenTemplates.add(pageTmpl)
    }
    const childDepth = here + 1
    let added = 0
    // 丢弃分类计数 —— 丢可以,静默不行(本仓一贯口径:折行报数、truncated 报、totals.capped 报)。
    // 原来的深度封顶是唯一一处不报的,整棵子树消失得毫无痕迹,换个站就是这样悄悄漏掉一半。
    const dropped = { depth: 0, seen: 0, offsite: 0, forbidden: 0, offFocus: 0, branch: 0 }
    const addedUrls: string[] = [] // 记入队的具体 url,打进日志(Ral:auto-seed 要看到"+1 = 哪个 url")
    /**
     * **支线打开期间不往主 worklist 加东西**(Ral 2026-08-14)。
     *
     * 支线 = 点击开出来的那个 tab,它的作业面是**这一页本身**:页面上的控件、表单、展开区。
     * 那些走 `ui_act`,和 frontier 无关,所以这道闸**不影响支线该干的活**。
     * 挡住的是它的**导航链接** —— 详情页的侧栏和主线是同一套菜单,收进来等于让支线变成
     * 第二个进入整站的入口,而且那些新入队的地点还会把这一轮一直往后拖。
     * 同样的入口主线迟早会自己走到;真需要单独钻的,记成主线的一个地点(worklist_add)。
     */
    const inBranch = this.branchStack.length > 0
    // 限定了范围时,这一页在范围内 → 它的子链接**继承**在范围内(子树整棵都算)。
    const parentInFocus = this.inFocus(pageUrl, '')
    /** 没见过的 url 却被模板折叠掉了 —— 正常(表格行)也可能异常(归一过头),必须留证。 */
    const collapsed: string[] = []
    for (const a of anchors) {
      const url = this.normalize(a.href, pageUrl)
      if (!url) continue
      if (this.hostOf(url) !== this.host) { dropped.offsite++; continue } // 离站锚点由离站闸处理,不入队
      if (childDepth > RUNAWAY_DEPTH_GUARD) { dropped.depth++; continue }
      if (inBranch) { dropped.branch++; continue }
      if (this.focus.length && !parentInFocus && !this.inFocus(url, a.name)) { dropped.offFocus++; continue }
      const tmpl = this.templateOf(url)
      if (!tmpl || this.seenTemplates.has(tmpl)) {
        dropped.seen++
        // 这个 url **本身**没见过,是被【模板】折叠掉的 —— 表格里的第 2..N 行本该这样折叠,
        // 但归一错了也长这样(顶层段被误判成 :var,整个模块撞进别人的模板)。所以留证:
        // 折叠成了哪个模板。静默折叠正是那个 bug 藏了这么久的原因。
        if (tmpl && !this.visited.has(url) && !this.worklist.some((w) => w.url === url)) collapsed.push(`${url} → ${tmpl}`)
        continue
      }
      if (this.rules && isVisitForbidden(this.rules, url)) { dropped.forbidden++; continue }
      this.seenTemplates.add(tmpl)
      this.depthByTemplate.set(tmpl, childDepth)
      // parent = 这批链接是从哪一页采到的。moduleDone 的来源闸靠它判断"这个模块自己的子链接走完没有"
      // —— 用来源而不是 URL 前缀,因为子页未必共享前缀(janeapp 的 Settings 子页一半 /admin/settings/*、
      // 一半 /admin/company/*,前缀判不了,但都是从 Settings 页采到的)。
      this.worklist.push({ url, name: a.name || url, parent: pageUrl, depth: childDepth })
      addedUrls.push(url)
      added++
    }
    if (added) this.log('auto-seed', `frontier += ${added} (depth ${childDepth}, from ${pageUrl}) → ${addedUrls.slice(0, 8).join(' | ')}${addedUrls.length > 8 ? ` | …${addedUrls.length - 8} more` : ''}`, { added, childDepth, urls: addedUrls }, 'info')
    if (dropped.depth) this.log('auto-seed-capped', `${dropped.depth} link(s) from ${pageUrl} exceeded the runaway depth guard (${RUNAWAY_DEPTH_GUARD}) — reported, not silent`, { ...dropped, pageUrl }, 'warn')
    if (dropped.branch) {
      this.log('auto-seed-branch-scoped', `${dropped.branch} link(s) from ${pageUrl} not queued — this is a BRANCH tab, its job is this page only (its menu is the main line's menu; the main line will reach those on its own)`, { branch: dropped.branch, pageUrl, branchDepth: this.branchStack.length }, 'info')
    }
    if (collapsed.length) {
      this.log(
        'auto-seed-template-collapsed',
        `${collapsed.length} never-seen link(s) from ${pageUrl} folded into an already-seen TEMPLATE — expected for extra rows of one table, a bug if two different modules share a template: ${collapsed.slice(0, 6).join(' | ')}${collapsed.length > 6 ? ` | …${collapsed.length - 6} more` : ''}`,
        { collapsed: collapsed.length, samples: collapsed.slice(0, 12), pageUrl },
        'info'
      )
    }
    if (dropped.offFocus) {
      this.offFocusDropped += dropped.offFocus
      this.log('auto-seed-offfocus', `${dropped.offFocus} link(s) from ${pageUrl} are outside this run's focus (${this.focus.join(' | ')}) — skipped, reported not silent`, { ...dropped, pageUrl, focus: this.focus }, 'info', true)
    }
    return added
  }

  /**
   * 这个地点在本轮范围内吗。没限定范围 → 一律 true(限定是可选的,默认整站)。
   * 匹配放在 url 和名字**两边**:侧栏项常常只有名字("Settings"),而 url 是 /admin/s/9f2 这种。
   */
  private inFocus(url: string, name: string): boolean {
    if (!this.focus.length) return true
    const hay = `${url} ${name}`.toLowerCase()
    return this.focus.some((term) => hay.includes(term))
  }

  /**
   * 列表页判据(per-page interaction,Ral 2026-08-12,已软化)。有表格/网格或行内可点控件 = 列表页 → 加进
   * listNeedsClick,作【软提示】:agent 若能顺手打开一条记录读详情就多录几个接口(bonus),打不开就走,不影响
   * "探完"。真 ui_act(noteUiAct)后清。不挡 end、不驱动续跑(硬闸反噬教训)。
   */
  private markListIfNeeded(url: string, evidence: PageEvidence | null): void {
    if (!evidence) return
    // 列表判据 = 结构(纯 DOM 事实,域无关):有表格/网格,或 ≥2 数据行,或有行内可点控件。取并集、宁多勿少 ——
    // 上一轮只靠"带文字的行按钮"漏检严重(图标按钮无 name 被丢),这里改认表格结构为主。
    const d = evidence.diag
    const looksLikeList = d.grids > 0 || d.tableRows >= 2 || (evidence.controls || []).some((c) => c.inRow && !c.forbidden)
    if (looksLikeList) this.listNeedsClick.add(url)
  }

  isOpen(): boolean {
    return this.open
  }

  /**
   * 登录暂停(drill-login-detection-and-pause.md,Ral 2026-08-12)。检测到登录墙 → 暂停钻探 + 请人登录。
   * 触发来源:①agent LLM 语义判断(explore_session {"action":"need_login"},主);②起点是登录页(begin 兜底);
   * password 框只是给 agent 的便宜提示信号。**人工登录后点"继续"是可靠主路径**;自动检测登录成功(password
   * 框消失)是 best-effort 顺带 —— 检测漏了也没关系,人可主动点继续。返回时页面已登录/人已确认。
   */
  async pauseForLogin(reason: string): Promise<void> {
    if (!this.task) return
    const url = this.drillWc()?.getURL() || this.startUrl
    this.log('login-needed', `pausing for login — ${reason}`, { url }, 'warn', true)
    this.deps.onBrowserUsePaused?.()
    await this.task.requestConfirm({
      title: 'Sign in to continue the drill',
      detail: `This page looks like it needs a sign-in (${reason}). Sign in on the page, then hit "I'm signed in, continue" — I also resume on my own once I detect the sign-in succeeded.`,
      confirmLabel: "I'm signed in, continue",
      cancelLabel: 'Skip (continue without signing in)',
      // best-effort 自动续跑:password 框消失 = 大概率登录了。漏检没关系,人点"继续"照样走。
      autoConfirmWhen: async () => { const e = await this.readPage(); return !!e && e.diag.passwordFields === 0 }
    })
    this.log('login-resumed', 'resuming after login pause', { url: this.drillWc()?.getURL() || url }, 'info', true)
  }

  /**
   * 强制续跑判据(controller 在 turn 结束时用)。模型探十几页就主动吐总结收尾,但 end_turn 后没人再唤起
   * 它 → 覆盖卡死。turn 结束若这里 `shouldContinue` 为真,controller 用合成 turn 再唤起,直到 worklist 空/
   * 预算到/无进展。worklist/visited 都是【服务端状态】,跨上下文压缩仍在,所以续跑能从 state 接着走。
   */
  continueState(): { open: boolean; discovered: number; drilled: number; aliasRefused: number; worklistLeft: number; visited: number; listNeedsClick: number; openBranches: number; overBudget: boolean; remainingText: string; shouldContinue: boolean } {
    const open = this.open
    const { discovered, drilled } = this.moduleLedger()
    const overBudget = this.overBudget()
    // 完成判定 = 【地点走空】∪【支线未收】。**模块不再参与判定**(Ral 2026-08-13)。
    //
    // 为什么把模块摘出去:"模块"被要求同时干两件事 —— 覆盖判定(要唯一确定的分母)和语义标注
    // (要读着顺的层级),而这两者对粒度的要求正好相反。塞进一个名词的结果是【分母跟着 agent 的
    // 措辞走】:同一份代码,test-dsh 上它挑叶子页 → 30 个模块;janeapp 上它挑顶部页签 → 7 个模块,
    // Settings 侧栏真实的 42 个子模块塌成 1 个,然后 7/7 全绿收工。不是 agent 偷懒,是我们给了它
    // 这个杠杆。而"模块到底怎么定义"本身没有标准答案(Ral:「这个说法太模糊了,最好也不要用」)。
    //
    // 所以判定只认两个【机械】台账,都不需要任何语义:
    //   ① 地点(worklist/frontier):站点自己暴露的可导航目标,autoSeedFrontier 从页面链接自动收割,
    //      模板去重。agent 加得进、减不掉(只能逐个 uncovered 标掉并给理由)。递归天然成立 ——
    //      一个页面链向别的页面,深度是站点的事实。
    //   ② 支线未收(新 tab 开了还没钻完)。
    // 模块降级为纯标签:标错了只影响 sitemap 好不好读,不影响探到多少。
    const openBranches = this.branchStack.length
    // 被人叫停 → 无论还剩多少地点都不再续跑。这一条排在最前面是有意的:续跑循环是【宿主】驱动的,
    // 它不看 LLM 那一发是不是被 abort 了,只看这里。少了这个条件,停止之后循环立刻合成下一轮,
    // 页面接着被点 —— 这正是「停了但没停」的机制。
    const shouldContinue = open && !this.aborted && !overBudget && (this.openWork().length > 0 || openBranches > 0)
    return { open, discovered, drilled, aliasRefused: this.aliasRefused, worklistLeft: this.openWork().length, visited: this.visited.size, listNeedsClick: this.listNeedsClick.size, openBranches, overBudget, remainingText: this.remainingText(), shouldContinue }
  }

  /** 还没打开过记录的列表页(仅软提示:有数据+可读详情就顺手开,是 bonus 不是要求)。 */
  listPagesNeedingClick(): string[] { return [...this.listNeedsClick] }

  /** 模块台账:已发现/已钻 + 还没钻的模块名(控制器续跑话术、进度显示用)。 */
  moduleLedger(): { discovered: number; drilled: number; undrilled: string[] } {
    const undrilled = [...this.moduleByUrl.values()].filter((m) => !this.drilledModuleUrls.has(m.url)).map((m) => m.name)
    return { discovered: this.moduleByUrl.size, drilled: [...this.drilledModuleUrls].filter((u) => this.moduleByUrl.has(u)).length, undrilled }
  }

  /**
   * 下一个该钻的【同站】tab(drill-extra-tabs-not-queued-and-drilled.md)。当前 tab frontier 走空后,控制器
   * 用它系统化切到下一个未钻的同站 tab 继续钻。返回 null = 所有同站 tab 都钻过了。外站 tab 不碰(离站闸)。
   */
  async firstUndrilledSameSiteTab(): Promise<{ id: string; url: string } | null> {
    if (!this.open) return null
    const tabs = await this.deps.listTabs().catch(() => [])
    for (const t of tabs) {
      if (!this.ownsActiveTab(t.id) || this.tabsDrilled.has(t.id)) continue
      if (!t.url || this.hostOf(t.url) !== this.host) continue // 只钻同站
      return { id: t.id, url: t.url }
    }
    return null
  }

  /**
   * end-闸(drill-structure-first-coverage.md)。worklist 非空且预算没到时,agent 主动调 `end` 返回这段而
   * 【不收尾】—— 把"探完"从 agent 自觉变成机械判定:frontier 空(或预算到)才准 end。逃生口写清楚:走完,
   * 或逐个标 uncovered。控制器据 `continueState()` 决定是否放行 finalize;回合结束兜底 finalize 不受此闸影响。
   */
  endRefusal(): string {
    const { discovered, drilled } = this.moduleLedger()
    const parts: string[] = []
    if (this.branchStack.length) {
      const b = this.branchStack[this.branchStack.length - 1]
      parts.push(
        `REFUSED: cannot end — a BRANCH drill is still open: tab ${b.tabId} → ${b.url}.`,
        'Finish it: record it as a module if you have not, drill it (observe → click/fill → observe), then explore_record {"moduleDone":{"url"}} for it. Main closes that tab and returns you to the main line automatically.',
        '',
        this.navState()
      )
      return parts.join('\n')
    }
    // 只按【地点台账】拒 —— 模块标没标完不再是判定条件(它是标签)。
    parts.push(
      `REFUSED: cannot end — ${this.openWork().length} place(s) the host harvested from this site's own links have never been opened. You have ${this.remainingText()} of budget left, and finishing matters more than finishing fast.`,
      'Go to each of them the normal way: click through from the UI. Every place you open may expose further places — that is expected, the tree is as deep as this site actually is.',
      'If one genuinely cannot be opened or must not be, settle it with explore_record {"uncovered":{"url","reason"}} — that clears it from the ledger. Nothing else does.',
      `not yet opened (${this.openWork().length}): ${this.openWork().slice(0, 20).map((w) => `"${w.name}"`).join(' | ')}${this.openWork().length > 20 ? ` | …${this.openWork().length - 20} more` : ''}`,
      discovered > 0 ? `(labelling, not a gate: ${drilled}/${discovered} module(s) marked done — labels do not decide when you are finished, coverage does.)` : ''
    )
    parts.push('', this.navState())
    return parts.join('\n')
  }

  private elapsedMs(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0
  }

  /** 本次探站已花的 token(回合累计 − 开钻时的基线)。没接 `turnUsage` 就恒为 0。 */
  private spentTokens(): number {
    if (!this.startedAt) return 0
    return Math.max(0, (this.deps.turnUsage?.().totalTokens || 0) - this.startTokens)
  }

  private spentCostUsd(): number {
    if (!this.startedAt) return 0
    return Math.max(0, (this.deps.turnUsage?.().costUsd || 0) - this.startCostUsd)
  }

  /**
   * 时间【或】token 任一触顶(Ral 2026-08-13)。两条走同一条收敛路径:软触顶 —— `visit`/`record`
   * 拒绝并要求 `end`,产物照样落盘、sitemap 取并集、下次可续。
   */
  /**
   * 原始触顶(时间或 token 越过当前这一档上限)。**它不再直接停钻探** —— 见 checkBudgetSoftLimit。
   *
   * 上限按"档"走:每次用户点继续就抬一档(extensions+1),于是下一档到了会再问一次,
   * 而不是问一次就无限放行。
   */
  private budgetExtensions = 0
  private budgetAsking = false
  /** 用户点了"停" —— 这才是唯一会让钻探收工的预算状态。 */
  private wrapUpRequested = false
  private rawOverBudget(): boolean {
    if (!this.open) return false
    const tier = this.budgetExtensions + 1
    return this.elapsedMs() > SESSION_BUDGET_MS * tier || this.spentTokens() > SESSION_BUDGET_TOKENS * tier
  }

  /**
   * 预算是【软限制】(Ral 2026-08-13:「token/时间不再是硬拦截,而是 agent 发个消息需要用户 confirm,
   * 否则就暂停了」)。触顶时弹确认卡:点继续 → 抬一档接着钻;点停 → 收工。
   *
   * 为什么必须这么改:原来 `overBudget` 被 AND 进了 `shouldContinue`,于是资源耗尽会【静默地】
   * 把"没探完"改写成"可以 end" —— 实测 24/58 就显示 completed 并直接进摄取,而墙钟才用掉 12m53s
   * (真正触顶的是 10M token,口径含 cache read,ReAct 每轮重发上下文,十几分钟就烧光)。
   * 见 docs/issues/drill-token-budget-silently-marks-complete.md。
   */
  async checkBudgetSoftLimit(): Promise<void> {
    if (!this.open || this.wrapUpRequested || this.budgetAsking) return
    if (!this.rawOverBudget()) return
    if (!this.task) { this.wrapUpRequested = true; return } // 没有任务卡就问不了人,只能收工
    this.budgetAsking = true
    const why = this.elapsedMs() > SESSION_BUDGET_MS * (this.budgetExtensions + 1) ? '时间' : 'token'
    const spent = `已录 ${this.elapsedText()} · 已用 ${this.tokensText()}`
    // 触顶必须留痕 —— 否则事后分不清"探完了"和"跑不动了"(这正是那个 issue 的次因)。
    this.log('budget-soft-limit', `budget tier ${this.budgetExtensions + 1} reached (${why}) — asking the operator whether to continue. ${spent}`, { tier: this.budgetExtensions + 1, why, elapsedMs: this.elapsedMs(), tokens: this.spentTokens() }, 'warn')
    const go = await this.task.requestConfirm({
      title: `钻探${why}预算到顶 —— 要继续吗?`,
      detail: `${spent}。站点还剩 ${this.openWork().length} 个地方没打开。继续会再给一档同样大小的预算;选择停止则收尾并生成 sitemap(本轮记为部分覆盖 —— sitemap 与 apidoc 会保留累积,但**下一轮是从头钻**,不接着这一轮的进度)。`,
      confirmLabel: '继续钻探',
      cancelLabel: '到此为止'
    })
    this.budgetAsking = false
    if (go) {
      this.budgetExtensions += 1
      this.log('budget-extended', `operator granted another budget tier (now ${this.budgetExtensions + 1}×) — continuing`, { tier: this.budgetExtensions + 1 }, 'info')
    } else {
      this.wrapUpRequested = true
      this.log('budget-wrap-up', 'operator chose to stop — the run will be reported as PARTIAL coverage', { worklistLeft: this.worklist.length }, 'warn')
    }
  }

  /** 只有【用户主动叫停】才算预算用尽 —— 触顶本身不再是硬拦截。 */
  private overBudget(): boolean {
    return this.wrapUpRequested
  }

  /** 这一轮是不是部分覆盖(还有地点没开就收工了)—— 报告/任务卡据此不许说"完成"。 */
  isPartialRun(): boolean {
    return this.openWork().length > 0 || this.branchStack.length > 0
  }

  private fmt(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000))
    const m = Math.floor(total / 60)
    return m ? `${m}m${String(total % 60).padStart(2, '0')}s` : `${total}s`
  }

  private elapsedText(): string {
    return this.fmt(this.elapsedMs())
  }

  private remainingText(): string {
    return this.fmt(SESSION_BUDGET_MS - this.elapsedMs())
  }

  /** `3.4M ($1.28)` —— 金额来自 pi SDK 的 Usage.cost,只显示不参与判定。 */
  private tokensText(): string {
    const tokens = this.spentTokens()
    const shown = tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(2)}M` : `${Math.round(tokens / 1000)}k`
    const cost = this.spentCostUsd()
    return cost > 0 ? `${shown} ($${cost.toFixed(2)})` : shown
  }

  /**
   * The navigation log Ral asked for:「当前的 domain、目标 domain,以及录制的 url」.
   * Without this the agent cannot NOTICE that it is lost — the standalone page where the
   * first-level menu simply is not rendered any more.
   */
  navState(tabs?: { id: string; url: string }[]): string {
    const wc = this.drillWc()
    const current = wc && !wc.isDestroyed() ? wc.getURL() : ''
    const currentHost = this.hostOf(current)
    const offSite = !!currentHost && !!this.host && currentHost !== this.host
    // 多 tab(drill-multi-tab):被新 tab 抢了焦点时,恢复动作是【切回 home tab】,不是 history back
    // (新 tab 没有回退历史,这正是原来卡死的病根)。
    const activeTab = this.deps.activeTabId() || ''
    const onHomeTab = !this.homeTabId || activeTab === this.homeTabId
    const lines = [
      `session: ${this.open ? 'open' : 'not started'}`,
      `drill_tabs: ${JSON.stringify(this.tabState())}`,
      `target host: ${this.host || '(none)'}`,
      `current host: ${currentHost || '(unknown)'}${offSite ? '  ← OFF TARGET SITE' : ''}`,
      `current url: ${current || '(none)'}`,
      `start url: ${this.startUrl || '(none)'}`,
      `recording dir: ${this.deps.captureSessionDir() || '(not recording)'}`,
      // 两条预算都要报给模型 —— 只报时间的话,token 触顶时它看到「还剩 80 分钟」却被 visit 拒绝,
      // 会以为是 bug 然后反复重试。
      `elapsed: ${this.elapsedText()} / budget 120min${this.overBudget() ? '  ← BUDGET EXHAUSTED' : ` (${this.remainingText()} left)`}`,
      `tokens: ${this.tokensText()} / budget 10M${this.spentTokens() > SESSION_BUDGET_TOKENS ? '  ← TOKEN BUDGET EXHAUSTED' : ''}`,
      `MODULES: ${this.drilledModuleUrls.size} drilled / ${this.moduleByUrl.size} discovered (discover new ones as you go, mark each done when its pages+queries are covered). DONE = all modules done AND no branch open AND the harvested-link queue below is empty.`,
      `visited: ${this.visited.size} pages · frontier hints (unvisited links): ${this.openWork().length}${this.worklist.some((w) => w.parked) ? ` (+${this.worklist.filter((w) => w.parked).length} parked)` : ''} · off-site exits: ${this.offsite.length}`,
      `listing pages where opening a record COULD add endpoints (optional bonus — do it only if the list has data + a readable detail; if not, just move on): ${this.listNeedsClick.size}`,
      `observed writes: ${this.writes.length}${this.writes.length ? ' (see explore_session state detail)' : ''}`,
      `extractor/agent disagreements: ${this.disagreements.length}`
    ]
    // Tab 全景(drill-multi-tab 决定 3)。列出所有 tab,标出 active / home / 同站可探 / 外站别探。
    // 一个页面在新 tab 打开时(target=_blank / window.open),它会抢焦点成为 active —— agent 据此
    // 用 explore_visit {"tab":"…"} 探同站的、切回 home、别碰外站的。状态跨 tab 累积(按 URL 存)。
    if (tabs && tabs.length > 1) {
      lines.push('open tabs (explore_visit {"tab":"<id>"} to switch — your exploration state spans all same-site tabs):')
      for (const t of tabs.filter((tab) => this.ownsActiveTab(tab.id))) {
        const h = this.hostOf(t.url)
        const same = !!h && h === this.host
        const marks = [
          t.id === activeTab ? '[active]' : '',
          t.id === this.homeTabId ? '[home]' : '',
          h ? (same ? '[same-site — explore it]' : '[OFF-SITE — do not explore]') : ''
        ].filter(Boolean).join(' ')
        lines.push(`  · ${t.id}  ${h || t.url}  ${marks}`)
      }
    }
    if (this.overBudget()) {
      lines.push(
        'THE 120-MINUTE BUDGET IS USED UP. Stop exploring and call explore_session {"action":"end"} now — the sitemap will be written and MERGED, so a later session continues from here instead of starting over.'
      )
    }
    if (offSite) {
      // 抢焦点的新 tab:切回 home;否则(在自己 tab 里被 302/SSO 甩走):back 或 start url。
      lines.push(
        !onHomeTab && this.homeTabId
          ? `YOU ARE OFF THE TARGET SITE — a new tab (${activeTab}) stole focus. Recover with explore_visit {"tab":"home"} (NOT "back" — a new tab has no history to go back to). Record its url in off-site exits if it is a real off-site link. Do not read or record anything from here.`
          : 'YOU ARE OFF THE TARGET SITE. Recover before doing anything else: explore_visit {"url":"back"} or explore_visit with the start url. Do not read or record anything from here.'
      )
    }
    if (this.rules) lines.push(this.rules ? renderSiteRules(this.rules) : '')
    return lines.filter(Boolean).join('\n')
  }

  /**
   * 这一发 begin 会命中「同站已经在钻」吗。**和 begin 内部用的是同一个判据**(故意抽出来共用):
   * 控制器要在建任务卡之前就知道 —— 重入的 begin 不该在 Workbench 上多出第二张 explore_session 卡,
   * 而那正是 08-14 双开时看到的现象之一。两处各写一份条件迟早会漂,所以只留这一份。
   */
  reentersRun(startUrl?: string): boolean {
    const url = (startUrl || this.deps.currentUrl() || '').trim()
    return Boolean(this.open && this.host && url && this.hostOf(url) === this.host)
  }

  async begin(params: { startUrl?: string; tabId?: string; task?: TaskHandle | null; focus?: string[] }): Promise<string> {
    const wc = params.tabId ? this.deps.webContentsForTab(params.tabId) : this.drillWc()
    if (!wc || wc.isDestroyed()) return 'ERROR: no page is open — open the site first.'
    const startUrl = (params.startUrl || wc.getURL() || '').trim()
    if (!startUrl) return 'ERROR: no start url.'
    /**
     * **同一个站已经在钻 → 不重开,把现状还给它。**
     *
     * 2026-08-14 实测:日志里两条 `begin` 相隔 4 秒,第一条报 13 个地点、第二条报 2 个 —— 第二发
     * 把整份状态清零后重新播种,于是这一轮的台账、漏斗、模板观测集全部对不上,而外面看不出发生过。
     * 模型重发同一个工具调用是常态(超时重试、续跑合成 turn、自己觉得"再确认一下"),所以这道闸必须
     * 在宿主侧。
     *
     * 做成**幂等**而不是**拒绝**:拒绝会造出死锁 —— 一轮被中途 abort 时 `open` 停在 true,
     * 之后每一次 begin 都被拒,而 `end` 又被覆盖闸挡着,这个站就再也钻不了了。返回现状则怎么都不会卡:
     * 真是重复调用 → 它看到自己已经在钻;真想换站 → host 不同,照常重开。
     */
    if (!this.tabPauseError && this.reentersRun(startUrl)) {
      this.log('begin-reentered', `begin called again for ${this.host} while a run is already open (${this.elapsedText()} in, ${this.visited.size} place(s) opened) — returning current state instead of restarting`, { host: this.host, visited: this.visited.size, worklist: this.worklist.length }, 'warn', true)
      return [
        `ALREADY DRILLING ${this.host} — this run started ${this.elapsedText()} ago and is still open. NOTHING WAS RESET.`,
        'Calling begin again does not start over; you are in the middle of a run. Carry on from the state below.',
        '',
        this.stateText()
      ].join('\n')
    }
    this.open = true
    this.startUrl = startUrl
    this.host = this.hostOf(startUrl)
    this.siteId = this.host
    this.homeTabId = params.tabId || this.deps.activeTabId() || ''
    this.tabMembers.clear()
    this.tabPauseError = ''
    this.tabScopeActive = true
    this.tabMembers.set(this.homeTabId, { id: this.homeTabId, role: 'main', url: startUrl, status: 'active', wc })
    this.branchStack = []
    this.branchSeenTabs.clear()
    this.currentDrillTabId = this.homeTabId
    await this.deps.onTabScopeChanged?.(this.activeTabIds())
    await this.onAnchorTabChanged(this.currentDrillTabId)
    this.tabsDrilled = new Set(this.homeTabId ? [this.homeTabId] : []) // home tab 从现在起就在钻
    this.task = params.task || null
    this.startedAt = Date.now()
    const openingUsage = this.deps.turnUsage?.()
    this.startTokens = openingUsage?.totalTokens || 0
    this.startCostUsd = openingUsage?.costUsd || 0
    this.worklist = []
    this.visited = new Set()
    this.seenTemplates = new Set()
    this.depthByTemplate = new Map()
    this.counts = { visits: 0, records: 0, uiActs: 0 }
    this.currentPageUrl = ''
    this.listNeedsClick = new Set()
    this.modules = []
    this.moduleByUrl = new Map()
    this.drilledModuleUrls = new Set()
    this.snapshotByModule = new Map()
    // ⚠ 这四样过去**一次都没在 begin 清过** —— 服务是单例,同一个进程里钻第二轮会继承第一轮的状态:
    //   · controlsByModule —— 上一轮的 exercised 直接算进这一轮,漏斗从第二轮起系统性偏乐观,
    //     而分母里还挂着这一轮根本没去过的页面的控件。要量这个漏斗,它必须先归零。
    //   · refNames —— 上一轮的 ref→name;ref 号会重排,拿旧表还原「点了谁」是记到别人头上。
    //   · dirtySinceLanding —— 上一轮结束时若为真,这一轮第一次落地就被告知「你已经输入过了,
    //     别碰任何可能提交的控件」。开局就自我设限,而这恰恰是「按钮不点」的一种成因。
    //   · segValuesByPos —— 模板学习器的观测集。不清 = 上一轮学到的参数位带进这一轮,
    //     刚开钻就有路径被判成 :var 而整片去重掉。
    this.blockedDownloads = []
    this.blockedUploads = []
    this.controlsByModule = new Map()
    this.refNames = new Map()
    this.dirtySinceLanding = false
    this.segValuesByPos = new Map()
    // 游标从【录制开始】起算,不是从 begin 起算:两者之间的流量(以及 begin 之前页面已经在跑的
    // XHR)否则不属于任何窗口。取不到就退回现在 —— 至少不会把窗口起点弄到未来。
    const recordedFrom = await this.deps.recordingStartedAt?.().catch(() => undefined)
    this.ingestCursor = recordedFrom && recordedFrom > 0 && recordedFrom <= Date.now() ? recordedFrom : Date.now()
    this.ingestedWindows = 0
    this.ingestLog = []
    this.ingestTally = { documented: 0, created: 0, lost: 0, keys: [] }
    this.snapshotLog = []
    this.pendingWindows = []
    this.placesSinceIngest = 0
    this.uncovered = []
    this.offsite = []
    this.writes = []
    this.disagreements = []
    this.journal = []
    this.refusedRevisits = []
    this.trail = []
    this.lastFingerprint = ''
    this.noProgressStreak = 0
    this.knownByModule = new Map()
    this.claimed = new Set()
    this.identityLog = []
    this.nextHandle = 1
    this.rules = await loadSiteRules(this.siteId)
    const known = await this.loadKnownFunctions()
    /**
     * **每一轮都是全新的一轮**(Ral 2026-08-17:「开始钻探就是重新钻探,不要再延续之前的钻探
     * 记录了」)。这里原本会把上一轮 `worklistLeft` 里的地点灌进 frontier(2026-08-14 加的
     * 「接上一轮」),现在整段撤掉。
     *
     * 为什么撤:续传要正确,得同时处理站点改版、录制被回收、摄取只摄了一半、代际、
     * 意图解析…… 场景多到设计文档写了八个决策单元还在长,而它**换来的收益是有限的** ——
     * 它绕开的那个问题(一轮跑不完整个站)并没有因此被解决,只是被摊到了多轮里。
     *
     * **撤掉之后问题才回到正位**:一轮就该跑完;跑不完是覆盖机制的毛病,不是"下轮再补"的理由。
     * 实测四轮 visited 从 30 掉到 7 —— 那是要修的东西,不是要绕的东西。
     *
     * ⚠ 别把这条读成「产物也不合并了」:sitemap 与 apidoc **仍然增量合并**(mergeWithPrevious /
     * ON CONFLICT DO UPDATE)。撤掉的是【进度】的延续,不是【产物】的积累 —— 两者完全不同,
     * 混起来会把一整个站的接口文档冲掉。
     */
    this.offFocusDropped = 0
    this.focus = (params.focus || []).map((t) => String(t || '').trim().toLowerCase()).filter(Boolean)
    this.log('begin', `exploration session opened for ${this.host} — FRESH run (previous runs' progress is not carried over)`, { startUrl, rules: { dontClick: this.rules.dontClick.length, dontVisit: this.rules.dontVisit.length }, known })
    if (known.candidates) {
      this.log('identity', `${known.candidates} function point(s) from a previous exploration can be claimed; next handle fnp_${this.nextHandle}`, known, 'info', true)
    }
    if (known.unclaimable) {
      // 说出来而不是当作没有:这些功能点这次只能重新铸号,它们的旧绑定(如果有)会变孤儿。
      this.log(
        'identity',
        `${known.unclaimable} previously-recorded function point(s) carry NO handle (produced before identity was tracked) — they cannot be claimed and will be re-minted this run`,
        { unclaimable: known.unclaimable },
        'warn'
      )
    }
    let evidence = await this.readPage()
    // 登录兜底(drill-login-detection-and-pause.md):起点就是登录墙(有 password 框)→ 暂停请人登录,登录后重读。
    // 主判断仍交给 agent 的 need_login(LLM 语义);这里只兜"一进来就是登录页"这种明显情况。
    if (evidence && evidence.diag.passwordFields > 0) {
      await this.pauseForLogin('起点页面有密码输入框,像登录墙')
      evidence = await this.readPage()
    }
    const homeUrl = this.normalize(this.drillWc()?.getURL() || startUrl, startUrl) || startUrl
    this.visited.add(homeUrl)
    // 结构优先:home = 深度 0,从它的同站链接收割 L1 进 frontier(main 主导,不等 agent worklist_add)。
    // 锚点 + 快照 /url: 两路都收 —— 折叠子菜单没有可见锚点,只有快照里有(见 snapshotLinks)。
    const homeTmpl = this.templateOf(homeUrl)
    if (homeTmpl) this.depthByTemplate.set(homeTmpl, 0)
    if (evidence) this.autoSeedFrontier(homeUrl, [...evidence.anchors, ...this.snapshotLinks(evidence.snapshot)])
    const tabs = await this.deps.listTabs().catch(() => [])
    // 限定范围必须【说出来】(Ral 2026-08-14:「钻探时应该能感知到这个上下文么,能感知到就行」)。
    // 不说的话 agent 只会看到 frontier 里少了很多东西,以为站点就这么大,然后照常宣布探完。
    const focusNote = this.focus.length
      ? [
          '',
          `## FOCUSED RUN — only these parts of the site are in scope: ${this.focus.map((t) => `"${t}"`).join(' | ')}`,
          'Anything that neither matches one of those nor was reached BY CLICKING THROUGH one of them is out of scope',
          'and is not queued — so "no places left" this run means "this focus is covered", NOT "the site is covered".',
          'Do not wander outside the focus to look for more; do drill the full depth INSIDE it (a focused part still nests).',
          this.offFocusDropped ? `  (${this.offFocusDropped} place(s) skipped so far as out of scope — they stay unexplored and a later full run will pick them up.)` : ''
        ]
          .filter(Boolean)
          .join('\n')
      : ''
    return [this.navState(tabs), '', this.renderEvidence(evidence), focusNote, '', BEGIN_GUIDANCE].join('\n')
  }

  /** Navigate — bounded, host-checked, rule-checked. `back` uses history so a wrong turn is cheap. */
  async visit(params: { url?: string; from?: string; tab?: string }): Promise<string> {
    if (!this.open) return 'ERROR: no exploration session. Call explore_session {"action":"begin"} first.'
    if (this.aborted) return STOPPED_BY_OPERATOR

    // 多 tab(drill-multi-tab 决定 2):切换到某个 tab(或 home),激活它 → capture + 快照都跟过去,
    // 读它、把同站页面记进同一份 sitemap。tab 切换有自己的激活逻辑,先于下面的 home 钉回处理。
    const tabTarget = (params.tab || '').trim()
    if (tabTarget) return this.visitTab(tabTarget, params.from)

    // URL/back 导航前把激活 tab 钉回钻探自己的 tab(bug 2026-08-11)。loadURL 的目标是"当前激活 tab"的
    // webContents,人在钻探时手动切了激活 tab,下一次 explore_visit {url} 就会把钻探 URL 加载进人的
    // 那个 tab、把它原来的 URL 冲掉。钉回 → 钻探永远只动自己的 tab,不受人工切 tab 干扰。
    await this.pinActiveTabToDrillTab()
    const wc = this.drillWc()
    if (!wc || wc.isDestroyed()) return 'ERROR: no page is open.'
    if (this.overBudget()) {
      this.log('budget', `120-minute budget used up after ${this.elapsedText()} — refusing further navigation`, undefined, 'warn')
      return `REFUSED: the 120-minute exploration budget is used up (${this.elapsedText()}). Call explore_session {"action":"end"} — the sitemap is written and merged, so a later session continues from here.\n${this.navState()}`
    }

    const raw = (params.url || '').trim()
    if (!raw) return 'ERROR: url is required (or "back", or a "tab").'

    if (raw.toLowerCase() === 'back') {
      const nav = wc.navigationHistory
      if (!nav.canGoBack()) return `Cannot go back — no history entry.\n${this.navState()}`
      nav.goBack()
      await this.settle(wc)
      this.log('back', `went back to ${wc.getURL()}`)
      const evidence = await this.readPage()
      return [this.navState(), '', this.renderEvidence(evidence)].join('\n')
    }

    const url = this.normalize(raw, this.startUrl)
    if (!url) return `ERROR: "${raw}" is not a usable url.`
    // 去重由 main 侧【硬拦】(Ral 2026-08-10:「让 agent 记住已经探索过哪些,防止重复探索」)。
    // 为什么不靠提示:提示只是建议。上下文一压缩、或者摘要被挤掉,模型就会拿同一个 url 再走一遍,
    // 而重复访问在 120 分钟预算里是纯损耗。拒绝的同时把已探清单摆出来,它才知道该挑什么。
    //
    // 但拦的口径要跟着 observeLanding 收窄:现在【每次点击落地】都写 visited,如果照旧一刀切拒,
    // 那么"凡是点进去过的页面"都再也回不去了 —— 而 explore_visit 正是回去的那把钥匙(recovery)。
    // 所以只拦【已经钻完的】页面(那才是真·重复探索);点过但所属模块还没标完成的,允许回去继续钻。
    if (this.visited.has(url) && this.drilledModuleUrls.has(url)) {
      this.refusedRevisits.push({ url, at: new Date().toISOString() })
      this.log('revisit-refused', `refused ${url} — module already drilled`, { url, refused: this.refusedRevisits.length }, 'warn')
      return [
        `REFUSED: ${url} is a module you already marked done this session. Main blocks re-drilling, so pick something you have not covered.`,
        '',
        this.trailSummary(),
        '',
        this.openWork().length
          ? `worklist (${this.openWork().length} pending${this.worklist.some((w) => w.parked) ? `, +${this.worklist.filter((w) => w.parked).length} parked nav shells` : ''}): ${this.openWork().slice(0, 8).map((w) => `"${w.name}" ${w.url}`).join(' | ')}`
          : 'worklist is EMPTY — either find new entries on the current page, or end the session.'
      ].join('\n')
    }
    const forbidden = this.rules ? isVisitForbidden(this.rules, url) : null
    if (forbidden) {
      this.log('visit-blocked', `refused ${url} — site rule: ${forbidden.reason}`, { url }, 'warn')
      return `REFUSED: a site rule says do not visit ${url} — ${forbidden.reason}. Pick something else.`
    }
    if (this.hostOf(url) !== this.host) {
      this.noteOffsite({ name: params.from || raw, url, host: this.hostOf(url), foundOn: wc.getURL(), kind: 'link' })
      this.log('visit-offsite', `refused ${url} — leaves ${this.host}`, { url }, 'warn')
      return `REFUSED: ${url} leaves the target site (${this.hostOf(url)} ≠ ${this.host}). It is now on the off-site exit list. Do not try it again.`
    }

    const outcome = await this.navigate(wc, url)
    this.visited.add(url)
    this.counts.visits += 1
    this.currentPageUrl = url
    this.worklist = this.worklist.filter((w) => w.url !== url)
    if (outcome !== 'ok') {
      this.uncovered.push({ name: params.from || url, url, reason: outcome === 'timeout' ? 'nav-timeout' : 'nav-failed' })
      this.log('visit-failed', `${url}: ${outcome}`, { url }, 'warn')
      return `Navigation ${outcome} for ${url}. Recorded as uncovered.\n${this.navState()}`
    }
    await this.settle(wc)

    // Landed off-site (302 / SSO) — say so loudly; the agent must recover, not read this page.
    const landed = wc.getURL()
    if (this.hostOf(landed) !== this.host) {
      this.noteOffsite({ name: params.from || url, url: this.normalize(landed, url) || landed, host: this.hostOf(landed), foundOn: url, kind: 'redirect' })
      this.uncovered.push({ name: params.from || url, url, reason: 'offsite-redirect', detail: `redirected to ${this.hostOf(landed)}` })
      this.log('visit-redirected', `${url} redirected off-site to ${this.hostOf(landed)}`, { url, landed }, 'warn')
      return `${url} REDIRECTED off-site to ${this.hostOf(landed)}. Recorded. Recover with explore_visit {"url":"back"} or the start url.\n${this.navState()}`
    }

    this.log('visit', `at ${url}`, { url, visited: this.visited.size, worklist: this.worklist.length }, 'info', true)
    this.task?.update({
      title: `${params.from || url} · ${this.elapsedText()}/120m`,
      progress: { done: this.drilledModuleUrls.size, total: Math.max(this.moduleByUrl.size, 1), stage: `${this.drilledModuleUrls.size}/${this.moduleByUrl.size} 模块 · ${params.from || url} — ${this.remainingText()} left` },
      metadata: { elapsedMs: this.elapsedMs(), budgetMs: SESSION_BUDGET_MS }
    })
    this.trail.push({ url, name: params.from || url, at: Date.now() })
    const evidence = await this.readPage()
    // 结构优先:落地后从本页同站链接收割下一级进 frontier(锚点 + 快照 /url:,封顶 2 级、模板去重)。
    if (evidence) this.autoSeedFrontier(url, [...evidence.anchors, ...this.snapshotLinks(evidence.snapshot)])
    this.markListIfNeeded(url, evidence)
    const stuck = this.noteProgress(url, evidence?.snapshot ?? null)
    // 认领候选跟着"到达这个模块"一起给 —— 它就是 agent 要做身份判断的那一刻。
    const known = this.renderKnownFunctions(url, (evidence?.controls || []).map((c) => c.name))
    const tabs = await this.deps.listTabs().catch(() => [])
    return [this.navState(tabs), '', this.renderEvidence(evidence), known ? `\n${known}` : '', stuck ? `\n${stuck}` : '', '', this.trailSummary()]
      .filter(Boolean)
      .join('\n')
  }

  /**
   * 切换到某个 tab(或 "home")并读它(drill-multi-tab 决定 2)。激活它 → operationView + capture
   * 都跟过去(激活即录该 tab 流量)→ settle → readPage。同站页面记进【同一份】sitemap(状态按 URL
   * 存,跨 tab 累积)。这就是"一个会话控制多个 tab,输出还在这个会话"。
   */
  /** 钻探【探索阶段】是否在进行(供控制器判断要不要钉 tab / 是否续跑)。整体 isDrilling(含 ingesting)
   *  在控制器上,= isExploring || ingesting —— Ral 2026-08-12:isDrilling 要到 ingest 结束才算完。 */
  get isExploring(): boolean {
    return this.open
  }

  /** 这一轮被人叫停了吗 —— 控制器的续跑循环、ui_act、finalize 都要读它。 */
  get isStopped(): boolean {
    return this.aborted
  }

  /**
   * **就地放弃这一轮**,让下一次 `begin` 走完整重置而不是 `reentersRun` 的幂等短路。
   *
   * 为什么需要它:被叫停的一轮 `open` 会停在 `true`(见 `begin` 里那段注释 ——
   * 拒绝式的闸会造成死锁,所以重入被做成幂等)。于是"停止 → 立刻重新开钻"会撞上
   * `reentersRun` → 返回 `ALREADY DRILLING … NOTHING WAS RESET`,新一轮**继承了那个已经死掉的
   * 运行**,连它那个已经 abort 的 TaskHandle 一起 —— 停止信号于是活到了下一轮身上
   * (`drill-stop-signal-outlives-the-drill.md` 的同一根源,换了个触发方式)。
   *
   * 只有在 DrillService 判定这一轮已经无效时才调它(`docs/issues/drill-run-epoch-and-stop-gates.md`)。
   */
  async abandonRun(reason: string): Promise<void> {
    if (!this.open) return
    this.log('run-abandoned', `run on ${this.host} abandoned: ${reason} — the next begin will start a fresh run instead of re-entering this one`, { host: this.host, visited: this.visited.size, reason }, 'warn', true)
    this.open = false
    await this.finishTabScope()
    this.task = null
  }

  /**
   * **钻探自己开出来的 tab**(支线 tab 的 id)。给渲染层用:这些 tab 的激活不是"人在切 tab",
   * 是钻探在干活,聊天会话不该跟着换过去(Ral 2026-08-16:「开始钻探的消息发出去后,消息列表
   * 被清空了,过了一会儿又重新生长出来」—— 那不是消息没了,是会话被切到了支线 tab 的空会话上)。
   *
   * 只报支线,不报主线:主线 tab 本来就承载着发起这一轮的那个会话,让它照常工作。
   */
  /**
   * 被拦掉的下载(downloadGuard)。**攒着,下一次落地时随提示一起交给 agent。**
   *
   * 为什么必须告诉它:拦截发生在主进程,agent 那边看到的只是「点了导出,页面没变化」——
   * 和"这个按钮坏了"长得一模一样,于是它会把同一个按钮反复点下去。说清楚之后它知道:
   * 这一发**成功了**(端点已录),文件是我们故意不要的,可以往下走。
   */
  private blockedDownloads: string[] = []
  /**
   * 上传入口被拦(文件/目录选择器)。和被拦的下载走**同一条交付路** —— 对 agent 来说两者要说的
   * 话几乎一样:控件是有效的、别重复点、别记 dont_click。区别只有一句:上传是**写操作**,
   * 本来就不在钻探范围内,所以连"端点已录"都不能说 —— 那一发请求根本没发出去。
   */
  noteBlockedUpload(what: string): void {
    if (!this.open) return
    this.blockedUploads.push(what)
    this.log('upload-blocked', `blocked a file/directory chooser during the drill: ${what} — uploading is a WRITE and out of scope`, { what }, 'info')
  }
  private blockedUploads: string[] = []

  noteBlockedDownload(name: string): void {
    if (!this.open) return
    this.blockedDownloads.push(name)
    this.log('download-blocked', `blocked a file download during the drill: ${name} — the request itself WAS recorded, only the file was dropped`, { name }, 'info')
  }

  branchTabIds(): string[] {
    return this.branchStack.map((b) => b.tabId)
  }

  /**
   * 把 OS 激活 tab 钉回【钻探当前应在的 tab】(currentDrillTabId,默认 home、探 B 时是 B)。人在钻探时
   * 手动切了激活 tab 后,`deps.webContents()`/`currentBrowserTarget()`(= 当前激活 tab)会指向人的那个 tab
   * —— 于是 explore_visit 的 loadURL、ui_act 的点击、page_snapshot 的读都落到错的 tab 上(bug 2026-08-11)。
   * 钉回后钻探永远只动自己的 tab。导航(visit URL/back)前 + 每次 ui_act/page_snapshot 前都调。
   * 已在正确 tab / 无记录则 no-op。public 供控制器调(ui_act、page_snapshot 走控制器)。
   */
  /**
   * **不再夺回激活 tab**(契约 PQ-5,落地 conn-009)。
   *
   * 它原来做的事是 `activateTab(钻探的 tab)`,修的是 bug 2026-08-11「人手动切 tab 后钻探操作落到错
   * tab」。那个 bug 的根因是钻探读**激活 tab 的镜像**;`drillWc()` 把根因拿掉之后,夺回焦点就
   * 只剩副作用了 —— 而副作用是真的:它每次导航 / `ui_act` / `page_snapshot` 之前都跑一次,
   * 于是钻探期间人每隔几秒被切走,connector tab 上的收件箱根本没法看。
   *
   * 保留这个方法而不是删掉:它现在是一条**留痕**,记下「人此刻在看别的 tab」这个事实,
   * 排查时能把"钻探读到的页面"与"人看到的页面"分开。多 tab 钻探主动换 tab 走的是
   * `currentDrillTabId` 的赋值(`explore_session {action:'tab'}`),与"激活哪个 tab 给人看"从此无关。
   *
   * 只在观察到的激活 tab **变化时**留一条 —— 它的调用频率是每个动作一次,无条件打会淹掉日志。
   */
  async pinActiveTabToDrillTab(): Promise<void> {
    const want = this.currentDrillTabId || this.homeTabId
    if (!want) return
    this.refreshTabScope()
    if (this.tabPauseError) throw new Error(this.tabPauseError)
    await this.deps.activateTab(want)
    const active = this.deps.activeTabId() || ''
    if (active === want) {
      this.lastObservedActiveTabId = active
      return
    }
    if (this.lastObservedActiveTabId === active) return
    this.lastObservedActiveTabId = active
    this.log(
      'human-on-other-tab',
      `active tab ${active || '(none)'} ≠ drill tab ${want} — 人在看别的 tab,钻探照旧在自己那只上跑(不夺回焦点)`,
      { active, want },
      'info'
    )
    const wc = this.drillWc()
    if (wc && !wc.isDestroyed()) await this.settle(wc)
  }

  /**
   * 新同站 tab 出现 → 开一条支线(Ral 2026-08-13 要求 1+2)。每次 ui_act 之后调:
   * 点了什么导致新 tab,是在这一刻才知道的。返回给 agent 的提示串(空 = 没开支线)。
   *
   * 只认【同站】新 tab:外站 tab(第三方文档/支付跳转)不是钻探对象,记 offsite 就够了。
   */
  async openBranchIfNewTab(explicitTabId?: string): Promise<string> {
    this.refreshTabScope()
    if (!this.open || this.tabPauseError) return ''
    const tabs = await this.deps.listTabs().catch(() => [])
    for (const t of tabs) {
      if (explicitTabId && t.id !== explicitTabId) continue
      if (!this.ownsActiveTab(t.id) || this.branchSeenTabs.has(t.id) || this.tabsDrilled.has(t.id) || t.id === this.homeTabId) continue
      this.branchSeenTabs.add(t.id)
      if (!t.url || (!explicitTabId && this.hostOf(t.url) !== this.host)) continue
      const parentTabId = this.tabMembers.get(t.id)?.parentTabId || this.currentDrillTabId || this.homeTabId
      this.branchStack.push({ tabId: t.id, url: t.url, parentTabId, openedAt: Date.now() })
      this.log('branch-open', `支线钻探:新 tab ${t.id} → ${t.url}(钻完自动关闭并回主线)`, { tab: t.id, url: t.url, parentTabId }, 'info')
      this.deps.onNote?.(`🌿 支线钻探:点击打开了新标签页 ${t.url} —— 先把它钻完,完成后自动关闭并回到主线。`)
      const switched = await this.visitTab(t.id, `branch:${t.id}`)
      return [
        `A controlled page opened a new tab or you explicitly opened it — this is now a BRANCH drill (branch depth ${this.branchStack.length}).`,
        'Drill this tab NOW: record it as a module, do the observe→click/fill→observe loop over it, then mark it done.',
        'When you mark it done main CLOSES the tab and returns you to the main line automatically — do not close or switch away yourself.',
        '',
        switched
      ].join('\n')
    }
    return ''
  }

  /** 支线那个模块标完成时调:关掉支线 tab、弹栈、切回父 tab。返回给 agent 的提示串。 */
  private async closeBranchFor(moduleUrl: string): Promise<string> {
    const matches = (b: { url: string }): boolean => this.normalize(b.url, this.startUrl) === moduleUrl || b.url === moduleUrl
    // Multiple tabs can have the same URL; finish the actual operation target first.
    const current = this.branchStack.findIndex((b) => b.tabId === this.currentDrillTabId && matches(b))
    const idx = current >= 0 ? current : this.branchStack.findIndex(matches)
    if (idx < 0) return ''
    const [branch] = this.branchStack.splice(idx, 1)
    const back = branch.parentTabId
    await this.deps.closeTab?.(branch.tabId).catch((err) => this.log('branch-close-failed', `close ${branch.tabId}: ${(err as Error).message}`, undefined, 'warn'))
    this.branchSeenTabs.delete(branch.tabId)
    this.tabsDrilled.add(branch.tabId)
    this.log('branch-close', `支线钻完:关闭 tab ${branch.tabId},回主线 tab ${back}`, { tab: branch.tabId, back }, 'info')
    this.deps.onNote?.(`✅ 支线钻完:已关闭标签页,回到主线继续。`)
    // 回主线:锚点切回父 tab,后续 ui_act/快照都落在主线上。
    const tabs = await this.deps.listTabs().catch(() => [])
    if (back && tabs.some((t) => t.id === back)) {
      await this.prepareDrillTab(back)
      this.currentDrillTabId = back
      await this.onAnchorTabChanged(back)
      const wc = this.drillWc()
      if (wc && !wc.isDestroyed()) await this.settle(wc)
      this.currentPageUrl = '' // 强制下一次 observeLanding 重新认这一页(回来的是父页面)
      await this.observeLanding(`back from branch ${branch.tabId}`)
    }
    return `BRANCH DONE — main closed tab ${branch.tabId} and returned you to the main line. Continue drilling the main line.`
  }

  /** Warm the chosen operation target without changing the human foreground. */
  private async prepareDrillTab(nextTabId: string): Promise<void> {
    await this.deps.activateTab(nextTabId)
  }

  private async visitTab(tabTarget: string, from?: string): Promise<string> {
    this.refreshTabScope()
    if (this.tabPauseError) return `ERROR: ${this.tabPauseError}`
    const targetId = tabTarget.toLowerCase() === 'home' ? this.homeTabId : tabTarget
    if (!targetId) return `ERROR: no home tab recorded for this session.`
    const tabs = await this.deps.listTabs().catch(() => [])
    if (!tabs.some((t) => t.id === targetId)) {
      return `ERROR: tab "${targetId}" is not open.\n${this.navState(tabs)}`
    }
    // An explicit explore_visit/activate_tab is takeover intent; simply opening a tab is not.
    if (!this.ownsActiveTab(targetId)) {
      await this.deps.activateTab(targetId)
      const tab = tabs.find((item) => item.id === targetId)!
      const wc = this.deps.webContentsForTab(targetId)
      if (!wc || wc.isDestroyed() || wc.isCrashed()) return 'ERROR: the requested drill tab is unavailable.'
      const parentTabId = this.currentDrillTabId || this.homeTabId
      await this.admitBranch(targetId, parentTabId, tab.url)
      if (!this.ownsActiveTab(targetId)) return 'ERROR: the drill stopped before this tab could be adopted.'
      this.branchStack.push({ tabId: targetId, url: tab.url, parentTabId, openedAt: Date.now() })
      this.branchSeenTabs.add(targetId)
    }
    await this.prepareDrillTab(targetId)
    this.currentDrillTabId = targetId
    await this.onAnchorTabChanged(targetId) // 钻探有意切到这个 tab → 之后的 url 导航/ui_act/快照都以它为锚
    this.tabsDrilled.add(targetId) // 记这个 tab 已在钻(issue 3:系统化逐 tab)—— firstUndrilledSameSiteTab 不再返回它
    const wc = this.drillWc()
    if (wc && !wc.isDestroyed()) await this.settle(wc)
    const landed = wc && !wc.isDestroyed() ? wc.getURL() : ''
    const nurl = this.normalize(landed, this.startUrl)
    const sameSite = !!landed && this.hostOf(landed) === this.host
    // 同站 tab:把它当一个已到达的页面记进状态(跨 tab 的 visited 是同一个集合)。外站 tab:不记页面。
    if (nurl && sameSite) {
      this.visited.add(nurl)
      this.counts.visits += 1
      this.currentPageUrl = nurl
      this.trail.push({ url: nurl, name: from || `tab:${targetId}`, at: Date.now() })
    }
    this.log('tab-switch', `switched to tab ${targetId} → ${landed}`, { tab: targetId, url: landed, sameSite }, 'info', true)
    this.touchTask(`tab ${targetId}`)
    const evidence = await this.readPage()
    if (evidence && nurl && sameSite) {
      this.autoSeedFrontier(nurl, [...evidence.anchors, ...this.snapshotLinks(evidence.snapshot)])
      this.markListIfNeeded(nurl, evidence)
    }
    const stuck = this.noteProgress(landed, evidence?.snapshot ?? null)
    const known = nurl && sameSite ? this.renderKnownFunctions(nurl, (evidence?.controls || []).map((c) => c.name)) : ''
    const tabsAfter = await this.deps.listTabs().catch(() => [])
    return [this.navState(tabsAfter), '', this.renderEvidence(evidence), known ? `\n${known}` : '', stuck ? `\n${stuck}` : '', '', this.trailSummary()]
      .filter(Boolean)
      .join('\n')
  }

  /** Read the page: complete anchor set + controls + the extractor's hint + rule annotations. */
  /**
   * 读页面。**空表格会自动重读一次。**
   *
   * 网络安静(settle)已经挡住了绝大多数"读太早",但挡不住两种:分页组件先渲染骨架、数据那一发
   * 稍后才由某个 effect 发出;或者请求回来了但列表要等一帧才 patch 进 DOM。表现都一样 ——
   * **有表格、零数据行**,于是操作列的「编辑」既不进控件台账、agent 也无从点击。
   *
   * 判据是纯 DOM 事实(`grids > 0 && tableRows === 0`),不认任何业务语义;只重读**一次**,
   * 而且重读结果不管好坏都用 —— 这里的目标是消掉时序噪声,不是把一个真的空列表等出数据来。
   */
  /** 上一次 readPage 是否触发了「空表格重读」—— 记进快照台账,事后能分开"读太早"和"真的空"。 */
  private lastReadWasReread = false

  /** 把这一次读到的页面记进快照台账(审计用,收尾落盘)。 */
  private noteSnapshot(e: PageEvidence, reread = false): void {
    this.snapshotLog.push({
      at: new Date().toISOString(),
      url: e.url,
      moduleUrl: this.currentModuleUrl(),
      title: e.title || '',
      rows: e.diag.tableRows,
      grids: e.diag.grids,
      controls: e.controls.length,
      inRowControls: e.controls.filter((c) => c.inRow).length,
      reread,
      funnel: this.currentFunnel(),
      yaml: e.snapshot
    })
  }

  private async readPage(): Promise<PageEvidence | null> {
    this.lastReadWasReread = false
    const first = await this.readPageOnce()
    if (!first || first.diag.grids <= 0 || first.diag.tableRows > 0) return first
    const wc = this.drillWc()
    if (!wc || wc.isDestroyed()) return first
    await this.settle(wc, EMPTY_TABLE_RETRY_MS)
    const again = await this.readPageOnce()
    if (!again) return first
    this.lastReadWasReread = true
    if (again.diag.tableRows > first.diag.tableRows) {
      this.log('empty-table-reread', `the table was still empty on first read — re-read after settling and got ${again.diag.tableRows} row(s) and ${again.controls.length} control(s) (was ${first.controls.length})`, { rowsBefore: first.diag.tableRows, rowsAfter: again.diag.tableRows, controlsBefore: first.controls.length, controlsAfter: again.controls.length }, 'info')
    } else {
      // 重读也还是空 —— 那多半就是一张真的空列表。说出来,免得事后把它当成"读太早"再查一遍。
      this.log('empty-table-confirmed', 'table is still empty after a re-read — treating it as genuinely empty, not a timing problem', { grids: again.diag.grids }, 'info', true)
    }
    return again
  }

  private async readPageOnce(): Promise<PageEvidence | null> {
    const wc = this.drillWc()
    if (!wc || wc.isDestroyed()) return null
    let raw: NavExtractResult | null = null
    try {
      const r = (await wc.debugger.sendCommand('Runtime.evaluate', { expression: NAV_EXTRACT, returnByValue: true, awaitPromise: true })) as {
        result?: { value?: NavExtractResult }
        exceptionDetails?: unknown
      }
      raw = r.exceptionDetails ? null : r.result?.value ?? null
    } catch (err) {
      this.log('extract-failed', `page extraction failed: ${(err as Error).message}`, undefined, 'warn')
      return null
    }
    if (!raw) {
      this.log('extract-empty', 'page extraction returned nothing — is the debugger attached?', undefined, 'warn')
      return null
    }
    // 计算态快照是主输入(Ral:「先读 A11Y」)。它拿不到就退化成只有锚点表 —— 那种情况必须
    // 说出来,因为模型少了句柄,只能走 href,点不了 hover 才出现的子菜单。
    const snap = await this.deps.pageSnapshot(this.anchorTabId).catch(() => null)
    if (!snap) this.log('snapshot-missing', 'accessibility snapshot unavailable — falling back to the anchor list only', undefined, 'warn')
    const url = wc.getURL()
    return {
      url,
      host: this.hostOf(url),
      title: raw.title,
      snapshot: snap ? snap.yaml : null,
      anchors: raw.links.map((l) => ({ name: l.name, href: l.href, depth: l.depth })),
      controls: raw.controls.map((c) => {
        const forbidden = this.rules ? isClickForbidden(this.rules, c.name) : null
        return { name: c.name, role: c.role, inRow: c.inRow, forbidden: forbidden ? forbidden.reason : undefined }
      }),
      totals: raw.totals,
      diag: raw.diag,
      walkControls: snap?.walkControls
    }
  }

  private renderEvidence(e: PageEvidence | null): string {
    if (!e) return 'PAGE READ FAILED — nothing extracted. Try explore_visit again, or page_snapshot to see the page yourself.'
    // 顺序是刻意的:**先快照**(主输入,Ral 定的「先读 A11Y」),锚点表在后面作补充。
    // 倒过来会让模型先抓住那份只有 href 的扁平清单,而结构、句柄、可点控件全在快照里。
    const lines = [
      `page: ${e.title} — ${e.url}`,
      e.diag.passwordFields > 0
        ? '⚠ LOGIN WALL? this page has a password field. If the app REQUIRES login and you are blocked from its content (not just visiting a login route while already signed in elsewhere), call explore_session {"action":"need_login"} — it PAUSES and asks the user to log in, then continues. Do not try to log in yourself.'
        : '',
      '',
      e.snapshot
        ? `ACCESSIBILITY SNAPSHOT (your primary view of this page — roles, names, [ref=eN] handles to act on, /url: on links):\n${e.snapshot}`
        : '⚠ NO ACCESSIBILITY SNAPSHOT for this page (the debugger may not be attached). You are working blind apart from the anchor list below: you can navigate hrefs but cannot click anything without a ref. Consider page_snapshot directly.',
      '',
      `anchors (${e.anchors.length} of ${e.totals.anchors} on the page) — a COMPLETE, UNFILTERED second opinion, including links the snapshot pruned for having no readable name:`,
      ...e.anchors.slice(0, 60).map((a) => `  · "${a.name}" → ${a.href}${this.visited.has(this.normalize(a.href, e.url) || '') ? '  [visited — main will refuse it]' : ''}`),
      e.anchors.length > 60 ? `  · … ${e.anchors.length - 60} more (see explore_session state)` : '',
      e.totals.capped ? '  ⚠ enumeration hit its per-page cap — there are more than listed.' : '',
      '',
      `controls (${e.controls.length} distinct of ${e.totals.controls} clickable) — judge from THIS page whether each writes business data before clicking:`,
      ...e.controls.slice(0, 60).map((c) => `  · "${c.name}" [${c.role}${c.inRow ? ', in a table/list row' : ''}]${c.forbidden ? `  ⛔ SITE RULE: ${c.forbidden}` : ''}`),
      e.controls.length > 60 ? `  · … ${e.controls.length - 60} more` : '',
      '',
      `extraction diag: anchors=${e.diag.anchors} navRoles=${e.diag.navRoles} navTags=${e.diag.navTags} ariaLabels=${e.diag.ariaLabels}`,
      'Note on this diag: navRoles/navTags near 0 is NORMAL for Arco/Element/Ant-Design admin apps — they ship almost no ARIA. That is why the snapshot above is the COMPUTED tree rather than the site\'s own roles, and why a low count here says nothing about whether you found the menu.',
      'If a menu you can SEE is missing from the snapshot (a collapsed or hover-only submenu), expand it with ui_act on its [ref=eN] and read again — its children do not exist in the tree until it opens. Then record the difference with explore_record so this site\'s recall is measured rather than assumed.'
    ]
    return lines.filter(Boolean).join('\n')
  }

  /** The agent's findings go here. Nothing is inferred — main only stores what it is told. */
  async record(params: {
    module?: { name: string; url: string; level?: number; parentUrl?: string; standalone?: boolean; expectedChildren?: number }
    functions?: {
      name: string
      verb?: string
      object?: string
      rowLevel?: boolean
      moduleUrl?: string
      /** 认领上次的把手(`fnp_31`)。省略 = 这是新功能点,main 铸一个新号。 */
      functionId?: string
      /** 认领的内容与上次不一致时【必填】,与 why 一起构成"合并比分裂难"那道闸(决定 4)。 */
      renamedFrom?: string
      why?: string
    }[]
    /** 页面上已经没有的功能点 —— 转孤儿,不删(决定 6)。 */
    retired?: { functionId: string; why?: string }[]
    worklistAdd?: { url: string; name: string; parentUrl?: string }[]
    dontClick?: { value: string; reason: string }[]
    dontVisit?: { value: string; reason: string }[]
    searchValues?: string[]
    observedWrite?: { method: string; url: string; after?: string }
    disagreement?: { extractor: number; agent: number; note?: string }
    uncovered?: { name: string; url: string; reason: string; detail?: string }
    /** agent 判定这个模块已钻完 → 分子 +1。要求它是已记录 + 已访问过的模块(否则拒,防空标)。 */
    moduleDone?: { url: string }
    /** 控件分诊:这一页哪些要点、哪些不点+为什么。漏斗中间那一格,只能由 agent 填。 */
    plan?: { click?: string[]; skip?: { name: string; reason?: string }[] }
    /**
     * agent 用一句话说这一步【学到了什么】(Ral 2026-08-13:「边录制 agent 也可以输出自己学到了什么」)。
     * 跟着发现/钻完模块一起播到聊天里 —— 播报的骨架由 main 保证(发现了什么、进度多少),
     * 这一句提供只有模型才知道的语义。
     */
    note?: string
  }): Promise<string> {
    if (!this.open) return 'ERROR: no exploration session. Call explore_session {"action":"begin"} first.'
    this.counts.records += 1
    const out: string[] = []
    // 触顶后仍然允许 record —— 已经看到的东西必须记得下来,否则最后一页白探。
    // 但要提醒它收工:拦的是继续【导航】,不是继续【记录】。
    if (this.overBudget()) out.push(`⚠ the 120-minute budget is used up (${this.elapsedText()}) — record what you already saw, then call explore_session {"action":"end"}.`)

    if (params.module) {
      const url = this.normalize(params.module.url, this.startUrl) || params.module.url
      const mod: SitemapModule = {
        name: params.module.name,
        level: params.module.level ?? 1,
        url,
        ...(params.module.standalone ? { standalone: true, foundAt: 'agent' } : {})
      }
      // 【别名闸】宿主从没落地过、而它的路由又已经是一个已知模块 → 这是同一个地方的另一种写法,
      // 不是新模块。2026-08-17 实测:一轮里 agent 用 3 种 hash-query key + 1 种 fragment 造了
      // 7 个「新模块」(`?branch=` / `?tab=` / `?closeBranch=` / `#tab-…`),每次名字里还如实写着
      // 「重复分支 / 独立 / 关闭别名」,宿主照单全收 —— 计数虚高、多跑一次无快照的摄取窗口,
      // 而且**那一刀假的窗口边界会把下一个真实模块的流量截走**(实测 /order/credit 因此摄到 0 个接口)。
      //
      // 判据是「**宿主自己有没有落地过**」,不是「这个参数名可不可疑」——
      // 参数名可以无穷造(实测已经换过三种 key 和一次 fragment),而落地记录是有限且宿主自己写的。
      // 允许未落地就注册的正常情况(菜单里看得见、还没打开的子模块)不受影响:
      // 它们的路由是【新】的,不会撞上已知模块。
      const rkey = this.routeKey(url, this.startUrl)
      const aliasOf = rkey && !this.visited.has(url)
        ? [...this.moduleByUrl.keys()].find((known) => known !== url && this.routeKey(known, this.startUrl) === rkey)
        : undefined
      if (aliasOf) {
        this.aliasRefused += 1
        this.log('module-alias-refused', `module "${params.module.name}" NOT recorded — "${url}" is another spelling of "${aliasOf}" (same route, never visited under this url)`, { url, aliasOf, name: params.module.name }, 'warn', true)
        out.push(
          `module NOT recorded — "${url}" is the same place as "${aliasOf}", just written differently (extra query/fragment). ` +
          `Do NOT invent url variants to re-register a page: use the url exactly as the host reported it on landing. ` +
          `If you genuinely need to revisit it, explore_visit it — you do not need a new module for that.`
        )
      } else if (!this.moduleByUrl.has(url)) {
        this.moduleByUrl.set(url, mod)
        // 【每发现一个模块 = 一份快照】(Ral 2026-08-24:「钻探过程发现一个模块要为该模块进行一次截图」)。
        //
        // 由**宿主**保证,不靠 agent 自觉:实测它的快照频率其实不低(24 次 / 16 个模块),
        // 但那是它自己按需要取的,和"每个模块都有一份存档"不是同一件事 —— 后者是产物要求。
        //
        // **只落盘,不喂给模型。** 上一轮 24 次快照 = 275K token,而窗口 272K;
        // 把每个模块的全文再塞一遍进上下文,等于直接把这条规则做成 OOM。
        // 存进 snapshotByModule(摄取时当上下文用)+ 录制的 ui/(UI 模式下)+ 将来 Form 提取取材;
        // 交回 agent 的只有一行摘要。
        void this.snapshotModuleForArchive(url, params.module.name)
        const parentUrl = params.module.parentUrl ? this.normalize(params.module.parentUrl, this.startUrl) : null
        const parent = parentUrl ? this.moduleByUrl.get(parentUrl) : null
        if (parent) (parent.children ||= []).push(mod)
        else this.modules.push(mod)
        // 把模块名回填到路径摘要上:摘要按模块聚合,而 visit 发生在 record 之前,
        // 所以落地那一刻还不知道自己属于哪个模块。
        for (const t of this.trail) if (!t.module && t.url === url) t.module = mod.name
        // agent 自己数的"这一页有几个子入口"。**用途是发现侧的交叉核对,不是完成闸**(Ral 2026-08-13:
        // 模块不再参与判定)。它回答的是一个机械台账答不了的问题:侧栏上明明有 42 项,我们只从
        // `a[href]` 收到 33 个 —— 差的 9 个不是链接(JS 驱动的导航/按钮),**只能靠点击挖出来**。
        // agent 看得见页面,所以它数;main 拿它和收割结果比对,把缺口指出来。数错了不阻断任何事。
        // 告诉 agent 存档已发生 —— 否则它可能"为了保险"再截一遍,而那一遍是要花上下文的。
        out.push(`module recorded — the host archived a page snapshot for "${params.module.name}" (kept out of your context on purpose; call page_snapshot only if you need to act on this screen now).`)
        const expected = Number(params.module.expectedChildren ?? 0)
        if (expected > 0) this.expectedChildrenByModule.set(url, expected)
        const harvested = this.unvisitedChildrenOf(url).length + (mod.children?.length ?? 0)
        const gap = expected - harvested
        out.push(
          `module recorded: ${mod.name} (level ${mod.level})` +
            (expected > 0
              ? gap > 0
                ? ` — you counted ~${expected} sub-entries here but only ${harvested} are reachable as links. The other ${gap} are NOT links (JS-driven nav / buttons): open them by CLICKING, they will not appear in the harvested list on their own.`
                : ` — ~${expected} sub-entries, all reachable as links.`
              : '')
        )
        this.deps.onNote?.(`🔍 发现模块 **${mod.name}**(第 ${this.moduleByUrl.size} 个)${expected > 0 ? `,预计 ${expected} 个子模块` : ''}${params.note ? ` —— ${params.note}` : ''}`)
        this.touchTask(`发现模块 ${mod.name}`)
      } else {
        out.push(`module already recorded: ${mod.name}`)
      }
    }

    for (const f of params.functions || []) {
      const modUrl = f.moduleUrl ? this.normalize(f.moduleUrl, this.startUrl) : null
      const mod = (modUrl && this.moduleByUrl.get(modUrl)) || this.moduleByUrl.get(this.normalize(this.drillWc()?.getURL() || '', this.startUrl) || '')
      if (!mod) {
        out.push(`function "${f.name}" NOT recorded — no module for it yet; record the module first`)
        continue
      }
      const verb = f.verb || 'action'
      const object = f.object || mod.name

      // ── 身份:认领(agent 说"这就是上次那个")或铸造(说"这是新的")。
      //    main 不猜:名字一样也不会自动认领(决定 3)。
      let handle: string
      let assertion: IdentityAssertion
      const claimId = (f.functionId || '').trim()
      if (claimId) {
        const known = (this.knownByModule.get(mod.url) || []).find((k) => k.handle === claimId)
        if (!known) {
          // 引用了别的模块的把手,或者根本不存在 —— 拒绝而不是接受,否则绑定会挂到错的功能上。
          const elsewhere = [...this.knownByModule.values()].flat().find((k) => k.handle === claimId)
          out.push(
            elsewhere
              ? `function "${f.name}" NOT recorded — ${claimId} belongs to a different module (${elsewhere.moduleUrl}). A function point cannot move between modules; omit function_id to mint a new one.`
              : `function "${f.name}" NOT recorded — ${claimId} is not a known function point here. Use one of the handles listed for this page, or omit function_id to mint a new one.`
          )
          continue
        }
        if (this.claimed.has(claimId)) {
          out.push(`function "${f.name}" NOT recorded — ${claimId} was already claimed by another control this session. Two controls cannot be the same function point; omit function_id for this one.`)
          continue
        }
        const differs = known.verb !== verb || known.object !== object || known.name !== f.name
        const renamedFrom = (f.renamedFrom || '').trim()
        const why = (f.why || '').trim()
        if (differs && (!renamedFrom || !why)) {
          // ← 这就是"合并比分裂难"那道闸(决定 4)。错误合并是静默的,错误分裂只是孤儿;
          //   所以让合并付出说明成本,而不是让它默默发生。
          out.push(
            `function "${f.name}" NOT recorded — you claimed ${claimId} (${known.verb} ${known.object} — "${known.name}") but this one differs, ` +
              `so renamed_from AND why are both REQUIRED. If it is actually a different function, omit function_id instead and it will get its own identity.`
          )
          continue
        }
        handle = claimId
        this.claimed.add(handle)
        assertion = { at: new Date().toISOString(), moduleUrl: mod.url, handle, action: 'continued', name: f.name, ...(differs ? { renamedFrom: renamedFrom || known.name, why } : {}) }
        out.push(differs ? `function CONTINUED as ${handle}: "${known.name}" → "${f.name}" (${why})` : `function CONTINUED as ${handle}: "${f.name}"`)
      } else {
        handle = this.mintHandle()
        assertion = { at: new Date().toISOString(), moduleUrl: mod.url, handle, action: 'minted', name: f.name }
        out.push(`function recorded as NEW ${handle}: ${verb} ${object} — "${f.name}"`)
      }
      this.identityLog.push(assertion)

      const fn: SitemapFunction = {
        handle,
        verb,
        object,
        name: f.name,
        ...(assertion.renamedFrom ? { renamedFrom: assertion.renamedFrom, renamedWhy: assertion.why } : {}),
        control: { role: 'button', name: f.name },
        ...(f.rowLevel ? { rowLevel: true } : {}),
        status: 'observed'
      }
      ;(mod.functions ||= []).push(fn)
    }

    // ── 退休:agent 说"这个功能在页面上已经没有了"。把手与绑定留在库里标孤儿,不删
    //    (决定 6)—— 断了要能看出是"断了"而不是"丢了"。
    for (const r of params.retired || []) {
      const id = (r.functionId || '').trim()
      const known = [...this.knownByModule.values()].flat().find((k) => k.handle === id)
      if (!known) {
        out.push(`retire skipped — ${id || '(no function_id)'} is not a known function point`)
        continue
      }
      this.identityLog.push({ at: new Date().toISOString(), moduleUrl: known.moduleUrl, handle: id, action: 'retired', name: known.name, why: (r.why || '').trim() || undefined })
      out.push(`function RETIRED ${id} ("${known.name}") — its bindings become orphans, kept and visible, not deleted`)
    }

    for (const w of params.worklistAdd || []) {
      const url = this.normalize(w.url, this.startUrl)
      if (!url) continue
      if (this.hostOf(url) !== this.host) {
        this.noteOffsite({ name: w.name, url, host: this.hostOf(url), foundOn: this.drillWc()?.getURL() || '', kind: 'link' })
        out.push(`worklist REFUSED "${w.name}" — it leaves the target site (now on the off-site list)`)
        continue
      }
      if (this.visited.has(url) || this.worklist.some((x) => x.url === url)) continue
      // 结构优先:同模板已见(已访问/已入队/详情行折叠)→ 不重复入队。auto-seed 是主 seeder,
      // worklist_add 只补 auto-seed 抓不到的项(hover/展开后才出现的子菜单)。
      const tmpl = this.templateOf(url)
      if (tmpl && this.seenTemplates.has(tmpl)) continue
      if (this.rules && isVisitForbidden(this.rules, url)) {
        out.push(`worklist REFUSED "${w.name}" — a site rule forbids it`)
        continue
      }
      const depth = this.depthOf(this.drillWc()?.getURL() || this.startUrl) + 1
      if (tmpl) {
        this.seenTemplates.add(tmpl)
        this.depthByTemplate.set(tmpl, depth)
      }
      this.worklist.push({ url, name: w.name, parent: w.parentUrl, depth })
    }

    if (params.dontClick?.length || params.dontVisit?.length || params.searchValues?.length) {
      const { rules, added } = await addSiteRules(this.siteId, params, 'agent')
      this.rules = rules
      out.push(`site rules: ${added} added (they will be enforced from now on, including next session)`)
      this.log('rule-added', `${added} site rule(s) recorded`, { dontClick: params.dontClick, dontVisit: params.dontVisit }, 'warn')
    }

    if (params.observedWrite) {
      // Decision 3: an audit, not a gate. This is what makes「有问题再说」actionable.
      this.writes.push({ ...params.observedWrite, at: new Date().toISOString() })
      this.log(
        'observed-write',
        `NON-GET during exploration: ${params.observedWrite.method} ${params.observedWrite.url}${params.observedWrite.after ? ` after clicking "${params.observedWrite.after}"` : ''}`,
        params.observedWrite,
        'warn'
      )
      out.push('write recorded. If that click was NOT supposed to write, add a dontClick rule for it now.')
    }

    if (params.plan && ((params.plan.click?.length ?? 0) > 0 || (params.plan.skip?.length ?? 0) > 0)) {
      out.push(this.recordPlan(params.plan))
    }

    if (params.disagreement) {
      this.disagreements.push({ url: this.drillWc()?.getURL() || '', ...params.disagreement })
      this.log('disagreement', `extractor ${params.disagreement.extractor} vs agent ${params.disagreement.agent} nav items`, params.disagreement, 'warn')
      out.push('disagreement recorded — this is what makes this site\'s recall measurable.')
    }

    // 拒收空 uncovered:没 url 就是没记任何东西 —— agent 老用空 payload 蒙混闸,直接退回报错、不落账。
    if (params.uncovered && !(params.uncovered.url || '').trim()) {
      out.push('uncovered REJECTED — a url is required (with a reason). An empty uncovered records nothing and cannot clear the frontier; visit the page or give the real url+reason.')
      this.log('uncovered-rejected', 'empty uncovered payload rejected', params.uncovered, 'warn')
    } else if (params.uncovered) {
      this.uncovered.push({
        name: params.uncovered.name,
        url: params.uncovered.url,
        reason: (params.uncovered.reason as SitemapUncovered['reason']) || 'error',
        detail: params.uncovered.detail
      })
      // 结构优先:标 uncovered 是 end-闸的合法逃生口 —— 把"确实打不开的页"显式出队(记录在案,绝不静默丢),
      // frontier 才能清空。但【出队多少】要看它有没有真去过:
      //   · 真去过才失败(visited) → 整族同模板一起 drain。这一族长一个样,一个打不开就都打不开,
      //     而且它是唯一能让 frontier 收敛的手段;
      //   · 没去过就断言打不开 → 只出队这一条。整族 drain 的口子在 F2 就是这么把覆盖打崩的:
      //     一次 uncovered 抛掉一整族 URL,比老老实实钻便宜太多(37→16 页、47→30 接口)。
      //     便宜的逃生口一定会被走,所以逃生口的价格必须和它省掉的工作量挂钩。
      const uncTmpl = this.templateOf(params.uncovered.url)
      const unUrl = this.normalize(params.uncovered.url, this.startUrl) || params.uncovered.url
      const before = this.worklist.length
      if (uncTmpl && this.visited.has(unUrl)) {
        this.worklist = this.worklist.filter((w) => this.templateOf(w.url) !== uncTmpl)
        this.seenTemplates.add(uncTmpl)
      } else {
        this.worklist = this.worklist.filter((w) => w.url !== unUrl)
      }
      if (before !== this.worklist.length) out.push(`frontier -= ${before - this.worklist.length} (marked uncovered)`)
      out.push(
        this.visited.has(unUrl)
          ? 'uncovered recorded (explicit, never a silent gap)'
          : 'uncovered recorded for THAT url only — you never landed on it, so its siblings stay on the queue. Try reaching one by clicking before writing the whole family off.'
      )
    }

    // 【自相矛盾闸】同一次调用里既说「我打算点这些」又说「我这页干完了」——
    // 那一批点击不可能发生过。2026-08-17 实测两例(`/iot/sensor`、`/customer/commission`),
    // 都是 `planned=1 / clicked=0` 紧跟同秒的 module_done,分属不同区段、相隔十分钟,不是手滑。
    //
    // 为什么要拒而不是只记一笔:漏斗的 planned→clicked 落差,语义是**「认出来了却没做」**,
    // 是最该被追的一格。收下这种调用等于让它被系统性灌水 —— 而灌进去的水和真实的漏点长得一模一样。
    if (params.moduleDone && (params.plan?.click?.length ?? 0) > 0) {
      const names = (params.plan?.click || []).slice(0, 8).map((n) => `"${n}"`).join(' | ')
      this.log('module-done-refused-incoherent', `module_done refused — the same call also planned ${params.plan?.click?.length} control(s) to click`, { url: params.moduleDone.url, planned: params.plan?.click?.length }, 'warn', true)
      out.push(
        `module_done REFUSED — this same call also says you plan to click ${params.plan?.click?.length} control(s): ${names}. ` +
        `Those two cannot both be true. Click them first (then mark done), or move them to skip with a reason if you decided against them.`
      )
    } else if (params.moduleDone) {
      const durl = this.normalize(params.moduleDone.url, this.startUrl) || params.moduleDone.url
      if (!this.moduleByUrl.has(durl)) {
        out.push(`moduleDone REJECTED — "${durl}" is not a recorded module. explore_record its module first, then mark it done.`)
      } else if (!this.visited.has(durl)) {
        out.push(`moduleDone REJECTED — you have not visited "${durl}" yet. Drill it (visit + interact) before marking done.`)
      } else if (this.drilledModuleUrls.has(durl)) {
        // 幂等:重复标记【不再触发第二轮摄取】(2026-08-14 实测:模型因工具超时重发 module_done,
        // 于是同一模块摄了两遍)。计数本来就不会重复涨(Set),但摄取原来是无条件触发的。
        this.log('module-done-repeat', `module "${durl}" was already marked done — ignoring the repeat (no second ingest)`, { url: durl }, 'info', true)
        out.push(`already marked done — nothing to do. (${this.drilledModuleUrls.size}/${this.moduleByUrl.size} labelled.) Move on to a place you have not opened yet.`)
      } else {
        this.drilledModuleUrls.add(durl)
        // 标完一个模块就看看:有没有哪个导航壳的子页因此全齐了 —— 有就自己了结,不留给 agent 慢慢想。
        this.resolveHubsCoveredByChildren()
        const mod = this.moduleByUrl.get(durl)
        this.log('module-done', `module drilled ${durl} (${this.drilledModuleUrls.size}/${this.moduleByUrl.size})`, { url: durl }, 'info', true)
        // 标签动作,不是完成判定 —— 但顺手把这一页链出去还没开的地点摆出来,那才是真正要去的地方。
        const pending = this.unvisitedChildrenOf(durl)
        out.push(
          `module labelled done — ${this.drilledModuleUrls.size}/${this.moduleByUrl.size} labelled. (Labels do not end the drill; opening every harvested place does.)` +
            (pending.length
              ? ` NOTE: ${pending.length} place(s) linked from this very page are still unopened — go into them next: ${pending.slice(0, 10).map((w) => `"${w.name}"`).join(' | ')}${pending.length > 10 ? ` | …${pending.length - 10} more` : ''}`
              : '')
        )
        this.deps.onNote?.(
          `✅ 钻完模块 **${mod?.name || durl}** —— ${this.drilledModuleUrls.size}/${this.moduleByUrl.size} 模块${params.note ? `;${params.note}` : ''}`
        )
        this.touchTask(`钻完 ${mod?.name || durl}`)
        // 边钻边摄:把这个模块被钻的时间窗【排队】去摄,立刻返回(不能在这 await —— 工具有 120s 墙钟)。
        // 真正的"暂停"在 observeLanding 里的 awaitIngestQueue。
        this.enqueueIngestWindow(durl, mod?.name || durl)
        // 支线模块钻完 → 关掉那个 tab、回主线(Ral 2026-08-13 要求 1+2)。
        const branchNote = await this.closeBranchFor(durl)
        if (branchNote) out.push(branchNote)
      }
    }

    out.push(`modules: ${this.drilledModuleUrls.size} drilled / ${this.moduleByUrl.size} discovered · visited: ${this.visited.size} pages · frontier: ${this.worklist.length}`)
    const undrilled = [...this.moduleByUrl.values()].filter((m) => !this.drilledModuleUrls.has(m.url))
    if (undrilled.length) out.push(`still to drill (mark each done when covered): ${undrilled.slice(0, 6).map((m) => `"${m.name}"`).join(' | ')}${undrilled.length > 6 ? ` | …${undrilled.length - 6} more` : ''}`)
    return out.join('\n')
  }

  private noteOffsite(exit: Omit<SitemapOffsiteExit, 'seen'>): void {
    const prev = this.offsite.find((e) => e.url === exit.url && e.kind === exit.kind)
    if (prev) prev.seen += 1
    else this.offsite.push({ ...exit, seen: 1 })
    void addSiteRules(this.siteId, { dontVisit: [{ value: exit.url, reason: `leaves ${this.host} (${exit.kind})` }] }, 'agent')
  }

  /** Write the artifacts and close. Merge with the previous sitemap is done by the caller (v1 path). */
  async end(): Promise<{
    text: string
    siteId: string
    modules: SitemapModule[]
    uncovered: SitemapUncovered[]
    offsite: SitemapOffsiteExit[]
    visited: number
    runPath: string
  }> {
    const dir = join(app.getPath('userData'), 'sites', this.siteId)
    await mkdir(join(dir, 'runs'), { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17)
    const runPath = join(dir, 'runs', `${stamp}-agent.json`)
    await writeFile(
      runPath,
      JSON.stringify(
        {
          runId: `${stamp}-agent`,
          engine: 'agent-v2',
          startedAt: new Date(this.startedAt).toISOString(),
          durationMs: Date.now() - this.startedAt,
          // 这一轮花了多少 —— 和 durationMs 并列,因为它俩是同一组预算的两个维度。
          tokens: this.spentTokens(),
          costUsd: Number(this.spentCostUsd().toFixed(4)),
          host: this.host,
          startUrl: this.startUrl,
          // 评估用(drill-eval.mjs):精确配对本轮录制 + 工具调用计数(uiActs=0 一眼看出只导航没点击)。
          captureSessionId: (() => { try { return basename(this.deps.captureSessionDir() || '') || null } catch { return null } })(),
          toolCounts: { ...this.counts },
          // 控件台账:模块 → 按钮/输入(按名字去重),标了这轮点没点过。Ral 2026-08-13 要的
          // 「模块-按钮点击记录」就是它 —— 漏点了哪些操作列按钮,一眼可查、可跨轮对比。
          controlLedger: this.controlLedger(),
          // 控件漏斗(Ral 2026-08-14):看见 → 判定可点 → 实际点了。三级的产生者不同,所以
          // 「按钮没被点」能定位到具体环节,而不是只剩一个总比率。逐模块留一份,跨轮可对比。
          controlFunnel: this.controlFunnel(),
          // 审计三件套(Ral 2026-08-14):什么时候开始(startedAt)· 截图了哪些页面(snapshots)·
          // 录制的流量怎么摄的(ingestWindows)。**钻探过程本身不持久化,但这三样要**——
          // 它们是事后判断"这一轮到底做对了什么、漏了什么"的全部依据。
          // 快照正文太大,单独一个文件;这里只留索引。
          snapshots: this.snapshotLog.map(({ yaml, ...meta }) => ({ ...meta, chars: yaml?.length ?? 0 })),
          snapshotsPath: `${stamp}-snapshots.json`,
          ingestWindows: this.ingestLog,
          visited: [...this.visited],
          worklistLeft: this.worklist,
          modules: this.modules,
          uncovered: this.uncovered,
          offsite: this.offsite,
          observedWrites: this.writes,
          disagreements: this.disagreements,
          refusedRevisits: this.refusedRevisits,
          identity: this.identityLog,
          trail: this.trail,
          journal: this.journal
        },
        null,
        2
      ),
      'utf8'
    )
    // 快照正文单独落一份 —— 主 journal 是给人扫的,几十份 yaml 会把它撑爆到打不开。
    await writeFile(
      join(dir, 'runs', `${stamp}-snapshots.json`),
      JSON.stringify({ runId: `${stamp}-agent`, host: this.host, snapshots: this.snapshotLog }, null, 2),
      'utf8'
    ).catch((err) => this.log('snapshots-write-failed', `could not write the snapshot log: ${(err as Error).message}`, undefined, 'warn'))
    await this.saveHandleCounter()
    const text = [
      `exploration of ${this.host} closed`,
      // 被人叫停的一轮要**第一时间说清楚**:下面所有的数字都是"停的那一刻"的快照,不是"探完了"。
      // 不说的话,一份 24/58 的摘要读起来和跑崩了一模一样。
      this.aborted
        ? `STOPPED BY THE OPERATOR — this run did not finish on its own. Everything below is what had been covered at the moment it was stopped; the sitemap and apidoc are written incrementally, so a later run continues from here rather than starting over.`
        : '',
      `${this.moduleByUrl.size} module(s) · ${this.visited.size} page(s) visited · ${this.openWork().length} still on the worklist${this.worklist.some((w) => w.parked) ? ` (+${this.worklist.filter((w) => w.parked).length} parked as nav shells — never opened)` : ''} · ran ${this.elapsedText()} of the 120min budget`,
      this.overBudget() && this.openWork().length ? `PARTIAL: the budget ran out with ${this.openWork().length} node(s) unvisited — run explore_session again on this site to continue (the sitemap merges).` : '',
      // 限定范围的一轮**绝不能**读起来像整站探完了。跳过的数目要报出来 —— 丢可以,静默不行。
      this.focus.length
        ? `SCOPED RUN: only ${this.focus.map((t) => `"${t}"`).join(' | ')} was in scope${this.offFocusDropped ? `; ${this.offFocusDropped} place(s) outside it were skipped and remain unexplored` : ''} — this is NOT full coverage of the site.`
        : '',
      // 控件覆盖率进摘要(Ral 2026-08-14:「我去观察下你钻取是否到位、该点的按钮是否都点了」)。
      // **操作列单列** —— 那一列的按钮打开的表单最可能带只读接口,漏点它们等于漏一整类端点,
      // 而 1/74 这种数字混在总数里看不出来。
      (() => {
        const fn = this.controlFunnel()
        if (!fn.total.seen) return ''
        const t = fn.total
        const r = fn.inRow
        // 漏斗**逐级报**,不报单一比率:每一级之间的落差各自对应一种毛病,合成一个数就又看不出
        // 是哪一环了(seen→planned 掉得多 = 认不出来;planned→clicked 掉得多 = 认出来了没做)。
        const lines = [
          `CONTROL FUNNEL — seen ${t.seen} → triaged ${t.planned + t.skipped} (${t.planned} to click, ${t.skipped} skipped) → clicked ${t.clicked}`,
          `  in-row (操作列): seen ${r.seen} → to click ${r.planned} → clicked ${r.clicked}`,
          t.untriaged ? `  ⚠ ${t.untriaged} control(s) never triaged — neither claimed nor declined; nothing explains why they were left.` : ''
        ]
        const owed = this.plannedNotClicked(6)
        if (owed.length) {
          lines.push(`  ⚠ claimed but NOT clicked: ${owed.map((m) => `${m.name} → ${m.controls.slice(0, 6).map((n) => `"${n}"`).join(' | ')}`).join(' ;; ')}`)
        }
        return lines.filter(Boolean).join('\n')
      })(),
      // 钻探的**正产物**进验收单(Ral 2026-08-17)。原来摘要有模块数、页面数、控件漏斗、
      // 非 GET、跳出清单 —— 唯独没有 apidoc,而那才是这一轮真正要的东西。
      //
      // 三个数同一行:摄到多少 / 其中新增多少 / 丢了多少。
      //   · `0 new` **照常打印** —— 在「开始钻探 = 重新钻探」的前提下,连续两轮 new 接近 0
      //     正是「这个站摄干净了」的客观读数,而那个信号原来完全读不到。
      //   · 丢失单独列 —— 只报成功数不是省略,是把损失藏起来
      //     (实测一个丢了 3 个端点的窗口,在人眼前是一个 ✅)。
      (() => {
        const t = this.ingestTally
        if (!this.ingestedWindows) return ''
        const lines = [
          `API INGEST — ${t.documented} endpoint(s) across ${this.ingestedWindows} window(s): ${t.created} new, ${Math.max(0, t.documented - t.created)} already known` +
            (t.lost ? ` · ⚠ ${t.lost} lost (never documented)` : '')
        ]
        if (t.keys.length) lines.push(`  new: ${t.keys.slice(0, 12).join(' | ')}${t.keys.length > 12 ? ` | …${t.keys.length - 12} more` : ''}`)
        return lines.join('\n')
      })(),
      this.offsite.length ? `${this.offsite.length} off-site exit(s) — on the do-not-visit list now` : '',
      this.writes.length ? `⚠ ${this.writes.length} NON-GET request(s) fired during exploration — review them: ${this.writes.slice(0, 5).map((w) => `${w.method} ${w.url}`).join('; ')}` : 'no non-GET requests observed',
      this.disagreements.length ? `${this.disagreements.length} extractor/agent disagreement(s) — this site's recall is NOT assumed, it is measured` : '',
      `journal: ${runPath}`
    ]
      .filter(Boolean)
      .join('\n')
    this.log('end', text.split('\n')[1])
    // 节流还原放在这里(而不是 isExploring 的 getter 里):`open = false` 是这条会话唯一的终点,
    // 而 getter 会被高频读,副作用不能挂在它上面。
    this.restoreDrillThrottling()
    this.open = false
    return { text, siteId: this.siteId, modules: this.modules, uncovered: this.uncovered, offsite: this.offsite, visited: this.visited.size, runPath }
  }

  stateText(): string {
    return [
      this.navState(),
      '',
      this.trailSummary(),
      '',
      this.openWork().length
        ? `worklist:\n${this.openWork().slice(0, 30).map((w) => `  · "${w.name}" ${w.url}`).join('\n')}`
        : 'worklist: empty',
      // 搁置项**必须露出来**:它们不阻塞收尾,但它们仍然是没打开过的地方 ——
      // 藏起来就等于"静默少覆盖",而那正是这次要修的病。
      this.worklist.some((w) => w.parked)
        ? `parked (look like nav shells — NOT blocking the end gate, but never opened; open one if you think it hides sub-pages):\n` +
          this.worklist.filter((w) => w.parked).slice(0, 20).map((w) => `  · "${w.name}" ${w.url}`).join('\n')
        : '',
      this.writes.length ? `observed writes:\n${this.writes.map((w) => `  · ${w.method} ${w.url}${w.after ? ` after "${w.after}"` : ''}`).join('\n')}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  }

  // ── bounded navigation, shared shape with v1 (wc.loadURL has no timeout of its own)
  private async navigate(wc: WebContents, url: string): Promise<'ok' | 'timeout' | 'failed'> {
    let timer: NodeJS.Timeout | null = null
    try {
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), 20_000)
      })
      const outcome = await Promise.race([wc.loadURL(url).then(() => 'ok' as const), timeout])
      if (outcome === 'timeout') {
        try {
          wc.stop()
        } catch {
          /* view may be gone */
        }
      }
      return outcome
    } catch {
      return 'failed'
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /**
   * 等页面安定下来。两个条件**都要**满足:文档不再加载 + 网络安静。
   *
   * 只等文档是不够的(这是 2026-08-14 之前的做法):`did-stop-loading` 是文档级事件,SPA 换路由
   * 不触发,表格数据那一发 XHR 它更看不见。结果是快照在数据回来之前就读了 —— 表格空的、操作列
   * 的按钮还没渲染,于是它们既不进控件台账、agent 也无从点击。
   *
   * 网络安静 = `inFlightRequests()` 连续 `QUIET_MS` 毫秒为 0。媒体类请求在录制入口就被挡掉了,
   * 所以一张慢图不会把这里吊住。仍然有总预算兜底:等不到安静也要走,**慢不能变成挂**。
   */
  private async settle(wc: WebContents, budgetMs = 8000): Promise<void> {
    const QUIET_MS = 700
    const startedAt = Date.now()
    await new Promise<void>((resolve) => {
      let idle: NodeJS.Timeout | null = null
      let poll: NodeJS.Timeout | null = null
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        if (idle) clearTimeout(idle)
        if (poll) clearInterval(poll)
        wc.off('did-stop-loading', arm)
        resolve()
      }
      // 文档侧:每次 did-stop-loading 重新计时。
      const arm = (): void => {
        if (idle) clearTimeout(idle)
        idle = setTimeout(tryFinish, QUIET_MS)
      }
      // 网络侧:**归零 或 连续 QUIET_MS 计数没有变化** 都算安定。
      // 只认"归零"曾经吊死过:一发收不到终点事件的请求就能让它永远等满预算(实测每次恰好卡在 1 发)。
      // 「计数不变」对这种挂着的请求免疫 —— 它不波动,所以不影响判定;而真的还在陆续发请求的页面
      // 计数一定在动,照样等得住。
      let lastCount = -1
      let steadySince = Date.now()
      const flyingNow = (): number => this.deps.inFlightRequests?.() ?? 0
      const settledEnough = (): boolean => {
        const flying = flyingNow()
        if (flying !== lastCount) { lastCount = flying; steadySince = Date.now(); return false }
        return flying <= 0 || Date.now() - steadySince >= QUIET_MS
      }
      const tryFinish = (): void => {
        if (settledEnough()) return done()
        arm()
      }
      // 叫停后不再等网络安定 —— 这一等最多 8 秒,而它夹在每一次落地里。
      if (this.aborted) return done()
      poll = setInterval(() => {
        if (this.aborted) return done()
        if (!this.deps.inFlightRequests) return
        if (settledEnough() && Date.now() - startedAt >= QUIET_MS) done()
      }, 150)
      wc.on('did-stop-loading', arm)
      arm()
      setTimeout(() => {
        const flying = this.deps.inFlightRequests?.() ?? 0
        // 超预算了还有在飞的 → 说出来。读到半成品页面时,这一行是唯一能解释"为什么表格是空的"的证据。
        if (flying > 0) this.log('settle-timeout', `page never went quiet: ${flying} request(s) still in flight after ${this.fmt(budgetMs)} — reading it anyway, the page may be half-rendered`, { flying, budgetMs }, 'warn')
        done()
      }, budgetMs)
    })
  }
}
