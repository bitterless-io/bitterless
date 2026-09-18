# Zellij tab 里焦点不在终端上时,`Cmd+W` 关掉了整扇窗

Status: root cause proven, fixed, code-verified; owner verification pending (2026-09-18)

Related: [关闭 Zellij tab 需要确认](../features/maestro-zellij-close-confirm.md)(这条要触发的就是它的
确认弹窗)、[zellij-miniapp.md](../features/zellij-miniapp.md)、
micromeet-cowork `apps/cowork/src/main/common/shortcutsHelper/shortcuts.helper.ts`(**同一个问题在
cowork 侧不存在**,理由见 #4)

## Report

Ral 2026-09-18:

> zellij 激活时,此时点击主窗口,不让 zellij session 窗口处于激活,点击 cmd+w 是关闭整个主窗口,
> 如果 zellij session 窗口处于激活,cmd+W 关闭的是 session pane(这是对的)。
> 我期望 zellij tab 激活、但是 session 窗口不激活的时候,cmd+w 触发关闭 zellij tab(需要 confirm 的那个)

## Confirmed cause

Zellij 迷你应用是**两个 `WebContentsView` 叠出来的**:围着终端的那一圈 chrome(`controls`,
`zellij/index.html`)+ 终端本身。焦点落在哪一个上,`Cmd+W` 的命运完全不同:

| 焦点 | 认领机制 | 结果 |
|---|---|---|
| 终端 view | `setTerminalKeyboardOwner` ＋ `setIgnoreMenuShortcuts(true)`(`zellijTerminalView.ts:220-222`) | zellij 自己关 pane ✅ |
| **chrome(`controls`)** | **什么都没有** | **关整扇窗** ❌ |
| Maestro 自己的 tab 条 / 地址栏 | 在 `MAESTRO_PARTITION` 里 | `closeActiveTab()`,关 tab ✅ |

`ZellijSurface.createControls()`(`zellijSurface.ts:113`)建这个 view 时四样都没给:

- 没有 `partition` —— 它跑在 **default session**,不是 `MAESTRO_PARTITION`;
- 没有 `enrollMaestroShortcutContents`;
- 没有 `guardWindowCloseShortcut`;
- 没有 `setIgnoreMenuShortcuts`。

于是 `installShortcutsForWebContents` 的 `claimsShortcuts`(`shortcuts.helper.ts:81`)判 false,
**根本不给它装 `before-input-event`**。没有人 `preventDefault`,`Cmd+W` 就落到应用菜单继承的
`{ role: 'fileMenu' }`(`applicationFindMenu.service.ts:129`)的 `close` role 上 —— 关窗。

这与 `shortcuts.helper.ts:61-70` 那段注释记录的 OnlyPreview 那次(Ral 2026-09-11)**是同一个坑**:
composite mini app 的 view 不在 Maestro 的 partition 里,Cmd+W 穿过去关了窗。当时的修法是
`enrollMaestroShortcutContents`,OnlyPreview 的三个入口都补了(`onlyPreviewDeferredTabSurface.ts`、
`onlyPreviewCoworkMount.ts`、`onlyPreviewFileTab.service.ts`),**Zellij 的 chrome 漏了**。

### 为什么不是「补一行 enroll」就完事

补一行能让这一个症状消失,但留着的是**同一台制造机**。三条,前两条是硬的:

1. **同一个 surface 会在两种宿主之间搬家。** `ZellijSurface` 既能挂在独立 Zellij 窗口
   (`zellijWindow.service.ts:271 createWindow`),也能挂进 Maestro tab(`:141-142 openOnTab`),
   `detachFromCurrentHost`(`:260`)再搬回去。而 `activateShortcuts` 绑的 actions 是**单例**
   `maestroWindowHelper`(`maestroWindow.handler.ts:208-212`)—— 无条件 enroll 之后,在**独立
   Zellij 窗口**里按 `Cmd+W`,会去关**另一扇** Maestro 窗口的 tab。
2. **`enrolledContents` 是只进不出的 `WeakSet`**,没有退出口:搬回窗口时摘不掉。
3. **`controls` 会被重建。** `zellijSurface.ts:76`:上一次 chrome 加载失败后 view 被 `close()`,
   下一次 `load()` 重新 `createControls()` —— 只在构造期登记一次的做法会丢。

更根本的一条:**这张名单不可能靠纪律保持完整**。它要求每一个「渲染在 Maestro 窗口里、但不在
Maestro session 里」的 surface 都记得去登记一次。漏了不报错、typecheck 看不见、review 看不出
(登记过的那些照常工作),而代价是最重的那种 —— 整扇窗没了。两次都是这么漏的:OnlyPreview 的
composite view(Ral 2026-09-11,三处),然后就是这次的 Zellij chrome。

所以 Ral 2026-09-18 拍板:**顺带把仲裁本身换掉**(原 PQ-1),不再补名单。

## Fix contract

**认领资格是「窗口」的属性,不是「view」的属性。**`Cmd+W` = 关活动 tab —— 当且仅当焦点窗口是那扇
**有 tab 的窗口**;在别的窗口里它不是我们的键,必须落到应用菜单的 `close` role 上去关那扇窗。

| 环节 | 改动 |
|---|---|
| `shortcuts.helper.ts` | 删掉 `enrolledContents` ＋ `enrollMaestroShortcutContents` ＋ `session.fromPartition(MAESTRO_PARTITION)` 判定。监听装到**每一个** WebContents 上;能不能动 tab,按键当刻问 `actions.ownsFocusedWindow()` |
| `maestroWindow.handler.ts` | 提供 `ownsFocusedWindow: () => BrowserWindow.getFocusedWindow() === maestroWindowHelper.browserWindow`。与旁边 `searchSessions` 已经在做的判定同一条 |
| `onlyPreviewDeferredTabSurface.ts` / `onlyPreviewCoworkMount.ts` / `onlyPreviewFileTab.service.ts` | 三处 enroll 调用全部删掉 —— 它们现在天然成立 |
| `zellijSurface.ts` | **一个字没加。** 这是这次改法的验收点:漏掉登记的那个 surface,不靠登记也对了 |
| `check-custom-menubar.mjs` | 守卫跟着契约走:原来断言「必须按 partition 收窄」,改成断言「按焦点窗口收窄」＋「登记表不许回潮」 |

保留两条显式例外 —— 它们是**行为**,不是许可:

- `terminalKeyboardOwners`:这个 view 自己要这个键(Zellij 终端关 pane)。
- `windowCloseGuards`:这个键在这里**什么都不做**(Omni cell,Ral 2026-09-11)。Omni 是自己的窗口
  且没有 tab,两条分支都不适用:关 Maestro 的 tab 是错的窗口,关 Omni 窗口是他明确不要的。

目标行为**不需要新写**:`closeActiveTab` → `closeTabByUser` → `closeTabsAsUser` →
`confirmCloseScope`(`maestroBrowserView.service.ts:2008-2035`),Zellij tab 的确认弹窗已经在了,
`Cmd+W` 本来就写在 `maestro-zellij-close-confirm.md` #1 的入口清单里。键送到了,弹窗自动有。

### 顺带修掉的一个旧错

旧 `runShortcut` 里 `if (key === 't') actions.newTab()` 排在 `windowCloseGuards` 之前 —— 也就是说
**在 Omni cell 上按 `Cmd+T`,会在 Maestro 窗口里开一个你看不见的新 tab**。新判定下它落进
「不是这扇窗的键」,什么都不发生。

### 不在范围内

- 终端 view 的行为一个字不改(`Cmd+W` 关 pane)。
- 独立 Zellij 窗口里 `Cmd+W` 仍然关那扇窗 —— 现在是**免费**得到的:那扇窗不是 Maestro 窗口。
- Omni 的 zellij cell 不走 `ZellijSurface`(`omniWindow.helper.ts:1443` 直接建 origin-backed view),
  它的 `setTerminalKeyboardOwner` ＋ `guardWindowCloseShortcut` 原样保留。
- Zellij 的 chrome 渲染层**没有任何** `keydown` / `metaKey` 处理,这两个键在那儿本来就是空的,不抢谁。
- `registerSurfaceView` 两个实现现在都是空的,seam 本身成了死的。没删:它是 composite mount 的共享
  接口,另一个实现(standalone mount)**在这次改动之前就已经**是空的,删它要动
  `onlyPreviewWindow.helper.ts` 这个又大又热的文件,收益为零。记在这里,不混进来。

## #4 cowork 侧:同一个缺陷不存在,不改

`micromeet-cowork` 的 `Cmd+W` 是**另一套仲裁**,结构上就没有这个漏洞:

| | bitterless | micromeet-cowork |
|---|---|---|
| 应用菜单 | 保留系统菜单,`{ role: 'fileMenu' }` 自带 `close` | `Menu.setApplicationMenu` 换成自建模板,`Window ▸ Close Tab` **自己占着** `Command+W` |
| 监听装在哪些 contents | 只装**认领**的(partition / enroll / guard) | **全部**,无条件 |
| 谁关 tab 的决定在哪做 | 装监听时(集合成员资格) | **按键当刻**:`webContents.getFocusedWebContents()`,是终端就转发给它,否则 `closeActiveTab()` |

所以 cowork 里焦点落在 zellij chrome 上时,菜单项照常触发 → 焦点不是终端 → `closeActiveTab()`。
**这一条无需改动;是核对结果,不是「已修复」。**

但核对时查出另一件**真缺的**:cowork 的 `closeActiveTab` 后面没有关闭确认,所以那儿 `Cmd+W` 关
zellij tab 是不问就关。那是 PQ-2,Ral 2026-09-18 让一起补,落在 cowork 自己的
`docs/features/cowork-zellij-close-confirm.md`。

cowork 那条注释还记了一件 bl 侧不成立的事:「macOS 在键到达任何 WebContents **之前**就把 `Cmd+W`
当成窗口的 native close key equivalent 吃掉」,所以它必须把加速键挂到菜单项上。bl 这边终端确实收得到
`Cmd+W`(Ral 亲证 pane 能关),两边的前提不同,不要把 cowork 的结论搬过来。

## Acceptance

- Zellij tab 激活,点终端**外面**那圈 chrome(会话条 / 空白处)→ `Cmd+W` ⇒ 弹关闭确认;确认 ⇒ 关掉
  这个 zellij tab;取消 ⇒ 什么都不关。
- Zellij tab 激活,焦点在终端里 → `Cmd+W` ⇒ 仍然关 pane,不弹确认、不关 tab。
- 独立 Zellij 窗口里(不在 Maestro tab 里),焦点在 chrome 上 → `Cmd+W` ⇒ 仍然关那扇 Zellij 窗口。
- 普通网页 tab / OnlyPreview tab 的 `Cmd+W` 行为一字不变。

## #pending-questions

| # | 问题 | 倾向 | 状态 |
|---|---|---|---|
| PQ-1 | bl 要不要整体改成无注册表的仲裁? | 要 —— 名单不可能靠纪律保持完整 | **已定并已实施**(Ral 2026-09-18:「干脆现在直接一起改了」)。只取 cowork 的**判定方式**,不取它的菜单归属:bl 保留系统菜单,而且它的终端确实能通过 `setIgnoreMenuShortcuts(true)` 收到 `Cmd+W` |
| PQ-2 | 关闭确认(`maestro-zellij-close-confirm.md`)要不要也落到 cowork? | 要 | **已定并已实施**(Ral 2026-09-18:「需要补」)—— 见 micromeet-cowork `docs/features/cowork-zellij-close-confirm.md` |
