# `ui_act`:hover + 动作后就绪判断(BJ4)+ Jev 默认开启

Status: Specced 2026-09-24 · 实现中 · 同日两次改定：先撤 `wait` 动作，再撤 `wait_for`(见 Request)

Paired with `micromeet-cowork`:`docs/features/ui-act-wait-hover-jev.md`(契约相同，只有路径不同)。

本仓风格：语句带分号;`for…of` 不用 `forEach`;i18n 走 `i18nHelper`。

## Request

Ral 2026-09-24:

> ui_act 要能支持 wait 和 hover 吧,wait for 我记得 playwright 有等待某一个元素或内容显示的，
> 内里也加下看看，但是 wait 和 wait for 都需要有超时反馈，超时的作用是告诉 ai 太久了，让 ai 重新决策。
> 不需要单独的 wait 工具，完善 ui_act 工具,ui_act 还能补充 hover 操作。
> 然后需要让 jev 支持 ui_act。bl cowork 都要做，另外 jev 默认开启。

> 需要 common 下配置 timerHelper,`await timerHelper.delay(500)` 能写出同步语法的 sleep 功能，
> 尽量都用 async await 语法，代码更好维护。

> (同日 10:51,当面改定 —— **以此为准**)UI act 不要使用 wait 了，不要包含 wait 动作了，做一个通用的内置 wait 技能吧，
> 因为不仅仅是 UI 操作需要 wait,可能也有别的操作需要 wait。……单位就得是毫秒。

改定的含义:`ui_act` 撤掉 `{"action":"wait"}`,只加 `hover` 和 `wait_for`(后者随后也撤了，见下一条);定时等待改由通用的内置 `wait` 工具承担(毫秒，任何场景可用),
规格在 `docs/features/browser-downloads.md` #6,与下载感知一起做。

> (同日稍晚，再次改定 —— **以此为准**)Wait for 先不要保留了，等后面我觉得需要这个东西的时候再做吧。

改定的含义:`wait_for`(连同由 Jev 判的 `until`)推迟，等 Ral 需要时另开;本文的 `ui_act` 只加 `hover`。BJ4(#3.1)不受影响。

同日确认的三项(AskUserQuestion):

| 问题 | Ral 的选择 |
|---|---|
| 「让 Jev 支持 ui_act」指什么 | **两个都做**:动作后由 Jev 判页面就绪(BJ4),**并且** `wait_for` 支持自然语言条件由 Jev 判(`wait_for` 部分随后撤销，只剩 BJ4) |
| Jev 默认开启怎么落地 | **首次写入 true**:没存过这一行就写一行 `true`;手动关过的保持关;配置库读失败仍按关 |
| 开启后未登录 / Jev 调不通时 BJ3 怎么办 | **未登录当关，其它仍问**:`unauthenticated` 等同开关关闭(放行);`http` / `network` / `invalid` / 判不准仍问人 |

### 起因

- 2026-09-24 Cowork 会话 `agent-io/20260924093707803-n6kpenpgltjmuev3a2u`(Maestro 同一套 walker / ui_act,同样缺等待手段):点开 Stripe 发票后第 3 秒、第 7 秒两次
  `page_snapshot` 都只拿到一个 `status` 节点(页面还没渲染),第 10 秒 `list_tabs` 已显示加载完。
  agent 没有「等一下再看」的手段，只能碰运气重拍(定时等待由通用 `wait` 工具补上，见 `docs/features/builtin-wait-tool.md`)。审核报告:overmind
  `areas/agent-runtime/chat/audit-report/20260924-094500-n6kpenpgltjmuev3a2u-review.md` P3-01。
  **注意：空快照未必是时机问题。** 那个弹窗 tab 是 agent 点出来、从未显示过的 view —— 和 issue 里点击无效的两次是同一类 tab;
  同一会话里显式打到另一个不在前台的 tab(`tab-mudyx7fj-7`,应用重启后恢复的旧 tab)时点击正常。差别在哪还没查明
  (overmind `areas/agent-runtime/browser-use/browser-use-tools.html` #3.1 的 2026-09-24 补充)。如果空快照的原因在 view 本身，
  再怎么等也只会按时超时，让页面渲染出来要靠那条 issue 的修法。
- 与 [`issues/ui-act-on-background-tab-stalls-and-click-has-no-effect.md`](../issues/ui-act-on-background-tab-stalls-and-click-has-no-effect.md)
  的关系：那条是「后台 tab 上点击卡 5 秒/次且无效」，根因是 tab 不在前台，**不在本文范围**;
  本文不解决那条的卡顿。

## 不做什么

- **等待不在本文。** 定时等待是通用的内置 `wait` 工具(`docs/features/builtin-wait-tool.md`);按条件等待(`wait_for`)推迟到 Ral 需要时再做。
- 不修后台 tab 卡顿(见上面的 issue)。
- 不把现有其它文件里的本地 `sleep` / `delay` 批量换成 `timerHelper`(无关改动)。清单见文末，Ral 要时另开任务。

## #1 `timerHelper`

新文件 `src/shared/timerHelper/timer.helper.ts`,形态照 `src/shared/idHelper/shared/id.helper.ts`(导出一个对象):

```ts
const delay = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, Number.isFinite(ms) && ms > 0 ? ms : 0))
}

export const timerHelper = { delay }
```

- 放 `shared/` 而不是 `main/common/` 或 `renderer/common/`:`ui_act` 在主进程，渲染进程也要能用，
  `shared/` 是两个进程都 import 得到的公共目录(`@shared/*` 两份 tsconfig 都有)。
- 负数 / NaN 当 0。
- **本仓的 maestro 别名边界守卫**(`scripts/maestro/_harness.mjs` `assertMaestroAliasBoundary`)不许 maestro 代码 import 宿主的 `@shared/…`。
  `timerHelper` 是跨切面的公共工具，按该守卫已有规则(i18n / 主题这类跨切面服务用前缀放行)在 `hostAliasPrefixAllowlist`
  加 `'@shared/timerHelper/'`,不挪进 `src/shared/maestro/`(那样它就不是公共的了)。2026-09-24 编排者定。
- 本文新写的等待一律 `await timerHelper.delay(ms)`;`drive/replayEngine.ts` 与 `drive/humanMouse.ts` 这两个本次必改的文件里的本地
  `wait()` 换成它。

## #2 新动作 `hover`

`actions_json` 里每一项仍是一个对象，新增一种 `action`:`hover`(`wait` 与 `wait_for` 同日先后撤掉，见 Request)。
与已有五种(click / fill / select / check / submit)同批执行、同样「第一条失败就停」。

| action | 参数 | 行为 | 成功 | 失败 |
|---|---|---|---|---|
| `hover` | `ref` 或 `selector` | 定位目标 → 拟人指针沿轨迹移到目标上(`HumanMouse.moveTo`;定位复用 `clickStep` 里的 `clickLocator` 求值 —— 抽成 `locateTarget` 私有方法供 click 与 hover 共用，与 Cowork 形状一致),**不按下** | `ok:true` + `target` | 定位不到 → `ok:false`,error **以** `hover target not located` **开头**,后面带定位失败的原因(如 `: element has no box (0x0) …`、`: Selector not found: …`),停批 |

- **已知限制(2026-09-24):** 在 agent 点出来、从未显示过的 tab 上，hover 和点击一样慢(同一条轨迹，每个移动点约 5 秒，一次 2–3 分钟);
  能不能触发悬停效果没验证。见 `docs/issues/ui-act-on-background-tab-stalls-and-click-has-no-effect.md`「2026-09-24 决定与补充」。
  修好之前已知可行的做法是先 `activate_tab {tab_id, show:"true"}`;真实会话验收 hover 要用显示着的 tab。

### #2.1 ~~`wait_for` 的四种条件~~(已撤)

2026-09-24 Ral:「Wait for 先不要保留了，等后面我觉得需要这个东西的时候再做吧。」连同 `until`(#3.2)一起推迟;需要时另开。
编号保留，免得别处的引用错位。

### #2.2 ~~超时反馈~~(已撤，随 `wait_for`)

定时等待的超时反馈改由通用 `wait` 工具承担(`docs/features/builtin-wait-tool.md`)。

### #2.3 Jev BJ3(不可逆闸)与新动作

`hover` **不改应用状态**,在 `uiActGate.ts` 的 `needsJudgement` 里保持「不判」(当前只判 click / submit,不用改判定逻辑)。
只需保证新动作能过 `gateUiActions` 的类型与遍历，不引发 Jev 调用。

### #2.4 工具说明

`ui_act` 的 `description`(`src/main/maestro/windows/main/maestroWindow.controller.ts`)补上 `hover` 的参数。
`src/main/maestro/drive/requestExec.helper.ts` `parseAgentUiActions` 的 `allowed` 列表与「no valid actions」报错文案同步。

### #2.5 目标 tab

`ui_act` 已经接受 `tab_id`:wrapper(`maestroWindow.controller.ts` ~1918,`withAgentBrowserTarget`)解析目标 tab 并把 `tab_id` 传进 `execute`。
`hover` 与 #3 的就绪判断**都必须作用在这次调用的目标 tab 上** —— 沿用 `toolUiAct` 现有取目标 tab / `replayEngine` 的方式，
不得读人眼前的前台 tab。工具说明里写明一句：用哪个 tab 拍的快照，就带同一个 `tab_id`(ref 只在拍它的那个页面里有效)。

## #3 Jev 接进 `ui_act`

### #3.1 动作后的就绪判断(BJ4)

设计出处：overmind `areas/agent-runtime/decision/browser-use.html` #1 的 BJ4(页面就绪闸，实测就绪 0.80 vs 加载壳 0.03)。

**何时跑：** 一批动作**全部成功**,且最后一个动作是 `click` 或 `submit`。最后一个是 `hover` / `fill` / `select` / `check` 时不跑(这几种通常不换屏)。

**流程**(在现有 700 ms `wait.popup` 之后):

```text
readiness budget = 8000 ms(从 wait.popup 结束起算)
loop:
  summary = readPageSummary()          ← 一次 Runtime.evaluate,**不走树、不重编 ref**
  if Jev off / unauthenticated → 跳过整段(fail-open,等于没有这一格)
  r = decisionHelper.check(readyQuestion, { page_url, title, summary }, { threshold: 0.7 })   ← docs/features/decision-helper.md
  if !r.ok (http/network/invalid) → 跳过(fail-open)
  if r.ready > 0.7 → done(ready)
  if 已用时 + 1000 > budget → done(not ready)
  await timerHelper.delay(1000)
```

- `readPageSummary()`:`document.title` + `body.innerText` 规整空白后前 1500 字符 + 可交互元素个数(`a,button,input,select,textarea,[role=button]`)。
  **不能**用 `capture.snapshot()`:走树会清掉全部 `data-coach-ref` 从 e1 重排(见 `uiActGate.ts` `describeUiAction` 的注释)。
- noul 题目照 `jev-browser-probe.mjs` 的 B4:
  `instructions: "Does this page show a finished, interactive screen — i.e. the real content and controls have rendered?"`,
  `criteria: { true: "the page has rendered its real content and controls", false: "it is still a loading shell, a skeleton, a blank page, an error page, or a login wall" }`。
- 阈值 0.7,调用时显式传给 Decision Helper(全局默认是 0.5;`browser-use.html`:BJ1 / BJ4 / BJ5 用 0.7,BJ3 用默认 0.5)。
- 失败方向 **fail-open**(`browser-use.html` #3):判不了就当就绪，照原逻辑返回。

**结果里怎么说：** 在 `ui_act` 返回的文本末尾(`drainNewTabsNote()` 之前)追加一行，只在真的跑了 BJ4 时出现:

| 情况 | 追加 |
|---|---|
| 判就绪 | `NOTE: page judged ready after 1.2s (decision maker ready=0.86).` |
| 8 秒仍未就绪 | `NOTE: page still looks like it is loading after 8.0s (decision maker ready=0.05). Wait a moment with the wait tool, then page_snapshot again — or decide on a different path.` |

不停批、不改 `ok`,只给信息。NOTE 里一律写 decision maker,不写 Jev(`docs/features/decision-maker-naming-and-approval-card.md`)。

### #3.2 ~~`wait_for` 的 `until`~~(已撤，随 `wait_for` 推迟)

## #4 Jev 默认开启

### #4.1 开关读法

`decision/jevDecision.service.ts` 的 `isJevEnabled()`:

```text
row = configStore.get(decision / jev-enabled)
if row == null:
    configStore.insertIfAbsent(decision / jev-enabled, true)   ← 新增的 ConfigDao 方法,INSERT … ON CONFLICT DO NOTHING
    row = configStore.get(...)
return row?.options === true
```

- 手动关过的行(`false`)永远不会被覆盖:`insertIfAbsent` 在已有行时什么都不做，没有「先读后写」的竞态。
- 配置库没起来(xpc 通道没注册)时 `get` / `insertIfAbsent` 都回 `null` → 仍然读成**关**,不把页面内容外发。这条旧防护保留。
- 设置页 store(`src/renderer/home/src/views/setting/components/DecisionSetting/decisionSetting.store.ts`)`load()` 先调同一个 `insertIfAbsent` 再读，
  这样不管主进程先读还是先打开设置页，看到的都是开。

### #4.2 BJ3 未登录放行

`uiActGate.ts`:`!result.ok && (reason === 'off' || reason === 'unauthenticated')` → 放行。
`http` / `network` / `invalid` / confidence ≤ 0.5 / 判为不可逆 → 仍然问人(不变)。
理由：默认开之后，没登录 Bitterless(`customerSessionService.current?.token` 为空)的用户每点一下都会被弹窗打断(Ral 2026-09-24 选定)。

### #4.3 连带影响(写明，不回避)

- **BJ1(快照选段)也随之默认开**:模型给了 `goal` 且快照超过阈值时会调 Jev。
- **PQ-1(快照与元素文案能否发到 TypeSafe)由此被定为「默认全开」**:`browser-use.html` 里它原是「待拍板、推荐按 host 白名单」。
  这次 Ral 的决定是默认开，关掉仍在 Settings → Decision。PQ-1 在该文里的状态需要同步(overmind 侧，不在本仓)。
- 设置页开关下面那行「生效范围」说明(i18n key `scope`)改为：生效于 BJ1、BJ3、BJ4(ui_act 动作后就绪判断);
  BJ2 / BJ5 尚未接入。`src/renderer/common/i18n/zh.ts` + `en.ts` 的 `setting.decision.scope` 同改。
- [`features/setting-decision-section.md`](setting-decision-section.md) 里「默认值 关」与「两条判据」加日期更正，指向本文。

## #5 改动点

| 文件 | 改什么 |
|---|---|
| `src/shared/timerHelper/timer.helper.ts` | 新建 |
| `src/main/maestro/drive/replayEngine.ts` | `AgentUiAction` 加 `hover`;`runStep` 支持 hover;本地 `wait()` → `timerHelper.delay` |
| `src/main/maestro/drive/humanMouse.ts` | 本地 `wait` → `timerHelper.delay` |
| `src/main/maestro/drive/requestExec.helper.ts` | `parseAgentUiActions` 解析新动作与参数校验 |
| `src/main/maestro/drive/requestExec.service.ts` | BJ4 就绪判断与 NOTE;700 ms 的内联 `new Promise(setTimeout)` → `timerHelper.delay` |
| `src/main/maestro/drive/uiActGate.ts` | 未登录放行 |
| `src/main/decision/jevDecision.service.ts` | `isJevEnabled` 首次写入 true |
| `src/preload/maestro/sqlite/config.dao.ts` + `src/shared/maestro/config.api.ts` | `insertIfAbsent` |
| `src/main/maestro/windows/main/maestroWindow.controller.ts` | `ui_act` 工具说明 |
| `src/renderer/home/src/views/setting/components/DecisionSetting/` + `src/renderer/common/i18n/{zh,en}.ts` | 默认开 + 范围说明 |

## #6 验收

- 单测(`tests/maestro/`,`node --test`):
  - `timerHelper.delay`:负数 / NaN 当 0;确实等了约 ms。
  - 解析:`hover` 被接受;`wait` / `wait_for` 不再被接受(当作不认识的动作)。
  - `hover`:指针移到目标上、不按下;定位不到 → `ok:false`,error 以 `hover target not located` 开头，停批。
  - BJ4:最后一个动作是 click 且 Jev 先 0.05 后 0.9 → NOTE「judged ready」;一直 0.05 → 8 秒后 NOTE「still looks like it is loading」;Jev off → 无 NOTE、无额外等待。
  - BJ3:`unauthenticated` 放行，不调 `askOperator`;`network` 仍调。
  - 开关：无行 → 写入 true 并读成开;已有 false → 保持关;`get` 抛错 / 回 null 且 `insertIfAbsent` 回 null → 关。
- `yarn typecheck`。
- 不跑 E2E(仓库规则)。真实会话验收待 Ral:在 hover 才出现菜单的页面上让 agent 用 `hover` 打开菜单;点 Download invoice 后看 BJ4 的 NOTE。

## 附：未迁移的本地 sleep / delay(本次不动)

`src/main/agent/BaseAgent.ts:151`、`src/main/agent/workflowEngine/processTree.ts:17`、`src/main/maestro/apidoc/apiDoc.service.ts:1221`、`src/main/mcp/mcpBridge.server.ts:141`、`src/renderer/maestro/control/src/store/message.store.ts:120`、`src/renderer/maestro/localHome/src/localHomeAuth.store.ts:16`。`src/main/eyesOnAgents/claudeHookOutbox.service.ts:71` 是同步 sleep,另议;`src/main/maestro/drive/requestExec.service.ts` 里 `toolUiAct` 的内联 700 ms 等待也还没换。
