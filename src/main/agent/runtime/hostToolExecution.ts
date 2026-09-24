import type { AgentToolSpec } from './agentRuntime.types'
import { sanitizeRuntimeError } from './errorSanitizer'
import { drainDownloadNote } from '@main/net/downloadManager'

export type HostToolExecutionEvent =
  | { status: 'success'; durationMs: number; outputChars: number }
  | { status: 'error'; durationMs: number; error: string }

/**
 * Execute the host tool once; providers only encode the returned observation.
 *
 * 这里是**每一个宿主工具返回的唯一汇合点**,所以网页下载的落地消息挂在这里而不是某个工具里:
 * agent 点完下载按钮之后下一步调什么都可能(`page_snapshot` / `bash` / `read_file`),
 * 挂在单个工具上就会漏(docs/features/browser-downloads.md #1.2)。
 *
 * **成功与失败两条路都要挂。** 抛错结束的那次返回(被中止、被宿主闸拒绝、工具自己炸了)同样是
 * agent 下一眼看到的东西;只挂成功分支,下载消息就会恰好在那种返回上缺席。
 *
 * **为在途下载多等多久，由工具定。** 没声明 `downloadSettleMs` 的照旧最多等 15 秒;`wait` 声明 0 ——
 * NOTE 照附，只是不再多等，否则 `wait {ms: 3000}` 会变成 3 秒加最多 15 秒(docs/features/builtin-wait-tool.md #2)。
 */
export const executeHostTool = async (
  tool: Pick<AgentToolSpec, 'execute' | 'downloadSettleMs'>,
  params: Record<string, unknown>,
  onResult?: (event: HostToolExecutionEvent) => void,
  signal?: AbortSignal
): Promise<{ text: string; durationMs: number }> => {
  const startedAt = Date.now()
  try {
    signal?.throwIfAborted()
    const text = (await tool.execute(params || {}, signal)) + (await drainDownloadNote(tool.downloadSettleMs))
    const durationMs = Date.now() - startedAt
    onResult?.({ status: 'success', durationMs, outputChars: text.length })
    return { text, durationMs }
  } catch (err) {
    const durationMs = Date.now() - startedAt
    const error = sanitizeRuntimeError(err instanceof Error ? err.message : String(err), 'tool')
    // 播报给宿主的是**干净的错误**;下载消息只拼进抛给模型的那一份。
    onResult?.({ status: 'error', durationMs, error })
    throw new Error(error + (await drainDownloadNote(tool.downloadSettleMs)))
  }
}
