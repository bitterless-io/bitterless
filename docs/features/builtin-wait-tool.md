# 通用的内置 `wait` 工具(毫秒)

Status: Specced 2026-09-24 · 实现未开始(任务见 #5)

Paired with `micromeet-cowork`:`docs/features/builtin-wait-tool.md`(同一份契约，两仓逐字相同，只有这一行不同)。

## Request

Ral 2026-09-24,前后四句，最后一句为准:

> UI act 不要使用 wait 了，不要包含 wait 动作了，做一个通用的内置 wait 技能吧，因为不仅仅是 UI 操作需要 wait,可能也有别的操作需要 wait。
> 单位就得是毫秒。
> Weight 上限按你的建议 60000ms。
> uiact 也不需要 wait 了，我们需要单独的 wait 内置技能，这样任何场景都能用了。

- **形态：内置工具**,和 `reload_skills` 同类，每一轮都在 agent 手边。不做成要先加载的 SKILL.md 技能 —— 「任何场景都能用」要求它常驻。
- **独立功能**:不属于 `ui_act`(`docs/features/ui-act-wait-hover-jev.md` 已撤掉 wait / wait_for),也不属于下载感知
  (`docs/features/browser-downloads.md` #6 只是它的一个使用方)。
- 这替换掉当天早些时候的两个做法:`ui_act` 的 `{"action":"wait"}` 和 `download_history` 的 `wait_ms`。

## #1 契约

| 参数 | 类型 | 说明 |
|---|---|---|
| `ms` | number,必填 | 等多少毫秒，上限 **60000**。负数当 0 |

| 情况 | 返回 |
|---|---|
| 正常 | `{"ok": true, "waitedMs": 5000}` |
| 超过上限 | 只等 60000,然后 `{"ok": false, "timedOut": true, "waitedMs": 60000, "error": "asked for 90000ms, capped at 60000ms — observe again and decide"}` |
| 被中止(人停掉这一轮) | 立刻返回 `{"ok": false, "aborted": true, "waitedMs": <实际等了多久>}` |
| `ms` 缺失或不是有限数字 | `ERROR: wait needs "ms": a number of milliseconds (0–60000).` |

- 超时**不是**故障，是给 AI 的反馈：结果是 JSON,不加 `ERROR:` 前缀。它的用途是告诉 AI「太久了」,由它重新观察、重新决策(Ral 对等待的要求)。
- 只有输入本身不对才用 `ERROR:`。
- 参数先过 pi 自己的 schema 校验:`ms` 缺失或写成 `"soon"` 时是 pi 报错，工具根本不会运行;`"3000"` 会被转成数字,`null` 转成 0。上面的 `ERROR:` 只兜 pi 放行之后的情况。
- 表里的 JSON 为了好读带了空格，实际输出是紧凑 JSON,键和值相同。

## #2 行为

- **不绑 tab、不绑下载:** 不在 Cowork `bindAgentBrowserTool` 的集合里，也不在 BL 的 scoped wrapper 列表里;不取浏览器锁。
- **实现:** `await timerHelper.delay(ms, signal)`。`timerHelper.delay` 加可选的 `AbortSignal`:到时或被中止都 resolve,**不抛错**,调用方看 `signal.aborted`。
- **不被通用超时截断:** 工具声明 `timeoutMs` = 60000 + 余量(65000)。
- **说等多久就是多久:** 每个工具返回末尾，宿主都会附下载 NOTE;有在途下载时还会再多等最多 15 秒(`DOWNLOAD_SETTLE_BUDGET_MS`)。
  `wait` 不能吃这 15 秒，否则 `wait {ms: 3000}` 在下载途中会变成 3 秒加最多 15 秒。做法：工具定义加可选字段 `downloadSettleMs`
  (`agent/runtime/agentRuntime.types.ts`),`agent/runtime/hostToolExecution.ts` 把它传给现成的 `drainDownloadNote(budgetMs)`;
  `wait` 设为 0 —— NOTE 照常附上，只是不再多等。`download_history` 以后也用这个字段(browser-downloads #6.6)。
- **必须顺序执行(审查 F1,2026-09-24):** pi 默认并行执行同一条 assistant 消息里的工具调用;模型若同时发 `[wait, page_snapshot]`,
  快照 3 ms 就拍完，等于白等。`AgentToolSpec` 加可选字段 `executionMode: 'sequential' | 'parallel'`,由把工具交给 pi 的那一层(`bindPiTools`)
  原样透传;`wait` 声明 `sequential`。pi(`@earendil-works/pi-agent-core` `agent-loop.js:287`)只要一批里有一个顺序工具，就把整批按顺序执行。
  说明里也写一句「单独调用 wait,等它返回再观察」。
- **已知限制:** 等待期间人发来的消息(steering)要等 `wait` 结束才送到，最长 60 s —— 目前只有 bash 能被 steering 打断。先接受;要改另开任务。
- **和 `workflow_wait` 分清:** `workflow_wait`(`agent/workflowEngine/hostIntegration.ts`)是等一个 workflow 跑完：登记后立刻返回、本轮结束，
  跑完时在同一个对话里恢复。`wait` 是本轮之内停一下再继续。两者的工具说明里都要写一句对方是干什么的，免得模型混用。

### #2.1 给模型的工具说明(要点)

- 什么时候用：页面还在加载、下载还在进行、服务端在生成文件、任何「过一会儿再看」的场景。
- 等完要**重新观察**:`page_snapshot`、`download_history` 或对应的读取工具。等本身不告诉你事情成了没有。
- 单次最多 60 秒;超时就说明太久了 —— 换思路或告诉用户，不要一次又一次长等。
- 等一个 workflow 跑完用 `workflow_wait`,不要用 `wait` 轮询。

## #3 改动点(两仓同形)

| 件 | `bitterless` | `micromeet-cowork`(`apps/cowork/`) |
|---|---|---|
| 工具本体(新，**两仓逐字节相同**,形态照 `reloadSkillsTool.ts`,那个文件两仓也逐字节相同) | `src/main/agent/tools/waitTool.ts` | `src/main/agent/tools/waitTool.ts` |
| 注册 | `src/main/maestro/windows/main/maestroWindow.controller.ts`(`reloadSkillsTool` 的注册处) | `src/main/modules/window-manager/windows/main/mainWindow.controller.ts`(同上) |
| 目录条目 | `src/main/agent/hostToolCatalog.ts` | 同左 |
| `downloadSettleMs` 字段 + 传预算 | `src/main/agent/runtime/agentRuntime.types.ts` + `hostToolExecution.ts`(两仓这两个文件本来就有差异，各自改) | 同左 |
| `timerHelper.delay` 支持中止 | `src/shared/timerHelper/timer.helper.ts` | 同左 |
| 工具可声明 `executionMode`(`'sequential' \| 'parallel'`)并透传给 pi | `src/main/agent/runtime/agentRuntime.types.ts`(字段)+ `src/main/agent/runtime/piRuntimeProtocol.ts` 的 `bindPiTools`(一行，传进 `pi.defineTool`) | 同左(`piRuntimeProtocol.ts:60` 附近，紧跟 `parameters`)|
| `check-download-destination` 守卫第 ④ 条：两条路径的断言从 `drainDownloadNote()` 改成 `drainDownloadNote(tool.downloadSettleMs)`(意图不变：成功、失败都附下载 NOTE) | `scripts/maestro/check-download-destination.mjs` | 同名守卫 |
| `workflow_wait` 说明补一句 | `src/main/agent/workflowEngine/hostIntegration.ts` | 同左 |
| `ui_act` 说明两处(两仓措辞逐字相同):加「`ui_act` 没有 wait 动作 —— 要暂停，在两次 `ui_act` 之间调 `wait`」;tab_id 那句的 "cannot catch" 改成 "cannot reliably catch"(uiact-wait-193 复审 N2 / N3) | `maestroWindow.controller.ts` | `mainWindow.controller.ts` |

## #4 验收

- 单测：正常等待(小 ms,实际耗时接近);超上限返回 `timedOut: true` 且 `waitedMs` 是 60000(上限判定与返回格式用纯函数测，不真等 60 秒);
  被中止时立刻返回 `aborted: true`;`ms` 非法报 `ERROR:`;`timerHelper.delay` 被中止时提前 resolve、不抛错;
  有在途下载时，带 `downloadSettleMs: 0` 的工具不多等 15 秒，不带的照旧等(**成功和失败两条路径都要有单测**,不能只靠守卫);
  `wait` 声明 `executionMode: 'sequential'` 且透传到交给 pi 的工具定义里;同一批里有 `wait` 时整批按顺序执行(用 pi 的 agent loop 或同等桩验证)。
- 源码断言:`wait` 不在浏览器目标解析的工具集合里。
- 两仓 `cmp` 确认 `waitTool.ts` 逐字节相同。`yarn typecheck`。不跑 E2E。
- 人做一次：让 agent 在一个慢页面上 `wait {ms: 3000}` 后再 `page_snapshot`。

## #5 任务

bitterless `docs/plan/tasks/builtin-wait-197.md`(排在 `uiact-wait-193` 之后)→ micromeet-cowork `docs/plan/tasks/builtin-wait-001.md`
(排在 `uiact-wait-001` 之后，`waitTool.ts` 从 BL 逐字节复制)。之后才做下载感知(browser-downloads #6)和 BJ4(ui-act-wait-hover-jev #3.1),
它们的 NOTE 都会提示用 `wait`。
