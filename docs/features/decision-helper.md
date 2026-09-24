# Decision Helper:一个通用的判定入口，阈值可传

Status: Specced 2026-09-24 · 已实现 2026-09-24(decision-helper-199 审查 2 通过，第 3 轮只改测试与注释)· Ral review / 测试待做;依赖它的任务在 Ral 确认后继续

Paired with `micromeet-cowork`:`docs/features/decision-helper.md`(同一份契约)。

## Request

Ral 2026-09-24:

> Decision helper 需要抽成通用的工具函数，然后是主进程和渲染进程的 preload world,或者其他进程类型，你看是不是都需要配置一个 decision helper?
> Jev 的全局默认阈值是 0.5,confident 阈值是 0.5,但是 decision helper 使用 Jev 的时候，可以传入指定的阈值。
> 将现在用到 Jev 的地方梳理一下，看看要不要统一重构成 Decision Helper。完成 Decision helper 的开发之后，让我 review 一下这个代码。

## #1 现状(两仓相同)

| 文件 | 角色 | 阈值 | 拿不到判定时 |
|---|---|---|---|
| `main/decision/jevDecision.service.ts` | **唯一实现**:开关、凭证(只在主进程)、调 relay 的 `/v1/systemone` | 无 | 返回 `{ ok:false, reason }`,永不抛 |
| `main/drive/uiActGate.ts`(BJ3 不可逆闸) | 调用方 | 本地常量 `CONFIDENCE_FLOOR = 0.5`,`> 0.5` 才采信 | 问人(fail-closed) |
| `main/drive/snapshotSegment.ts`(BJ1 快照选段) | 调用方 | 本地常量 `CONFIDENCE_FLOOR = 0.7`,`< 0.7` 不采信 | 原样返回整份快照(fail-open) |
| `main/drive/skillScript.ts`(技能脚本沙箱) | 门面：沙箱里的 `jev.judge()` / `jev.enabled()` | 无(脚本自己判) | 原样把 `JevResult` 交给脚本 |
| `main/xpc/jev.handler.ts`(`xpc:JevHandler/*`) | 渲染进程门面 | 无 | 原样转发 |
| 规划中的 BJ4(`ui-act-wait-hover-jev.md` #3.1) | 调用方 | 规格写 0.7 | 放行(fail-open) |

`JevHandler` 在两仓的渲染层和 preload **都没有调用方**。

## #2 各类进程要不要一个 Decision Helper

| 进程 | 要不要 | 理由 |
|---|---|---|
| **主进程** | **要，而且只在这里实现** | 凭证只在主进程;闸、选段、技能沙箱都在主进程 |
| **技能脚本沙箱**(主进程里的 `vm`) | **要一个门面** | 沙箱里够不到 xpc 和 require,只能靠注入的绑定;绑定背后就是主进程的 Decision Helper |
| **渲染进程** | **要：渲染层 `decisionHelper` 模块(Ral 2026-09-24 选定)** | 一个模块，接口与主进程同形;内部经 `electron-xpc` 调主进程的 `xpc:DecisionHandler/*`(electron-xpc 本身就经 preload 桥转给主进程)。**业务代码只 import 这个模块**,不直接碰 xpc 通道名;登录 token 与阈值判断都在主进程，渲染层只把 `options` 原样带过去 |
| **preload** | **不另放实例** | 备选方案「在每个窗口的 preload 用 `contextBridge` 挂一个 `window.decisionHelper`」没选(Ral 2026-09-24):效果一样，却要给「preload 只暴露静态数据」的规矩开例外 |
| **utilityProcess / Worker**(会话复盘、workflow 引擎、文档转换等) | **不要** | 目前没有决策需求，也拿不到凭证;将来要用，经主进程的 IPC 调同一个 helper,不在子进程里再实现一份 |

## #3 接口(主进程，`main/decision/decisionHelper.ts`)

```ts
export const DECISION_DEFAULT_THRESHOLD = 0.5            // Ral:全局默认阈值 0.5

decisionHelper.enabled(): Promise<boolean>              // = 现在的 isJevEnabled
decisionHelper.judge(request, options?): Promise<JevResult>   // 原样判定(不加阈值),给需要自己看原始结果的调用方
decisionHelper.choose(question, state, options?): Promise<DecisionOutcome<string>>   // choice 题
decisionHelper.check(question, state, options?): Promise<DecisionOutcome<boolean>>   // noul 题(是 / 否)
decisionHelper.score(question, state, options?): Promise<DecisionOutcome<number>>    // score 题

question = 对应的 Jev 题目去掉 `type`(由调用的方法决定)+ 必填 `name`(请求里的键，如 `risk` / `block`,迁移前后发出的请求逐字节相同);题目里即使带了 `type`(技能脚本可能传),也以调用的方法为准
options = { threshold?: number /* 默认 0.5 */, timeoutMs?: number, model?: string }

DecisionOutcome<T> =
  | { decided: true;  value: T; confidence: number; durationMs: number }
  | { decided: false; reason: 'off' | 'unauthenticated' | 'http' | 'network' | 'invalid' | 'low-confidence';
      confidence?: number; value?: T; message: string; status?: number /* 只有 http 带,卡片写「判不了(http 502)」*/; durationMs: number }
```

- **阈值语义:** 都是**严格大于**阈值才算 `decided`(沿用 BJ3 现在的「大于 0.5 才采信」)。`choice` / `score` 看返回的 `confidence`。
  `check` 对「是」和「否」一视同仁:`value = noul > 0.5`,`confidence` 是选中那一边的概率(`value ? noul : 1 − noul`)。
  所以很有把握的「否」(noul 0.02 → 置信度 0.98)也是判定，不算判不准。
  (2026-09-24 改：原稿写的是 `value = noul > threshold`,会把有把握的「否」报成 low-confidence。)置信度最低就是 0.5,阈值低于 0.5 对 `check` 没有意义。
  不过阈值 → `decided:false`,`reason:'low-confidence'`,同时带回 `value` / `confidence`,调用方要看可以看。
- **阈值取值:** 缺省 0.5;传入的必须在 `(0, 1)` 之内，否则按 0.5。
  判不成时，说明接在 `message` 后面(判成了的结果没有 `message`)。每次还记一条 `console.warn('[coach:decision:helper]', …)`。
- **日志:** 拿不到判定(http / network / 服务自己的 invalid)时，helper 另记一条带 relay / 网络原文的 `console.warn('[coach:decision:helper]', …)` —— 原文只进日志(BL 的底层服务另有一条 `logRelayFailure`,card-198 F6 加的，lead 定两条都留;Cowork 只有 helper 这一条);调用方(如 BJ3 的闸)自己的日志改用上表的固定句式(审查 001-1 修复轮，lead 2026-09-24 定)。
  helper **自己**判 invalid(回包形状不对、choice 不在 `criteria`、置信度不在 `[0, 1]`)时，也记一条：`console.warn('[coach:decision:helper]', 'decision maker gave an unusable answer to "<name>"', JSON.stringify(<回来的答案>))` —— 答案里没有 relay 报错原文;不记就查不出「这次为什么问人」(审查 001-2 N4 / 199-1 O2,lead 2026-09-24 定)。
- **回包坏了:** 缺答案、字段类型不对(含 NaN、Infinity、字符串、布尔、对象)一律判 `reason:'invalid'`,`message` 用 helper 自己的文案(见下表),不带 relay 原文。
  下面几种也算回包坏了:`choice` 不在题目 `criteria` 的键里;`confidence` 或 `noul` 不在 `[0, 1]` 之内。
  理由:BJ3 把任何不是 `irreversible` 的判定都当成安全，出现一个意料之外的 choice(比如大小写不同)就会不问人直接执行(审查 001-1 N4,lead 2026-09-24 定)。
- **XPC:** `DecisionHandler` 的每个方法只收一个对象参数(electron-xpc 只转发一个参数):`{ request, options }` / `{ question, state, options }`。
  渲染层模块对外保持与主进程相同的位置参数签名，由它负责装包。
- **失败方向不在 helper 里:** helper 只把「判定了没有、为什么」说清楚。拿不到判定时是放行还是问人，仍由每个调用方决定(BJ3 问人,BJ1 / BJ4 放行)—— 这条不能合进 helper,因为两种方向同时存在，合进去必有一侧错。
- **对外文案:** `message` 里一律写 decision maker,不写 Jev(`decision-maker-naming-and-approval-card.md`)。
- **`message` 的固定句式**(2026-09-24 定，两仓逐字一致):

  | 情况 | `message` |
  |---|---|
  | `off` / `unauthenticated` | 底层服务写给人看的那句，原样(已是 decision maker 措辞，如 `The decision maker is switched off in Settings → Decision.`) |
  | `http` / `network` | `The decision maker could not judge it (http 502).` / `… (network).` —— **relay 原文和网络报错原文都不进 `message`**,只进日志(原文里可能带 jev 字样或主机名) |
  | `invalid` | `The decision maker gave no usable answer to "<name>".`;没有题名时(`judge()` 的原始结果)写 `The decision maker gave no usable answer.` |
  | `low-confidence` | `The decision maker was not confident enough (<confidence>, needs more than <threshold>).` |
  | `judge()` 返回的原始结果 | 其余字段原样，失败时的 `message` **同样按本表改写**(技能脚本经 `jev.judge` / `decision.judge` 拿到的也不能带 relay 原文 —— 审查 198-F4) |
  | 阈值非法(空一格接在上面任一句之后) | `Threshold <给的值> is not a number strictly between 0 and 1, so the default 0.5 was used.`(给的值是数就原样写，如 `1.5`、`NaN`;不是数就写成 JSON —— 字符串带引号 `"0.7"`、数组 `[0.7]`、`null` 写 `null`;无法 JSON 化的(如 BigInt)用 `String()`;连 `String()` 都写不出来(没有原型、`toString` 会抛)就写 `(unprintable)`;任何情况都不抛错) |

- `jevDecision.service.ts` 保留为底层实现(开关、凭证、HTTP),只由 `decisionHelper` 调用;其它文件不再直接 import 它。

## #4 迁移(要不要统一重构：要，全部走 helper)

| 调用方 | 改成 | 阈值 | 行为变化 |
|---|---|---|---|
| BJ3 `uiActGate.ts` | `decisionHelper.choose(riskQuestion, state)` | 默认 0.5(删掉本地常量) | 只在上游坏掉时有变化，方向都偏安全(没有任何回包从「问人」变成「不问人」)。<br>**原来：** 答案缺失、choice 不是字符串、`(confidence ?? 0) <= 0.5`(JS 隐式转换)或 choice 是 `irreversible` → 问人;其余不问人就执行。<br>**现在：** 只有 choice 是 `read_only` / `reversible_write` 且置信度是 `(0.5, 1]` 内的数才不问人;回包坏了一律判 invalid、问人，卡片写「判不了(invalid)」。<br>① 两边都问人，只是卡片原因变了：答案缺失、choice 不是字符串、置信度缺失 / 为负 / 转换后 ≤ 0.5(如 `null`、`false`、`""`、`"0.3"`、`[]`、`[0.3]`),或 choice 是别的字符串而置信度低。原来的原因是「判不准(置信度 X)」;`irreversible` 配坏置信度(NaN、Infinity、大于 1、`"0.9"`、`true`、`{}` 等)原来写「判为不可逆(置信度 X)」。<br>② 原来不问人就执行、现在问人：choice 是别的**字符串**(大小写不同如 `Irreversible`、`toString`、`__proto__` …)而置信度转换后不 ≤ 0.5;或判成 `read_only` / `reversible_write`,置信度转换后不 ≤ 0.5 却不是 `[0, 1]` 内的数(NaN、Infinity、大于 1、`"0.9"`、`true`、`{}`、`[0.9]`)。<br>(审查 001-2 N2 / 199-1 F1。)其余无 |
| BJ1 `snapshotSegment.ts` | `decisionHelper.choose(blockQuestion, state, { threshold: 0.7 })` | 显式 0.7(保持现状，不因默认值改成 0.5 而变) | 方向都偏安全(没有任何回包从整份变成选段)。**原来：** `(confidence ?? 0) < 0.7`(JS 隐式转换)才不采信、返回整份，否则按 choice 选段;**现在：** 置信度是 `(0.7, 1]` 内的数才选段(统一用严格大于),回包坏了判 invalid、返回整份。<br>· 原来选段、现在返回整份(只是多占一点上下文):置信度**恰好 0.7**;置信度转换后不 < 0.7 却不是 `[0, 1]` 内的数(NaN、Infinity、大于 1、`"0.9"`、`true`、`{}`、`[0.9]`;审查 001-1 N1)。<br>· 只有说明变、返回给模型的内容不变(原来就是整份):choice 不在 `criteria` 里;置信度缺失、为负或转换后 < 0.7 的非数(如 `null`、`false`、`""`、`"0.3"`、`[]`、`[0.3]`);`none` 配坏置信度;答案缺失或不是对象。说明从 `picked none` / `confidence …` 变成 `decision maker invalid`;说明只进一条 `info` trace,不回模型(审查 001-2 N2 / 199-1 F1)。<br>选段说明统一成 `not segmented (decision maker <reason>[ <status>])`,不带 message(与 BL 一致;原 card-002 第 2 项提前到这里)。其余无 |
| 技能沙箱 `skillScript.ts` | 沙箱绑定改名 `decision`,提供 `enabled / judge / choose / check / score`,可传 `{ threshold }`;**保留 `jev` 作为同一对象的别名**(已生成的技能脚本可能在用) | 脚本自己传，缺省 0.5 | 新增能力;`jev.*` 旧用法不变，只是失败时的 `message` 改成 #3 表里的句式(原来是 relay 原文;字段不变)。例外：开关开着时裸调 `jev.judge()` / `jev.judge(null)`,原来脚本直接报 TypeError、什么都不发;现在当 `{}` 处理，向 relay 发一次请求(body 只有默认 `model`),失败按 #3 表写(如 `(http 422)`)。开关关着时两边都返回 `off`(审查 199-1 F2 / 001-2 N2) |
| 渲染门面 `jev.handler.ts` | 改名 `DecisionHandler`(`xpc:DecisionHandler/*`),方法同上;没有调用方，改名不破坏任何东西 | 同上 | 无 |
| 渲染层(新) | `src/renderer/common/decision/decisionHelper.ts`:`enabled / judge / choose / check / score`,签名与主进程相同，内部 `createXpcRendererEmitter('DecisionHandler')` | 透传 | 新增 |
| BJ4(未实现) | 规格改为 `decisionHelper.check(readyQuestion, state, { threshold: 0.7 })`,就绪 = `decided && value` | 显式 0.7 | —— |

## #5 验收

- 单测:helper 的阈值判断(等于阈值不算，大于才算;缺省 0.5;非法阈值回落 0.5)、三种题型、各种失败原因都原样带回、`message` 不含 Jev;
  BJ3 / BJ1 / 技能沙箱迁移前后行为一致(用桩掉的底层判定对比);`jev` 别名仍可用。
- 源码守卫:`jevDecision.service` 只被主进程的 `decisionHelper` import;渲染层里 `DecisionHandler` 这个通道名只出现在 `renderer/common/decision/decisionHelper.ts`。
- 渲染层模块的单测：桩掉 xpc emitter,确认 `options`(含 `threshold`)原样到达、返回值原样交回。
- 两边 typecheck。不跑 E2E。
- **实现完成、审查通过后，先交 Ral review 代码**(他要看),通过后才做依赖它的 BJ4 / Jev 默认开启。

## #6 任务

micromeet-cowork `docs/plan/tasks/decision-helper-001.md`(排在 `decision-maker-card-001` 之后)· bitterless `docs/plan/tasks/decision-helper-199.md`(排在 `decision-maker-card-198` 之后)。

## #7 多题一次请求:`decideMany`(问卷 qn-004 加,Ral 2026-09-24)

问卷预答要按 JEV 接口成批问(`micromeet-cowork/docs/features/questionnaire-message.md` #6.1):单选题每批最多
20 道、估算不超过 24k tokens,多选题一题一个请求(每个选项一道 noul),全部串行。helper 原有的
`choose` / `check` / `score` 一次只问一道题,所以加一个多题入口。Ral:「你直接在 qn-004 里加」。

```ts
decisionHelper.decideMany(
  request: { state: Record<string, unknown>; questions: Record<string, JevQuestion> },
  options?: DecisionOptions
): Promise<Record<string, DecisionOutcome<string | boolean | number>>>
```

- **分批:** 超过 20 题或估算 24k tokens 就切,串行发;两个上限常量只在 helper 里。依据:jev-1.13 每请求 64k tokens、
  「state + 最长一题」32k(docs.typesafe.ai/models),文档另警告 state 里无关内容越多准确率越低 —— 批不宜大。
- **判定语义不变:** 每道题与 `choose` / `check` / `score` 共用同一段「读答案 → 比阈值 → 组 outcome」,不另写一份。
- **失败:** 一批失败,这批每道题 `decided:false` 带原因,继续下一批;429 / 529 有上限地指数退避重试(文档建议)。
- **只在主进程:** 不进共享的 `DecisionHelper` 接口;渲染层模块、`DecisionHandler`、技能沙箱绑定都不动,
  等第一个调用方出现再加(与 #2 同一个态度)。
- bitterless 侧由问卷的 BL 移植(`qn-006`)同形加上。
