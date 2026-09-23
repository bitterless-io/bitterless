# Setting → Decision 板块(Jev 开关)

Status: Specced + implemented 2026-09-23(Phase 1 = 界面与持久化)· Phase 2 部分已接:BJ3 + BJ1(见文末更正)

## Request

Ral 2026-09-23:「两边的 setting 都:增加一个 decision 板块。Decision 板块下面的表单里面只有一个内容,
就是 jev 的开关……如果开关打开,就走 JEV 去决策;如果开关关闭,就按照现有的循环流程走。」

「两边」= 本仓 + `micromeet-cowork`。Cowork 侧还要把 Settings 的结构改成本仓这种
「左侧分区导航 + 右侧分区内容」,那部分记在 cowork 的
`docs/features/workbench-settings-sections.md`;本仓结构本来就是目标形态,所以只加一个分区。

开关的语义由 overmind `areas/agent-runtime/decision/browser-use.html` #1 的五个插入点定义
(BJ1 选段 / BJ2 选 ref 残量 / BJ3 动作不可逆分级 / BJ4 页面就绪闸 / BJ5 接口-界面选路):

- 开 → 这五格走 Jev 判定;
- 关 → 完全按现有循环流程走,一次 Jev 调用都不发。

## 本轮做了什么

| | |
|---|---|
| 分区位 | `SETTING_TABS` 里 `systemPrompt` 之后插 `'decision'` —— 它和 systemPrompt 同族(都在配 agent 怎么想),排在通知/日志/关于之前 |
| 组件 | `views/setting/components/DecisionSetting/`(`.vue` + `.less` + `.store.ts`),与其余分区同形,`defineAsyncComponent` 懒载 |
| 控件 | 一个 `a-switch`,label `用 Jev 做 agent 决策`;下面一行说明它管什么 |
| 默认值 | **关** |
| 持久化 | `ConfigDao`(`domain='decision'` / `key='jev-enabled'`,options 是布尔),与 capture 的 allowlist 全局开关同形 |
| i18n | `setting.decision.*`,`en.ts` + `zh.ts` 同时补齐 |

### 两条判据,不是口味

- **默认关,且读不到 / 读失败一律读成关。** `electron-xpc` 对「通道没注册」和「handler 抛了」
  都回 `null` —— 于是「配置库坏了」和「人把它关了」是同一个值。把那个默认成开,
  等于在配置库坏掉的那天把页面内容发给第三方 API。合规边界(browser-use.html PQ-1)也还没拍板。
- **界面要说清它还没接线。** 本轮只做界面 + 持久化;开关打开时行为与关闭时完全一致,
  直到 Phase 2 落地。不写这一行,它就是个骗人的开关。

### 与 cowork 的对齐

`DECISION_CONFIG_DOMAIN` / `DECISION_JEV_ENABLED_KEY` 两个常量**两仓同名同值**。
两边的配置库各自独立,对齐的收益是同一份排查经验两侧都成立 —— 这条与
`config.api.ts` 里 `APIDOC_CONFIG_DOMAIN` 已经写下的理由是同一条。

## 验收

- Setting 左侧出现「决策 / Decision」,点开只渲染该分区。
- 开关可开可关,重开应用后保持;配置读失败时显示为关并给出提示行。
- 其余 9 个分区一行未改。
- 不跑 E2E(仓库规则)。

## Phase 2(不在本文范围)

把开关接到 BJ1–BJ5。届时至少要解决:主进程侧怎么读这个开关(同一对常量)、Jev API key 从哪来、
按 host 的白名单(PQ-1)、以及每一格的失败方向(browser-use.html #3 —— BJ3 是 fail-closed,
其余 fail-open)。

## 2026-09-23 更正:开关下方那行说明

Phase 1 写的是「已保存，但尚未接线」。之后 BJ3（`src/main/maestro/drive/uiActGate.ts`，ui_act 点击/提交前的不可逆闸）
和 BJ1（`src/main/maestro/drive/snapshotSegment.ts`，模型给了 goal 时的快照选段）两边都接上了，都读这个开关（关 → `reason:'off'`，
BJ3 直接放行、BJ1 原样返回），那行字就成了反向的误导：开关打开已经有效果，界面却说没有。

现改为如实写明范围：生效于这两处，其余判断点（BJ2 / BJ4 / BJ5）尚未接入。i18n key 由 `pending` 改为 `scope`。
**接线范围再变时，这一行必须同一改动内跟着改。**

## 2026-09-23 BJ3 置信度阈值 0.7 → 0.5

Ral:「confidence 大于 0.5 都不需要人工去 confirm」。`uiActGate.ts` 的 `CONFIDENCE_FLOOR` 由 0.7 改为 0.5,
比较由 `<` 改为 `<=` —— **大于 0.5** 才采信 Jev 的分级,等于或低于仍按不可逆去问人。
判成 `irreversible` 的动作照样问,与置信度无关(PQ-2「每次都问」不变)。BJ1 选段的 0.7 不是人工确认闸,不在此列。
