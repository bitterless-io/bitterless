# 关闭 Zellij tab 需要确认

Status: implemented — owner testing pending(2026-09-16,Ral:「bl cowork zellij 的 tab 关闭时需要
alertview 弹窗确认,包括 close tabs to the right、close other tab 等,只要关闭范围包括 zellij 就都要
alertview confirm,多个 zellij 触发只有第一个触发 confirm 一次」)。

范围是 **bl 的 Cowork 窗口**(`src/main/maestro/**`)。姊妹实现在 `micromeet-cowork`
(`apps/cowork/src/main/modules/browser/browser.controller.ts` ＋ `shellAlertView.service.ts`),
本次**只改 bl 一侧** —— Ral 点名的是 bl。

## #0 目标

| # | 目标 | 判据 |
|---|---|---|
| G1 | 关掉一个 Zellij tab 前先问 | 弹覆盖层对话框,取消 = 一个 tab 都不关 |
| G2 | 批量关闭同样受管 | `Close other tabs` / `Close tabs to the right` 的**关闭范围**里有 Zellij 就要问 |
| G3 | 判据是范围,不是被点的那一个 | 右键一个普通网页 tab 选 `Close tabs to the right`,右边有 Zellij ⇒ 要问 |
| G4 | 一次关闭 = 一次确认 | 范围里 N 个 Zellij 也只弹一次,不是 N 次 |
| G5 | 不碰非 Zellij 的关闭 | 范围里没有 Zellij ⇒ 行为和今天逐字一致,没有多出来的一次 await |
| G6 | 程序发起的关闭不问 | agent 取页收尾、drill 分支回收、OnlyPreview 换宿主 —— 那些不是人点的 |

## #1 判据:**关闭范围**里有没有 Zellij tab

今天四个入口各自算出「要关哪些」,然后逐个 `closeTab`:

| 入口 | 范围 |
|---|---|
| tab 条上的 `×` | 被点的那一个 |
| 右键 `Close` | 被点的那一个 |
| 右键 `Close other tabs` | 除它以外所有非 pinned |
| 右键 `Close tabs to the right` | 它右边所有非 pinned |
| `Cmd+W`(`closeActiveTab`) | 当前活动的那一个 |

所以闸必须开在**范围算出来之后、第一次 `closeTab` 之前**,而不是开在 `closeTab` 里面。两条理由,
第二条是硬的:

1. 开在 `closeTab` 里,一次 `Close other tabs` 关三个 Zellij 就要弹三次 —— 违反 G4。
2. **`closeTab` 不只有人在调。** `openControlledBlankTab` 的 `done()`、`openAgentTab` 的失败回滚、
   `exploreSession` 的分支回收、`onlyPreviewHostToggle` 的换宿主、`setAsHomepage` 关掉旧 Home ——
   这些都是程序自己的收尾。在 `closeTab` 里加一道要人回答的闸,等于让这些路径**挂在一个没人会看的
   对话框上**(G6)。

判据本身是 `tab.kind === MAESTRO_ZELLIJ_TAB_ID`。composite tab 的 `kind` 就是它的 spec id
(`maestroBrowserView.service.ts` 建 composite tab 时 `kind: spec.id as TabKind`),所以这一条不需要
新字段。

## #2 为什么必须是覆盖层,不是 `dialog.showMessageBox`

和 [tab-alias.md](tab-alias.md) #2 同一份账,结论一字不改:

| 方案 | 为什么不行 |
|---|---|
| home DOM 里一张居中卡片 | 操作区是原生 `WebContentsView`,画在 home 的 DOM **之上**,卡片会被整块盖住 |
| 原生 `dialog.showMessageBox` | 本仓有三处记录:窗口级 modal 卡死整个窗口并让 CDP 钻探死锁,已全部迁走 |
| 先把操作区 view 藏起来再用 DOM | 被既有不变量禁止 —— 不可见 view 上 CDP 截图/快照会退化或失败,而 agent 的 `page_snapshot` 靠它 |

所以复用**已经在那儿**的那一层:`MaestroTabAliasViewService`。它是 Maestro 壳里唯一一个能画在操作区
之上的对话框层,而且 tab-alias.md #2.1 那四条硬约束(不挂在子节点列表里 / 不 remove 再 add / 进两条
摆位路径 / 取操作区矩形)已经在它身上验过一遍 —— 再起一层等于把同样四个坑重新踩一次。

### #2.1 一层,两种对话框

`MaestroTabAliasSnapshot.dialog` 从单一形状改成判别联合:

```ts
type MaestroShellDialog =
  | { variant: 'alias';        dialogId; tabLabel; alias }
  | { variant: 'closeConfirm'; dialogId; terminalLabels: string[] }
```

服务内部收敛成一条 `open(dialog, unavailableAnswer)`,答案统一成 `{ confirmed, value }`:

| 请求 | 确认 | 取消 / Escape | **另一个对话框正开着** | **这一层起不来** |
|---|---|---|---|---|
| `requestAlias` | 新别名(空串 = 删除) | `null`(什么都不改) | `null` | `null` |
| `requestConfirm` | `true` | `false` | `false` | **`true`** |

最后一格是这份设计里唯一一个「反直觉但故意」的选择,理由见 #4。

**文件名没跟着改。** 这一层现在不止服务 alias,但 `tabAlias` 这个词同时是 XPC handler 的**字符串
键**(`MaestroTabAliasXpcHandler`)、`electron.vite.config.ts` 的入口名、i18n 的命名空间、以及
`check-tab-alias.mjs` 的锚点。为一次语义补全去动四处字符串键,收益是名字更好听,风险是 XPC 两侧对不
上而 typecheck 看不见。记在 `#pending-questions` PQ-3,不在这一发做。

## #3 入口清单:谁走闸,谁不走

新增 `closeTabByUser()` 作为**人发起的关闭**的唯一入口;`closeTab()` 原样留给程序。

| 调用方 | 走哪条 | 为什么 |
|---|---|---|
| `CoachXpcHandler.closeTab`(tab 条 `×`) | `closeTabByUser` | 渲染层唯一的关闭调用,就是人点的那一下 |
| 右键 `Close` | `closeTabByUser` | |
| 右键 `Close other tabs` → `closeTabsExcept` | 闸在方法内,批量算完再问一次 | G4 |
| 右键 `Close tabs to the right` → `closeTabsToRight` | 同上 | G4 |
| Workbench chip 的两项批量关闭 → `closeClosableTabs` | 同上 | 它也是人点的 |
| `closeActiveTab`(`Cmd+W`) | `closeTabByUser` | |
| `openControlledBlankTab` 的 `done()` / 失败回滚 | `closeTab` | 取页收尾,不是人点的 |
| `exploreSession` 分支回收(`drillHost`) | `closeTab` | |
| `onlyPreviewHostToggle` 换宿主 | `closeTab` | 同一个 mini app 从 tab 搬进窗口,不是「关掉它」 |
| `setAsHomepage` 关掉旧 Home tab | `closeTab` | 内置 Home,无状态 |
| composite host 自己的 `close()` seam | `closeTab` | mini app 自己请求下台 |

### #3.1 先滤,后问

`closeTabsAsUser()` 在问之前把 id 集合滤成**真的会被关掉的那些**(非 pinned、且条上不止一个)。

`closeTab` 自己也拒这两种,但那是在**问完之后**。少了这一步,`Cmd+W` 停在一个 Zellij 自定义主页
上会弹出确认、人按下「关闭」、然后什么都不发生 —— 一个答案不改变任何事情的问题。右键菜单的
`Close` 与条上的 `×` 在这两种情况下本来就不出现(`canClose` / `v-if`),快捷键没有那道 UI 闸,所以
闸要落在这里。

两个批量方法自己也 `.filter((tab) => !tab.pinned)`,这一步对它们是冗余的 —— 但它保护的是
`closeTabByUser` 的每一个调用方,而不是某一条路径。

## #4 这一层起不来时:**放行**,不是拦住

`unavailable` 闩(加载失败 / 渲染进程没了)下,alias 那一路答 `null` = 什么都不改。确认这一路如果照抄
成 `false`,后果是**这扇窗里的 Zellij tab 再也关不掉** —— `×`、右键、`Cmd+W` 三个入口全被同一道闸挡
住,而用户看不到任何对话框、也没有任何提示。丢一次确认是体验降级;丢掉「关闭」这个动作本身是功能坏
掉,而且没有第二条路绕开。

所以这一路 `unavailable` ⇒ 答 `true`(照常关闭),同时:

- `tab-alias` scope 记一行 `error`(打包版里唯一查得到的地方);
- 往 Control 面板发一条 trace,写明「确认对话框起不来,已按确认处理」。

「另一个对话框正开着」是另一回事 —— 那时屏幕上**有**东西,答 `false`(什么都不关)不会让人困惑。

## #5 文案留在渲染层

main 只传数据(`terminalLabels`),标题/正文/按钮全部取渲染层的 `i18nHelper.maestroTabClose`,和
alias 表单同一条纪律 —— 本仓禁止 main 侧硬编码面向用户的文本,而且 `zh` / `en` 必须同时有键。

单数/复数由 `terminalLabels.length` 在渲染层选键,不做字符串插值:`i18nHelper` 是纯对象取值,没有
`$t()` 的参数能力,而把计数拼进 main 侧的文案就把文案搬回了 main。

## #pending-questions

| # | 问题 | 倾向 | 阻塞什么 | 状态 |
|---|---|---|---|---|
| PQ-1 | 关**整扇 Cowork 窗口**时有活着的 Zellij,要不要也确认? | 要,但那是窗口生命周期的事(`before-quit` / `close` 一条完全不同的路),不该塞进 tab 闸 | 与本需求正交 | **未定** — Ral 说的是 tab 关闭;没做,等他点名 |
| PQ-2 | 其他 composite mini app(OnlyPreview / Trench)要不要也确认? | 不要 —— 它们关掉不丢任何正在跑的东西,Zellij 关掉是**结束一条 shell 会话** | G5 的边界 | **已定** — 只认 Zellij。要扩,改的是 `#1` 那一个判据 |
| PQ-3 | 覆盖层要不要按 cowork 改名成 `shellAlert`? | 要,但单独一发 —— 它是四处**字符串键**的重命名(XPC handler 名、vite 入口、i18n 命名空间、守卫锚点),混在功能里做,XPC 两侧对不上时 typecheck 一声不吭 | 与本需求正交 | **未定** — 本次保留 `tabAlias` 文件名,#2.1 已写明理由 |
| PQ-4 | 确认里要不要给「不再提示」? | 不要 —— 这条确认存在的理由是「会话丢了拿不回来」,给了开关等于默认状态下它不存在 | | **已定** — 不给 |
