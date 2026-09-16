// 【喂给模型的内容,必须留在磁盘上】—— Ral 2026-08-20:
// 「给大模型输入的内容,哪怕它超出了大模型窗口限制,也应该留在 jsonl 里面。」
//
// 为什么这条是硬要求:pi 的会话是 `SessionManager.inMemory()`(piRuntimeAdapter),
// 对话历史只在内存里。于是 `context_length_exceeded` 打死一轮之后**零证据** ——
// 连"哪个工具的哪一笔撑爆了"都无从查证(见 issues/context-overflow-not-attributable.md)。
// inputBudget 那个账本只记**构成**(字节数 + 短标签),而结构化数据的分片方案需要**看原始数据**,
// 光有分布不够。
//
// 与录制(traces/)刻意分开的两个理由:
//   ① 钻探启动会**清空当前录制**(「开启探站要清空当前的录制」),而这份日志恰恰要在
//      下一轮开始之后还能被翻出来 —— 放进录制目录等于让新一轮抹掉上一轮的失败证据;
//   ② 录制记的是**页面与网络发生了什么**,这里记的是**模型看到了什么**。
//      两者内容重叠但口径不同:录制里有的东西未必进过上下文,进过上下文的也不都来自录制
//      (系统提示、工具入参、宿主拼的提示词都不在录制里)。
//
// ⚠ **数据落盘的边界**:这里写的是模型真实看到的内容,钻探时其中含目标站点的业务数据。
// 落盘是 Ral 明确要求的(上面那句原话),范围限定在本机 userData;
// 保留策略见 RETAIN_SESSIONS —— 只留最近若干轮,不无限堆。

import { appendFile, mkdir, readdir, rm, stat } from 'fs/promises'
import { join } from 'path'

/**
 * agent-io 证据链的落盘根目录。
 *
 * SDK 不认识 Electron,所以由宿主在 boot 时注入一次;`micromeet-cowork` 传的是
 * `join(app.getPath('userData'), 'agent-io')`，Bitterless 使用同一目录规则。
 * **不调 = 不落盘**，不会退到某个临时目录去 —— 见 `root()` 里的说明。
 */
let resolveIoRoot: (() => string) | null = null
let warnedNoRoot = false

export const setModelIoRoot = (resolve: () => string): void => {
  resolveIoRoot = resolve
  warnedNoRoot = false
}
import { currentAgentSessionKey } from './agentSessionContext'

/** 单个 part 的大小上限。到了就换下一个 —— 与录制的 PART_MAX_BYTES 同一思路,只是这里的行更大。 */
const PART_MAX_BYTES = 8 * 1024 * 1024
/** 保留最近多少个会话目录。超出的从最旧的删 —— 无限堆盘不是"完整留存",是把磁盘当垃圾桶。 */
const RETAIN_SESSIONS = 20
/**
 * 总字节上限。**条数上限一个人挡不住** —— `PART_MAX_BYTES` 只管单个 part,一个会话的 part 数不限,
 * 于是 20 个会话也不限。而这份日志的立身之本是「原文不截断」:一轮两小时的钻探每回合把整个上下文
 * 原样落盘,单会话上百 MB 是正常量级。盘上现在只有几百 KB,那是因为这些都是短会话,**不是因为有闸**。
 *
 * 取值与 `logRetention.MAX_TOTAL_BYTES` 一致(同一套策略形状:**条数或总量,谁先触发谁生效**)。
 * 刻意不把这棵树塞进 `logRetention` —— 那边是 `.log` + `webview/<domain>/` 两层目录的形状,
 * 教它认第三种结构只会让两边都变脆。
 *
 * ⚠ 这个数必须远高于 `check-behavior-model-io-log.mjs` 第 ③ 步造的 12MB(40×300KB 写进同一个会话),
 * 因为它第 ④ 步要断言那个目录还在 —— 「下一轮不许抹掉上一轮的失败证据」那条断言是对的。
 */
const MAX_TOTAL_BYTES = 200 * 1024 * 1024

/** 目录名里的会话段:只留文件名安全字符,空了给个占位 —— 目录名不许被会话 id 决定成非法路径。 */
const safeSessionSegment = (value: string): string =>
  (String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || UNATTRIBUTED_IO_SESSION)

export type ModelIoKind = 'prompt' | 'tool_result' | 'turn_end' | 'note'

export interface ModelIoLine {
  ts: number
  /** 第几个回合(与 inputBudget 的 turnIndex 同一个计数)。 */
  turn: number
  kind: ModelIoKind
  /** tool_result 时是工具名;prompt 时是 provider/model。 */
  name: string
  /** 白名单拼出来的短标签(url / module / …),便于 grep。 */
  subject: string
  bytes: number
  /** **原文**。这就是这份日志存在的全部理由 —— 分片方案要看原始数据,不是看摘要。 */
  text: string
  /** turn_end 时带上归因报告与错误(如果有)。 */
  detail?: unknown
}

/** 一个会话的落盘状态。**按会话分桶**,见 ModelIoLog 的类注释。 */
interface IoHandle {
  dir: string | null
  part: number
  partBytes: number
  /** 串行化写:appendFile 并发时行会交错。**每桶一条队列**,不同会话互不排队。 */
  queue: Promise<void>
  opening: Promise<void> | null
  failed: boolean
}

/** 拿不到归属时的桶名。**不叫 'default'** —— 那个词在本仓已经是"会话键退化"的同义词。 */
export const UNATTRIBUTED_IO_SESSION = 'unattributed'

class ModelIoLog {
  /**
   * **按会话分桶(Ral 2026-09-03:「我们的会话要有自己的 session id,jsonl 的文件名就是用这个
   * session id」)。**
   *
   * 原来是单例一个 `dir`,`openSession` 轮换它 —— 于是两个并发的 agent 会话把行写进**最后一次
   * openSession 的那个目录**,而且没有任何东西标明这行属于谁。追 issues/
   * drill-activity-bleeds-into-another-session.md 时就被它坑了:只能跨 14 个时间戳目录 grep 内容
   * 反推归属,而且第一遍推错了(drill 技能描述在每份提示词里都有,看着像"共用同一会话")。
   *
   * 归属取自 `AsyncLocalStorage`(`currentAgentSessionKey()`),所以 append 的调用点一个都不用改。
   * 拿不到就落到 `UNATTRIBUTED_IO_SESSION` 桶 —— **不冒充任何会话**。
   */
  private handles = new Map<string, IoHandle>()

  private root(): string {
    if (!resolveIoRoot) {
      if (!warnedNoRoot) {
        warnedNoRoot = true
        console.warn(
          '[model-io] 落点未配置 —— 本进程不写 agent-io 证据链。宿主应在 boot 时调一次 setModelIoRoot()。'
        )
      }
      // 抛而不是给默认值。四个 root() 调用点都在 try/catch 里,所以这等于「干净地什么都不做」——
      // 而**给一个 tmpdir 兜底会让证据链静默落到别处**,那正是这份日志要防的事
      // (它存在的前提就是证据必须留在宿主的 userData 里,见文件头 RETAIN_SESSIONS 那段)。
      throw new Error('model-io root not configured')
    }
    return resolveIoRoot()
  }

  /** 当前行属于哪个桶。 */
  private key(): string {
    return currentAgentSessionKey() || UNATTRIBUTED_IO_SESSION
  }

  private handle(key: string): IoHandle {
    let h = this.handles.get(key)
    if (!h) {
      h = { dir: null, part: 1, partBytes: 0, queue: Promise.resolve(), opening: null, failed: false }
      this.handles.set(key, h)
    }
    return h
  }

  /**
   * 新会话(agent reset / 新钻探)。
   *
   * 目录名是 **`<时间戳>-<sessionId>`**,不是裸 uuid。Ral 要的是"文件名带 session id",而裸 uuid
   * 会同时破掉 `prune()` 的两个依据:它按 `/^\d{17}$/` 过滤、并按**名字排序**当作时间序
   * (见 prune 的注释)。前缀保留时间戳 ⇒ id 可 `ls`/grep 定位,时间序与保留策略一个字都不用改。
   */
  async openSession(label: string): Promise<string | null> {
    const key = this.key()
    const h = this.handle(key)
    try {
      const d = new Date()
      const p = (n: number, w = 2): string => String(n).padStart(w, '0')
      const stamp =
        `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
        `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}`
      const dir = join(this.root(), `${stamp}-${safeSessionSegment(key)}`)
      await mkdir(dir, { recursive: true })
      h.dir = dir
      h.part = 1
      h.partBytes = 0
      h.failed = false
      h.opening = null
      void this.prune()
      this.append({ kind: 'note', name: 'session-open', subject: label, text: '', turn: 0 })
      return dir
    } catch {
      // 落盘失败**绝不影响回合**:这是诊断设施,不是业务路径。
      h.dir = null
      return null
    }
  }

  /** 当前归属那一桶的目录(报告里带上)。 */
  get sessionDir(): string | null {
    return this.handles.get(this.key())?.dir ?? null
  }

  /**
   * 某个聊天会话的 jsonl 目录 —— `/view_context` 用它把**绝对路径**写进导出
   * (Ral 2026-09-03:「/export 要能导出 jsonl 的绝对路径」)。活桶优先;桶里没有就按目录名后缀
   * 在盘上找最近的一个,这样重启后翻旧会话也拿得到。
   */
  async dirForSession(sessionId: string): Promise<string | null> {
    try {
      const handle = this.handles.get(sessionId)
      // opening 完成时还会追加 session-open，必须在它之后读取写队列。
      if (handle?.opening) await handle.opening
      if (handle) await handle.queue
      const live = handle?.dir
      if (live && await this.hasSavedParts(live)) return live
      const suffix = `-${safeSessionSegment(sessionId)}`
      const names = (await readdir(this.root())).filter((n) => /^\d{17}-/.test(n) && n.slice(17) === suffix).sort()
      for (const name of names.reverse()) {
        const dir = join(this.root(), name)
        if (dir !== live && await this.hasSavedParts(dir)) return dir
      }
      return null
    } catch {
      return null
    }
  }

  /** mkdir 成功不代表写入成功；空目录不能作为已保存日志交给用户。 */
  private async hasSavedParts(dir: string): Promise<boolean> {
    try {
      for (const name of await readdir(dir)) {
        if (!/^part-\d{3,}\.jsonl$/.test(name)) continue
        const file = await stat(join(dir, name)).catch(() => null)
        if (file?.isFile() && file.size > 0) return true
      }
    } catch {
      // 日志被清理或读取失败时继续查其他已保存目录。
    }
    return false
  }

  /**
   * 追加一行。**同步返回,异步落盘** —— 这条在模型调用的热路径上,不能让磁盘拖慢回合。
   * 写失败只报一次(failed 闸),不然一次磁盘满会刷屏。
   */
  append(line: Omit<ModelIoLine, 'ts' | 'bytes'> & { bytes?: number }): Promise<boolean> {
    // **惰性开目录。** 原来只在 reset() 里 openSession,于是"应用起来后第一个回合还没 reset 过"
    // 这条路径上一个字都不会落盘 —— 而那恰恰是最需要证据的第一轮。
    // 现在 append 自己保证有目录:没有就开一个,并把这一行排在开目录之后。
    const h = this.handle(this.key())
    if (!h.dir && !h.opening) {
      h.opening = this.openSession('auto').then(() => undefined)
    }
    const text = line.text || ''
    const row: ModelIoLine = {
      ts: Date.now(),
      turn: line.turn,
      kind: line.kind,
      name: line.name,
      subject: line.subject,
      bytes: line.bytes ?? Buffer.byteLength(text, 'utf8'),
      text,
      ...(line.detail === undefined ? {} : { detail: line.detail })
    }
    // JSON.stringify 之后一行一条。**原文不截断** —— 截断了就回到"只有构成没有原文"的原点,
    // 而那正是这份日志要解决的问题。
    const payload = JSON.stringify(row) + '\n'
    const bytes = Buffer.byteLength(payload, 'utf8')
    let written = false
    h.queue = h.queue
      .then(async () => {
        if (h.opening) await h.opening.catch(() => undefined)
        const dir = h.dir
        if (!dir) return // 开目录失败:诊断设施不许把回合拖死
        if (h.partBytes + bytes > PART_MAX_BYTES && h.partBytes > 0) {
          h.part += 1
          h.partBytes = 0
          // 换卷时顺手清一次。**只在 openSession 清是不够的** —— 一轮两小时的钻探就是一个会话,
          // 它自己涨到多少 MB 都碰不到那次清理。挂在换卷上 = 每写满 8MB 至多一次,成本有界。
          void this.prune()
        }
        await appendFile(join(dir, `part-${String(h.part).padStart(3, '0')}.jsonl`), payload, 'utf8')
        h.partBytes += bytes
        written = true
      })
      .catch((err) => {
        if (h.failed) return
        h.failed = true
        console.warn('[model-io] 写入失败(后续不再报):', (err as Error).message)
      })
    // Existing hot-path callers ignore this; initialization can confirm this exact evidence line.
    return h.queue.then(() => written)
  }

  /** 一个会话目录占多少字节。读不到算 0 —— 清理不该因为一个坏目录整体罢工。 */
  private async dirBytes(dir: string): Promise<number> {
    try {
      let total = 0
      for (const n of await readdir(dir)) {
        try {
          total += (await stat(join(dir, n))).size
        } catch {
          /* 竞态删除,忽略 */
        }
      }
      return total
    } catch {
      return 0
    }
  }

  /**
   * 保留策略:**条数或总量,谁先触发谁生效**(与 logRetention 同一形状)。
   * ① 只留最近 RETAIN_SESSIONS 个目录;② 历史总量仍超 MAX_TOTAL_BYTES 就从最旧删到达标。
   *
   * **当前会话永不删,而且它的字节也不计入这笔预算。** 两条缺一不可:只豁免目录、却把它的体积
   * 算进 `total`,就会出现「一个超大的活会话把 19 份历史全部删光,然后仍然超标」—— 而那正是本闸
   * 要保护的场景(两小时钻探 = 一个会话)。所以上限约束的是**历史**,单个活会话只受磁盘约束;
   * 截断是这份日志明令不做的事。
   *
   * 失败无声 —— 清理不该拖累主流程。
   */
  private async prune(): Promise<void> {
    try {
      const root = this.root()
      // 目录名是 `<17 位时间戳>[-<sessionId>]` —— 过滤放宽到可选后缀,排序仍是时间序(前缀定序)。
      const names = (await readdir(root)).filter((n) => /^\d{17}(-[a-zA-Z0-9._-]{1,64})?$/.test(n)).sort()
      // **所有活桶都豁免**,不再只豁免"当前那一个" —— 分桶之后同时可能有多个会话在写,
      // 删掉其中任意一个正在写的目录都会让它 ENOENT,而写失败只报一次 ⇒ 之后整轮静默不落盘。
      const liveDirs = new Set(
        Array.from(this.handles.values())
          .map((item) => item.dir)
          .filter((item): item is string => Boolean(item))
      )
      // 条数淘汰也要避开当前会话:目录名是本地墙钟(时区西移 / NTP 回拨 / 双实例都能让它不是最大),
      // 删掉正在写的那份之后 appendFile 会 ENOENT,而失败只报一次 —— 之后整轮静默不落盘。
      const extra = names.slice(0, Math.max(0, names.length - RETAIN_SESSIONS))
      for (const n of extra) {
        if (liveDirs.has(join(root, n))) continue
        await rm(join(root, n), { recursive: true, force: true }).catch(() => {})
      }

      // 目录名是时间戳,sort() 之后天然最旧在前 —— 超量就从这一头删。
      const kept = names.slice(extra.length).filter((n) => !liveDirs.has(join(root, n)))
      const sized: { name: string; bytes: number }[] = []
      let total = 0
      for (const n of kept) {
        const bytes = await this.dirBytes(join(root, n))
        sized.push({ name: n, bytes })
        total += bytes
      }
      for (const s of sized) {
        if (total <= MAX_TOTAL_BYTES) break
        // **只有真删成功才减账。** 删失败(EPERM / 只读 / 文件被锁)却照减,会让 total 掉到线下
        // 直接 break —— 于是闸永久失效,而且一声不响:实测能到 5.5 倍上限、一个都删不掉。
        try {
          await rm(join(root, s.name), { recursive: true, force: true })
          total -= s.bytes
        } catch {
          /* 删不掉就跳过它,继续找下一个能删的 —— 不减账 */
        }
      }
    } catch {
      /* 目录还不存在等等,忽略 */
    }
  }

  /** 这一轮写了多少 —— 报告里带上,免得"以为在记"和"真的在记"分不开。 */
  async sizeOnDisk(): Promise<number> {
    const dir = this.sessionDir
    if (!dir) return 0
    try {
      const names = await readdir(dir)
      let total = 0
      for (const n of names) total += (await stat(join(dir, n))).size
      return total
    } catch {
      return 0
    }
  }
}

export const modelIoLog = new ModelIoLog()
