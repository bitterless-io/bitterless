import type { ApidocLedgerApi, ApidocEndpointWrite } from '@maestro-shared/apidocLedger.api'
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CodexDebugEvent } from '@maestro-shared/coach.api'
// ApiDoc* 那几型 bl 没有 cowork.api,抽进了 apidoc.types(见那个文件尾部的说明)。
import type { ApiDocEntry, ApiDocSummary, IngestAdvice, IngestApiDocResult } from '@maestro-shared/apidoc.types'
import type { ConfigApi } from '@maestro-shared/config.api'
import { APIDOC_CONFIG_DOMAIN } from '@maestro-shared/config.api'
import { sliceCodeUnits } from '@maestro-shared/text'
import type { BaseAgent } from '@main/agent/BaseAgent'
import { writeDomainArtifacts } from '@maestro-main/apidoc/apiArtifacts.service'
import type { ApidocArtifactWriteResult } from '@maestro-main/apidoc/apiArtifacts.types'
import { buildIngestAdvice, summarizeAdvice } from '@maestro-main/apidoc/ingestAdvice.service'
import type { ApiDocExchangeInput, ApiDocFilterContext, ApiDocOperation, IngestContinueDecision, JsonParseOutcome } from '@maestro-main/apidoc/apiDoc.types'

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'] as const

// Bodies go to the model WHOLE — there is no clip (Ral 2026-08-10, ingest-pipeline.html PQ-3
// 「body 是不是就先不要裁剪了,等遇到这个问题再想着怎么解决」). The rejected alternative was NOT
// "clip vs not": a blind N-character cut of the whole body is the wrong shape of rule, because it
// severs the JSON mid-object and hides every deeper field. The better rule is per-FIELD (clip a
// string field only past ~500 chars, and only when that field is not itself parseable JSON/XML —
// embedded JSON carries structure worth seeing, free text does not), and that rule cannot be
// calibrated without real cases. So: send everything, and make the one failure this exposes —
// a prompt too large for the model — EXPLICIT (bisect, then name the endpoint in `lost`).
//
// A body that arrives at the LLM at full length is safe to do: it is the same value the recording
// already stores (ingest.html PQ-14 存值), and file/binary bodies are withheld separately.
// There is NO cap on how many endpoints one ingest documents (Ral 2026-08-10「MAX_EXCHANGES = 40 先不
// 做限制」, ingest-pipeline.html PQ-1). The old `MAX_EXCHANGES = 40` silently truncated after dedupe, so
// a 500-endpoint site produced a 40-endpoint doc with nothing saying the rest were dropped — the exact
// silent-loss failure G1 forbids. Cost moved instead of vanishing: batches = ceil(endpoints / 4), and
// that count is logged and reported so a large ingest is visible rather than quietly expensive.
// Endpoints per LLM call. The doc is NOT generated in one shot — a single OpenAPI JSON for many
// endpoints overflows the model's output budget and truncates mid-token (→ JSON.parse fails).
// Small batches keep each response well within the output limit; the full doc is assembled in code.
// 4 (not 6): per-field descriptions + observed enums make each endpoint's output richer; a failing
// batch still bisects, but a smaller batch overflows less often to begin with.
const BATCH_SIZE = 4

// 每批 LLM 调用的超时。原为 180s(基于 2026-08-11 的实测:中位 ~60s、最高 ~100s)。
//
// 【2026-08-14 抬到 600s】(Ral 定)。理由是新证据推翻了"180s 够用"这个前提:welladjustedhk 那轮
// 反复 `agent-oneshot-error 180s`,而超时那批的 `bodyBytes` 只有 **3573**(3.5 KB)——
// **不是输入体积撑爆,是模型侧就是慢**。对这种情况 180s 掐断只会把它推进重试,总耗时反而更长
// (实测一轮 20 端点 / 5 批拖了 10 分 27 秒)。放宽让慢批一次跑完。
//
// 注意:这个数只有在【摄取串行】之后才可信 —— 之前三轮摄取并发互抢同一个 provider,
// 分不清是模型慢还是被自己抢的(见 issues/drill-ingest-concurrent-and-duplicated 已修)。
const INGEST_BATCH_TIMEOUT_MS = 600_000
// 摄取心跳:批在飞时每 15s 刷新一次任务进度。一次 LLM 回合就 60s+,而任务看门狗 TASK_STALL_MS=45s
// 没上报就判 stalled —— 只在批间上报会让正常慢跑被误判。心跳走同一条 onProgress;真卡死(事件循环
// 停了)心跳也停,仍可检出。
const INGEST_HEARTBEAT_MS = 15_000
// 一批超时最多重试几次,然后【问用户】(Ral 2026-08-11:超时就重试并展示次数,满次弹一张可交互
// 卡片,用户 Confirm 才继续、Cancel 则停)。
//
// 【2026-08-14 从 10 降到 3】(Ral 定)。上一个数是配 180s 超时定的;超时抬到 600s 之后
// 600s × 10 = **单批最坏 100 分钟**,乘上批数完全不可接受。而且降到 3 不是在牺牲成功率:前两次
// 不成、后八次大概率也不成,超时的成因是模型侧挂住而不是这一批本身有问题。早失败早进下一批,
// 漏掉的端点会留给下一轮兜底(apidoc 是增量合并的),比让整轮卡在一批上划算。
// 卡片本身没变 —— 满次仍然问人,而不是默默放弃或无限吊死。
const INGEST_TIMEOUT_RETRIES_BEFORE_ASK = 3
// 超时【才】考虑二分的最小 body 体量。超时且 body 小 = provider 挂住,拆了白拆(每半又是一个 180s
// 超时);body 大才可能是输入溢出,值得二分隔离大 body。与 LAST_RESORT_BODY_CLIP 同值:比"截断后
// 还留的量"还大才算溢出嫌疑。
const TIMEOUT_BISECT_MIN_BODY = 20_000

// Endpoint lines the agent-facing INDEX will print in one `api_doc` call. This is a READ-path bound,
// not a coverage bound — the doc still holds everything, and the overflow line says how to reach it.
const INDEX_LIMIT = 200

// Reached from main via xpc — the encrypted config DB lives in the sqlite window's preload.
const configStore = createXpcMainEmitter<ConfigApi>('ConfigDao')
// apidoc 账本(apidoc-001)。目录/详情两张表在 sqlite 窗口的 preload 里。
const ledger = createXpcMainEmitter<ApidocLedgerApi>('ApidocDao')

/**
 * Generates a per-site OpenAPI 3.1 doc from captured API traffic (API ingest) and stores it in
 * the config DB (domain 'apidoc', key = host). LLM-generated but to a FIXED format: real
 * endpoints only, a purpose note per operation, schemas without example values.
 *
 * Generation is BATCHED: endpoints are grouped by origin and chunked into small LLM calls that
 * each emit only a `paths` fragment; the servers list + full OpenAPI envelope are assembled
 * deterministically in code. This removes the single-shot output-truncation failure and lets a
 * bad batch degrade gracefully (partial doc) instead of nuking the whole result.
 */
export class ApiDocService {
  constructor(
    private readonly pi: BaseAgent,
    private readonly onDebug?: (event: CodexDebugEvent) => void
  ) {}

  /**
   * 这一次摄取里【库中原本没有】的端点数与清单(Ral 2026-08-17:
   * 「钻探完成之后,展示你这一轮钻探摄入了多少个接口?有多少是已经存在的,有多少是新摄入的?」)。
   *
   * 为什么是实例字段而不是局部量:计数发生在 `persistFragment` 里(每批落盘一次),
   * 而它是独立方法。**每次 `generateAndSave` 开头必须清零** —— 不清就跨窗累加,
   * 于是第 10 个窗口会报出前 9 个窗口的新增数,而那个数看起来完全正常,错得不会被发现。
   */
  private ingestCreated = 0
  private ingestCreatedKeys: string[] = []

  async generateAndSave(
    exchanges: ApiDocExchangeInput[],
    siteUrl: string,
    filterContext?: ApiDocFilterContext,
    // 进度回调(apidoc-incremental-ingest 决定 3)。调用方(后台任务)把它接到 task.update,
    // 于是 running tasks 条与聊天任务部件能显示「批 N/总数 · 已文档化 M」。不传就只打日志。
    onProgress?: (done: number, total: number, note: string) => void,
    // 一批超时满 10 次后问用户是否继续(决定 3)。不传 = 默认放弃这批。
    onTimeoutExhausted?: IngestContinueDecision,
    /**
     * 边钻边摄时,这一窗对应的模块上下文(名字 + 落地快照)。文档生成本来只看得见流量,
     * 看不见"这个页面是干什么的" —— 参数描述因此常常只能照名字复述一遍。把快照喂进去,
     * 模型能先明白这个模块在做什么业务,再去解释每个字段。
     */
    moduleContext?: { name: string; snapshot: string | null }
  ): Promise<IngestApiDocResult> {
    const startedAt = Date.now()
    const host = safeHost(siteUrl)
    if (!host) {
      return { ok: false, host: '', endpointCount: 0, message: 'API ingest needs a site URL to key the doc.', error: 'no-host' }
    }
    // No cap: every deduped endpoint is documented. `collapsed` is reported, not swallowed.
    const grounded = dedupeExchanges(exchanges)
    const collapsed = exchanges.length - grounded.length
    const adviceFor = (documented: number): IngestAdvice | undefined =>
      filterContext
        ? buildIngestAdvice({
            host,
            options: filterContext.options,
            blocked: filterContext.blocked,
            blockedCapped: filterContext.blockedCapped,
            filterChangedWhileRecording: filterContext.filterChangedWhileRecording,
            drops: filterContext.drops,
            documented,
            fileBodyWithheld: grounded.filter((e) => e.requestBodyIsFile || e.responseBodyIsFile).length,
            dedupeCollapsed: collapsed
          })
        : undefined
    if (!grounded.length) {
      // The advisory matters MOST here: "no API traffic" is usually a whitelist that excluded the
      // site's own API host, and without this the operator only sees an empty result.
      const advice = adviceFor(0)
      return {
        ok: false,
        host,
        endpointCount: 0,
        message:
          'No captured API traffic to document — record with network capture on, then ingest again.' +
          (advice ? ` ${summarizeAdvice(advice)}` : ''),
        error: 'no-api-records',
        advice
      }
    }
    // Body volume is logged up front because bodies are now sent UNCLIPPED: this number is the token
    // bill and the thing to look at first if batches start failing. It is also the evidence Ral needs
    // to design the per-field rule if/when it bites (PQ-3).
    const totalBodyBytes = batchBodyBytes(grounded)
    const biggest = grounded.reduce(
      (max, e) => {
        const bytes = (e.requestBody?.length || 0) + (e.responseBody?.length || 0)
        return bytes > max.bytes ? { endpoint: endpointLabel(e), bytes } : max
      },
      { endpoint: '', bytes: 0 }
    )
    this.debug({
      phase: 'apidoc-start',
      level: 'info',
      message: `Generating API doc for ${host}: ${grounded.length} endpoint(s) in ${Math.ceil(grounded.length / BATCH_SIZE)} batch(es), ${Math.round(totalBodyBytes / 1024)} KB of bodies (unclipped).`,
      detail: {
        host,
        exchanges: grounded.length,
        raw: exchanges.length,
        dedupeCollapsed: collapsed,
        batches: Math.ceil(grounded.length / BATCH_SIZE),
        bodyBytes: totalBodyBytes,
        biggestBody: biggest.bytes ? `${biggest.endpoint} (${Math.round(biggest.bytes / 1024)} KB)` : 'none'
      }
    })

    // Distinct origins (site origin first) — computed in code, not left to the LLM.
    const primaryOrigin = safeOrigin(siteUrl) || safeOrigin(grounded[0].url)
    const byOrigin = new Map<string, ApiDocExchangeInput[]>()
    for (const ex of grounded) {
      const origin = safeOrigin(ex.url) || primaryOrigin
      const list = byOrigin.get(origin)
      if (list) list.push(ex)
      else byOrigin.set(origin, [ex])
    }
    const origins = [primaryOrigin, ...Array.from(byOrigin.keys()).filter((o) => o && o !== primaryOrigin)]

    // 有界的固定前置上下文(决定 4)。站点 host + 鉴权证据(header 名)+ 本次端点的精简索引。
    // 每一批都带着它,让批与批之间对站点端点全貌、鉴权方案有一致认知。有界:索引截断,不随批次增长。
    // 边钻边摄时,把这一窗所属模块的【落地快照】接在站点前置上下文后面(Ral 2026-08-13 的两段式:
    // 先看快照弄明白这个模块在做什么业务,再据此解释每个接口和字段)。快照按 6000 字符截断 —— 它只是
    // 上下文,不是要文档化的对象;不截断会把批次挤爆(整轮那份实测就在反复 output overflow)。
    const preamble = buildSitePreamble(host, grounded) + buildModulePreamble(moduleContext)
    // Batch per origin → merge each fragment's paths (operations on non-primary origins get a
    // per-operation server override, set in code).
    const paths: Record<string, Record<string, unknown>> = {}
    let batchTotal = 0
    let batchOk = 0
    let llmError = ''
    // 批序号 + 计划批数:tryBatch 里做「超时重试 m/10」「本批已 Ns」进度提示要用,所以提前声明。
    const plannedBatches = origins.reduce((n, o) => n + Math.ceil((byOrigin.get(o) || []).length / BATCH_SIZE), 0)
    let batchIndex = 0
    // 用户在超时卡片上点了 Cancel → 停止整轮(已落盘的都在)。
    let userCancelled = false
    // 决定 1(PQ-10 收口):累计【已落盘】的端点数。每批成功就立刻 upsert 那一批,所以被掐只丢
    // 当前这一批,已存的都在。也是 eval 指标之一。
    let persistedTotal = 0
    // 每一窗独立计数(见字段上的说明:不清零就跨窗累加,而那个数看起来完全正常)。
    this.ingestCreated = 0
    this.ingestCreatedKeys = []
    // Endpoints whose doc was lost, with why + how big their bodies were. Bodies are sent WHOLE now
    // (PQ-3), so "the prompt was too large" is a real failure mode and it must be NAMED, never counted.
    const lost: { endpoint: string; reason: string; bodyBytes: number }[] = []
    // Endpoints that only got documented after a LAST-RESORT body clip. Not a policy clip — the full
    // body demonstrably did not fit, and a doc with shallower fields beats no doc for that endpoint.
    // This list is also the evidence for PQ-3: it names exactly which endpoints need the per-field rule.
    const clippedRecovery: { endpoint: string; bodyBytes: number }[] = []
    // Generate one batch. BOTH failure kinds bisect when the batch holds more than one endpoint:
    //  - parse failure → the OUTPUT overflowed and truncated mid-JSON (rich schemas are large)
    //  - LLM error     → most often the INPUT overflowed, which became possible when body clipping was
    //                    removed. Bisecting means one oversized body costs its own endpoint, not the
    //                    three neighbours that happened to share its batch.
    // A single-endpoint failure is the end of the line: record it in `lost` with its body size so the
    // result can name it. That is the whole point — an unclipped body may not fit, and G1 permits a
    // drop only if it is explicit.
    const tryBatch = async (batch: ApiDocExchangeInput[], origin: string, attempt: 'full' | 'clipped' | 'retry' = 'full'): Promise<void> => {
      if (userCancelled) return
      batchTotal += 1
      const bodyBytes = batchBodyBytes(batch)
      // 超时重试循环(决定 2/3):超时就重试同一批并【展示次数】,满 10 次问用户 —— Confirm 再来一轮、
      // Cancel 停整轮。只有【超时 + body 小】才走重试(挂住的 provider,拆了白拆);其它失败照旧往下。
      let result = await this.pi.oneShot(buildPathsPrompt(batch, siteUrl, preamble), INGEST_BATCH_TIMEOUT_MS)
      let timeoutRetries = 0
      while ((result.errorMessage || !result.ok) && /timed out/i.test(result.errorMessage || result.error || '') && bodyBytes <= TIMEOUT_BISECT_MIN_BODY) {
        if (userCancelled) return
        timeoutRetries += 1
        llmError = result.errorMessage || result.error || 'LLM timeout'
        this.debug({ phase: 'apidoc-llm-slow', level: 'warn', message: `LLM 反馈慢/超时,批 ${batchIndex} 重试 ${timeoutRetries}/${INGEST_TIMEOUT_RETRIES_BEFORE_ASK}`, detail: { host, batch: batchIndex, timeoutRetries, bodyBytes } })
        onProgress?.(batchIndex, plannedBatches, `批 ${batchIndex}/${plannedBatches} · LLM 反馈慢,超时重试 ${timeoutRetries}/${INGEST_TIMEOUT_RETRIES_BEFORE_ASK}`)
        if (timeoutRetries >= INGEST_TIMEOUT_RETRIES_BEFORE_ASK) {
          // 满 10 次:问用户。没接 callback(手动摄取等)→ 默认放弃这批,保持有界不吊死。
          const keepGoing = onTimeoutExhausted
            ? await onTimeoutExhausted({ label: batch.map(endpointLabel).join(', '), batchIndex, plannedBatches, attempts: timeoutRetries, timeoutMs: INGEST_BATCH_TIMEOUT_MS })
            : false
          this.debug({ phase: 'apidoc-timeout-ask', level: 'warn', message: `批 ${batchIndex} 超时满 ${timeoutRetries} 次,用户选择:${keepGoing ? '继续' : '停止'}`, detail: { host, batch: batchIndex, attempts: timeoutRetries } })
          if (!keepGoing) {
            userCancelled = true
            for (const ex of batch) lost.push({ endpoint: endpointLabel(ex), reason: `LLM timeout ×${timeoutRetries} (user stopped)`, bodyBytes: batchBodyBytes([ex]) })
            return
          }
          timeoutRetries = 0 // 用户要继续 → 再来一轮 10 次
        }
        await sleep(retryBackoffMs(timeoutRetries))
        result = await this.pi.oneShot(buildPathsPrompt(batch, siteUrl, preamble), INGEST_BATCH_TIMEOUT_MS)
      }
      if (result.errorMessage || !result.ok) {
        llmError = result.errorMessage || result.error || 'LLM unavailable'
        this.debug({ phase: 'apidoc-llm-error', level: 'warn', message: 'API doc batch failed (LLM).', detail: { error: llmError, batchSize: batch.length, bodyBytes, attempt } })
        if (batch.length > 1) {
          const mid = Math.ceil(batch.length / 2)
          await tryBatch(batch.slice(0, mid), origin, attempt)
          await tryBatch(batch.slice(mid), origin, attempt)
          return
        }
        // ONE endpoint whose FULL body does not fit. Bisecting cannot help any further, so instead of
        // losing the endpoint, retry it once with the body clipped. This is the answer to "what if the
        // recording is huge / the context overflows": bodies stay unclipped by default (PQ-3), and the
        // clip appears only where the model has just proven the full body impossible.
        if (attempt === 'full' && bodyBytes > LAST_RESORT_BODY_CLIP) {
          this.debug({
            phase: 'apidoc-body-too-large',
            level: 'warn',
            message: `${endpointLabel(batch[0])}: ${Math.round(bodyBytes / 1024)} KB of body did not fit — retrying this endpoint once with the body clipped to ${LAST_RESORT_BODY_CLIP} chars.`,
            detail: { host, endpoint: endpointLabel(batch[0]), bodyBytes, error: llmError }
          })
          const before = Object.keys(paths).length
          await tryBatch([clipExchangeBodies(batch[0], LAST_RESORT_BODY_CLIP)], origin, 'clipped')
          if (Object.keys(paths).length > before) clippedRecovery.push({ endpoint: endpointLabel(batch[0]), bodyBytes })
          return
        }
        lost.push({ endpoint: endpointLabel(batch[0]), reason: `LLM: ${llmError}`, bodyBytes })
        return
      }
      const parsed = parseJsonObject(result.text)
      if (parsed.value) {
        mergePaths(paths, parsed.value, origin !== primaryOrigin ? origin : null)
        // 决定 1:这一批立刻落盘,不攒到最后。任何成功分支(full 或 clipped)都走这里。
        persistedTotal += await this.persistFragment(parsed.value, host, origin, primaryOrigin, origins)
        batchOk += 1
        return
      }
      if (batch.length > 1) {
        const mid = Math.ceil(batch.length / 2)
        this.debug({ phase: 'apidoc-batch-split', level: 'info', message: 'API doc batch did not parse — splitting and retrying (likely output overflow).', detail: { from: batch.length, jsonError: parsed.error, textLength: result.text.length } })
        await tryBatch(batch.slice(0, mid), origin)
        await tryBatch(batch.slice(mid), origin)
        return
      }
      // 单端点批,二分已经走到头。这里分两种失败,处理完全不同:
      //
      // **被截断**(读到头还欠闭合)—— 输出【不完整】,不是【不合法】。实测这是绝对多数:
      // 2026-08-17 当日报错位置**逐一等于**输出长度,零反例。
      //
      // ⚠ 这里原来写着「同一输入截在不同位置 ⇒ 原样重发大概率就完整」,**那条推断已被实测否掉**:
      // 四对配对重试全部又截断,输出长度几乎不变、有时更短。所以重试必须**改变输入**
      // (压 body → 压小响应 schema → 压小输出),见 TRUNCATION_RETRY_BODY_CLIP。
      //
      // **格式错** —— 重试是浪费,直接记账。
      if (parsed.truncated && attempt !== 'retry') {
        this.debug({
          phase: 'apidoc-output-truncated',
          level: 'warn',
          message: `${endpointLabel(batch[0])}: output ended mid-object at ${result.text.length} chars — retrying once with the input body clipped to ${TRUNCATION_RETRY_BODY_CLIP} chars (a plain re-send truncates again: 4/4 observed).`,
          detail: { host, endpoint: endpointLabel(batch[0]), textLength: result.text.length, jsonError: parsed.error, clipTo: TRUNCATION_RETRY_BODY_CLIP }
        })
        // 压输入再试 —— **不是原样重发**。原样重发实测 4/4 又截断(理由见 TRUNCATION_RETRY_BODY_CLIP)。
        await tryBatch([clipExchangeBodies(batch[0], TRUNCATION_RETRY_BODY_CLIP)], origin, 'retry')
        return
      }
      lost.push({
        endpoint: endpointLabel(batch[0]),
        reason: parsed.truncated ? `output truncated (retried once): ${parsed.error || 'unknown'}` : `output not valid JSON: ${parsed.error || 'unknown'}`,
        bodyBytes: batchBodyBytes(batch)
      })
      this.debug({
        phase: parsed.truncated ? 'apidoc-output-truncated' : 'apidoc-parse-error',
        level: 'warn',
        message: parsed.truncated
          ? 'API doc endpoint output was truncated again after a retry — giving up on this endpoint.'
          : 'API doc endpoint output was not valid JSON.',
        detail: { endpoint: endpointLabel(batch[0]), textLength: result.text.length, jsonError: parsed.error, window: parsed.window, retried: parsed.truncated }
      })
    }

    // Sequential on purpose (the LLM is a single shared agent). With the cap gone this loop can be
    // long — 500 endpoints is 125 calls — so it REPORTS PROGRESS. Without that the operator watches a
    // spinner for an unknown time and cannot tell a slow ingest from a hung one; removing a silent
    // truncation must not introduce a silent wait in its place.
    // 心跳(决定 1):批在飞时每 15s 刷新一次任务,别让正常慢批(中位 60s > 45s 看门狗)被误判 stalled。
    // 走同一条 onProgress;真卡死(事件循环停了)心跳也停,仍可检出。`heartbeatStartedAt` 每批置位,
    // 心跳里算「本批已 Ns」,超 30s 明说「LLM 反馈慢」——「原因要能具体标记」(Ral 2026-08-11)。
    let heartbeatStartedAt = Date.now()
    const heartbeat = setInterval(() => {
      const secs = Math.round((Date.now() - heartbeatStartedAt) / 1000)
      const note =
        secs >= 30
          ? `批 ${batchIndex}/${plannedBatches} · LLM 反馈慢,本批已 ${secs}s · 已文档化 ${persistedTotal}`
          : `批 ${batchIndex}/${plannedBatches} · 已文档化 ${persistedTotal} · 本批已 ${secs}s`
      onProgress?.(batchIndex, plannedBatches, note)
    }, INGEST_HEARTBEAT_MS)
    heartbeat.unref?.()
    try {
      for (const origin of origins) {
        if (userCancelled) break
        for (const batch of chunk(byOrigin.get(origin) || [], BATCH_SIZE)) {
          if (userCancelled) break
          batchIndex += 1
          const batchStartedAt = Date.now()
          heartbeatStartedAt = batchStartedAt
          const okBefore = batchOk
          this.debug({
            phase: 'apidoc-batch',
            level: 'info',
            message: `API doc batch ${batchIndex}/${plannedBatches} (${batch.length} endpoint(s), ${Object.keys(paths).length} path(s) so far).`,
            detail: { host, batch: batchIndex, plannedBatches, origin, endpoints: batch.map((e) => `${e.method.toUpperCase()} ${pathOf(e.url)}`) }
          })
          await tryBatch(batch, origin)
          // 决定 3:进度可见 —— 后台任务把它显示成「批 N/总数 · 已文档化 M」。
          onProgress?.(batchIndex, plannedBatches, `批 ${batchIndex}/${plannedBatches} · 已文档化 ${persistedTotal} 端点`)
          // 决定 5:结构化 eval 打点(每批),phase=apidoc-eval,可从日志切出来算成功率/耗时。
          this.debug({
            phase: 'apidoc-eval',
            level: 'info',
            message: `batch ${batchIndex}/${plannedBatches} done in ${Date.now() - batchStartedAt}ms`,
            detail: { host, batch: batchIndex, plannedBatches, size: batch.length, ok: batchOk > okBefore, ms: Date.now() - batchStartedAt, bodyBytes: batchBodyBytes(batch), persistedTotal, timedOutStopped: userCancelled }
          })
        }
      }
    } finally {
      clearInterval(heartbeat)
    }

    if (!Object.keys(paths).length) {
      const why = userCancelled
        ? `你在 LLM 反复超时后停止了摄取(${llmError})—— 还没文档化任何端点;等模型快一些再重试`
        : llmError
        ? `the LLM failed (${llmError}) — fix the model (sign in / switch provider / check quota), then ingest again`
        : 'the LLM returned no valid endpoints across all batches — try again'
      this.debug({ phase: 'apidoc-empty', level: 'warn', message: 'API doc produced no endpoints.', detail: { host, batchTotal, userCancelled } })
      return { ok: false, host, endpointCount: 0, message: `API doc generation failed: ${why}.`, error: llmError ? 'llm-required' : 'invalid-openapi', advice: adviceFor(0) }
    }

    const authEvidence = collectAuthEvidence(grounded)
    const infoResult = await this.generateInfo(host, siteUrl, Object.keys(paths), authEvidence).catch(() => ({ info: null, authDesc: '' }))
    const info = infoResult.info || {
      title: `${host} API`,
      description: `Captured business API for ${host} (${Object.keys(paths).length} path(s)).`,
      version: 'captured'
    }
    const openapi: Record<string, unknown> = {
      openapi: '3.1.0',
      info,
      servers: origins.map((url) => ({ url })),
      paths
    }

    // Backstop against the no-secret-examples rule — warn (not fail) like the skill script check.
    if (/eyJ[A-Za-z0-9_-]{12,}|bearer\s+\S{8,}/i.test(JSON.stringify(openapi))) {
      this.debug({ phase: 'apidoc-literal-warning', level: 'warn', message: 'Generated API doc may contain a secret-looking literal — it should carry schemas only.', detail: { host } })
    }

    const endpointCount = countOperations(openapi)

    // ── 账本已在【每批完成时】增量落盘(决定 1,PQ-10 收口)——「不能忘记之前处理了什么」:
    //    被掐只丢当前这一批,已存的都在。所以这里不再做循环外的一次性 upsertMany。旧 blob 仍写一份
    //    (过渡期回退,读优先账本、账本空才回落 blob),它在下面 configStore.upsert 里。

    // 站点级鉴权方案(apidoc-site-auth)。site_id 主键 UPSERT → 再摄取一次直接覆盖旧值。
    // 写失败不致命(端点文档已存),只记一条日志。
    try {
      // `apiBases` 和鉴权方案存在**同一行**(Ral 2026-08-14)。这两件事必须一起被取用:调一个接口
      // 要同时知道「打到哪」和「怎么带凭据」,少任何一个都调不通。而 origin 之所以要显式记下来 ——
      // 页面站 ≠ API 站:test-dsh 页面在 test-dsh-admin.terncloud.com,39 个端点全在 dsh-test.terncloud.com。
      await ledger.upsertSite({ siteId: host, authDesc: infoResult.authDesc, apiBases: origins.filter(Boolean) })
      if (infoResult.authDesc) this.debug({ phase: 'apidoc-auth', level: 'info', message: `Auth scheme summarized for ${host}.`, detail: { host, authDescChars: infoResult.authDesc.length } })
    } catch (err) {
      this.debug({ phase: 'apidoc-auth-failed', level: 'warn', message: `Site auth upsert failed: ${(err as Error).message}`, detail: { host } })
    }

    await configStore.upsert({ domain: APIDOC_CONFIG_DOMAIN, key: host, options: { openapi, updatedAt: Date.now() } })

    // 与 `skills-changed` 对称(ingest-pipeline.html PQ-6)。没有它,摄取成功后 API Doc 面板
    // 毫无反应 —— 操作者要手动切走再切回才看得到,而"面板没变化"读起来就是"摄取失败了"。
    try {
      xpcMain.broadcast('cowork/apidoc-changed', { host, endpointCount: countOperations(openapi), ts: Date.now() })
    } catch {
      /* 没有渲染进程在听不算错 */
    }

    // Execution artifacts — the FIXED, parameterised call unit the executor runs
    // (docs/features/node-only-api-execution.md decision 5). Written from the captured exchanges
    // DETERMINISTICALLY, not from `openapi` above: that doc is LLM-generated and bisect-retries
    // around output truncation, and an execution table that silently lost an endpoint to a truncated
    // response would be much worse than a plainer descriptor. Failure here must not fail the ingest.
    let artifacts: ApidocArtifactWriteResult | null = null
    try {
      // Artifacts are keyed by the host that will SERVE the call, not by the tab that was open.
      // Those differ constantly: on the reference site the operator sits on
      // `test-dsh-admin.terncloud.com` while every endpoint lives on `dsh-test.terncloud.com`. Keying
      // by the tab wrote the successRule somewhere `loadDomainArtifacts` (called with the request
      // host) could never look — a silent miss, and a silent miss here means an HTTP-200 business
      // failure is reported as success. One artifact set per API host actually observed.
      // Contract: features/api-learn-to-call.md D3.
      const byApiHost = new Map<string, ApiDocExchangeInput[]>()
      for (const ex of grounded) {
        const h = safeHost(ex.url)
        if (!h) continue
        if (!byApiHost.has(h)) byApiHost.set(h, [])
        byApiHost.get(h)!.push(ex)
      }
      const written: ApidocArtifactWriteResult[] = []
      for (const [apiHost, subset] of byApiHost) {
        const r = writeDomainArtifacts({ host: apiHost, exchanges: subset })
        written.push(r)
        this.debug({
          phase: 'apidoc-artifacts',
          level: 'info',
          message: `Execution artifacts for ${apiHost}: ${r.endpointCount} endpoint(s).`,
          detail: { apiHost, pageHost: host, dir: r.dir, endpoints: r.endpointCount, wroteClient: r.wroteClient }
        })
      }
      // The doc itself stays keyed by the page host (that is how the operator and `api_doc` look it
      // up); only the EXECUTION artifacts follow the API host.
      artifacts = written.find((w) => w.dir.includes(host)) || written.sort((a, b) => b.endpointCount - a.endpointCount)[0] || null
      if (!artifacts) throw new Error('no api host in the captured exchanges')
      this.debug({
        phase: 'apidoc-artifacts',
        level: 'info',
        message: `Execution artifacts written for ${byApiHost.size} api host(s) from page ${host}.`,
        detail: {
          host,
          apiHosts: [...byApiHost.keys()],
          dir: artifacts.dir,
          endpoints: artifacts.endpointCount,
          wroteClient: artifacts.wroteClient,
          droppedNonBusiness: artifacts.droppedNonBusiness
        }
      })
    } catch (err) {
      this.debug({
        phase: 'apidoc-artifacts-failed',
        level: 'warn',
        message: 'Could not write per-domain execution artifacts (the API doc itself is saved).',
        detail: { host, error: err instanceof Error ? err.message : String(err) }
      })
    }

    // ── Filter/coverage advisory. Written next to the execution artifacts so it survives the toast —
    //    a recommendation the operator reads once and loses is worth nothing. Failure is non-fatal.
    const advice = adviceFor(endpointCount)
    if (advice && artifacts) {
      try {
        writeFileSync(join(artifacts.dir, 'advice.md'), `${advice.text}\n`, 'utf8')
      } catch (err) {
        this.debug({ phase: 'apidoc-advice-write-failed', level: 'warn', message: `Could not write advice.md: ${(err as Error).message}`, detail: { host } })
      }
    }
    if (advice) {
      this.debug({
        phase: 'apidoc-advice',
        level: advice.recommendations.some((r) => r.action === 'add-whitelist' || r.action === 'remove-blacklist') ? 'warn' : 'info',
        message: summarizeAdvice(advice),
        detail: { host, recommendations: advice.recommendations, blocked: advice.blocked, drops: advice.drops }
      })
    }

    // Endpoints that failed all the way down are NAMED, not counted. Unclipped bodies make "the prompt
    // did not fit" a real outcome, and a doc that is quietly short is the failure G1 forbids.
    if (lost.length) {
      this.debug({
        phase: 'apidoc-lost-endpoints',
        level: 'warn',
        message: `${lost.length} endpoint(s) could not be documented — see detail for which and why.`,
        detail: { host, lost }
      })
    }

    const totalMs = Date.now() - startedAt
    this.debug({
      phase: 'apidoc-created',
      level: 'info',
      message: `API doc for ${host}: ${endpointCount} operation(s).`,
      detail: { durationMs: totalMs, host, endpointCount, batches: `${batchOk}/${batchTotal}`, lost: lost.length }
    })
    // 决定 5:收尾 eval 摘要,一行能算出这次摄取的整体指标(成功率、耗时、增量落盘、丢失/截断)。
    this.debug({
      phase: 'apidoc-eval',
      level: 'info',
      message: `ingest summary for ${host}: ${endpointCount} documented · ${persistedTotal} persisted incrementally · ${batchOk}/${batchTotal} batches ok · ${totalMs}ms`,
      detail: {
        host,
        endpoints: grounded.length,
        documented: endpointCount,
        persistedTotal,
        batchesOk: batchOk,
        batchesTotal: batchTotal,
        plannedBatches,
        lost: lost.length,
        clippedRecovery: clippedRecovery.length,
        userCancelled,
        totalMs,
        avgBatchMs: batchTotal ? Math.round(totalMs / batchTotal) : 0
      }
    })
    return {
      ok: true,
      host,
      endpointCount,
      // 这一窗【库里原本没有】的端点数与清单,以及丢失数 —— 调用方要把三个数报在同一行。
      created: this.ingestCreated,
      createdKeys: [...this.ingestCreatedKeys],
      lostCount: lost.length,
      message:
        `Generated API doc for ${host}: ${endpointCount} endpoint operation(s) from ${batchOk}/${batchTotal} batch(es). See Workbench ▸ API Doc.` +
        (userCancelled ? ` ⏹ 你在 LLM 反复超时后停止了摄取,已文档化的端点已保存(可稍后重跑补齐剩余)。` : '') +
        (lost.length
          ? ` ⚠ ${lost.length} 个端点没能文档化:${lost
              .slice(0, 5)
              .map((l) => `${l.endpoint}(body ${Math.round(l.bodyBytes / 1024)}KB · ${l.reason})`)
              .join('; ')}${lost.length > 5 ? ' …' : ''}`
          : '') +
        (clippedRecovery.length
          ? ` ℹ ${clippedRecovery.length} 个端点的 body 太大、整份送不进模型,已用截断后的 body 补文档(字段可能不全):${clippedRecovery
              .slice(0, 5)
              .map((l) => `${l.endpoint}(${Math.round(l.bodyBytes / 1024)}KB)`)
              .join('; ')}${clippedRecovery.length > 5 ? ' …' : ''}`
          : '') +
        (artifacts ? ` Execution table: ${artifacts.endpointCount} endpoint(s) in ${artifacts.dir}.` : '') +
        (advice ? ` ${summarizeAdvice(advice)}${artifacts ? ` — 详见 ${join(artifacts.dir, 'advice.md')}` : ''}` : ''),
      advice
    }
  }

  /**
   * 决定 1:把【一批】的 paths 片段立刻 upsert 进账本。返回写入端点数。
   * 与循环外那份【已删除的】一次性 upsert 用同一套映射(listOperations),所以不会分叉。
   * 服务器口径:非主 origin 的端点存 [origin],主 origin 存全部 origins —— 与 mergePaths 的覆盖一致。
   * 失败不致命:blob 那份最后仍写,读路径会回落;只记一条日志。
   */
  private async persistFragment(
    fragment: Record<string, unknown>,
    host: string,
    origin: string,
    primaryOrigin: string,
    origins: string[]
  ): Promise<number> {
    const servers = origin !== primaryOrigin ? [origin] : origins
    const ops = listOperations({ paths: fragment, servers: servers.map((url) => ({ url })) })
    if (!ops.length) return 0
    const writes: ApidocEndpointWrite[] = ops.map((op) => ({
      siteId: host,
      method: op.method,
      pathTemplate: op.path,
      summary: [op.summary, op.description].filter(Boolean).join('. ').slice(0, 400),
      role: /^(get|head)$/i.test(op.method) ? 'read' : 'write',
      source: 'ingest',
      docJson: op.operation,
      servers: op.servers
    }))
    try {
      const res = await ledger.upsertMany({ endpoints: writes })
      // 这一批里有几个是库里原本没有的。累加到整轮的计数上 —— 收尾摘要要回答
      // 「这一轮摄了多少、其中新增多少」(Ral 2026-08-17)。
      this.ingestCreated += res.created || 0
      for (const k of res.createdKeys || []) if (this.ingestCreatedKeys.length < 40) this.ingestCreatedKeys.push(k)
      // 每批落库后就播一次 —— 边钻边摄之后端点是【陆续】到的,只在整轮结束播一次的话,
      // 25 批要等四十分钟面板才动一下,看起来就像卡住了(Ral 2026-08-14 要"apidoc 变化就自动刷新")。
      try {
        xpcMain.broadcast('cowork/apidoc-changed', { host, endpointCount: res.written, ts: Date.now() })
      } catch {
        /* 没有渲染进程在听不算错 */
      }
      return res.written
    } catch (err) {
      this.debug({ phase: 'apidoc-ledger-failed', level: 'warn', message: `per-batch upsert failed: ${(err as Error).message}`, detail: { host, batchSize: writes.length } })
      return 0
    }
  }

  // Small, bounded call for the doc's info block (title + one-paragraph description + auth_desc).
  // Failure is non-fatal — the caller falls back to a code-derived info and an empty auth_desc.
  // Returns { info, authDesc } so the site-level auth scheme can be persisted separately (apidoc_site).
  private async generateInfo(
    host: string,
    siteUrl: string,
    pathList: string[],
    authEvidence: string
  ): Promise<{ info: Record<string, unknown> | null; authDesc: string }> {
    const result = await this.pi.oneShot(buildInfoPrompt(host, siteUrl, pathList, authEvidence), 60_000)
    if (result.errorMessage || !result.ok) return { info: null, authDesc: '' }
    const parsed = parseJsonObject(result.text).value
    if (!parsed || typeof parsed.title !== 'string') return { info: null, authDesc: '' }
    const authDesc = typeof parsed.auth_desc === 'string' ? parsed.auth_desc.trim() : ''
    return {
      info: { title: parsed.title, description: typeof parsed.description === 'string' ? parsed.description : '', version: 'captured' },
      authDesc
    }
  }

  /**
   * 读优先走账本:目录 + 详情两表 JOIN 后在代码里【投影】成 OpenAPI,所以 Workbench 面板、
   * Copy OpenAPI JSON、digest() 的形状全都不用改。账本为空(老数据、或本次写失败)才回落旧 blob。
   */
  async get(host: string): Promise<ApiDocEntry | null> {
    try {
      const projected = await this.projectFromLedger(host)
      if (projected) return projected
    } catch (err) {
      this.debug({ phase: 'apidoc-ledger-read-failed', level: 'warn', message: `Ledger read failed, falling back to the stored blob: ${(err as Error).message}`, detail: { host } })
    }
    const entry = await configStore.get({ domain: APIDOC_CONFIG_DOMAIN, key: host })
    const parsed = parseStoredDoc(entry?.options)
    return parsed ? { host, ...parsed } : null
  }

  /** 账本 → OpenAPI 投影。OpenAPI 从此是【导出格式】而不是存储本体。 */
  private async projectFromLedger(host: string): Promise<ApiDocEntry | null> {
    const catalog = await ledger.catalog({ siteId: host })
    if (!catalog.length) return null
    const paths: Record<string, Record<string, unknown>> = {}
    const servers = new Set<string>()
    let updatedAt = 0
    for (const row of catalog) {
      const full = await ledger.contract({ endpointId: row.id })
      if (!full) continue
      for (const s of full.servers || []) servers.add(s)
      updatedAt = Math.max(updatedAt, full.updatedAt || row.lastSeen)
      ;(paths[row.pathTemplate] ||= {})[row.method.toLowerCase()] = full.docJson as Record<string, unknown>
    }
    if (!Object.keys(paths).length) return null
    // 站点级鉴权方案(apidoc-site-auth)—— 面板 header 下要展示它。读失败不致命,退化成空串。
    const meta = await ledger.siteMeta({ siteId: host }).catch(() => null)
    return {
      host,
      openapi: {
        openapi: '3.1.0',
        info: { title: `${host} API`, description: `Captured business API for ${host} (${catalog.length} endpoint(s)).`, version: 'captured' },
        servers: [...servers].map((url) => ({ url })),
        paths
      },
      updatedAt: updatedAt || Date.now(),
      authDesc: meta?.authDesc || '',
      apiBases: meta?.apiBases || [],
      // 冒烟结论跟着文档一起投影出去 —— 面板要据此显示绿/红 tag。
      authSmoke: meta?.authSmoke || '',
      authSmokeNote: meta?.authSmokeNote || ''
    }
  }

  /**
   * Agent-facing READ of the stored doc (host tool `api_doc`). Two modes, on purpose:
   *  - INDEX (default): one line per operation — `METHOD /path — summary. description`. Cheap
   *    enough to pull before every data read, which is what makes the API-first path viable.
   *  - DETAIL (`endpoint` given): the full contract of ONE operation (parameters / requestBody /
   *    responses schema), so schemas only enter the context when the agent actually calls that
   *    endpoint. Dumping the whole OpenAPI would cost more than the page snapshot it replaces.
   */
  async digest(params: { host: string; endpoint?: string; query?: string }): Promise<string> {
    const host = params.host.trim()
    if (!host) return 'ERROR: host is required (no site is open).'
    const entry = await this.get(host)
    if (!entry) {
      const known = await this.list()
      const others = known.length ? ` Known sites: ${known.map((d) => `${d.host} (${d.endpointCount})`).join(', ')}.` : ''
      return (
        `No API doc for ${host}.${others}\n` +
        'Generate one: record the flow with network capture on, then ingest_recording {"api":true}. ' +
        'Until then, drive the page with page_snapshot + ui_act.'
      )
    }
    const operations = listOperations(entry.openapi)
    if (!operations.length) return `API doc for ${host} has no operations. Re-run ingest_recording {"api":true} on a richer capture.`

    const wanted = (params.endpoint || '').trim()
    if (wanted) {
      const match = matchOperation(operations, wanted)
      if (!match) {
        return (
          `No operation matches "${wanted}" in ${host}. Available:\n` +
          operations.map((op) => `${op.method} ${op.path}`).join('\n')
        )
      }
      return [
        `# ${match.method} ${match.path} @ ${host}`,
        match.summary ? `summary: ${match.summary}` : '',
        match.description ? `purpose: ${match.description}` : '',
        match.servers.length ? `servers: ${match.servers.join(', ')}` : '',
        '',
        'contract (schemas only — no captured values):',
        clip(JSON.stringify(match.operation, null, 2), 8_000)
      ]
        .filter(Boolean)
        .join('\n')
    }

    const needle = (params.query || '').trim().toLowerCase()
    // 目录行匹配不到时,再拿同一个词去【契约里】搜一遍 —— 字段名 / enum 值 / 描述都在 doc_json 里。
    // 这一步没有倒排表:LIKE 子串全扫,几百端点是微秒级,而且天然 CJK 安全(不需要分词)。
    let rows = needle
      ? operations.filter((op) => `${op.method} ${op.path} ${op.summary} ${op.description}`.toLowerCase().includes(needle))
      : operations
    if (needle && !rows.length) {
      try {
        const hits = await ledger.searchFields({ siteId: host, needle })
        if (hits.length) {
          const keys = new Set(hits.map((h) => `${h.method} ${h.pathTemplate}`))
          rows = operations.filter((op) => keys.has(`${op.method} ${op.path}`))
          this.debug({ phase: 'apidoc-field-search', level: 'info', message: `"${needle}" matched ${rows.length} endpoint(s) by contract content.`, detail: { host, needle, hits: hits.length } })
        }
      } catch (err) {
        this.debug({ phase: 'apidoc-field-search-failed', level: 'warn', message: `Field search failed: ${(err as Error).message}`, detail: { host } })
      }
    }
    if (!rows.length) return `No operation in ${host} matches "${params.query}". Call api_doc without a query to list all ${operations.length}.`

    // The index is injected into the agent's context on every call, and removing the endpoint cap made
    // it unbounded — a 500-endpoint site used to be impossible, so 500 lines (~40 KB) never happened.
    // Bounded here, and the overflow is STATED with the way to reach the rest: a silent cut on this
    // side would be the same defect as `MAX_EXCHANGES`, just moved to the read path.
    const shown = rows.slice(0, INDEX_LIMIT)
    const lines = shown.map((op) => {
      const note = [op.summary, op.description].filter(Boolean).join('. ')
      const params_ = op.paramNames.length ? ` [params: ${op.paramNames.join(', ')}]` : ''
      return `${op.method} ${op.path}${note ? ` — ${note}` : ''}${params_}`
    })
    return [
      `# api doc: ${host} — ${rows.length}${rows.length === operations.length ? '' : `/${operations.length}`} endpoint(s), updated ${new Date(entry.updatedAt).toISOString().slice(0, 10)}`,
      ...lines,
      ...(rows.length > shown.length
        ? [
            '',
            `... ${rows.length - shown.length} more endpoint(s) NOT listed (index capped at ${INDEX_LIMIT} to keep this readable). ` +
              'Narrow it with api_doc {"query":"<keyword>"} — the query also matches field names and enum values inside each contract.'
          ]
        : []),
      '',
      'Call one with call_site_api {"method":"GET","path":"<path>","query":{…}} — the host resolves this site\'s credentials from the open tab and issues the request from Node. ' +
        'For the full parameter/response contract of one endpoint first: api_doc {"endpoint":"GET /path"}.'
    ].join('\n')
  }

  async list(): Promise<ApiDocSummary[]> {
    // 跨站清单直接一条 SQL(site-knowledge:apidoc 留 SQLite 正是为了跨站可查)
    try {
      const sites = await ledger.sites()
      if (sites.length) {
        return sites
          .map((s) => ({ host: s.siteId, title: `${s.siteId} API`, endpointCount: s.endpointCount, updatedAt: s.updatedAt }))
          .sort((a, b) => b.updatedAt - a.updatedAt)
      }
    } catch (err) {
      this.debug({ phase: 'apidoc-ledger-list-failed', level: 'warn', message: `Ledger list failed, falling back to stored blobs: ${(err as Error).message}` })
    }
    const rows = (await configStore.list({ domain: APIDOC_CONFIG_DOMAIN })) ?? []
    const summaries: ApiDocSummary[] = []
    for (const row of rows) {
      const parsed = parseStoredDoc(row.options)
      if (!parsed) continue
      const info = parsed.openapi.info as { title?: unknown } | undefined
      summaries.push({
        host: row.key,
        title: typeof info?.title === 'string' && info.title.trim() ? info.title.trim() : `${row.key} API`,
        endpointCount: countOperations(parsed.openapi),
        updatedAt: parsed.updatedAt
      })
    }
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  private debug(event: Omit<CodexDebugEvent, 'scope' | 'ts'>): void {
    this.onDebug?.({ ...event, scope: 'summarize', ts: Date.now() })
  }
}

// Prompt for ONE batch: return only the OpenAPI `paths` object for the given endpoints. Small
// output — no whole-document truncation. Servers/info are assembled in code, not asked for here.
/**
 * 有界的固定前置上下文(apidoc-incremental-ingest 决定 4)。每一批都带着它:站点 host + 鉴权证据
 * (header 名)+ 本次端点的精简索引。让批与批之间对站点全貌、鉴权方案有一致认知,命名/schema 更一致。
 * 【有界】是硬要求:端点索引截断到 MAX_PREAMBLE_ENDPOINTS 条,不随批次或已文档化数无限增长。
 */
const MAX_PREAMBLE_ENDPOINTS = 60
const buildSitePreamble = (host: string, allExchanges: ApiDocExchangeInput[]): string => {
  const index = new Set<string>()
  for (const ex of allExchanges) {
    if (index.size >= MAX_PREAMBLE_ENDPOINTS) break
    index.add(`${ex.method.toUpperCase()} ${pathOf(ex.url)}`)
  }
  const more = allExchanges.length - index.size
  return [
    `SITE CONTEXT (shared across all batches — for consistent naming, do NOT document these unless they are in THIS batch):`,
    `- host: ${host}`,
    `- ${collectAuthEvidence(allExchanges).replace(/\n/g, '\n  ')}`,
    `- endpoint landscape (${index.size}${more > 0 ? ` of ${allExchanges.length}` : ''} shown): ${[...index].join(' · ')}${more > 0 ? ` … +${more} more` : ''}`
  ].join('\n')
}

/**
 * 这一窗所属模块的上下文段。空上下文返回空串(手动 Ingest / 收尾兜底走这条,行为完全不变)。
 *
 * 为什么值得喂:文档生成本来只看得见流量,看不见"这个页面是干什么的" —— 于是参数描述常常只能
 * 照着字段名复述一遍。有了这个模块的 a11y 快照(标题、区块名、表头、按钮名),模型能先明白业务,
 * 再去解释字段,描述会具体得多。
 */
const MODULE_SNAPSHOT_CHARS = 6000
const buildModulePreamble = (ctx?: { name: string; snapshot: string | null }): string => {
  if (!ctx) return ''
  const lines = ['', `## Where this traffic came from: the "${ctx.name}" screen`, '']
  if (ctx.snapshot) {
    const snap = ctx.snapshot.length > MODULE_SNAPSHOT_CHARS ? ctx.snapshot.slice(0, MODULE_SNAPSHOT_CHARS) + '\n… (snapshot truncated)' : ctx.snapshot
    lines.push(
      'This is the accessibility snapshot of that screen — headings, section names, column headers and',
      'control labels. Use it to work out WHAT THIS PART OF THE PRODUCT DOES, then describe each endpoint',
      'and each field in those business terms. Do NOT document anything that is only in the snapshot:',
      'the endpoints to document are still exactly the ones in the captured traffic below.',
      '',
      snap,
      ''
    )
  }
  return lines.join('\n')
}

const buildPathsPrompt = (exchanges: ApiDocExchangeInput[], siteUrl: string, preamble = ''): string => {
  const traffic = exchanges.map(exchangeForPrompt).join('\n\n')
  return [
    "You are Micromeet Cowork. Document ONLY the endpoints in the captured traffic below as an",
    'OpenAPI 3.1 **paths** object, so an agent can call these existing endpoints later.',
    '',
    'Return STRICT JSON ONLY (no markdown fences, no commentary): a single object mapping each path',
    'to its operations. Exact shape:',
    '{',
    '  "/api/example/{id}": {',
    '    "get": {',
    '      "summary": "<short purpose>",',
    '      "description": "<purpose note: what this endpoint does + WHEN to use it>",',
    '      "parameters": [{ "name": "sort_key", "in": "query", "required": false, "description": "<what this parameter controls>", "schema": { "type": "string", "enum": ["<ONLY values seen in the captured traffic>"] } }],',
    '      "requestBody": { "content": { "application/json": { "schema": { "type": "object", "properties": { "<field>": { "type": "string", "description": "<what this field means>" } } } } } },',
    '      "responses": { "200": { "description": "<what comes back>", "content": { "application/json": { "schema": { "type": "object", "properties": { "<field>": { "type": "string", "description": "<what this field means>" } } } } } } },',
    '      "x-mm": { "role": "read|write", "replay": "safe|confirm", "capability": "<short kebab intent tag, e.g. list-staff / create-staff>", "success": "<how to tell the call satisfied the intent, e.g. resp.code===0>" }',
    '    }',
    '  }',
    '}',
    '',
    'Rules:',
    '- Document ONLY the endpoints listed below — NEVER invent paths, methods, or fields. Do NOT include an "openapi"/"info"/"servers" wrapper; return just the paths object.',
    '- "x-mm" is DOCUMENT METADATA for the agent/router — it is NEVER sent as a request header. '
    + 'role: does this call CHANGE state on the server? Changes something → "write". Only retrieves data → "read". '
    + 'The HTTP METHOD IS NOT EVIDENCE, in either direction — a POST can be a pure query (filters, paging, export) and that is "read"; '
    + 'a GET can just as well create, update or delete something and that is "write". '
    + 'Judge from the whole picture: what the path means, what the parameters are for, what the response contains, and what the surrounding flow was doing. '
    + 'If you genuinely cannot tell, OMIT role rather than guessing — the host treats a missing role as "needs the operator\'s confirmation", which is the safe outcome; a wrong "read" is not. '
    + 'replay: safe for reads, confirm for writes (needs user intent).  capability: a short kebab tag naming the USER TASK this endpoint serves. success: a brief, checkable signal the call worked. Do NOT add any custom "x-*" request header anywhere.',
    '- One operation per DISTINCT method+path. Turn variable path segments (numeric ids, uuids, long tokens) into {param} path parameters.',
    '- EVERY operation MUST carry "summary" AND "description" (the purpose note: what it does + when to use it, inferred from the flow).',
    '- Infer parameter/requestBody/response schemas (types + field names) from the observed query strings and bodies. Schemas ONLY — NO example values anywhere; NEVER echo tokens, cookies, session ids, emails, or personal data.',
    '- EXPLAIN every parameter and every request-body / response field: give each a concise "description" of what it means / what it is for, inferred from its name + the surrounding flow. This field explanation is what the reader relies on.',
    '- VALUES ARE OBSERVED-ONLY — never guess. For an enum-like parameter/field (e.g. sort_key, sort_type, status, order), add an "enum" listing ONLY the value(s) that ACTUALLY appear in the captured traffic. If a field\'s values were not captured, give the description but NO enum (do not invent possible values); you may note "other values may exist but were not captured". Descriptions explain MEANING; enums list only CAPTURED values.',
    '- Keep schemas to a readable depth (≤3 levels; for nested arrays/objects include ONE level of item/child fields) so the output does not overflow — but DO include the per-field descriptions above.',
    '- Query-string keys become "in":"query" parameters. Do NOT document auth/cookie headers as parameters — the runtime applies the domain auth profile automatically; mention required auth in the description if useful.',
    '- Skip static assets, analytics, and telemetry; document business/data endpoints.',
    '- A body shown as "<file upload …>" / "<file/binary download …>" was WITHHELD on purpose (it is an export / download / upload endpoint). Still document the endpoint and all its parameters, but do NOT invent a JSON schema for that body: describe the response content as a file (mention the observed content type) and set "x-mm".capability accordingly (e.g. export-customers).',
    '- responses: use the observed status code(s) with a short description.',
    '',
    `Site: ${siteUrl}`,
    preamble ? `\n${preamble}` : '',
    '',
    'Captured traffic (grounded evidence — request header VALUES were removed):',
    '',
    traffic
  ].join('\n')
}

// Tiny prompt for the doc's info block only.
// 鉴权类端点:路径里带这些词的,是登录/令牌/会话流程,鉴权方案八成从它们开始。
const AUTH_PATH_HINT = /login|logout|signin|sign-in|token|refresh|oauth|session|auth\b|authenticate|sso|captcha|verif/i
// 鉴权相关的请求头名(只看名字,值从不进来)。X- 前缀的自定义头也常是令牌/租户标识,一并留。
const AUTH_HEADER_HINT = /^(authorization|cookie|x-|auth|token|api-key|apikey|session|bearer|csrf|xsrf)/i

/**
 * 从录到的 exchange 里抽【鉴权证据】喂给 LLM 总结 auth_desc。只用 header 名(值早被上游抹掉)
 * 和端点路径 —— 不碰任何凭证值。产出一段紧凑证据:去重的鉴权头名 + 命中关键词的端点。
 */
const collectAuthEvidence = (exchanges: ApiDocExchangeInput[]): string => {
  const headerNames = new Set<string>()
  const authEndpoints = new Set<string>()
  for (const ex of exchanges) {
    for (const h of ex.requestHeaderNames || []) if (AUTH_HEADER_HINT.test(h)) headerNames.add(h.toLowerCase())
    const path = safeUrlForPrompt(ex.url)
    if (AUTH_PATH_HINT.test(path)) authEndpoints.add(`${ex.method.toUpperCase()} ${path}`)
  }
  const lines: string[] = []
  lines.push(`Auth-relevant request header NAMES seen (values were never captured): ${[...headerNames].sort().join(', ') || '(none)'}`)
  lines.push(`Auth-looking endpoints (login/token/session/…): ${[...authEndpoints].slice(0, 20).join(' · ') || '(none)'}`)
  return lines.join('\n')
}

const buildInfoPrompt = (host: string, siteUrl: string, pathList: string[], authEvidence: string): string =>
  [
    `Return STRICT JSON ONLY: { "title": "<short API title for ${host}>", "description": "<one paragraph: what this API covers>", "auth_desc": "<the site's AUTHENTICATION SCHEME in one or two plain sentences>" }.`,
    // 措辞很要紧(Ral 2026-08-14):上一版会写出 "though specific login endpoints and session cookie
    // names are not provided" —— **事实正确,但读起来像阻塞项**。真相通常是"不需要知道",不是
    // "我们不知道";和前半句连起来给人的印象是"鉴权没搞定"。所以这里强制它给出【三选一的明确判断】,
    // 并且要求把"为什么不需要"说出来,而不是罗列缺了什么。
    'auth_desc: give a VERDICT on whether a caller can authenticate, in ONE of exactly three shapes, then the evidence:',
    '  (a) REPLAYABLE — every credential the request needs can be obtained deterministically. Say which header carries it and where that value comes from (e.g. "X-CSRF-Token taken from localStorage.csrf-token, stable per session"), and if the session itself rides on browser cookies, say so explicitly AND say that this means no credential has to be extracted — then note the one real constraint (calls must originate in the browser context).',
    '  (b) NEEDS A SIGNING ALGORITHM — a header is computed per request (a signature/nonce/timestamp) with no storage it can be read from. Name the header(s) and say plainly that the signing code has to be analysed before these endpoints are callable.',
    '  (c) NO AUTH OBSERVED — the traffic carries no credential at all. Set auth_desc to "" (empty).',
    'NEVER phrase an absence as a blocker when it is not one: "the login endpoint was not captured" is only worth saying if a caller actually NEEDS it. If the credential is already obtainable, say so as the headline and do not list what is missing. Base everything ONLY on the evidence below, and NEVER include any secret value — you were given header NAMES only, keep it that way.',
    'No markdown, no example credential values, no personal data.',
    '',
    `Site: ${siteUrl}`,
    'Auth evidence:',
    authEvidence,
    '',
    'Documented paths:',
    pathList.slice(0, 60).map((p) => `- ${p}`).join('\n')
  ].join('\n')

const exchangeForPrompt = (exchange: ApiDocExchangeInput): string => {
  // Keep the ORIGIN in the label — same-site captures may span subdomains (app.foo.com page
  // calling api.foo.com), and the doc must not collapse them onto one server.
  const lines = [`### ${exchange.method.toUpperCase()} ${safeOrigin(exchange.url)}${safeUrlForPrompt(exchange.url)}`]
  if (exchange.requestHeaderNames.length) lines.push(`Request headers (names only): ${exchange.requestHeaderNames.join(', ')}`)
  // A file body carries no field structure — telling the model it IS a file is worth more than its
  // bytes, and it keeps the endpoint documented (params + purpose) instead of dropped.
  if (exchange.requestBodyIsFile) lines.push('Request body: <file upload (multipart/binary) — body withheld. Document it as a file upload; describe the non-file parameters.>')
  else if (exchange.requestBody) lines.push(`Request body:\n${exchange.requestBody}`)
  if (exchange.status) lines.push(`Response: ${exchange.status} ${exchange.mime || ''}`.trim())
  if (exchange.responseBodyIsFile) lines.push('Response body: <file/binary download (export, attachment) — body withheld. Document the response as a file download, NOT as a JSON schema.>')
  else if (exchange.responseBody) lines.push(`Response body:\n${exchange.responseBody}`)
  return lines.join('\n')
}

// Dedupe on method+origin+path (query dropped for the key): keep the richest exchange per
// endpoint — prefer one that carries a response, then one with a request body.
const dedupeExchanges = (exchanges: ApiDocExchangeInput[]): ApiDocExchangeInput[] => {
  const byEndpoint = new Map<string, ApiDocExchangeInput>()
  for (const exchange of exchanges) {
    const key = `${exchange.method.toUpperCase()} ${safeOrigin(exchange.url)}${pathOf(exchange.url)}`
    const existing = byEndpoint.get(key)
    if (!existing) {
      byEndpoint.set(key, exchange)
      continue
    }
    const richer =
      (exchange.responseBody && !existing.responseBody) ||
      (!!exchange.responseBody === !!existing.responseBody && exchange.requestBody && !existing.requestBody)
    const winner = richer ? exchange : existing
    const loser = richer ? existing : exchange
    // Carry a file flag onto the winner ONLY where the winner has no body of its own. If a JSON
    // variant won it has a real schema to document and must keep it; but when neither variant carried
    // a body, dropping the flag would leave the model free to invent a JSON schema for a download —
    // the very thing the marker prevents. (Same endpoint, two shapes: async kickoff returns
    // `{taskId}`, the follow-up returns the file; or an export that 400'd once with a JSON error.)
    if (!winner.responseBody && loser.responseBodyIsFile) winner.responseBodyIsFile = true
    if (!winner.requestBody && loser.requestBodyIsFile) winner.requestBodyIsFile = true
    if (richer) byEndpoint.set(key, exchange)
  }
  return Array.from(byEndpoint.values())
}

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// Merge a batch's paths fragment into the accumulating paths object. First operation for a
// method+path wins (batches are already deduped by endpoint). Non-primary-origin operations get a
// per-operation `servers` override so the doc keeps subdomain endpoints on their own origin.
const mergePaths = (paths: Record<string, Record<string, unknown>>, fragment: Record<string, unknown>, originOverride: string | null): void => {
  for (const [path, methodsRaw] of Object.entries(fragment)) {
    if (!methodsRaw || typeof methodsRaw !== 'object' || Array.isArray(methodsRaw)) continue
    const methods = methodsRaw as Record<string, unknown>
    const target = paths[path] || (paths[path] = {})
    for (const method of HTTP_METHODS) {
      const op = methods[method]
      if (!op || typeof op !== 'object' || Array.isArray(op)) continue
      if (target[method]) continue // keep first
      if (originOverride && !(op as Record<string, unknown>).servers) {
        (op as Record<string, unknown>).servers = [{ url: originOverride }]
      }
      target[method] = op
    }
  }
}

/**
 * 扫一遍,看对象有没有闭合。字符串内的括号与转义要跳过,否则 body 里一个 `"{"` 就能把判断带偏。
 * 返回 true = 读完了还欠闭合 = **被截断**。
 */
const endedMidObject = (raw: string): boolean => {
  let depth = 0
  let inString = false
  let escaped = false
  for (const ch of raw) {
    if (escaped) { escaped = false; continue }
    if (inString) {
      if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') depth += 1
    else if (ch === '}' || ch === ']') depth -= 1
  }
  return inString || depth > 0
}

// SAFE, fallback-only repairs (applied only after a direct parse fails): straighten smart quotes and
// drop a trailing comma right before a }/] . Deliberately conservative — no comment-stripping or
// URL-mangling that could corrupt valid content.
const safeRepairJson = (raw: string): string =>
  raw
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,(\s*[}\]])/g, '$1')

// Tolerant JSON-object extraction: strip a ```json fence, else take the first {…last } span, then
// try a direct parse, then a safe-repaired parse. On failure, RETURN the JSON.parse error + a window
// around the offending offset instead of swallowing it, so a bad batch is diagnosable.
const parseJsonObject = (text: string): JsonParseOutcome => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  const raw = fenced?.[1]?.trim() || (start >= 0 && end > start ? text.slice(start, end + 1) : '')
  if (!raw) return { value: null, error: 'no JSON object found in output' }
  let error = 'invalid JSON'
  let window = ''
  for (const candidate of [raw, safeRepairJson(raw)]) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { value: parsed as Record<string, unknown> }
      return { value: null, error: 'top-level JSON was not an object' }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      const pos = Number(error.match(/position (\d+)/)?.[1])
      window = Number.isFinite(pos) ? candidate.slice(Math.max(0, pos - 120), pos + 120) : candidate.slice(-240)
      // "Unexpected non-whitespace character after JSON at position N" near the END → a COMPLETE
      // object was parsed and there is TAIL junk (an over-closed `}` / stray trailing chars). Parse
      // the prefix so an over-close self-heals. Guard to the tail only: a position mid-document
      // (e.g. a second `{…}` fragment, or an early close) must fall through to bisection instead,
      // so we don't grab a partial set and rob the retry that would recover ALL endpoints.
      if (Number.isFinite(pos) && pos > 0 && candidate.length - pos <= 5) {
        try {
          const prefix = JSON.parse(candidate.slice(0, pos)) as unknown
          if (prefix && typeof prefix === 'object' && !Array.isArray(prefix)) return { value: prefix as Record<string, unknown> }
        } catch {
          /* prefix not a complete object either — fall through to the next candidate / report */
        }
      }
    }
  }
  // 截断判定看**模型输出的原文尾巴**(`text.slice(start)`),不看 `raw` ——
  // `raw` 是截到「最后一个 `}`」的,那一刀本身就会把欠闭合的证据剪掉。
  return { value: null, error, window, truncated: start >= 0 && endedMidObject(text.slice(start)) }
}

const parseStoredDoc =(options: unknown): { openapi: Record<string, unknown>; updatedAt: number } | null => {
  if (!options || typeof options !== 'object') return null
  const openapi = (options as { openapi?: unknown }).openapi
  if (!openapi || typeof openapi !== 'object' || Array.isArray(openapi)) return null
  const updatedAt = Number((options as { updatedAt?: unknown }).updatedAt) || 0
  return { openapi: openapi as Record<string, unknown>, updatedAt }
}

export const countOperations = (openapi: Record<string, unknown>): number => {
  const paths = openapi.paths
  if (!paths || typeof paths !== 'object') return 0
  let count = 0
  for (const item of Object.values(paths as Record<string, unknown>)) {
    if (!item || typeof item !== 'object') continue
    for (const method of HTTP_METHODS) {
      if ((item as Record<string, unknown>)[method]) count += 1
    }
  }
  return count
}

const asPlainRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const listOperations = (openapi: Record<string, unknown>): ApiDocOperation[] => {
  const paths = asPlainRecord(openapi.paths)
  if (!paths) return []
  const docServers = (Array.isArray(openapi.servers) ? openapi.servers : [])
    .map((s) => String(asPlainRecord(s)?.url || ''))
    .filter(Boolean)
  const out: ApiDocOperation[] = []
  for (const [path, item] of Object.entries(paths)) {
    const pathItem = asPlainRecord(item)
    if (!pathItem) continue
    for (const method of HTTP_METHODS) {
      const op = asPlainRecord(pathItem[method])
      if (!op) continue
      const paramNames = (Array.isArray(op.parameters) ? op.parameters : [])
        .map((p) => asPlainRecord(p))
        .filter((p): p is Record<string, unknown> => !!p)
        .map((p) => `${String(p.name || '')}${p.in ? `:${String(p.in)}` : ''}`)
        .filter((name) => name && !name.startsWith(':'))
      const opServers = (Array.isArray(op.servers) ? op.servers : [])
        .map((s) => String(asPlainRecord(s)?.url || ''))
        .filter(Boolean)
      out.push({
        method: method.toUpperCase(),
        path,
        summary: typeof op.summary === 'string' ? op.summary.trim() : '',
        description: typeof op.description === 'string' ? op.description.trim() : '',
        paramNames,
        servers: opServers.length ? opServers : docServers,
        operation: op
      })
    }
  }
  return out
}

// `endpoint` accepts "GET /api/x", "/api/x", or a path fragment — the model should not have to
// reproduce the exact string to read a contract.
const matchOperation = (operations: ApiDocOperation[], wanted: string): ApiDocOperation | undefined => {
  const text = wanted.trim().toLowerCase()
  const parts = text.split(/\s+/)
  const method = parts.length > 1 && HTTP_METHODS.includes(parts[0] as (typeof HTTP_METHODS)[number]) ? parts[0] : ''
  const pathPart = (method ? parts.slice(1).join(' ') : text).trim()
  const candidates = method ? operations.filter((op) => op.method.toLowerCase() === method) : operations
  return (
    candidates.find((op) => op.path.toLowerCase() === pathPart) ||
    candidates.find((op) => op.path.toLowerCase().includes(pathPart)) ||
    (method ? undefined : operations.find((op) => `${op.method} ${op.path}`.toLowerCase().includes(text)))
  )
}

const clip = (text: string, limit: number): string => (text.length <= limit ? text : sliceCodeUnits(text, limit) + `\n...[clipped ${text.length - limit} chars]`)

/**
 * Body length used ONLY in the last-resort retry, after the model has already refused the full body.
 * Generous on purpose: 20 K chars still shows a list's first several items and the whole key tree of a
 * normal response, while being ~250× smaller than the multi-MB payload that failed. Deliberately a
 * plain character clip and not the structure-aware trimmer — that design is PQ-3 and still open.
 */
const LAST_RESORT_BODY_CLIP = 20_000
/**
 * 截断重试时把输入体压到这么小。
 *
 * 为什么必须压而不是原样重发(2026-08-17 实测推翻了原来的推断):原注释写「同一输入截在不同位置,
 * 原样重发一次大概率就完整了」—— 那条推断**被 4/4 次实测否掉**:
 *   getBaseGoods 1978 → 重试 2054 · delivery-base/list 3291 → 3237
 *   config/getAppConfig 1169 → 1054 · user/api-key 1541 → 1517
 * 重试全部又截断,且输出长度几乎不变、有时更短 —— 不是随机抖动,而是**这个端点的输出量撞了同一个顶**。
 * 输入没变,凭什么指望输出这次就短了?
 *
 * 而输出的体量主要来自**响应体推出的 schema**,所以压输入是直接可用的杠杆(且 `clipExchangeBodies`
 * 已经为「body 太大」那条路存在,复用它,不新造机制)。
 * 结果是一份**更薄但真实**的契约 —— 端点至少在册、方法路径摘要都有,以后可以重摄;
 * 而原来的结局是**静默丢掉整个端点**。薄契约优于没有契约。
 *
 * 比 LAST_RESORT_BODY_CLIP 小一个数量级:那一条治的是「输入塞不进去」,这一条治的是「输出吐不完」,
 * 后者要压得更狠才有意义。
 */
const TRUNCATION_RETRY_BODY_CLIP = 2_000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
// 超时重试之间的退避。轻量即可 —— 180s 的超时本身已把两次尝试拉开很远;线性、封顶 10s。
const retryBackoffMs = (n: number): number => Math.min(n * 2_000, 10_000)

const clipExchangeBodies = (exchange: ApiDocExchangeInput, limit: number): ApiDocExchangeInput => ({
  ...exchange,
  requestBody: exchange.requestBody ? clip(exchange.requestBody, limit) : exchange.requestBody,
  responseBody: exchange.responseBody ? clip(exchange.responseBody, limit) : exchange.responseBody
})

const endpointLabel = (exchange: ApiDocExchangeInput | undefined): string =>
  `${(exchange?.method || '').toUpperCase()} ${pathOf(exchange?.url || '')}`.trim()

/** Body bytes a batch would put in the prompt. The number to look at when a batch fails unclipped. */
const batchBodyBytes = (batch: ApiDocExchangeInput[]): number =>
  batch.reduce((n, e) => n + (e.requestBody?.length || 0) + (e.responseBody?.length || 0), 0)

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname
  } catch {
    return url.split('?')[0]
  }
}

// URL for the prompt: real path + query KEYS with values templated (values may embed ids/tokens).
const safeUrlForPrompt = (url: string): string => {
  try {
    const u = new URL(url)
    const query = Array.from(u.searchParams.keys())
      .map((key) => `${key}=<value>`)
      .join('&')
    return `${u.pathname}${query ? `?${query}` : ''}`
  } catch {
    return url.split('?')[0]
  }
}

const safeHost = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const safeOrigin = (url: string): string => {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}
