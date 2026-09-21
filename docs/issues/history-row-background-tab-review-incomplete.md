# 历史记录后台开 tab:对抗性复核被限流打断,8 条候选未定案

Status: resolved 2026-09-21 — all 8 candidates adjudicated; every one stood and is fixed. The two finder lenses that never ran were re-run separately.

[history-row-opens-background-tab.md](../features/history-row-opens-background-tab.md) 已实现、单测/类型检查通过并已提交。实现完成后按 docs-sprint 惯例另起一个对抗性 review workflow(5 个 finder + 每条候选独立复核),核对 Cowork 与 BL 两仓的改动。那一轮跑到一半,账号级 rate limit 同时打断了当时并行的两个会话——包括这个 review workflow 自己的子 agent。

## 现状不是「已复核通过」

当时的 task-notification 显示 `"confirmed":[],"refuted":[...]`,看起来像是「找到几条,复核后全部推翻」。核实 workflow 的 journal(`agent-*.jsonl`)后发现不是这样:

- 5 个 finder 里只有 3 个跑完并产出候选(共 8 条);另外 2 个在读文件读到一半被 429 打断,永远不会有第二种视角的候选了。
- 负责复核这 8 条候选的 16 个 verifier agent,**没有一个跑完**——每个的 transcript 只有 4 行(系统初始化 + 技能清单 + 一句话),全部停在同一个 rate-limit 时间戳。
- workflow 脚本把「拿不到复核结果」和「复核后判定为假」用同一个空数组处理,于是 8 条全部落进 `refuted`,`reasons` 全是空数组——这是「没查」不是「查过了不是问题」。

## 8 条候选(未验证,按来源标注仓库)

1. **cowork** `apps/cowork/src/main/modules/browser/browser.controller.ts` ~1443行 — background 分支新开的 tab 如果被 `enforceWarmCap` 在诞生瞬间冷却(view 被销毁),`loadInitialPage` 会命中 `!wc` 分支静默 no-op:tab 出现在条上但从不加载,只有用户手动点它才会重新加载。复现条件:同时存在 4 个 warm 且不可驱逐的 tab(pinned/connector/当前活跃/本轮 agent 打开的)时,新开的第 5 个背景 tab 首当其冲被冷却。
   - 注:验收 todo(`验收 BL / Cowork：历史记录行改成后台新 tab`)第 6 步已经把「后台 tab 切过去时已加载或能正常重载」都算作通过,所以就算这条属实,也可能已经在可接受范围内——但那条验收步骤写的时候没意识到「诞生即冷却」和「后来才冷却」是两种不同的后果,值得确认一次。
2. **cowork** `apps/cowork/src/renderer/home/src/components/MenuBar/menuBar.store.ts:208` — `restoreAddress()` 用 `TabInfo.displayUrl` 重建地址栏,而不是地址栏真正的数据源 `navUrlOf(tab)`。mini-app tab 的 `liveDisplayUrl` 从不上线,file tab 也是静态路径而非 `file://`。具体场景:在锁定的 OnlyPreview mini-app tab 上开着预览某文件,点一条历史记录后地址栏会被 `restoreAddress()` 覆盖成 `micromeet://only-preview`,不会自愈,除非切换文件或切走再切回来。
3. **cowork** `apps/cowork/src/main/modules/browser/browser.controller.ts:1432` — background 分支在主进程测试里零覆盖:把整个 `if (params.background) {...}` 块删掉,`browserHistory.test.mjs` 30 项照样全绿。渲染进程测试只证明了「渲染进程发了 `background: true`」,没人证明主进程真的听了。
4. **bl** `src/main/maestro/windows/main/maestroBrowserView.service.ts:2226` — 同上,BL 侧的 background 分支同样零覆盖,删掉对应块 `maestroBrowserHistoryInput.test.mjs` 16 项照样全绿。
5. **bl** `tests/maestro/maestroBrowserHistoryInput.test.mjs:130` — `restored === 1` 断言的是测试自己装的回调计数器,没有真正驱动 `menuBarStore`。删掉生产代码里 `browserHistoryStore.setAddressRestorer(...)` 那一行注册,16 项照样全绿——真正的接线没被钉住。Cowork 侧的等价测试(`browserHistory.test.mjs:354`)是对的,断言的是 `f.state.url` 最终字符串。
6. **cowork** `apps/cowork/tests/unit/browserHistory.test.mjs:377` — "metadata tab broadcasts preserve typing" 这条用例是空转的:`f.setTabs([...])` 只写 `tabStore.tabs`,而 `menu.store` 不订阅 `cowork/tabs`、也不 watch `tabStore`,所以断言对任何实现都成立。BL 侧对应用例(`maestroBrowserHistoryInput.test.mjs:204`)是对的,直接调用 `menu.applyTabs(...)`。
7. **cowork** `apps/cowork/tests/unit/browserHistory.test.mjs:714` — 契约 #3.3「地址栏直接回车维持 navigate」没被真正钉住:fixture 把 `coach.navigate` 和 `coach.openTab` 都推进同一个 `navigations` 数组,两者无法区分,所以就算把 `go()` 最后一行悄悄换成 `openTab({ background: true })`,断言照样通过。
8. **cowork** `apps/cowork/tests/unit/browserHistory.test.mjs:404`(nit)— `crashed` 变量声明后从未被赋值 `true`,`isValidate()` 的崩溃分支从未被真正跑到。

## 当时的下一步(已执行,结论见下一节)

需要重新跑一遍(建议把 finder 数量补回 5 个、verifier 补回每条候选独立复核),或者人工逐条过一遍上面 8 条再定案。在此之前不应该把「refuted: []」当成这次改动已经过审。

## 定案(2026-09-21)

**8 条全部属实,没有一条被推翻。** 由实现方逐条复核并修掉;两个从未跑完的 finder 视角
(BL 实现、同构/文档)另起一轮补跑。修法如下:

| # | 结论 | 修法 |
|---|---|---|
| 1 出生即被冷却 | 属实 | cowork `openTab` 后台分支加 `if (!this.liveWc(tab)) await this.viewSlot.ensureWarm(tab)`。**BL 不需要** —— 它的 `claimSpareTab` 已经 `enforceWarmCap([tab.id])` 把新 tab 排除在驱逐名单外,这条前提由 BL 守卫第④条钉住 |
| 2 `restoreAddress` 取错字符串 | 属实 | cowork 新增 `navUrl` 字段(`cowork/nav` 与 `applyTabs` 两处写入),复位取它而不是 `displayOf(tabStore.activeTab)`;单测补一条 OnlyPreview mini-app 场景,断言复位成 `file:///Users/ral/docs/x.md` 而不是 `micromeet://only-preview` |
| 3 cowork 主进程分支零覆盖 | 属实 | 新守卫 `apps/cowork/scripts/check-history-background-tab.mjs`(`yarn check:history-background-tab`)。变异实测:删整个分支 / 删 `applyBounds` / 删 `broadcastTabs` / 删 `ensureWarm` 四个变异体全部变红 |
| 4 BL 主进程分支零覆盖 | 属实 | 同构守卫 `scripts/maestro/check-history-background-tab.mjs`,并额外钉住 `enforceWarmCap([tab.id])` 这条「BL 为什么不需要 ensureWarm」的前提 |
| 5 BL 复位接线未钉 | 属实 | 新单测 `the real menuBarStore wiring puts the address bar back after a background history open` —— 用真的 `menuCode` 起 `menuBarStore`、走 `bindAddressInput`,断言 `menu.url`;守卫第⑦条再钉一次注册行本身 |
| 6 cowork 空转用例 | 属实 | 改成直接调 `f.state.applyTabs(...)`(与 BL 侧同构),不再只写 `tabStore.tabs` |
| 7 地址栏直接回车未钉 | 属实 | fixture 新增 `opens` 数组记录调用的是哪个动词,断言 `f.opens.at(-1)[0] === 'navigate'` |
| 8 `crashed` 死开关(nit) | 属实 | 去掉字段,`isCrashed()` 直接返回 `false` 并写明这套用例覆盖的是弹窗 view 的 `render-process-gone`,不是宿主 renderer 崩溃 |

复核方法与第一轮同构(独立 agent、先试图证伪、拿不到复核结果**不**记作推翻)——
第一轮把「没查」和「查过不是问题」折叠成同一个空数组,这次的脚本把两者分开成
`confirmed` / `unverified` / `refuted` 三档。
