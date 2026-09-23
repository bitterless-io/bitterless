import { BaseAgent } from '@main/agent/BaseAgent';
import { STATIC_TURN_GUIDANCE } from '@main/agent/runtime/agentPrompt';

/**
 * Chat 的表 2 产品层 —— 只放**会话级静态指引**,角色与模型身份仍由表 1 提供。
 *
 * 这里原来是空的(`extends BaseAgent {}`),于是逃生阀、浏览器纪律、检索纪律、技能匹配与钻探路由
 * 全都拼在**每一条** user 消息上。它们零插值、与本轮无关,聊 N 轮就重发 N 遍
 * (`overmind:areas/agent-runtime/chat/compaction/compaction-closeout1.md` B4)。
 * 按表 3 的契约每轮只该有 D1–D4,常量属于系统提示词。
 *
 * **为什么落在这里而不是 pi 的 `getAppendSystemPrompt()`**:`fullSystemPrompt()` 是每个 runtime
 * 共用的装配点,而那个钩子只属 pi 的资源加载器。技能目录(A8)另走那条路,因为它要随
 * `session.reload()` 重建;这些常量永不变,不需要。
 */
export class MaestroAgent extends BaseAgent {
  /**
   * 表 2 = 恒定指引 + **会话级技能指引**(内置文本流程清单 / 安装与创作纪律)。
   *
   * 后者原来也拼在每一条 user 消息上。换 workspace 时随系统提示词和 cwd 更新，
   * 原会话文件保留历史。与 cowork 的 `CoworkAgent` 成对。
   */
  protected systemPrompt(): string {
    // 根目录传这个 agent 自己绑定的那个 —— 与 cwd 同源。让回调按 sessionKey 再查一次会拿到
    // 未绑定时的默认工作区,把作者根目录和 cwd 指到两个地方(cowork 2026-09-22 实测)。
    return [STATIC_TURN_GUIDANCE, `Active workspace: ${this.projectRoot ?? this.opts.cwd}\n${this.projectRoot ? 'Use this user-selected workspace for all relative paths and generated files.' : 'No workspace selected. Use this shared work directory for all relative paths and generated files.'}`, this.opts.skillGuidance?.(this.projectRoot)]
      .filter(Boolean)
      .join('\n\n');
  }
}
