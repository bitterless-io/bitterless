---
id: maestro-guard-revival-075
scope: Repair the Maestro parity guard suite so it runs again, and classify every remaining failure
status: pending
depends-on: []
verify:
  - check-agent-runtime.mjs runs to completion instead of crashing on a removed pi-ai file
  - Every assertion that referenced a removed pi-ai path either points at the current file or is retired with a recorded reason
  - The nine other failing scripts are each classified as stale-guard, in-flight owner work, or real defect, with evidence
  - No source file outside scripts/maestro is modified
  - Mutation testing shows the repaired agent-runtime assertions still fail when their guarded behavior is removed
  - yarn typecheck:node
  - yarn typecheck:web
  - No Electron/Playwright/E2E
---

# 让 Maestro 守卫复活 —— 修 `check-agent-runtime`,给其余 9 个红定性

## Objective

`scripts/maestro/` 的 38 个 parity 守卫**现在整套跑不起来**,其中最关键的
`check-agent-runtime.mjs` **崩在读取一个 pi 已删除的文件上,里面每一条断言都没在执行**。

steering(`073` / `074`)要改的正是 agent runtime 那几行。**在沉默的守卫上做验收等于没验** ——
所以先修守卫,再动代码。

## 已测基线(2026-08-28,勘察实测,不必重新推导)

```
node scripts/maestro/check-maestro.mjs
  → 死在 :13 assertMaestroAliasBoundary(),38 个脚本一个都没执行
  → 17 条 forbidden host alias,全部来自 onlypreview / claudeSubscription / common/i18n

逐个跑:28 绿 / 10 红
  ✗ check-agent-runtime          ← 本卡主体
  ✗ check-artifact-generation    ✗ check-cli-integration     ✗ check-custom-menubar
  ✗ check-debugger-toggle        ✗ check-embedded-host       ✗ check-inject-button
  ✗ check-integration-target     ✗ check-startup-settings    ✗ check-update-ux
```

## 要做的三件

### 1. 修 `check-agent-runtime.mjs`(唯一要真改的)

```js
// :31 —— 读一个 pi-ai 0.80.10 里已不存在的文件
const piOpenAiCompletions = readFileSync(join(workspaceRoot,
  'node_modules/@earendil-works/pi-ai/dist/providers/openai-completions.js'), 'utf8')
// → ENOENT,整个脚本在这里崩,后面所有断言都不执行

// :115 —— 断言的字符串在整个 dist/providers/ 下已经一处都没有
assert(piOpenAiCompletions.includes('url: `data:${item.mimeType};base64,${item.data}`'), …)
```

**已核实的事实**(不必重查):

- pi-ai `0.80.10` 的 `dist/providers/` 里**没有** `openai-completions.js`;
  现有的是 `openai.js` / `openai-codex.js` / `azure-openai-responses.js`
- **`base64` 在整个 `dist/providers/*.js` 里出现 0 次**

**要求**:

- 让脚本**跑到底**。读文件那步要么指向现存文件,要么带存在性判断后跳过并**打印一行明确的跳过原因**
  (不要静默 `try/catch` 吞掉 —— 沉默正是这次的病根)
- `:115` 那条断言:**先判断它守的那件事现在还成立不成立**,再决定改指向还是退役。
  **退役必须在脚本里留一行注释写明退役原因与日期**,不许无声删除
- **`:133` 那条 `piRuntime.includes('this.session.prompt(message.text)')` 不要动** ——
  它是 `073` 的活(steering 要给 `prompt()` 加第二个参数)。本卡只让它**能跑起来**,
  跑起来之后它应该是**绿**的(当前代码确实是那个形状);如果跑起来发现是红的,**报回来**
- 修完把 `check-agent-runtime.mjs` 里**每条断言的绿/红逐条列出来**

### 2. 给另外 9 个红定性 —— **只定性,不修**

每个给出三选一 + 证据:

| 分类 | 判据 |
|---|---|
| **stale-guard** | 守卫过期(像 `check-agent-runtime` 那样断言了已不存在的上游形状) |
| **in-flight owner work** | Ral 正在改的 `onlypreview` / `claudeSubscription` / `submodules` 造成的 |
| **real defect** | 真代码缺陷 |

判 `real defect` 的必须给出**具体失败断言 + 为什么它守的那件事真的坏了**。
判 `in-flight owner work` 的要指出是哪个未提交改动引起的。

**一个都不要修。** 这卡的产出是一张定性表,修哪些由 Ral 决定。

### 3. `assertMaestroAliasBoundary()` 的 17 条 alias 违规 —— **不碰,只列**

它们全部落在 Ral 未提交的 `onlypreview` / `claudeSubscription` / `common/i18n` 工作里
(`main/llm/maestroLlm.service.ts` 引 `@main/claudeSubscription/...`、
`renderer/workbench/.../WorkbenchAppsView.vue` 引 `@shared/onlypreview/...` 等)。

**这是 Ral 的活。** 本卡只把 17 条按「哪个文件 → 引了哪个禁用 alias」列全,交给他。
**不要改任何 `src/` 文件,不要改 `_harness.mjs` 的 alias 白名单去绕过它。**

## Path

- `scripts/maestro/check-agent-runtime.mjs`(唯一要改的文件)
- 其余只读

## 硬约束

- **只改 `scripts/maestro/check-agent-runtime.mjs`。** `src/` 下一个文件都不许动;
  `_harness.mjs` 不许动(尤其不许放宽 alias 白名单)
- **禁止任何分支 / worktree 操作。禁止任何 git 写操作**(不 add / commit / stash / revert / checkout)
- 只用 `yarn`,禁 npm/pnpm。**不跑 Electron E2E**(overmind 硬规则)
- ⚠️ Ral 在 bitterless 有 **115 个未提交文件**,集中在 `onlypreview` / `claudeSubscription` /
  `submodules`。**一个都不要碰**,也不要 `git checkout` 任何文件
- 代码风格跟随周边(`scripts/maestro/*.mjs` 的既有写法)

## Verification

- `node scripts/maestro/check-agent-runtime.mjs` —— **跑到底**,逐条断言的绿/红列出来
- `yarn typecheck:node` · `yarn typecheck:web`
- **突变验证,至少 3 条,每条先报锚点命中数(≠1 就换锚点)**:修好的断言各挑一条,
  把它守的行为从源码里去掉 → **必须变红**。证明修完的断言**不是空转的**
  (这次的病根就是"看起来有守卫,实际一条都没跑")
- **不要**把 `check-maestro.mjs` 的 `38` 改成别的 —— 本卡不新增脚本
