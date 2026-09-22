# 双击 Zellij tab 就地改名

Status: **withdrawn 2026-09-22 —— 功能已从代码里删除,见 #8**。(原需求 2026-09-16,Ral:「browser tab 增加双击编辑 alias 的功能,
但只给 miniapp zellij 开放。1. input 长度和文字输入长度匹配,超出 20 个字截断。2. 清空文本点击回车保存
的时候,直接还原到 zellij 作为 title。3. 回车保存 zellij tab 的 title 需要持久化,重启恢复」)。

范围是 **bl 的 Cowork 窗口**的 tab 条(`src/renderer/maestro/home/src/components/MenuBar/`)。

这是 [tab-alias.md](tab-alias.md) 的**第二个入口**,不是第二套机制:存的还是那一个
`TabInfo.alias` 字段,落盘走的还是 `persistSoon` → `tabs` 表 → `restoreTabs` 那条路。新增的只有
「怎么把名字输进去」。

## #0 目标

| # | 目标 | 判据 |
|---|---|---|
| G1 | 双击 Zellij tab chip 进入编辑 | chip 里就地变成输入框,预填当前显示名 |
| G2 | **只有** Zellij | 其余每一种 tab 双击一律无事发生 —— 不是置灰,是这个手势在它们身上不存在 |
| G3 | 输入框宽度跟着字走 | 空 → 一个字符宽;打字变宽;上限是 chip 自己的宽度 |
| G4 | 20 字截断 | 第 21 个字**打不进去**,而不是打进去再报错 |
| G5 | 回车保存 | 保存后 chip 立刻显示新名字 |
| G6 | 清空 ＋ 回车 = 还原成 `Zellij` | 空串是**删除别名**,退回 spec 给的 title |
| G7 | 跨重启存活 | 关掉 app 再开,这个 Zellij tab 还叫那个名字 |

## #1 为什么落在 `alias` 上,而不是 `title`

`tab.title` 有六个写入方(`page-title-updated`、composite 的 `setTitle` seam、两个 tab 工厂、
`restoreTabs`、`newTab` 的 mini-app 分支)。名字写进 `title`,任何一条一响就**静默冲掉**用户起的名字
—— 这是 tab-alias.md #1 已经付过一次的学费,这一发不再付第二次。

所以「改 title」这个说法在实现上是 **`alias`**:显示端 `tabLabel()` 本来就是 `alias || title || …`,
alias 一写上,chip 立刻显示它;alias 一删掉,chip 立刻退回 `title`,而 Zellij composite tab 的
`title` 恒为 spec 的 `'Zellij'` —— G6 因此不需要任何「还原成 Zellij」的专门代码,它是 G5 的空串分支。

## #2 只给 Zellij 开,判据放在哪儿

判据是 `tab.kind === MAESTRO_ZELLIJ_TAB_ID`,**两处都要**:

| 位置 | 作用 |
|---|---|
| 渲染层 `beginRename()` | 决定这个手势在这个 chip 上是否存在(G2) |
| main 侧 `setTabAlias()` | XPC 是独立入口,渲染层的判断不是保护 |

main 那一道不是洁癖:`CoachXpcContract` 上的方法渲染进程谁都能调,而这一条会写进设置与 sqlite。
和 `setAsHomepage` 硬拒非 composite 同一条纪律 —— 菜单/手势只是**看得见的**那一半。

> 右键菜单里的 `Alias…` 保持原样,对每一个非默认固有 tab 都开放(tab-alias.md #3)。本需求加的是
> **手势**,不是收窄既有能力:双击只给 Zellij,是因为三个 Zellij tab 全叫 `Zellij` 时最需要它。

## #3 写回的路:渲染层需要一条自己的 XPC seam

今天 alias 只有一条写入路径:main 的右键菜单 → 覆盖层表单 → `promptTabAlias()` 自己写 `tab.alias`。
渲染层**没有**任何写 alias 的能力。

所以新增 `CoachXpcContract.setTabAlias({ id, alias })`,main 侧把 `promptTabAlias` 里那段写回逻辑抽成
`applyTabAlias(tabId, next)` 给两边共用。抽出来的那段带着一条不能丢的规矩:

- **`pinned` 的 tab 还要写一次设置。** pinned tab 不进 `SavedTab`(`isRestorableComposite` 要求
  `!t.pinned`,那条过滤不许放松),`homeAlias` 是它的名字**唯一**的落脚点。漏掉就是「条上立刻变了,
  下次启动没了」,而且是静默的(tab-alias.md #4 / custom-homepage-tab.md #2.1)。

## #4 落盘:一个字都不用新写

G7 走的是已经在跑的四环,本需求**没有**新增任何持久化代码:

| 环节 | 现状 |
|---|---|
| `tabs` 表有 `alias` 列 | 已有(DDL ＋ `addMaestroColumnIfMissing` 迁移) |
| `TabsDao` 三处列名 | 已有 |
| 渲染层 `persistSoon()` 的 `.map()` 里有 `alias` | 已有 —— 这一格漏了就是**永不落盘且不报错** |
| `restoreTabs` 在 `openCompositeTab` **之后**补写 alias | 已有(tab-alias.md PQ-3) |

最后一条是 composite tab 专有的:那条恢复路径按 spec 重建 tab、把存下来的行整个忽略,所以 alias 必须
在 `openCompositeTab` 返回**之后**补写。守卫 `check-tab-alias.mjs` ③ 已经钉住这个顺序。

Zellij tab 进得了 `persistSoon` 的白名单,靠的是 spec 的 `restorable: true` ＋ 它自己的 `instanceId`
(`isRestorableComposite`)。所以这条名字跟着的是**那条会话**,不是「左起第三个 tab」。

## #5 20 字:为什么和共享的 64 不一样

`MAESTRO_TAB_ALIAS_MAX_LENGTH = 64` 是**表单**的上限 —— 覆盖层那张卡片有的是宽度。就地编辑发生在
chip 里,chip 的宽度是被 tab 条的收缩算法钳死的,所以它有自己的、更紧的上限:
`MAESTRO_TAB_INLINE_RENAME_MAX_LENGTH = 20`。

两个数放在同一个 shared 文件里、互不引用 —— 它们钉的是两块不同的画布,把其中一个定义成另一个的
函数只会让下次改宽表单时顺手把 chip 挤坏。

截断在**写进状态之前**做(`value.slice(0, 20)`),不是靠 `maxlength` 属性:输入法组字、粘贴、拖放
三条路都能绕过 `maxlength`,而 chip 的宽度账已经按 20 算好了。`maxlength` 照样写上,它负责让第 21 个
**按键**当场没反应(G4 要的正是这个手感)。

## #6 宽度跟着字走(G3)

`width: <max(1, draft.length)>ch`,外加 `max-width: 100%`。

`ch` = 当前字体下 `0` 的前进宽度,对本仓 chip 用的等宽感字体族足够近似;它不需要精确,它需要的是
**空输入框不是一条通栏、长输入框不撑破 chip**。`max-width: 100%` 那一半是硬的:没有它,20 个中文字
会把 chip 顶宽,而 tab 条的收缩算法会把**其余每一个** tab 挤变形。

## #7 提交与放弃

| 手势 | 结果 |
|---|---|
| `Enter` | 提交(空串 = 删除别名 → 退回 `Zellij`) |
| `Escape` | 放弃,一个字都不改 |
| 失焦(点别处) | **提交** |
| 输入法组字中的 `Enter` | 不提交 —— `event.isComposing` 时直接放行给输入法 |

失焦提交而不是放弃,是因为这个手势的心智模型是「改名」而不是「填表」:点走就把刚打的字丢掉,是本仓
在 alias 表单上刻意没有的行为(那张卡片有明确的取消按钮,chip 里没有)。`Escape` 是那条明确的退路。

编辑期间 chip 的 `draggable` 关掉、点击不再切 tab —— 否则选文字这个动作会变成拖 tab。

## #pending-questions

| # | 问题 | 倾向 | 阻塞什么 | 状态 |
|---|---|---|---|---|
| PQ-1 | 其余 composite(OnlyPreview / Trench)要不要也开双击? | 先不开 —— Ral 点名只给 Zellij。要开,改的是 #2 那一个判据,两处一起改 | G2 的边界 | **已定** — 只给 Zellij |
| PQ-2 | 普通网页 tab 要不要开双击? | 不要 —— 双击 tab 条在浏览器里普遍是「最大化窗口」,抢掉它会让每个用户都踩一次 | | **已定** — 不开 |
| PQ-3 | 20 字上限要不要按显示宽度算(中文占两格)? | 不要 —— 「20 个字」是 Ral 的原话,按**字符**数最直白;宽度由 `max-width: 100%` 兜底 | | **已定** — 按字符 |

## #8 撤回(Ral 2026-09-22)

> 取消 tab 双击改名的功能,只能右击点击 alias 改名

改名入口收敛成**一个**:右键菜单的 `Alias…`([tab-alias.md](tab-alias.md) G1)。整套就地编辑
**从代码里删掉了**,不是藏起来 —— 留着一条没有入口的编辑态,只会让下一个人以为它还在用。

删掉的东西:

| 位置 | 删掉的 |
|---|---|
| `MenuBar.vue` | tab chip 的 `@dblclick`、`onTabDblClick` / `renameWidth` / `onRenameKeydown`、进入编辑时聚焦全选的那个 `watch`、chip 里的 `<input>`、`onTabClick` 里让位给光标的那道闸、`:draggable` 里的 `isRenaming` 项、以及 `:title` 里那句「双击可重命名」 |
| `tab.store.ts` | `renamingTabId` / `renameDraft` / `renameMaxLength` / `canRename` / `isRenaming` / `beginRename` / `updateRenameDraft` / `cancelRename` / `commitRename` |
| `i18n/en.ts` · `i18n/zh.ts` | `menuBar.maestro.renameTab` 与 `renameTabHint`(两种语言一起,`check:renderer-i18n` 要求 key 对齐) |

**没删、刻意留着的:** main 侧的 `setTabAlias` XPC(`coach.api.ts` → `coach.handler.ts` →
`maestroWindow.controller.ts` → `maestroBrowserView.service.ts`)连同它的 Zellij-only 拒绝与
`MAESTRO_TAB_INLINE_RENAME_MAX_LENGTH`(20 字)截断。它现在**没有调用方** —— 唯一那个是
`commitRename`。留着的理由有两条:`check-zellij-tab-chrome` 的 ④ 段以「XPC 是独立入口,任何 renderer
都能调,而它会写 settings 与 sqlite」为由钉着那道 main 侧判据,那条理由与手势本身无关;而删掉它要
横跨四个文件。**这是一处已知的死代码,要不要一起清掉是 Ral 的决定。**

一个真实的行为后果:Zellij chip 的 alias 现在只能经覆盖层那张卡片设置,而它的上限是 **64**
(`MAESTRO_TAB_ALIAS_MAX_LENGTH`),不是就地编辑那 20。#5 当初把 20 的理由写成「chip 的宽度账已经
按 20 个字算好了」—— 现在 Zellij chip 和其余每一种 tab 一样,靠 tab 条的收缩算法与 CSS 兜。

### #8.1 防回归

`check-zellij-tab-chrome.mjs` 的 ⑤ 段从「钉住这个手势存在」**反转**成「钉住它不存在」:
`MenuBar.vue` 里不许再出现 `@dblclick`,`tab.store.ts` / `MenuBar.vue` 里不许再出现
`isRenaming` / `renameDraft` / `renamingTabId` / `beginRename` / `commitRename` / `canRename`。

反向钉的理由:这个手势看起来只是一行 `@dblclick`,极容易被"顺手加回来",而加回来之后**不会有任何
测试变红** —— 就地编辑的每一处状态都得跟着回来,才会有人发现。
