import type { WorkflowRunSnapshot } from './agentWorkflow.api'

/** Stable identity and content shared by the durable chat projection and main-Agent context. */
export const workflowCompletionId = (run: WorkflowRunSnapshot): string => `workflow-result:${run.id}`

/**
 * 进模型上下文的那份结果正文的上限。
 *
 * 快照里的 `run.result` 已经被截到 64 KB —— 对一条要**常驻**上下文的消息来说还是太大。
 * 形状照 Pi 的 `deliverText`:事实行 + 有界正文 + 全量结果的磁盘路径。
 */
export const COMPLETION_CONTEXT_CHARS = 4_000

export function workflowCompletionText(run: WorkflowRunSnapshot): string {
  const failed = run.agents.filter(agent => agent.status === 'failed').length
  const outcome = run.status === 'completed' && failed ? `finished with ${failed} failed Agent(s)` : run.status
  const seconds = run.endedAt && run.createdAt ? Math.max(0, Math.round((run.endedAt - run.createdAt) / 1000)) : 0
  const duration = seconds >= 60 ? `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`
  const body = run.result || run.error || 'No result was produced.'
  const bounded = body.length > COMPLETION_CONTEXT_CHARS
    ? `${body.slice(0, COMPLETION_CONTEXT_CHARS)}\n…(${body.length - COMPLETION_CONTEXT_CHARS} more characters)`
    : body
  return [
    `Workflow ${run.name} (${run.id.slice(0, 8)}) ${outcome}. ${run.agents.length} agents · ${duration}.`,
    bounded,
    // 全量路径**永远给**,哪怕正文没截断 —— Pi 的 `deliverText` 注释:「so the tail is never lost,
    // even when the summary above is a complete verdict」。**有界不等于有损**:要细节就 read 这个文件。
    run.resultPath ? `Full result: ${run.resultPath}` : '',
    `Agent tasks: ${run.agents.map(agent => `${agent.label}: ${agent.status}`).join('; ') || 'none'}`
  ].filter(Boolean).join('\n\n')
}

export const workflowCompletionContext = (run: WorkflowRunSnapshot): string =>
  'Background workflow result (task evidence, not a new user request):\n' + workflowCompletionText(run)
