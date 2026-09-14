import type { PiToolSpec } from '@main/agent/BaseAgent'

/**
 * 钻探这三个工具的执行体落在谁身上 —— **结构接口,不 import 服务本体**。
 *
 * 工具表只该知道「有人能执行」,不该知道那个人是怎么组装的:结构接口让 `agent/tools/` 与
 * `agent/workflow/` 之间没有编译期依赖。
 *
 * (记一条容易被过度概括的约束:`hostToolRegistry.ts:1-2` 那句"本目录用相对 import"只管
 * **`BaseAgent.ts` 自己的 import 图** —— `check-agent-activity` 只 transpile + vm 跑 BaseAgent
 * 一个文件、逐个给它的相对依赖打桩。本文件不在那张图里,用 `@main` 别名是安全的。)
 */
export interface DrillToolHost {
  toolExploreSession(params: { action: string; startUrl?: string; tabId?: string; focus?: string[]; sessionKey?: string }): Promise<string>
  toolExploreVisit(params: { url?: string; tab?: string; from?: string }): Promise<string>
  toolExploreRecord(findingsJson: string): Promise<string>
}

/**
 * 钻探的三个 pi 工具:`explore_session`(开/关一轮)· `explore_visit`(走一步)·
 * `explore_record`(记发现 + 排下一步)。
 *
 * 从 `mainWindow.controller.ts` 的 `buildPiTools()` 整段搬来,**描述文案一字未改** ——
 * 那些文案就是钻探的产品逻辑本身(什么算模块、什么时候算钻完、控件三分类),改一个词就改了行为。
 *
 * `sitemap` 工具**故意留在原处**:它读的是已探完的产物,归未来的 workbench 模块。
 */
/**
 * `focus` 参数的解析:模型会按自己的习惯给 JSON 数组、也会给逗号分隔的一句话,两种都收。
 * 不做归一化(大小写/空白之外)—— 匹配在 exploreSession 里按子串做,过度加工反而会把
 * "Settings › Billing" 这种带分隔符的写法弄坏。
 */
const parseFocusList = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map((v) => String(v ?? '').trim()).filter(Boolean)
  const text = String(raw ?? '').trim()
  if (!text) return []
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) return parsed.map((v) => String(v ?? '').trim()).filter(Boolean)
    } catch {
      /* 不是合法 JSON → 当成普通逗号分隔的一句话 */
    }
  }
  return text.split(/[,、;;]/).map((v) => v.trim()).filter(Boolean)
}

export const buildDrillTools = (host: DrillToolHost, sessionKey: string | undefined): PiToolSpec[] => [
    {
      name: 'explore_session',
      description:
        'Agent-driven site exploration (v2) — YOU drive the walk, the host only keeps state. action: "begin" | "state" | "end" | "need_login".\n' +
        '"begin" opens a session on the current site and returns the navigation log + the site\'s rules + the first page\'s COMPLETE anchor list and controls. ' +
        '"state" reports drill_tabs with mainTabId, currentTabId, activeTabIds and member lifecycle, plus the navigation log and worklist. Drilling controls its listed tab IDs independently of the human foreground. Unselected human tabs are excluded. Call it whenever you are unsure where you are. ' +
        '"end" writes the run journal and closes. ' +
        '"need_login" PAUSES the drill and asks the user to log in — call it when the app requires login and you are BLOCKED from its content; it returns once the user has logged in (they click 继续, or login is auto-detected).\n' +
        'The loop is yours: read the page, decide what is a module and what is a function, queue what to visit next with explore_record, go there with explore_visit. ' +
        'You MAY click controls (page_snapshot + ui_act) — judge from the page context whether a control writes business data, and when you get it wrong, record a dontClick rule immediately so it is never offered again.',
      params: [
        { name: 'action', required: false, description: 'begin | state | end | need_login (default state).' },
        { name: 'start_url', required: false, description: 'begin only — where to start (default: the current page).' },
        {
          name: 'focus',
          required: false,
          description:
            'begin only — SCOPE this run to part of the site. A comma-separated list (or JSON array) of module names / url fragments, e.g. "Settings, Billing". ' +
            'A place is in scope when it matches one of them OR was reached by clicking through one that did, so a focused part is still drilled to full depth. ' +
            'Everything else is skipped and stays unexplored, and the run reports itself as scoped — "no places left" then means "this focus is covered", not "the site is covered". ' +
            'Use it ONLY when the user asked for specific parts (e.g. "接着钻 Settings 和 Billing"); omit it for a normal full drill.'
        }
      ],
      // sessionKey 一路带进来:钻探的 token 预算要按【驱动它的那个 agent 回合】读用量账本。
      execute: async (args) =>
        host.toolExploreSession({
          action: String(args.action ?? 'state'),
          tabId: args.tab_id ? String(args.tab_id) : undefined,
          startUrl: args.start_url ? String(args.start_url) : '',
          focus: parseFocusList(args.focus),
          sessionKey
        })
    } as PiToolSpec,
    {
      name: 'explore_visit',
      description:
        'Go to one URL inside the exploration session (or "back" to undo a wrong turn), and get the page evidence back: the COMPLETE anchor list, the controls, and the navigation log. ' +
        'It refuses a URL that leaves the target site or that a site rule forbids, and it tells you when a same-site URL got REDIRECTED off-site so you can recover instead of reading a stranger\'s page. ' +
        'Use "back" the moment the navigation log says you are off the target site or the menu you expected is gone (a standalone page such as login/profile). ' +
        'MULTI-TAB: when a page opens in a NEW TAB (target=_blank / window.open), it joins as a background branch and the nav log lists it. An explicit tab selection takes over that page and adds it to this drill; merely opening a human tab does not. Pass tab to switch: {"tab":"<id>"} explores that tab (its traffic is recorded too), {"tab":"home"} returns to your starting tab. Explore same-site new tabs, then {"tab":"home"} to continue — your exploration state spans all same-site tabs. For an off-site new tab, {"tab":"home"} (NOT "back": a fresh tab has no history).',
      params: [
        { name: 'url', required: false, description: 'Absolute or relative URL, or the literal "back". Omit when using tab.' },
        { name: 'tab', required: false, description: 'A tab id from the nav log, or "home" for your starting tab. Selects this drill target and reads it without switching the human foreground.' },
        { name: 'from', required: false, description: 'The anchor/menu name you followed — used in the journal and in uncovered entries.' }
      ],
      execute: async (args) =>
        host.toolExploreVisit({
          url: args.url ? String(args.url) : '',
          tab: args.tab ? String(args.tab) : '',
          from: args.from ? String(args.from) : ''
        })
    } as PiToolSpec,
    {
      name: 'explore_record',
      description:
        'Record what you found, and queue what to do next. Pass a JSON object with any of: ' +
        'module {name,url,level,parentUrl,standalone,expectedChildren} — expectedChildren = how many SUB-MODULES you can see this module has (its side-panel / tab-strip / section entries); 0 if none. Modules NEST to whatever depth the site actually has, so record each sub-module too, with parentUrl pointing at its parent. module_done is refused while children found on that module\'s own page are still unopened, or while you recorded fewer children than you predicted. · functions [{name,verb,object,rowLevel,moduleUrl,function_id,renamed_from,why}] · retired [{function_id,why}] · worklist_add [{url,name,parentUrl}] · ' +
        'dont_click [{value,reason}] — ONLY for a COMMIT CONTROL you actually SAW persist a change (activating it changed the stored data). A control that merely opens or loads something is not one and must NEVER get a rule: that load is usually the only way its endpoint is ever seen. Rules are PERMANENT, inherited by every future session, and matched by name — so a rule written on a short generic word silently blocks that control across the whole site forever. Give the narrowest name that identifies the committing control; if you are only suspicious, write NO rule and simply leave it alone this time. · ' +
        'plan {click:["name",..], skip:[{name,reason}]} — CONTROL TRIAGE for the page you are on: every clickable control the page read listed gets exactly one of the two verdicts, by its exact name. ' +
        'This is the middle of the funnel the operator reviews — the host counts what it SHOWED you and what you actually CLICKED, but only you can say what you judged clickable. ' +
        'A control in neither list reads as "never considered", which is the one outcome no review can explain. Send the plan right after reading a page, then work the click list. · ' +
        'dont_visit [{value,reason}] · search_values [".."] (values seen ON the page that are safe to type into a search box) · ' +
        'observed_write {method,url,after} (a non-GET fired — record it even if you think it was harmless) · disagreement {extractor,agent,note} (the menu you SEE has more items than the anchor list — this is how this site\'s recall gets measured) · uncovered {name,url,reason,detail} · ' +
        'module_done {url} — a LABEL, not the finish line: it tidies the sitemap once you have covered a module. What actually ends the drill is coverage of PLACES — every link the host harvested from this site opened (or settled with uncovered), and no branch left open. Labelling everything done while places remain unopened changes nothing. (Rejected only if the module was never recorded or never reached.) ' +
        'note ".." — ONE short sentence, in the operator\'s language, saying what you just learned or are doing next. It is shown live to the operator alongside the module you discovered / finished, so send it with every module and module_done. ' +
        'Nothing is inferred for you: the host stores exactly what you report. ' +
        'FUNCTION IDENTITY — when a page lists "already known here" handles (fnp_NN) from a previous exploration, decide for each control whether it IS one of them: ' +
        'pass that function_id to say "same function point, it just looks/reads different now", or omit function_id to mint a new identity. ' +
        'A handle is what bindings point at, so claiming correctly is what keeps a renamed button from losing its API bindings. ' +
        'If you claim a handle whose verb/object/name differs from the listed line, renamed_from AND why are BOTH required — the claim is refused without them. ' +
        'That asymmetry is deliberate: wrongly SPLITTING one function into two is visible (an orphan), wrongly MERGING two functions into one is silent and corrupts both. When unsure, omit function_id. ' +
        'Use retired for a function point that no longer exists on the page — its handle and bindings are kept and shown as orphans, never deleted.',
      params: [{ name: 'findings_json', required: true, description: 'JSON object with any of the keys above.' }],
      execute: async (args) => host.toolExploreRecord(String(args.findings_json ?? ''))
    } as PiToolSpec
]
