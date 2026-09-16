import { createWorkflow, createStep } from '@kimchi-dev/kimchi-workflows/flow'
import { Type } from 'typebox'
import { createAgentTask, type AgentOutcome } from '../author'
const roles = [
  ['implementation', '实现建议', '列出三个最小实现步骤'],
  ['acceptance', '验收标准', '列出三个具体、可执行的验收标准'],
  ['risks', '边界风险', '列出三个边界情况与处理建议']
] as const
export default createWorkflow({ name: 'mini-demo', description: '三个真实 Pi Agent 并行分析，再由独立 Agent 汇总；停止的分支明确列为缺失。', input: Type.String(), maxConcurrency: 3 })
  .parallel(roles.map(([name, label, task]) => createAgentTask({ name, label, input: Type.String(), output: Type.Array(Type.String()), tools: [], retries: 0, thinkingLevel: 'low', prompt: ({ input }) => `需求：${input.trim() || '设计一个可新增、勾选完成和删除待办的最小清单'}\n${task}，用中文简短回答。只分析，不执行文件、命令或外部工具；分析完成后必须调用 workflow_submit_result 提交结果。` })), { name: 'analysis' })
  .then(createAgentTask({ name: 'synthesize', label: '汇总', output: Type.String(), tools: [], retries: 0, thinkingLevel: 'low', prompt: ({ ctx }) => `原始需求：${ctx.getInitData<string>()}\n角色分工：implementation=实现建议，acceptance=验收标准，risks=边界风险；它们是互补视角，不代表三方共识。只分析，不执行文件、命令或外部工具。\n用中文在 350 字内给出简短建议、验收和风险。只使用 status=completed 的 output；逐个说明 stopped/failed 的分支，不能补写缺失结论或虚构共识。必须调用 workflow_submit_result 提交字符串结果。\n${JSON.stringify(ctx.getStepResult('analysis'))}` }))
  .then(createStep({ name: 'report', run: ({ ctx }) => {
    const analysis = ctx.getStepResult<Record<string, AgentOutcome<string[]>>>('analysis') ?? {}
    const synthesis = ctx.getStepResult<AgentOutcome<string>>('synthesize')
    const missing: Array<{ name: string; status: string; error?: string }> = Object.entries(analysis).filter(([, outcome]) => outcome.status !== 'completed').map(([name, outcome]) => ({ name, status: outcome.status, error: 'error' in outcome ? outcome.error : undefined }))
    if (!synthesis || synthesis.status !== 'completed') missing.push({ name: 'synthesize', status: synthesis?.status ?? 'failed', error: synthesis && 'error' in synthesis ? synthesis.error : 'Missing summary' })
    return { partial: missing.length > 0, summary: synthesis?.status === 'completed' ? synthesis.output : '汇总不可用', analysis, missing }
  } })).commit()
