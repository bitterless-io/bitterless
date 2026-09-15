# `/view_context_graph` —— 把「此刻的上下文」画成可读的结构(Maestro control)

状态:**已实现(2026-09-09)**。落地清单与验证见 [#9](#9-落地与验证)。
来源:Ral 2026-09-09「bitterless 也做下,先做文档然后做」——`/view_context_graph` 先在 cowork 落地
(契约 `micromeet-cowork/docs/features/cowork-context-graph.md`),本页是 bitterless 这一侧的契约。
**parity 方向照旧:cowork 是源,bitterless 跟随**(`maestro.md` #Upstream)。

Ral 对这个功能的原话(cowork 那次):「从 system prompt 开始 每个消息的类型都要展示出来…一个 block
一个 block 的展示…通过 modal 弹窗展示出来,然后需要是半透明的效果,点击后可以跳转对应的消息区域,
如果是不显示在 UI 上的上下文 block 就不能点击,要能区分 turn」;目标随后点明:**为了理解当前上下文的结构**。

## #0 这次不是从零 —— 地基已经有五分之四

移植前先把「已经有什么」钉住,否则会重新发明一遍已经存在的东西(而重新发明的那份必然与既有的漂)。

| 已有 | 在哪 | 这次怎么用 |
| --- | --- | --- |
| pi `0.85.1` + `SessionEntry` 联合类型 | `package.json`;`import type { SessionEntry }` 在三个 main 文件 | 直接用 |
| 条目树 | `AgentRuntimeContextSurface.entries()` → `BaseAgent.existingContextSurface()` | 直接用 |
| 组装入口 | `src/main/agent/contextExport.service.ts`(`flattenEntries` / `buildContextRecord` / `renderContextText` / `entriesOfSurface`) | **抽出 `flattenEntryRows`**,`flattenEntries` 成为它的投影 |
| 压缩边界 | `src/main/agent/compaction/compactionEntries.ts` `compactionBoundary()` | **直接用**(见 #2.1) |
| 系统提示词 | `BaseAgent.composedSystemPrompt()`(`copyNextTurnContext` 已经在用) | 直接用 |
| slash 面板 | `control/src/SlashMenu.vue` + `store/shortcut.store.ts` + `store/shortcut.type.ts` | 加第四条命令 |
| 注入式执行体 | `ShortcutRunContext { newChat, copyContext, copySessionPath }` | 加第四个回调 |
| xpc 三跳 | `shared/maestro/coach.api.ts` → `main/maestro/xpc/coach.handler.ts` → `maestroWindow.controller.ts` → `main/agent/maestroAgent.service.ts` | 照 `copyNextTurnContext` 的形状加一条 |
| 黏底机器 | `message.store.ts` `listEl` + `stickToBottom`(120px 阈值)+ 5 处无条件 `scrollToBottom(true)` | 跳转要先松它(见 #3) |
| 会话换即重挂 | `ControlApp.vue` `<ChatPanel :key="activeSession.id">` | 弹窗状态不会跨会话留下来 |

**所以本次真正新增的只有五件**:`flattenEntryRows` 抽取 · `contextGraph.service.ts` ·
`readContextGraph` 一条 xpc(三跳)· `ContextGraphModal.vue` + 兄弟 `.less` ·
`scrollToMessage()` + 行上的 `data-message-id` + 第四条命令的三处接线。

## #1 与 cowork 相同的四个判断(不在这里重新论证,只给出处)

1. **结构只能由 main 给。** 渲染层的上下文投影算的是**预算账**,没有工具调用与工具返回正文 —— 而那是
   窗口里最大的一块。理由逐字写在 `contextExport.service.ts` 顶上的注释里(bitterless 这份也有)。
2. **回合是「上下文回合」,不是渲染层那个 `Turn`。** 仓里没有 turn 身份,渲染层也推不出可靠分组键;
   数的是模型看到的边界 —— 一条**存活的** user 条目开启一轮。
3. **认领 fail closed。** 一条 `user` 条目的正文是整块拼装后的 turn prompt,不是用户那句话,所以
   「哪一块对应界面上哪条消息」只能在 main 用消息正文的前 200 字符 `includes` 认领,游标只前进,
   认领不到就留空。**错链比不可点糟得多。**
4. **被吸收的条目只汇总不逐条列。** 它们模型已经看不到,逐条列出来画的是"我们存了什么"。
   顺带把 xpc 载荷钉成有界。

上游论证:`micromeet-cowork/docs/features/cowork-context-graph.md` #0 / #2 / #3 / #4。

## #2 与 cowork **刻意不同**的八处

这一节才是这份文档存在的理由 —— 逐字移植会在这八处出错(#2.7 / #2.8 是实现期定的)。

### #2.1 压缩边界用 bitterless 自己的 `compactionBoundary()`,**不移植** cowork 的 `absorbedBoundaryIndex()`

bitterless 这版更强,而且强在一个真实分支上:

```ts
// compactionEntries.ts:75
const keptIndex = list.findIndex((entry) => entry.id === previous.firstKeptEntryId)
return { startIndex: keptIndex >= 0 ? keptIndex : previousCompactionIndex + 1, … }
```

`firstKeptEntryId` **找不到**(上一轮把尾部清空了 ⇒ 那个 id 故意匹配不到任何 entry)时它退到
`previousCompactionIndex + 1`,与 pi 未导出的 `prepareCompaction` 同一个分支。cowork 那版在同样情形下
退成 `0`,也就是**报告"什么都没被吸收"** —— 一个只在压缩过的长会话里出现、且方向是"少报"的偏差。

保留 cowork 的那条豁免:**`compaction` 条目自己永不算被吸收**(它携带的 summary 是活着的一块)。
fallback 边界恰好落在它后面,所以豁免不是可选的。

> **回流待办**:这条差异要带回 cowork(`absorbedBoundaryIndex` 换成同一个 fallback)。
> 记在 #8,不在本次改动里 —— 那是另一个仓的改动,而且它需要自己的守卫用例。

### #2.2 i18n:两张表、点号访问、**没有插值器**

`i18nHelper.maestroControl.contextGraph.*`,新键同时进 `src/renderer/common/i18n/en.ts` 与 `zh.ts`;
parity 由 `export const zh: typeof en` 的**类型**保证(`yarn typecheck:web`),没有 key 对等测试。

**这里没有 `controlText()` 那样的插值函数。** 表里的 `{count}` / `{chars}` 是字面花括号,三个既有调用点
各自替换(`ChatPanel.vue` 的 `withCount`、`turn.service.ts` 的私有 `interpolateChatCopy`、
`ResponseStatus.vue` 的链式 `.replace`)。本次**在弹窗组件内放一个三行 `fill()`**,不抽公共的 ——
抽公共的要改那三个既有调用点,是本次没被要求的重构。

### #2.3 样式:兄弟 `.less` + 扁平 BEM,不是 Tailwind

所有样式进 `ContextGraphModal.less`,BEM 扁平、最多两个 `__`(`context-graph__block--locked`)。

**样式的引入方式按目录改口**:本文初稿照 `CLAUDE.md` 写的是 `<style>` 里一行 `@import`,而
`maestro/control/src` 这一支(从 cowork 移植来的那批)六个兄弟**全部**是脚本侧 `import './X.less'`,
`<style>` 块一个都没有。仓里两种写法都存在(bitterless 自己的 home 渲染器用 `<style>@import`),
所以判据不是"仓里哪种多",而是**一个目录里只能有一种** —— 否则 diff 里这个文件会格外扎眼。落地按目录。
颜色照本渲染器既有习惯:hex + `rgb(R G B / N%)`(本仓没有共享 token 层,control 渲染器一个自定义属性都没有)。
等宽与数字对齐照既有字面量习惯(`ui-monospace, SFMono-Regular, Menlo, monospace`、`font-variant-numeric: tabular-nums`)。

**`z-index` 必须大于 20** —— 拖拽提示遮罩 `.chat-panel__drop-overlay` 占了 `z-index: 20`,
它同样是 `position:absolute; inset:0`(这也正是"面板内半透明遮罩"在本仓的既有先例)。

### #2.4 一条边框都不用

Ral 2026-09-09 的全局规则:「你尽量不要用带 border 的 UI 设计,除非我要求你有」。分层靠三样:
**底色落差**(纸浅灰 / 块白 / 页脚更深一档)· **抬起**(可点的块一层 1px 阴影,不可点的块是平的半透明白
—— 抬起本身就是"能点"的信号)· **留白与圆角**(回合之间不画横线)。
吸收段用**斜纹底**、pending 段用**实色淡蓝**,两者刻意反义(一个已经出局,一个即将进场)。
唯一保留的细条是**类型色轨** —— 它不是分隔线,是这一块的类型编码。

既有的 `SlashMenu.less` 里有 `border: 1px solid var(--bl-royalblue-100, …)`:**不在本次清理范围**
(规则明说"已经存在的边框不要顺手清")。

### #2.5 **没有 jsonl 页脚**

结构图保持只展示上下文结构，不添加日志页脚。原先未配置 `setModelIoRoot()` 的缺陷已由
[日志入口修复](../issues/maestro-model-io-chain-is-dead.md) 单独处理（2026-09-15）；
日志路径通过 `/copy_session_path` 和 `/view_context` 获取。

### #2.6 加一条命令要改三个文件,而且 Enter 分支在两处

命令名是**封闭字符串联合**,`ShortcutStore.commit()` 用 `switch` 显式分派(`default` 回
`unknown command`,是刻意的可见失败)。所以第四条命令 = `shortcut.type.ts` 的联合 +
`shortcut.store.ts` 的 `switch` + `ChatPanel.vue` 的注册数组 + 两张 i18n 表。
命令名只能用 `[\w-]`(开菜单的 token 正则是 `/(?:^|\n)\/([\w-]*)$/`)。

`Enter` 在**两处**分支:`onComposerKeydown`(键盘)与 `send()` 里对 `slashVisible` 的第二道检查
(Send 按钮)。两处都已存在,新命令自动受益 —— 但改动这一块时不能只看一处。

### #2.7 pending 段的三处口径(实现期定的)

1. **`pending.draft` 是拼装后的 turn prompt,不是输入框里那几十个字**(cowork 送原始草稿)。
   pending 这一块的真实体量是整块拼装后的提示词(含每轮注入的上下文与技能简介);只送原始草稿会把它
   **少报一整个前缀**,而"谁在吃窗口"正是这个弹窗存在的理由。顺带让 `/view_context` 与这条对同一状态
   报同一个 pending,不出现两个口径。附带效果:pending 那块的 preview 显示的是提示词开头而不是你那句话 ——
   这与其它块一致(user 块的 preview 同样是拼装后的正文),而你那句话就在弹窗底下的输入框里。
2. **附件给绝对路径**(cowork 给 basename),与本仓 `copyNextTurnContext` 同一口径 —— 两条命令描述的是
   同一个 pending 集合。弹窗里显示 basename、`title` 带全路径,面板只有 380px。
3. **`pending.workspace` 从入参的 `WorkspaceRef` 取**:本仓的请求本来就带 `context`,不为一行显示字段
   给这个服务新增依赖(cowork 那边是控制器补的,因为它的请求不带 context)。

### #2.8 服务直接产出 xpc 契约里的类型

`buildContextGraph` 返回 `ContextGraphView` 本身,**不另立一套 main 侧同形类型**(cowork 是
`ContextGraph` + `ContextGraphView` 两张结构相同的表,靠人手同步)。这个函数的唯一出口就是那条 xpc,
少一张表 = 少一处会静默漂的地方。守卫因此**不该**去断言一个 main 侧的 `ContextGraph` 接口。

## #3 跳转落点这一侧要新建什么

- **行上没有任何身份。** `MessageItem.vue` 的根节点是 `<div name="messageItem" class="message-item">`
  —— `name` 是**静态字面量**,整个 maestro 渲染器里唯一的 `data-*` 与 `scrollIntoView` 属于会话抽屉。
  所以要加 `:data-message-id="props.message.id"`。
- **`scrollToMessage(messageId)` 进 `message.store`**,与 `scrollToBottom` 同一形状
  (`nextTick` + `requestAnimationFrame` 双写 —— 流式 markdown 会改行高),但**第一件事是
  `this.stickToBottom = false`**:5 处无条件 `scrollToBottom(true)` 与 `setListEl` 每次挂载重新武装它,
  不先松就会被当场拽回底部。停在视口上四分之一处,不贴顶。
- **闪光用外发光环,不用背景色。** 仓里已有先例是 home 老聊天的 `message-highlight-pulse`
  (背景 `var(--bl-royalblue-200)`),但 maestro 的气泡底色**带语义**
  (connector `#ecfdf5` / error `#fef2f2`),背景闪会和它们打架。1.6s 自清,与 store 里的定时器成对
  —— 两个数必须一起改。
- 列表是**全量 `v-for`**(无窗口化),所以屏外消息在 DOM 里存在,能滚到。

## #4 载荷有界

`readContextGraph` 只回**有界投影**;正文那条路仍归 `/view_context`(它不截断,原则上无界,所以它去剪贴板)。

| 字段 | 形状 |
| --- | --- |
| 每块 | `i` · `entryId` · `parentId` · `type` · `tool?` · `chars` · `turn` · `preview`(≤160)· `messageId?` |
| 头部 | `sessionId` · `provider` · `model` · `systemChars` · `systemPreview` · `turns` · `totalChars` · `byType[]` · `pending` · `absorbed?` · `noHistory` |

与 cowork 的 `ContextGraphView` 同名同形,**少一个 `ioLogDir`**(#2.5)。
认领用的头部长度是**两侧共享的一个常量**(`CONTEXT_GRAPH_MATCH_HEAD_CHARS = 200`,放
`shared/maestro/coach.api.ts`):渲染层按它截、main 按它再夹一刀。两侧写成两个数的话,长消息会
**静默**停止可点,而这是不会报错的那类偏差。

## #5 UI:一条竖向块栈

面板宽 **380–480px**(`layout.store.ts` `MIN_SIDEBAR_W`/`MAX_SIDEBAR_W`),没有并排多列的余地。
而"点击跳到对应消息"这条要求本身把它钉在 control 渲染进程里,所以**弹窗在面板内是自洽的**。

```
┌ 遮罩(面板内 · 半透明 + 轻模糊 · z-index > 20)──────────┐
│ ┌ 纸(浅灰 · 圆角 14 · 阴影,无描边)─────────────────┐ │
│ │ CONTEXT STRUCTURE                            ✕   │ │  深色头
│ │ provider/model                                    │ │
│ │ ▓▓▓░░░░░░░░░░░░░░  分布条(按类型,同色索引)      │ │
│ │ 3 turns · 11 blocks · 118,402 chars               │ │
│ ├──────────────────────────────────────────────────┤ │
│ │ ▌system prompt      17,339  🔒                    │ │  白块 · 平(不可点)
│ │ ▨ 已并入摘要 · 128 块 · 402,110 字符(斜纹)       │ │
│ │   turn 1                                  62,884  │ │  吸顶标签,无横线
│ │ ▌user                2,904  ↳                     │ │  白块 · 抬起(可点)
│ │ ▌tool_call read_file    96  🔒                    │ │
│ │ ▌tool_result read_file 58,352 ████████████ 🔒     │ │  量条:分母是最大那一块
│ │ ▌assistant           1,214  ↳                     │ │
│ │ ▐ pending · this send    64  🔒(实色淡蓝)        │ │
│ └──────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

方向是**仪表盘**而不是"漂亮卡片":目标是理解结构,所以**体量必须可见** —— 一条 `tool_result` 吃掉 58k
而 system 只有 17k,这件事在纯文本里要靠人数字符,在这里是一眼。

## #6 守卫

- **新** `scripts/maestro/check-context-graph.mjs`。**运行时**断言照搬 cowork 那份(结构 / 回合 /
  认领 fail-closed / 游标只前进 / 工具块不参与认领 / 压缩边界 / 载荷有界 / 无边框 + 抬起=可点),
  静态断言按 bitterless 自己的文件名与表达重写。用本仓既有的那份递归 CommonJS + alias 解析的
  headless 加载器(三个守卫里逐字复制的那个),不引入第四种写法。
- **umbrella 计数**:`check-maestro.mjs` 的 `assert(checks.length === 42, …)` → `43`,
  **顺手修那句 off-by-one 的消息**(现在断言 42 却写着 "expected 43")。
- **`tests/maestro/maestroComposerHistory.test.mjs` 现在就是红的**:它断言注册表只有两条命令
  (`['/clear', '/view_context']`),而今天已经有三条;它的 i18n mock 也缺 `slashCopySessionPath`。
  第四条命令会让它更红 → 本次把 fixture 修到与注册表一致。**这是别人改动留下的红,不是本次引入的**。
- **别期待 umbrella 当场变绿**:它的前置断言 `assertMaestroAliasBoundary()` 是 fail-fast,而当前
  工作区里另一个会话未提交的 OnlyPreview 改动有若干处 alias 违规。判据用 `git archive HEAD` 的只读
  基线对比(见 `bitterless 验证基线`),不要把别人的红认到自己账上。

## #7 不做

- **不移植 cowork 的 Tailwind 类、`controlText()`、ioc/inversify store**(#2.2 / #2.3)。
- 结构图继续用原始条目统计被吸收的内容；`/view_context` 的有效上下文读取由
  [独立修复](../issues/view-context-includes-compacted-history.md) 处理。
- **不给工具条目可点**(它们在界面上没有载体)。
- **不加持久化的 turn 字段**(上下文回合是 main 侧算得出的派生量)。
- **不用 Arco `a-modal`**:它的 `content` 收窄成 string、且本仓规矩要求 closable + 关闭按钮,
  而这里要的是"面板内半透明遮罩 + 底下就是跳转落点"。用既有的手写遮罩先例
  (`.chat-panel__drop-overlay`)。
- **不抽公共插值器、不清 `SlashMenu.less` 既有边框**；日志入口修复见 #2.5 的独立 issue。

## #8 验收

| 场景 | 期望 |
| --- | --- |
| `/view_context_graph` | 面板内开出半透明弹窗,第一块是 system prompt |
| 每种类型 | user / assistant / tool_call / tool_result / compaction / pending 各有自己的块与色轨 |
| 发生过压缩的会话 | 吸收段**折成一条**并标出条数;`firstKeptEntryId` 找不到时边界退到上一条 compaction 之后 |
| 点 user / assistant 块 | 列表滚到那条消息并闪 1.6s;**不被流式钉底抢回去**;跳到了才关弹窗 |
| 点 system / tool / compaction 块 | **不可点**,光标与视觉(平、不抬起、锁形)都说明这一点 |
| 认领不到的块 | 不可点 + 说**「定位不到这条消息」**(与"界面上没有它"是两句不同的话) |
| 上下文回合 | 吸顶标签分组;中途 steering 显示成独立回合 |
| Esc / 点遮罩 | 关闭 |
| 面板 380px 宽 | 不横向溢出 |
| 一条边框都没有 | 守卫扫 `class`/`.less` |

**回流待办(不在本次)**:把 #2.1 的 `firstKeptEntryId` fallback 带回 cowork 的
`absorbedBoundaryIndex()`,并给它一个用例(上一轮清空尾部 ⇒ 那个 id 匹配不到任何条目)。

## #9 落地与验证

| 文件 | 角色 |
| --- | --- |
| `src/main/agent/contextExport.service.ts` | 抽出 `flattenEntryRows`;`flattenEntries` 成为它的投影 —— 剪贴板导出的行形状**一个字节没变** |
| `src/main/agent/contextGraph.service.ts` | **新**。`buildContextGraph`(纯函数)+ `CONTEXT_GRAPH_PREVIEW_CHARS` + 认领。边界走本仓 `compactionBoundary()` |
| `src/shared/maestro/coach.api.ts` | `readContextGraph` + `ContextGraphView` 一族 + `CONTEXT_GRAPH_MATCH_HEAD_CHARS`(两侧同一个数) |
| `src/main/maestro/xpc/coach.handler.ts` · `windows/main/maestroWindow.controller.ts` · `agent/maestroAgent.service.ts` | 三跳转发 + 执行体(与 `copyNextTurnContext` 同一批真源,逐条注明留下/去掉了哪一步) |
| `src/renderer/maestro/control/src/ContextGraphModal.vue` + `.less` | **新**。只排版:类型轨 · 体量条 · 回合吸顶头 · 抬起=可点 · 无边框 |
| `src/renderer/maestro/control/src/ChatPanel.vue` | 注册第四条命令 · 消息摘要(原文前 200 字符)· 注入 `openContextGraph` · 面板内挂弹窗 |
| `store/shortcut.type.ts` · `store/shortcut.store.ts` | 封闭联合 + 显式 switch 分派(store 仍然只有一条 `import type`) |
| `store/message.store.ts` · `MessageItem.vue` · `MessageItem.less` | `scrollToMessage()`(先松黏底,再三次测量)· 行上的 `data-message-id` · 1.6s 外发光环 |
| `src/renderer/common/i18n/{en,zh}.ts` | `maestroControl.contextGraph` 16 键 + `chat.slashViewContextGraph` |
| `scripts/maestro/check-context-graph.mjs` | **新**守卫。**18 个变异全部被捕获**(含"退回 cowork 那个 fallback-to-0 的边界") |
| `scripts/maestro/check-maestro.mjs` | 计数 42 → 43,顺手修了那句本来就 off-by-one 的消息 |
| `tests/maestro/maestroComposerHistory.test.mjs` | 修 fixture:注册表四条、i18n mock 补键、`@maestro-shared/coach.api` 值导入的 mock、`props.session.messages` |

**验证**

- `check-context-graph` 绿;**18/18 变异被捕获**(边界 fallback / 压缩豁免 / 错链 / 工具块认领 /
  游标 / 头部截断 / preview 上限 / 回合边界 / totalChars / 关弹窗时机 / 不可点变按钮 / 两句话合一 /
  抬起 / z-index / 松黏底顺序 / 1.6s 配对 / 行锚点 / 真边框)。
- `typecheck:node` 与 `typecheck:web` 里**我的文件零错误**;剩下的错误在 `git archive HEAD` 的干净树里
  同样存在(`turn.service.ts` × 3、`maestroAgent.service.ts` 的两处 pre-existing 只是被我的插入推下去了 91 行)。
- `maestroComposerHistory.test.mjs`:**四条 slash 用例全绿**(含改过的注册表顺序)。同文件另外 3 条
  会话抽屉用例在 HEAD 就是红的(fixture 只喂了 `historySessions`,而面板早已读 `sessionListItems`)——
  别人改名留下的债,不在本次修。
- 同组守卫:`check-chat-composer` / `check-compaction-integration` / `check-control-link-policy` /
  `check-file-reading` 绿;`check-agent-activity` / `check-agent-runtime` / `check-chat-performance` /
  `check-debugger-toggle` 红,而它们**在 HEAD 的干净树里同样红**。
- `assertMaestroAliasBoundary()` 报 4 处违规,全部在另一个会话未提交的 OnlyPreview 文件里
  (`localPathTarget.ts` / `maestroBrowserView.service.ts`);我的文件全部用 `@maestro-*`。
  umbrella 是 fail-fast,所以在那 4 处清掉之前 `yarn check:maestro` 不会跑到我这条。
- **未跑 Electron E2E**(房规:不主动跑)。
