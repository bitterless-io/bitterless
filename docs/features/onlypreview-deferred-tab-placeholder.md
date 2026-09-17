# 独立窗口占着 OnlyPreview 时,tab 留下一张占位页

Status: bl 侧已实现,owner 验收待做;cowork 侧待做(2026-09-17,Ral:「cowork bl 独立窗口打开 onlypreview 时,此时浏览器内的
onlypreview tab 应该显示一个渲染进程:内容: 已在独立窗口打开,配上: 前往的按钮,点击定位到一打开的
onlypreview。另外 独立的 onlypreview 窗口关闭,且主窗口 onlypreview 还存在的情况,就应该恢复在 tab
中打开,效果和回到 tab 打开的按钮差不多」)。

交付:[task 181](../plan/tasks/onlypreview-deferred-tab-placeholder-181.md)。

## #0 目标

| # | 目标 | 判据 |
|---|---|---|
| G1 | 切到独立窗口,tab **不关** | undock 路径上 `closeTab` 调用次数为 **0** |
| G2 | 那一格显示占位页 | 「已在独立窗口打开」+ 一个「前往」按钮,不持有 host token |
| G3 | 前往 = 定位到那个窗口 | `show()` + `focus()`,复用既有 `showSurface()` |
| G4 | 关掉独立窗口 → 回到 tab | 占位页就地升格成真正的 OnlyPreview,等价于按「回到 tab」 |
| G5 | 没有 tab 时不回收 | 「主窗口 onlypreview 还存在的情况」—— 没有那一格就什么都不做 |

## #1 为什么这条比原来的「关掉 tab」对

**关不掉。** 固有 tab 是 `pinned`,而 `closeTab` 对 pinned 直接静默返回
(`maestroBrowserView.service.ts:2424` 的 `tabs.length <= 1`、`:2427` 的 `tab.pinned`;cowork 同形
在 `browser.controller.ts:1615,1619`)。而 bl 的固有槽位**默认就装 OnlyPreview**
(`onlyPreviewCoworkTab.ts:62` 的 `defaultHome: true`,见
[onlypreview-default-homepage.md](onlypreview-default-homepage.md))。所以 2026-09-07 那条
「独立窗口打开,浏览器里的 tab 就得关掉」在默认配置下**根本执行不了**,留下的是一格关不掉的空白。

今天的补救是降级:`spec.open` 在已有活着的承载时抛,`loadPinnedHomeTab()` 的 catch 把这一格换成
内置本地 Home 并留 trace。代价是主页槽位悄悄变成另一个页面,而且**没有任何回到那个窗口的入口** ——
这正是 Ral 说的「关闭这个事情 UI 上不友好」。

**#4 当初拒绝 `show()` 的理由原样保留。**
[onlypreview-default-homepage.md](onlypreview-default-homepage.md) #4 写的是:这条路最常发生在
Cowork 窗口正在启动那一刻,把另一个窗口提到前台正好与用户刚点的动作相反。占位页把「提到前台」
变成**用户主动点前往**,那条理由一条都不用改 —— 被取代的只是「降级成本地 Home」这个补救手段。

## #2 两个状态,一个 tab id

`onlyPreviewCoworkTab.ts` 的那一格变成双态运行时:

| 状态 | 这一格装什么 |
|---|---|
| `live` | 今天的 OnlyPreview composite(shell + preview + globalSearch + alert + fileSearch runtime) |
| `deferred` | `OnlyPreviewDeferredTabSurface`:自己的 `View` + 一个 `WebContentsView`,装新的 `onlypreview/detached` 渲染入口 |

按已经落地的 `OnlyPreviewFileTabSurface`(`onlyPreviewFileTab.service.ts:27-138`)同形:容器自持、
同一套 dev/packaged 入口解析、同一道导航禁闭。**占位页不持有 host token,不拿 workspace、不拿索引、
不拿文件路径** —— 它只是一张纸。

反转落在一行:`OnlyPreviewCoworkMount.destroyHost()` 从 `this.deps.close()` 改成
`this.deps.defer()`,并且 `teardownSource('cowork')` 里那个 `closeTab` 循环整段删掉。
`getDisplayedFile()` 在 `deferred` 下返回 `null`,于是 `isMountedOnCoworkTab()` 仍然把工作区 chip
的点击路由到**窗口**,不会路由到占位页。

## #3 前往

一个不需要 token 的新 xpc 方法 `focusOnlyPreviewWindow()`:

- 有活着的 standalone 承载 → `show()` + `focus()`(`onlyPreviewStandaloneMount.ts:97-108`,带持久化
  bounds、取消最小化、maximize/full-screen 处理)。返回 `{ focused: true }`。
- 窗口已经死了(崩了,或者升格失败) → 直接走 #4 那条升格,返回 `{ focused: false }`。

**不复用 `openOnlyPreviewWindow()`**:它的冷分支会**新建**一个窗口
(`onlyPreviewWindow.helper.ts:443-459`),对一张占位页来说那是错的答案。

## #4 关窗回 tab

**监听可取消的 `'close'`,不是 `'closed'`。** Electron 的 `destroy()` 明确不发 `'close'`,只发
`'closed'`,所以三个非用户来源自动绕开这个钩子:toggle 的 dock 方向(走 `destroy()`)、登出拆卸、
以及 `closeOnRendererFailure`。最后那个**应该**升格,所以它在调 `destroyStandalone()` 之前显式布防。
`app.quit()` 会对每个窗口发 `'close'`,因此钩子在模块内的 `shuttingDown` 标志(由
`app.once('before-quit')` 置位)为真时拒绝。

`'close'` 触发时,在 surface 还没消失之前:快照转移目标(workspace registry + preview region 的当前
文件,两者都会在 `:1280` 被吊销)、调 `beginHostTransition()` 让在途索引活过这次搬家(否则
`stopSearchRuntimeUnlessPreserved()` 会把它丢掉),然后布防升格。

**只有一条 dock 路径,不许有第二条。** `promoteDeferredTab(target)` 是 toggle service 上的新方法,
跑在 `relocate` 用的同一条 `onlyPreviewTargetMutations.run` FIFO 上,复用同样的私有步骤:
`buildHost('cowork')` → `restoreTarget()` → `rememberOnlyPreviewHostMount('tab')` → `show()`。

## #5 定了的三条(原是待定)

1. **升格要写持久化偏好 `'tab'`。** 否则关掉窗口内容回到了 tab,下一次点 chip 又弹窗口,读起来像
   「没回来」。与 `rememberOnlyPreviewHostMount` 既有口径一致:落定的承载就是真相。
2. **占位页只有「前往」一个按钮,不加「移回标签页」。** Ral 那句「效果和回到 tab 打开的按钮差不多」
   说的是**关窗自动回收**,不是再加一个按钮;而占位页不持有 `hostToken`,加 dock 按钮要另开一个
   免 token 的 Main 操作。`detached.body` 直接把「关掉那个窗口就回来」写在页面上。
3. **不把隐藏的浏览器窗口提到前台。** 升格照做,但只在浏览器窗口**已经可见**时 `show()`/focus;
   窗口是隐藏的就静默回到那一格。理由与 #1 引的 #4 同源:用户刚关掉独立窗口,大概是想收起来,
   这时候弹一个他没点的窗口正好相反;内容确实已经回到 tab,他下次打开浏览器就看见。
   **代价说清**:浏览器窗口隐藏时关掉独立窗口,屏幕上会一瞬间什么都没有 —— 如果 Ral 觉得这读起来
   像「东西丢了」,把这一条翻成「总是 show + focus」,只改一处判断。

## #6 边界

- **没有 tab** → 不升格,持久化偏好保持 `'window'`,下次点 chip 还是开窗口(G5)。
- **窗口开着时用户把 tab 关了** → spec 的 `close()` 释放占位 surface;之后关窗找不到 tab,不升格。
- **pinned / 最后一格的静默拒绝** → 不再关任何东西,这道风险整个离开 undock 路径,并且**顺手修掉
  bl 现存的那个缺陷**:`loadPinnedHomeTab` 的降级分支不再触发,因为 `spec.open` 不抛了。
- **退出应用** → `shuttingDown` 拒绝;`destroyOnlyPreviewForHostQuit()` 走 `destroy()`,连 `'close'`
  都不发。两条都不升格。
- **窗口在另一个 Space / 已拔掉的显示器** → 前往走既有 `showSurface()`,macOS 自己切 Space,
  `windowState.show()` 取消最小化并重放持久化 bounds(含既有的离屏保护)。不新增几何逻辑。
- **连点前往** → 幂等:活窗口上 `show()`+`focus()`;死窗口上升格走 FIFO 串行,已经有 cowork 承载
  之后就是 no-op。占位按钮不需要 pending 态。
- **「tab 还存在」的判据** = 条上有一格其 kind 标识 OnlyPreview(bl `tab.kind === 'onlypreview'`;
  cowork `kind === 'miniapp' && miniappId === 'only-preview'`)**且**其运行时报告状态为 `deferred`。
  不是看持久化偏好,也不包括 undock 时存在、之后被关掉的那一格。

## #7 i18n

新增一个顶层命名空间 `detached`(en 插在 `topbar` 之后,zh 放镜像位置)。用 `detached` 而不是
`standalone`:后者在 Main 里已经专指那个**窗口**(`ensureStandalone`、
`OnlyPreviewMountKind = 'standalone' | 'cowork'`),而这几句描述的是那个**tab**。

```ts
// en
detached: {
  title: 'OnlyPreview is open in a separate window',
  body: 'This tab keeps its place. Close that window and OnlyPreview returns here.',
  focusWindow: 'Go to the window'
},
// zh
detached: {
  title: '已在独立窗口打开',
  body: '此标签页会保留。关闭那个窗口，OnlyPreview 就回到这里。',
  focusWindow: '前往'
},
```

`Localized<typeof en>` 保证两份对齐 —— 漏一个 zh key 直接 `vue-tsc` 红。

## #8 UI

占位页遵守工作区的无边框规则:层次只用留白、底色、圆角,没有卡片、没有描边、没有分隔线。
「前往」是一个 `a-button type="primary" size="mini"`,并且在 `detached/src/App.less` ——
**这个 surface 唯一加载的样式表** —— 里显式写上 `border: 0` 和 `background`。这条不是多余的:
`micromeet-cowork` 的 OnlyPreview shell `main.ts` 只 import Arco,曾经让一批 Tailwind 类失效、
每个图标按钮都带上 Chromium 的 UA 默认边框(见工作区规则里记的 2026-09-09 那一例)。

结构节点带稳定 `name`:`onlypreview__detachedApp`、`onlypreview__detachedContent`、
`onlypreview__detachedFocusWindow`;BEM 块 `onlypreview-detached`,最多两个 `__`。

## #9 这份方案与已有文档的关系

- **取代** 2026-09-07 的「独立窗口打开,tab 就得关掉」——
  见 [onlypreview-host-toggle-leaves-empty-cowork-tab.md](../issues/onlypreview-host-toggle-leaves-empty-cowork-tab.md)
  的 Reversal 段(原推理原样保留)。
- **取代** [onlypreview-default-homepage.md](onlypreview-default-homepage.md) #4 的补救手段
  (`spec.open` 抛 → 降级成本地 Home)。那一节的**理由**仍然有效,换掉的是补救方式。
- **不动** 2026-09-07 同一场里定的另外两条:teardown-first 的顺序
  (`onlyPreviewHostToggle.service.ts:248-262`)、以及来回切换时索引要能继续创建
  (`onlyPreviewWindow.helper.ts:231-238`)。
- **吸收** 2026-09-04 就已经写好、一直挂着 `pending` 的两条任务
  `onlypreview-surface-ownership-136` 与 `onlypreview-standalone-close-takeover-137`
  ([onlypreview-embeddable-mount.md](onlypreview-embeddable-mount.md) #318-367、PQ-1):它们描述的
  正是这件事,由 task 181 接手,不再各自推一遍。
