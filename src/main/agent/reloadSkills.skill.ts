import type { AgentSkillBrief } from '@main/agent/runtime/agentPrompt'

/**
 * 内置文字流程,没有录制配方 —— 只有一步:调 `reload_skills`。
 *
 * 之所以做成 builtin 技能而不是 UI 里的斜杠命令(Ral 2026-09-22「先做一个 /reload-skills
 * 这是最小范围的需求,并配置为 built in 技能」):builtin 技能不需要动 UI 与跨进程通道,
 * 用户打 `/reload-skills` 或说「技能更新了」都能命中,两端共用同一份定义。
 */
export const RELOAD_SKILLS_BUILTIN_SKILL: AgentSkillBrief = {
  id: 'builtin:reload-skills',
  name: '重载技能 (Reload Skills)',
  triggers: ['/reload-skills', 'reload skills', '重载技能', '刷新技能', '技能更新了', 'reload-skills', 'refresh skills'],
  // 本仓的 AgentSkillBrief 把这三项定为必填;内置流程没有录制输入,给空值。
  // (CoWork 的同名类型没有这三项,那边的副本相应少这三行 —— 既有 builtin 技能文件两端本就不同形。)
  inputs: [],
  seed: {},
  missing: [],
  description:
    '内置文字流程,不用 get_skill_contract:直接调 reload_skills 重扫磁盘上的技能库并重建本会话的技能目录。' +
    '用在 SKILL.md 被应用外部改过(编辑器、git pull、别的 agent 会话)之后 —— 那类改动对已开着的会话不可见。' +
    '经本应用自己的技能工具做的改动会自行刷新,不需要它。新目录从下一条消息起生效,不在本回合内。'
}
