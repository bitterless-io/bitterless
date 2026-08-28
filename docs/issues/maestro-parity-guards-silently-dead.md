# Maestro parity 守卫整套沉默 —— 一个都没在跑,而退出码不说

Status: 已定性(2026-08-28),修复进行中(`docs/plan/tasks/maestro-guard-revival-075.md`)

## Observed behavior

`scripts/maestro/` 有 38 个 parity 守卫,`yarn check:maestro` 是它们的总入口。**现在整套跑不起来,
而且失败的方式不指向真正的问题。**

两层各自独立坏掉:

### 第一层 —— 总入口死在 38 个检查跑起来之前

```
$ node scripts/maestro/check-maestro.mjs
main/llm/maestroLlm.service.ts: forbidden host alias @main/claudeSubscription/claudeSubscription.runtime
renderer/control/src/ControlApp.vue: forbidden host alias @shared/claudeSubscription/claudeSubscription.contract
renderer/workbench/src/views/WorkbenchAppsView.vue: forbidden host alias @shared/onlypreview/onlyPreview.contract
…共 19 条…
    at assertMaestroAliasBoundary (scripts/maestro/_harness.mjs:99:3)
    at scripts/maestro/check-maestro.mjs:13:1
```

`check-maestro.mjs` 的顺序是:

```js
:12  assert(checks.length === 38, …)
:13  assertMaestroAliasBoundary()      ← 死在这里
:14  assertNoStandaloneEntry()
:17  for (const script of checks) { … }   ← 一个都没执行
```

⇒ **一条与 maestro 无关的 alias 违规,让 38 个 maestro 守卫全部不运行。**
那 19 条落在 `claudeSubscription` / `onlypreview` / `common/i18n` 的宿主耦合上,
**全部在已提交代码里** —— 见下「Scope note」。

### 第二层 —— 逐个跑,28 绿 / 10 红

绕过总入口逐个执行:

```
✗ check-agent-runtime      ✗ check-artifact-generation   ✗ check-cli-integration
✗ check-custom-menubar     ✗ check-debugger-toggle       ✗ check-embedded-host
✗ check-inject-button      ✗ check-integration-target    ✗ check-startup-settings
✗ check-update-ux
```

其中 **`check-agent-runtime.mjs` 是崩,不是断言失败**:

```js
// :31
const piOpenAiCompletions = readFileSync(join(workspaceRoot,
  'node_modules/@earendil-works/pi-ai/dist/providers/openai-completions.js'), 'utf8')
// → ENOENT
```

`pi-ai@0.80.10` 的 `dist/providers/` 下**没有** `openai-completions.js` —— 它搬到了 **`dist/api/`**。
(`dist/providers/` 仍然存在,里面是 `openai.js` / `openai-codex.js` 等**模型注册表**,
所以目录在、grep 有结果,**没有任何信号提示路径搬了家** —— 这一点还额外造成过一次误判,
见 [`maestro-attachment-media-assumption-stale.md`](maestro-attachment-media-assumption-stale.md)。)
脚本在第 31 行就退出,
**它下面每一条断言都从未执行过** —— 包括保护 `BaseAgent.prompt` 会话复用形态(`:120-127`)、
`piRuntimeAdapter` 投递形状(`:133`)的那些,以及 `:186-255` 那个 fake runtime 的真实行为测试。

## Root cause

三处症状是**同一个根因的三个面**:

> **守卫把断言锚在第三方依赖的「内部形状」上 —— 文件路径、字符串字面量、序列化细节 ——
> 而没有任何机制把守卫与依赖版本绑在一起。依赖一动,守卫不是响亮地失败,而是静默死掉或继续
> 断言一条已经不成立的事实。**

分解:

| # | 根因 | 证据 |
|---|---|---|
| **R1** | **断言锚在依赖的内部文件路径上。** `dist/providers/openai-completions.js` 是 pi-ai 的构建产物内部结构,不是公开契约 —— pi 把它搬到 `dist/api/` 完全正当。<br>⚠️ **注意搬家而非删除**:被断言的那行 `` url: `data:${item.mimeType};base64,${item.data}` `` **今天仍然存在**(`dist/api/openai-completions.js:747` 与 `:891`),`ImageContent` 也仍是 `{ type, data, mimeType }` 的纯 base64 形状(`dist/types.d.ts:239-243`)。⇒ **守住的事实成立,正确处置是重新指向,不是退役** | `check-agent-runtime.mjs:31` · `:115` |
| **R2** | **`readFileSync` 在断言之外、无兜底。** 文件读取是"取证据"的一步,它失败时脚本应当**响亮地说"我取不到证据"**,而不是抛 ENOENT 混在一堆红里 | 同上;对比 `:115` 之后所有断言从未执行 |
| **R3** | **总入口把跨切面前置条件排在个体检查之前,且用硬 `assert`。** alias 边界是全仓不变量,与 38 个 maestro 检查各自守的东西**没有依赖关系**。把它放在 `for` 循环之前 ⇒ 任何人在任何模块引一个禁用 alias,都会把整套 maestro 守卫连带打黑 | `check-maestro.mjs:12-17` · `_harness.mjs:99` |
| **R4** | **没有"守卫自己在跑吗"的元检查。** 38 个脚本里没有一个断言"其余 37 个都执行到底了"。所以"守卫沉默"这个状态**本身不可观测** —— 它只在有人手动逐个跑时才暴露 | `scripts/maestro/` 全目录 |

**R3 与 R4 合起来产生了最坏的性质:** 沉默期的长度无法从仓库状态推断。已实测的两段:

| 沉默对象 | 起点 | 时长 |
|---|---|---|
| `check-agent-runtime.mjs`(ENOENT 崩溃) | `a9f2b0e`(2026-07-30)把 yarn.lock 的 `pi-ai` 从 `0.79.10` 升到 `0.80.10`;而该断言写于 `d22171b`(2026-07-15,针对 `^0.79.0`) | **~29 天** |
| **整套 38 个**(总入口死在 `:13`) | `c67ac21`(2026-08-24)引入 `@shared/claudeSubscription` 等跨界 import | **~4 天** |

⇒ **已有一个被证实从沉默期溜过去的真缺陷** ——
见 [`maestro-debugger-toggle-unreachable.md`](maestro-debugger-toggle-unreachable.md):
`1a7607f`(2026-08-25 21:09)删掉了 MenuBar 的 debugger 开关,**距守卫失明仅一天**,
而 `check-debugger-toggle.mjs:51` 那条断言是对的、现在确实红 —— 它只是没被执行过。
**R3 不是理论风险。**

## Required behavior

- **取证据失败要与断言失败区分开。** 守卫读不到它要检查的文件时,必须打印一行明确的
  "证据缺失"并以非零退出,而不是抛原始 ENOENT。
- **锚点降级为公开契约。** 断言 pi 行为时优先锚在类型声明(`.d.ts`)或包的公开导出上;
  必须锚在内部结构时,**同一处要断言依赖版本**,版本一变守卫立刻红并指出"请重新核对上游形状"。
- **跨切面前置条件不得连带打黑个体检查。** alias 边界这类全仓不变量应当作为**一项检查**参与汇总
  (红了报它自己红),而不是作为**整套的门禁**。
- **加一条元检查**:汇总器必须核实每个子脚本都执行到底(而不是崩在导入/读文件阶段),
  子脚本崩溃要与断言失败分类上报。
- **退役任何断言必须留痕** —— 脚本里写明退役原因与日期。无声删除会把这次的问题重新种回去。

## Scope note

### alias 违规:**19 条**(不是 17),全部在**已提交**代码里

初版写 17,复核为 **19**(期间 Ral 在并发编辑本仓,脏文件数从 136 动到 141)。
更重要的一处更正:**这些违规不是「未提交的在途工作」造成的** ——
`git diff -- src/*/maestro` 为空,每一处违规都在已落地的提交里
(`c67ac21` 2026-08-24 · `92a4afc`/`1a7607f` 2026-08-25 · `6caec1a` 2026-08-26)。

`_harness.mjs:59-79` 的 `hostAliasAllowlist` 从未为 `c67ac21` 之后那批**有意的**宿主耦合扩展过。
⇒ 处置是 Ral 的决定:**扩白名单** vs **重构那些 import**。不在本 issue 的修复内。
本 issue 只要求「它红了不该连带打黑另外 38 个检查」。

### 另外 9 个红:**8 条 stale-guard + 1 条真缺陷**,同样全在已提交代码里

| | |
|---|---|
| **真缺陷 ×1** | `check-debugger-toggle.mjs:51` → [`maestro-debugger-toggle-unreachable.md`](maestro-debugger-toggle-unreachable.md) |
| **stale-guard ×8** | `artifact-generation`(exceljs/docx 移到 devDependencies 并走 `bundledRuntimeDependencies` 打包)· `cli-integration`(`prepare-maestro-cli.cjs` 的调用点从 `publish.js` 下移到 package scripts)· `custom-menubar`(chrome 瘦身 96→84px、gutter 90→78px 的像素漂移)· `embedded-host`(同 alias 白名单)· `inject-button` / `integration-target` / `update-ux`(硬编码英文字面量迁到 `i18nHelper`,行为不变)· `startup-settings`(脚本自己的 TS loader 不认 `@shared/` 宿主 alias,**代码没问题**) |

**8 条 stale-guard 一条都没修** —— 修哪些由 Ral 决定。它们的共性与 R1 一致:
断言锚在**实现细节**(包管理位置、调用点、像素值、UI 字面量)而不是**行为**上。

**明令禁止**的修法:放宽 `_harness.mjs` 的 alias 白名单让总入口假装通过 —— 那是让守卫继续沉默。
