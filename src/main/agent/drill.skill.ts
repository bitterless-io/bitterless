import type { AgentSkillBrief } from '@main/agent/runtime/agentPrompt'

/**
 * 钻探 —— 内置文字技能。形状照 `deepFetch.skill.ts`:清单里一条简介,正文与它放在一起。
 *
 * **为什么搬出 `agentPrompt.ts`**(Ral 2026-09-18「钻探改为 builtin 技能」,执行 2026-09-16 的定案
 * 「肯定不搬啊,可以作为内置技能按需调用触发这个流程」):原来那 10,464 字符零插值、无开关地拼进
 * **每一条** user 消息,steering 再发一次,纯聊天会话也照发。2026-09-18 在 cowork 实测一条 `hi` 的 user 消息
 * 74,547 字符,这一段占 12.9%;本仓同一条路径、同一份文案(issues/turn-prompt-buries-the-user-message.md)。
 *
 * **为什么只留路由,删掉循环正文。** 循环怎么跑不是这里的知识 —— `explore_session {"action":"begin"}`
 * 的回包 `BEGIN_GUIDANCE`(`maestro/sitemap/exploreSession.service.ts`,7,956 字符)已经完整交付了:
 * observe→act 循环、`ui_act` 怎么用、`explore_record` 的 plan/module/module_done/expectedChildren、
 * 登录墙 `need_login`、分支新标签页、commit control、覆盖率判据与 `end` 的强制条件。**那是按需交付,
 * 时机也更对** —— 人真的开钻时才读到,而不是每次说句话都读一遍。
 *
 * 所以留在这里的只有 `begin` **之前**必须知道的路由,和 `end` **之后**才用得上的收尾纪律 ——
 * 这两头 `BEGIN_GUIDANCE` 都没有(实测:它 `start_recording` 0 次、`ingest_recording` 0 次、
 * `apidoc` 0 次、完成播报 0 次)。
 */
export const DRILL_BUILTIN_SKILL: AgentSkillBrief = {
  id: 'builtin:drill',
  name: '钻探 (Drill)',
  triggers: ['钻探', 'drill', '探站', 'explore this site', '钻探这个站', 'map this site', '自动探站', 'probe the site', 'discover the endpoints'],
  description:
    '对当前站点做一次完整钻探,产出站点地图(sitemap)+ 接口文档(apidoc),会覆盖已有产物。' +
    '内置流程,不用 get_skill_contract —— 按系统提示的钻探路由做:start_recording→explore_session begin/循环/end→ingest_recording。',
  // bl 的 `AgentSkillBrief` 这三项是必填(cowork 那边可选)。内置技能没有 recipe 文件,
  // 所以没有输入契约、没有种子、也没有缺项 —— 给空值而不是省略。
  inputs: [],
  seed: {},
  missing: []
}

/**
 * 钻探路由 —— 四步、续钻、收尾纪律。**不含循环正文**,那份在 `begin` 的回包里。
 */
export const DRILL_ROUTE = [
  '钻探 (DRILL) an unfamiliar site — the user may ask for this as 钻探 / 探站 / drill / explore / map / probe this site (中文或英文都算). There is no one-shot tool; YOU run the flow:',
  '1. start_recording {"mode":"api"} — 钻探 needs the traffic recorded, or there is nothing to ingest. SKIP this only if a recording is already running (the Capture 钻探 button starts it for you — explore_session state shows the recording dir). ' +
    'ONE recording spans the WHOLE drill. The host ingests it in WINDOWS as you go — a window closes when you mark a module done, and drilling continues into the SAME recording afterwards. So never stop or restart the recording between modules: a restart would orphan the traffic the next window is supposed to cover. ' +
    'If start_recording comes back with capturing:false it now tells you WHY in "error" — report that to the operator and stop; do not keep drilling into a recording that never started, because every endpoint you would have captured is lost silently.',
  '2. explore_session {"action":"begin"} — **its reply carries the full loop**: how to observe→act, how to record modules, what',
  '   finishes a drill, and the login-wall / branch-tab / commit-control rules. Read it and follow it; it is the authority on the',
  '   loop, not this block. explore_session {"action":"state"} whenever unsure where you are.',
  // `BEGIN_GUIDANCE` 覆盖了循环的一切,但**这两条它没有**(实测:`uncovered` 0 次、`ENFORCED` 0 次)。
  // 不写在这里的话,模型只能靠撞 `end` 的拒绝才知道自己还没完 —— 那是可恢复,但白跑一轮。
  '   END IS GATED: explore_session {"action":"end"} is REFUSED while any branch is open, while the host still has harvested',
  '   places you have not opened, and while you have discovered zero. Settle a place you deliberately will not open with',
  '   explore_record {"uncovered":{"url":"…","reason":"…"}} — that is a legitimate outcome, being silent about it is not.',
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
  // 「接着钻某几块」是常见的第二轮诉求(第一轮预算到顶/被兜底收尾之后)。不给它一个显式入口的话,
  // agent 只能重钻整站,把已经探过的地方再走一遍(Ral 2026-08-14)。
  'CONTINUING PART OF A SITE: when the user names which parts to drill ("接着钻 Settings 和 Billing", "只钻 Reports 相关的", "钻一下权限那块"), pass them as focus: explore_session {"action":"begin","focus":"Settings, Billing"}. RESOLVE THEIR WORDING TO REAL LABELS FIRST: read the page, find the entries they actually mean, and pass those entries\' own text verbatim — the host matches focus as plain substrings against each place\'s name and url, so a paraphrase that appears nowhere on the site matches nothing and you would drill an empty scope. If their wording is ambiguous between two entries, take both. That SCOPES the run — a place counts only if it matches one of those or was reached by clicking through one that did, so the named parts still get drilled to full depth while the rest of the site is skipped. The begin output tells you the run is scoped; when it is, "no places left" means THAT FOCUS is covered, not the site. Say so when you report. Omit focus for a normal full drill — and never invent a focus to make a run finish sooner.',
  'Already-explored site: read it with the sitemap tool instead of drilling again.'
].join('\n')
