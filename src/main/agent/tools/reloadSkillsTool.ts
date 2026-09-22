import type { AgentToolSpec } from '@main/agent/runtime/agentRuntime.types'

/**
 * `/reload-skills` 的执行面。对应 builtin 技能 `builtin:reload-skills`。
 *
 * **为什么需要它**:技能目录是会话级常量(表 1 A8),只在**新建会话**或**显式 reload** 时重建。
 * 宿主自己改技能会让 `resourceRevision` 变、下一条消息自动重载;但**在应用外面**直接改磁盘上的
 * SKILL.md(编辑器、git pull、另一个 agent 会话)不会碰到宿主缓存 —— 那种改动在本会话里
 * 一直看不见,只能新开 Chat。这个工具就是补那一口。
 *
 * **按 pi 来**:pi 的 `/reload` 是 `AgentSession.reload()` → `_resourceLoader.reload()` +
 * `_buildRuntime()`。宿主这边同形:先让 registry 重扫磁盘,`resourceRevision` 随之变化,
 * `PiRuntimeSession.prompt()` 在下一条消息前就会调 `session.reload()`,A8 目录连同工具表一起重建。
 *
 * **为什么不在工具里直接调 `session.reload()`**:这个工具是在 agent 循环**当中**执行的,
 * 而 `reload()` 会重建扩展运行器与工具注册表 —— 在工具正跑着的时候换掉它们不安全。
 * pi 自己的 `/reload` 也是回合之间跑的 TUI 命令,不是回合内的工具。
 */
export interface ReloadSkillsToolHost {
  /** 重扫磁盘并返回新快照的规模与版本。 */
  reload(): { skills: number; revision: string }
  /** 重扫之前的规模与版本,用于报告差异。 */
  current(): { skills: number; revision: string }
}

export const buildReloadSkillsTool = (host: ReloadSkillsToolHost): AgentToolSpec => ({
  name: 'reload_skills',
  description:
    'Rescan the skill libraries from disk and rebuild this Chat\'s skill catalog. Use it when SKILL.md files were changed OUTSIDE this app — an editor, git pull, or another agent session — because those edits are invisible to an already-running Chat. Edits made through this app\'s own skill tools already refresh themselves and do not need this. Returns the catalog size and revision before and after; the refreshed catalog reaches the model on the NEXT message, not inside this turn.',
  params: [],
  // 不取 signal:两端 `execute` 的第二参数形状不同(CoWork 是 `{ signal, confirm }`,
  // BL 是 `signal` 本身),而重扫是同步的、没有可中断点 —— 不用它,这个文件才能两端字节一致。
  execute: async () => {
    const before = host.current()
    const after = host.reload()
    return JSON.stringify({
      before,
      after,
      changed: before.revision !== after.revision,
      added: after.skills - before.skills,
      // 说清楚生效时机,免得模型在同一轮里以为目录已经换了、据此回答。
      note: before.revision === after.revision
        ? 'No change on disk; the catalog is already current.'
        : 'Catalog rescanned. The rebuilt catalog is in the system prompt from the next message onward, not in this turn.'
    })
  }
})
