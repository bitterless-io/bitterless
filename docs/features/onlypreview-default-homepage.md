# bl 的固有 tab 默认装 OnlyPreview

Status: implemented — owner testing pending(2026-09-14,Ral:「将 bl 的固有 tab 默认就设为 onlypreview」;
同日拍板:「2 不是问题,workbench 可以兜底,onlypreview 在 bitterless 是默认,crms 是 cowork 的默认」)。

前置:[自定义固有 tab(Set as homepage)](custom-homepage-tab.md) 已经把「固有槽位装谁」做成了一个
可配置项(`CoachSettings.homeCompositeId`)。本页只改**没配置时的那个值**:bl 从「内置本地 Home」
改成 OnlyPreview,也就是把那份文档 G5 里 `bl: 本地 Home` 这一格换掉。

## #0 目标

| # | 目标 | 判据 |
|---|---|---|
| G1 | 没设过主页的机器,固有槽位装 OnlyPreview | 全新 `coach-settings.json`,启动后条上第一格是 OnlyPreview |
| G2 | 默认值来自 **registry**,不是 settings 里的一个预置字符串 | 设置文件里 `homeCompositeId` 仍然不存在 |
| G3 | `Restore default homepage` 还原到的是**新的默认值** | 点完之后槽位装 OnlyPreview,不是内置 Home |
| G4 | 登出落地不变 | 登出后那一发启动,槽位仍然是内置本地 Home |
| G5 | OnlyPreview 已经在独立窗口里时不出空条 | 槽位这一发降级成内置 Home,trace 写明原因 |

## #1 默认值住在 registry,不住在 settings

两种落法,选后者:

| | 把 `'onlypreview'` 写进 `DEFAULT_SETTINGS` | registry 里声明 `defaultHome: true` |
|---|---|---|
| 设置文件 | 每台机器都会被写进一个 `homeCompositeId` | 保持「没设过」= 字段不存在 |
| `Restore default` | 清空之后又要立刻写回默认值,「清空」变成假的 | 清空即回默认,一条路 |
| maestro ↔ 宿主边界 | maestro 要认识 `'onlypreview'` 这个字面量 | 宿主注册时自己声明,maestro 只问 registry |
| cowork 那一份 | 两仓的 `DEFAULT_SETTINGS` 各写一个不同的值 | 两仓各自在注册处声明,maestro 代码同形 |

第三行是决定性的:`check:maestro` 的别名边界不许 maestro 那棵树认识任何一个具体 mini app。
而「哪个 mini app 是默认主页」和 `singleton` / `restorable` 是同一类事实 —— **mini app 自己的属性**,
所以它属于 `MaestroCompositeTabSpec`:

```ts
/** 没设过主页时,固有槽位装我。至多一个 spec 可以声明。 */
defaultHome?: boolean
```

`resolveHomeCompositeId()` 因此变成两级,**fail-closed 那一条一个字不改**:

```
settings.homeCompositeId(用户设过的) → registry 里 defaultHome 的那个 → null(= 内置本地 Home)
                                     ↑ 两级都要过 getMaestroCompositeTab(id) ? id : null
```

`null` 仍然是合法结果:registry 里没有任何 `defaultHome`(cowork 那一份、或者降级/改名)时,
行为与今天逐字相同。

## #2 「默认」这个词现在有两个所指,三个下游都要跟着改

改之前「默认固有 tab」与「内置本地 Home」是同一件事,所以三处都写成了 `kind === 'home'`。
改之后它们分开了:**默认的那一格现在是一个 composite tab**,而内置本地 Home 退成
「登出落地 ＋ 装不起来时的兜底」。

| 下游 | 今天 | 改成 | 不改会怎样 |
|---|---|---|---|
| `isDefaultHomeTab`(`Alias…` 置灰判据) | `pinned && kind === 'home'` | `pinned && (kind === 'home' \|\| 没写过 homeCompositeId)` | 默认那一格能改名,而 `normalizeSettings` 在 `homeCompositeId` 为空时**会把 `homeAlias` 丢掉** —— 改完就丢,静默 |
| `canRestoreHome` | `pinned && Boolean(resolveHomeCompositeId())` | `pinned && Boolean(设置里那个原始值)` | 现在恒真:菜单项永远亮着,点下去什么都不变 |
| `restoreDefaultHomepage()` | 建一个内置本地 Home 装进槽位 | 装**默认那个 mini app** | 「还原默认」这一发回到 Home,下次启动又是 OnlyPreview —— 两种说法 |

第一行那条是本次改动里唯一一个**静默**失败,所以判据取「设置里写没写过」而不是「装的是不是
registry 的默认值」:用户显式把 OnlyPreview 设成主页(设置里有值)之后仍然能改名,而且名字存得住。

## #2.1 内置本地 Home 退居幕后不丢东西 —— 启动器在 Workbench

默认值一换,那个本地 Home 页就只在两处出现:登出落地、默认 mini app 装不起来的降级。它身上挂着
一个**完整 8 格启动器**(Zellij / Todo / Maestro / Coin / EyesOnAgents / Submodules / OnlyPreview /
Omni),所以「改了默认之后这些还够不够得到」是这次改动唯一一个真实的功能性代价。

**结论:够。**`+` 号菜单确实只列注册过的 composite spec(Zellij / OnlyPreview / Trench),但
[`WorkbenchAppsView.vue`](../../src/renderer/maestro/workbench/src/views/WorkbenchAppsView.vue) 调的是
**同一个** `createMiniApps(...)`(`src/renderer/home/src/views/miniApp/miniApps.constant.ts`)——
八格一个不少,而且就在 Cowork 窗口里。Ral 2026-09-14:「2 不是问题,workbench 可以兜底」。

一条不受影响的:**登录门不靠这一格。** `MaestroWindowHandler.open()` 一开始就 `assertAuthReady()`,
没登录根本开不出 Cowork 窗口;`LocalHomeApp.vue` 里那个 `<Login>` 护的是**登出拆卸那一发**的落地,
而那条路由 `forcePinnedHomeBoot()` 强制装回本地 Home,与默认值无关(见 #5)。

## #3 还原路径:四种落地,零 pinned 的中间态一次都不许出现

`MenuBar.vue` 在没有任何 tab 报 `pinned` 时回落到 index 0,注释写着「不该发生」——
所以下面每一支都是**先建/先置 pinned,再摘旧的**(custom-homepage-tab.md #3.2)。

清掉三格设置之后按当前槽位分流:

| 槽位现在装的 | 怎么做 | 为什么 |
|---|---|---|
| 内置本地 Home | 只广播 | 登出那一发就是这个状态(它无视设置装回 Home)。清掉设置就是全部要做的事,这一发留在 Home,下次启动装默认 |
| 就是默认那个 mini app | 只广播 | 用户把默认值又显式设了一遍;清掉设置之后槽位已经对了 |
| 别的 mini app,而默认那个**已经作为普通 tab 开着** | **晋升**它进槽位,旧的降级成普通 tab | OnlyPreview 是 `singleton`,再开一个拿不到内容(见 #4),条上会多一格空白 |
| 别的 mini app,默认那个没开 | 新建一格 pinned tab,走 `loadPinnedHomeTab()` 挂载 | 复用启动那条路:它按 kind 分流,装不起来还会就地降级成内置 Home |

registry 没有 `defaultHome` 时退回今天的行为(建内置本地 Home),与 #1 的 `null` 同义。

旧槽位那个 mini app **不关**,降级成普通 tab —— 它身上有用户的状态,和 `setAsHomepage` 的
「带状态的留着,不带状态的回收」同一条纪律。

## #4 OnlyPreview 已经有活着的承载时,固有槽位不许去抢

`onlyPreviewWindowHelper.openOnMount()` 在「已经有一个活着的 host」时**返回那个 host 并
`show()` 它**,新建的 `OnlyPreviewCoworkMount` 从来没有被 attach。对一个 tab 来说这意味着:

- `spec.open` **成功返回** ⇒ maestro 认为这一格装好了;
- 而那一格没有任何内容 ⇒ 用户看到一格空白,同时那个独立窗口莫名其妙跳到前台。

以前这只在「先把 OnlyPreview 切成独立窗口、再手动把它设成主页」时够得着,是 custom-homepage
那一版留下的一个潜伏缺陷。**默认之后它变成一条日常路径**:先预览了一个文件(承载是窗口),
再打开 Cowork 窗口。

定案:spec 的 `open` 在已经有活着的承载时**抛**,不 `show()`。
`loadPinnedHomeTab()` 的 catch 已经把这一发降级成内置本地 Home 并留 trace,于是
「一格空白 ＋ 窗口抢焦点」变成「这一发是 Home,日志里写着为什么」。

不 `show()` 的理由:这条路最常发生在 **Cowork 窗口正在启动的那一刻**,把另一个窗口提到前台
正好与用户刚点的那个动作相反。

## #5 明确不动的

- **登出 / 鉴权拆卸仍然强制内置本地 Home。** `forcePinnedHomeBoot()` 那一支在
  `resolveHomeCompositeId()` **之前**短路,所以默认值换成 mini app 不触及它
  (custom-homepage-tab.md #3.5、`maestroLogoutHomeLanding` A8)。
- **`isPinnedHomeTab` 不动。** 它护的是内置 Home 的几条安全不变量(导航禁闭、第一方 preload、
  DevTools),和「哪个是默认主页」是两件事 —— 这正是当初分成两个同义谓词的理由。
- **`setAsHomepage` 不动。** 它只在旧槽位 `kind === 'home'` 时顺手关掉旧 tab;默认变成 mini app
  之后,旧槽位那个 OnlyPreview 会被降级成普通 tab 留着,正是它想要的行为。
- **`homeCompositeId` 的归一不动。** settings 服务仍然只做「空串 = 没设」、不查 registry ——
  它在注册之前就会被读到。默认值的解析全部发生在读取方。
- **cowork 那一份不跟。** Ral 2026-09-14:「onlypreview 在 bitterless 是默认,crms 是 cowork 的默认」。
  两仓的默认值各自在**注册处**声明,maestro 侧代码同形 —— 这正是 #1 选 registry 而不选默认设置的
  兑现:同一份 maestro 代码,两个仓答出两个不同的默认值,而它一个具体 mini app 都不必认识。
  cowork 那份 registry 里 `MINIAPPS.crms` 的 `pinned: true` 继续表达「**默认**固有 tab 装它」
  (custom-homepage-tab.md #3.3),不需要改名成 `defaultHome`。

## #6 验收

| # | 判据 | 怎么验 |
|---|---|---|
| A1 | 空设置 → 槽位是 OnlyPreview,且 `homeCompositeId` 仍然不存在 | `maestroCompositeTabInstances.test.mjs` |
| A2 | registry 没有 `defaultHome` → 槽位是内置本地 Home(今天的行为逐字不变) | 同上 |
| A3 | 设置里是别的 mini app → 它赢过默认值 | 同上 |
| A4 | 默认那一格 `Alias…` 置灰;显式设成主页之后可用 | 同上 |
| A5 | 默认那一格 `Restore default homepage` 置灰;设过自定义值之后可用 | 同上 |
| A6 | 还原 → 槽位装默认 mini app;默认那个已经开着时是**晋升**不是新开 | 同上 |
| A7 | 登出那一发仍然是内置本地 Home,且设置一个字不动 | 同上 ＋ `maestroLogoutHomeLanding.test.mjs` |
| A8 | 默认 mini app 拒绝打开 → 这一发降级成内置 Home,不空条,trace 写明原因 | 同上 |
| A9 | OnlyPreview 已有活着的承载时,`open` 抛而不是静默返回 | `check-tab-alias.mjs` 源码断言 |

**运行时那一半要跑一次才算**(单测覆盖不到,需重新打包):删掉 `coach-settings.json` → 开
Cowork → 第一格是 OnlyPreview;把 OnlyPreview 切成独立窗口 → 关掉 Cowork 窗口 → 重开 →
第一格是内置 Home 而不是空白。
