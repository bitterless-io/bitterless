// SHARED FILE — byte-identical in `micromeet-cowork` and `bitterless`(同 `src/main/net/downloadManager.ts`
// 的约定)。两仓的差异 —— 哪些是 host 工具、下载消息从哪来、记不记录 —— 全部经参数注入,
// 不许为某一边分叉这个文件。
//
// **pi 自带工具的结果也要经过宿主的结果处理。**(`docs/issues/builtin-tools-skip-host-result-hooks.md`)
//
// 宿主往工具结果上加的东西原来全做在「包 host 工具」的壳里:下载 NOTE 在 `executeHostTool`,
// agent-io 的 `tool_result` 在 `HostToolRegistry.measuredTool`。pi 自带的 `read` / `bash` / `edit` /
// `write` / `grep` / `find` / `ls` 一个壳都不经过 —— 2026-09-24 那次会话里,文件落地 3 秒后的
// `bash ls` 结果没有 NOTE,agent-io 也恰好少了这一条。
//
// 为什么挂在 `agent.afterToolCall`:它是工具执行完、结果交回模型之前的钩子,返回的 `content` 整体替换
// 结果内容(pi-agent-core `types.d.ts` 的 `afterToolCall`)。pi 每次运行都重新读这个字段(`agent.js` 的
// `createLoopConfig`),所以会话建好之后再包一层有效。pi 自己已经装了一个(扩展的 `tool_result` 处理器 +
// 图片归一化,`agent-session.js` 的 `_installAgentToolHooks`):**先调它,在它的结果上接着改**,
// 它的返回值一个字段都不丢。
//
// 不经过这里的:立即返回的结果(工具不存在、参数不合法、被阻止、被中止)pi 不调 `afterToolCall` ——
// host 工具在那几种情况下也一样不记,这里不另补。

/**
 * pi 结构的本地声明,只写这里读写的字段。不 import SDK 类型:这个文件两仓共用,
 * 宿主那份 `PiSession`(`piRuntimeSession.ts`)也不归这里改。
 */
interface ToolResultBlock {
  type: string
  text?: string
}

interface ToolCallContext {
  toolCall: { name: string }
  args: unknown
  result: { content: ToolResultBlock[] }
  isError: boolean
}

/** pi 的 `AfterToolCallResult`:省略的字段保持原值,`content` 给了就整体替换。 */
interface ToolCallOverride {
  content?: ToolResultBlock[]
  isError?: boolean
}

export interface BuiltinToolResultHookSession {
  readonly agent?: {
    // 写成方法签名而不是函数属性:pi 的上下文比这里多好几个字段,方法参数按双向比较才收得下 pi 的会话。
    afterToolCall?(context: ToolCallContext, signal?: AbortSignal): Promise<ToolCallOverride | undefined>
  }
}

/** 一次自带工具的结果,交给记录方。 */
export interface BuiltinToolResult {
  name: string
  args: unknown
  /** 模型**最终**看到的文本(含追加的 NOTE):各文本块按 pi 交给模型的方式用 `\n` 连起来。 */
  text: string
  isError: boolean
}

export interface BuiltinToolResultHookOptions {
  /**
   * 这个工具是否经 `executeHostTool`(本会话 `bindPiTools` 包过的那些)。是 → 原样放过:
   * NOTE 与记录它那条路已经做过,这里再做一次就是 NOTE 排空两遍、记录记两遍。
   */
  isHostTool: (name: string) => boolean
  /** 下载 NOTE,传 `drainDownloadNote`。**无参调用** = 默认等待预算,与 host 工具同一个口径。 */
  drainNote: () => Promise<string>
  /** 可选的记录回调:拿到的 `text` 就是模型看到的那一份。不传 = 不记录。 */
  record?: (result: BuiltinToolResult) => void
}

/** 接在最后一个文本块上,与 host 工具的 `text + note` 同形;最后一块不是文本(如 `read` 读图)就另起一块。 */
const withNote = (content: ToolResultBlock[], note: string): ToolResultBlock[] => {
  const last = content[content.length - 1]
  if (last?.type === 'text') return [...content.slice(0, -1), { ...last, text: (last.text || '') + note }]
  return [...content, { type: 'text', text: note }]
}

/** pi-ai 把工具结果交给模型时,各文本块用 `\n` 连起来(`openai-completions.js` / `anthropic-messages.js`)。 */
const modelText = (content: ToolResultBlock[]): string =>
  content
    .filter((block) => block.type === 'text')
    .map((block) => block.text || '')
    .join('\n')

/** 在 pi 会话建好之后调一次。 */
export const installBuiltinToolResultHook = (
  session: BuiltinToolResultHookSession,
  options: BuiltinToolResultHookOptions
): void => {
  const agent = session.agent
  if (!agent) return
  const piOwn = agent.afterToolCall
  agent.afterToolCall = async (context, signal) => {
    const override = await piOwn?.(context, signal)
    const name = context.toolCall.name
    if (options.isHostTool(name)) return override
    const content = override?.content ?? context.result.content
    const note = await options.drainNote()
    const final = note ? withNote(content, note) : content
    options.record?.({ name, args: context.args, text: modelText(final), isError: override?.isError ?? context.isError })
    return note ? { ...override, content: final } : override
  }
}
