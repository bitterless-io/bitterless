/**
 * **业务模块日志**(Ral 2026-08-16:「日志应该分为业务模块指定需要去记录日志的地方,以及主进程
 * 默认的日志,以及各个进程自己的日志」)。
 *
 * 三层里前两层本来就有(`log.setup.ts`):
 *   · **各进程自己的** —— 每条记录带 `proc` / `world`,渲染层经 preload logger 汇进同一份文件,
 *     被浏览的页面则单独进 `webview/<domain>/<date>.log`;
 *   · **主进程默认** —— `Object.assign(console, log.functions)`,main 里所有 `console.*` 自动落盘。
 *
 * 缺的是第三层:**模块自己指定"这里要留一条"**。机制其实一直在 —— `toRecord` 会把消息开头的
 * `[tag]` 解析成 `scope` 字段 —— 但没人系统地用,于是想查"录制这条线今天发生了什么"只能全文
 * grep 中文,查不准也漏。这个文件把那条约定变成一个有类型的入口。
 *
 * 为什么用 `console.*` 而不是直接调 electron-log:main 的 console 已经被 `initLogging()` 换成了
 * log.functions,走 console 等于**零新增管道**,而且开发时终端里照样看得见。
 *
 * 查法(NDJSON,一行一条):
 *   grep '"scope":"capture"' <日志目录>/main-YYYY-MM-DD.log | jq -r '.ts + " " + .msg'
 *   日志目录用 Workbench ▸ Log 里那个路径(getLogPaths),不要在这里写通配路径 ——
 *   路径里的 星号+斜杠 会把这段块注释提前关掉,整个文件当场语法错(2026-08-16 踩过)。
 */
export type LogScope =
  /** 录制生命周期:开/停/换目标、下载拦截。 */
  | 'capture'
  /** 钻探状态机:地点、控件、支线、摄取窗口。 */
  | 'drill'
  /** 聊天会话归属:哪个 tab 对应哪个会话、什么时候换的。 */
  | 'chat-session'
  /**
   * 文档解析的**路由判定**:这一份文件是 anydoc 本地解析的、发给 relay 让百炼读的、还是命中缓存的。
   * Ral 2026-09-01:「通过日志能看到文字走 anydoc、图片版 pdf 走 relay 接口」—— 所以它是一等日志,
   * 每份文件恰好一条(docs/features/agent-document-parsing.md #8)。
   */
  | 'doc-parse'
  /**
   * 自动更新全链路:两道闸门的判定、静默下载、broadcast/recv 配对、两段式安装。
   * main 与 home 渲染层共用这一个 scope —— 渲染层自己拼 `[update]` 前缀(它走 console-message
   * spy,只有渲染后的文本能过来),`proc`/`world` 已经把两侧分开了。
   */
  | 'update'
  /**
   * 上下文审计文件的**写入规格**:哪个会话、多少条目、多少字符、落在哪个天文件、有没有轮转掉旧文件。
   * 正文**不**进这里 —— 正文在 `<userData>/context-audit/<date>.jsonl` 里
   * (docs/features/cowork-slash-commands.md #4)。日志记"记了什么规格",不重复一份内容。
   */
  | 'context-audit'
  /**
   * 取页两条路:`web_fetch`(HTTP 直取)与 `deep_fetch`(隐藏窗口渲染)。
   *
   * 每次取页的行数是**约定好的**:
   *   · `web_fetch` —— 成功 1 行(服务层)或失败 1 行(工具层),二者互斥;
   *   · `deep_fetch` —— `start` 1 行 + 结果 1 行。**开始行是必须的**:它会开渲染进程且可能挂住,
   *     挂住时结果行永远不出现,那时唯一能证明它跑过的就是开始行。
   *   · 闸门动作(下载/重定向/权限被拦、challenge 换 UA 重试、快照拿不到)各自额外一行 warn。
   *
   * 每行都带 **requested 与 final 两个 URL**(重定向可能换了源,只记一个等于记错)、字符数、
   * 快照节点数、耗时。失败只在工具层记,服务层只记成功 —— 两处都记会让一次失败出现两行。
   * **URL 只留 origin + path** —— query 里常带签名与 token,与 `downloadGuard` 的 narrowUrl 同口径。
   * **绝不记页面正文**:那是不可信的第三方内容,不进日志。
   */
  | 'deep-fetch'
  /**
   * 主进程健康心跳:事件循环延迟、本次 tick 实际间隔、内存与各进程占用。
   * 它存在的理由是「卡住」在日志里本来只是一段空白 —— 空白既可能是主进程被阻塞,也可能只是在等
   * 网络,两者产物一模一样。这个 scope 让那段空白自己说话
   * (与 cowork 同源,docs/issues/main-process-hang-has-no-diagnostics.md)。
   */
  | 'health'
  /**
   * Tab 别名表单的整条链:菜单点击 → 请求 → 覆盖层建/载/挂 → 渲染层答复 → 写回 tab。
   *
   * 每一步一行,**包括成功的步**。理由是一次真实失败:`promptTabAlias` 把 controller 的方法摘进
   * 局部变量再调,丢了 `this`,于是同步抛 TypeError、被菜单 handler 的 `void` 吞掉 —— 点了没反应,
   * 而从菜单到表单整条线一行日志都没有,只能读源码猜(docs/issues/maestro-tab-alias-does-nothing.md)。
   * 成功的那几行是这条线的基线:没有它们,「走到哪一步断的」永远答不了。
   */
  | 'tab-alias'

export interface ModuleLogger {
  info(msg: string, detail?: Record<string, unknown>): void
  warn(msg: string, detail?: Record<string, unknown>): void
  error(msg: string, detail?: Record<string, unknown>): void
}

/**
 * `detail` 单独作为第二个参数传,不拼进 msg —— `toRecord` 会把它放进 `args`,于是 `msg` 保持
 * 可读、可 grep,而结构化字段仍然拿得到。拼成一句话的话两者都会失去。
 */
export const moduleLog = (scope: LogScope): ModuleLogger => {
  const emit = (level: 'log' | 'warn' | 'error', msg: string, detail?: Record<string, unknown>): void => {
    if (detail && Object.keys(detail).length) console[level](`[${scope}] ${msg}`, detail)
    else console[level](`[${scope}] ${msg}`)
  }
  return {
    info: (msg, detail) => emit('log', msg, detail),
    warn: (msg, detail) => emit('warn', msg, detail),
    error: (msg, detail) => emit('error', msg, detail)
  }
}
