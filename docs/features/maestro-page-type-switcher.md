# 页面类型切换器(`menubar__pagetype__button`)

Status: implemented — owner testing pending(2026-09-14,Ral:「cowork bl 都需要:
menubar__pagetype__button。另外通过 menubar__pagetype__button 切换 miniapp,假设当前处于 zellij,
切换后要确保当前的 zellij 的 session 被关闭,哪怕有进程在跑的 session 也可以直接关闭」)。

对齐对象是 micromeet-cowork 的同名按钮(`apps/cowork/.../MenuBar.vue` + `miniappTab.service.ts`
的 `setTabKind`)。本文只写 Maestro 这一侧的契约与差异。

## #0 目标

| # | 目标 | 判据 |
|---|---|---|
| G1 | 地址栏左侧有 `menubar__pagetype__button` | 名字与 cowork 逐字一致,自动化能按同一个选择器找到它 |
| G2 | 点它能**把当前 tab 换成**另一种内容 | Website ⇄ 任一已注册 composite mini-app,tab 身份不变(不新开、不关旧的) |
| G3 | 从 Zellij 切走必须结束那条会话 | 切完 `zellij list-sessions` 里那条消失,**pane 里有进程在跑也照关** |
| G4 | 重复选中当前类型是空操作 | 不白拆一次 view,不重起会话 |
| G5 | 单例 mini-app 不被复制 | 已经有一个 OnlyPreview/Trench 时,菜单里选它 = 聚焦已有的那个 |

## #1 为什么是原生菜单

和 `+` 的 hover 菜单、tab 右键菜单同一个理由:操作区是一个**原生 view,绘制在 Home 渲染进程的 DOM
之上**,超过一行的下拉必被它盖住。所以菜单在 main 里 `Menu.buildFromTemplate` + `popup`,坐标由
renderer 测按钮 rect(DIP)传进来 —— 只有 renderer 知道那个 rect。

菜单内容也不写死:mini-app 行来自 `listMaestroCompositeTabs()`,与 `+` 菜单同源。「一个 tab 能装哪些
mini-app」是一条事实,抄第二份就会过期。

## #2 与 cowork 的模型差异

cowork 的 tab 有 `kind: 'browser' | 'miniapp'` + `miniappId`,mini-app 来自静态 `MINIAPPS` registry。
Maestro 不是:**`TabKind` 本身就是 mini-app 的身份**(`'home' | 'browser' | 'onlypreview' |
'trench' | 'zellij'`),composite 规格在运行时注册(`registerMaestroCompositeTab`),而且每个
composite tab 还有一个持久身份 `instanceId`(Zellij 的会话就挂在它上面)。

于是切换的语义要按 Maestro 的模型重述:

| 方向 | 做什么 |
|---|---|
| composite → 任意 | 调该 spec 的 `close(host)`(**这一步就是关会话**),注销 `compositeTabs`/`compositeHosts`,丢弃 `instanceId` 与 `compositeDisplayUrl` |
| browser → 任意 | 先把 `tab.url` 存进 `tab.websiteUrl`(切回来能恢复),停掉录制目标,`coolTab` 拆掉 WebContentsView |
| → composite | 铸一个**新的** `instanceId`,挂上 spec,`spec.open(host)` |
| → browser | `tab.url = tab.websiteUrl ?? ''`,由 `activateTab` 的正常 warm→load 路径重建 |

`instanceId` 必须重铸而不是沿用:它是「这条 Zellij 会话是谁的」的键。切走已经把会话关了,再切回来
沿用旧 id 等于让新 tab 去认领一条刚被杀掉的会话。**新开即新会话**是既有契约
([zellij-multi-tab.md](zellij-multi-tab.md)),这里只是同一条规则的另一个入口。

## #3 G3 为什么不需要新代码

`zellijWindow.service.ts` 的 `closeTab(host)` 已经在做全套:

```ts
closeTab(host: MaestroCompositeTabHostApi): void {
  this.closedTabs.add(host);
  void closeZellijTerminal(host.instanceId || STANDALONE_SURFACE_ID).catch(...);
  ...
}
```

而 `closeZellijTerminal` 是**无条件强关**:递增 surface generation 作废在飞的 `prepare`、退掉 web
bridge,然后原生路径发 `KillSession` IPC(socket 1s 不消失就 SIGTERM→SIGKILL 并删该会话 cache 目录),
CLI 回退路径 `kill-session` + `delete-session` 并轮询确认。**全程不询问、不因为 pane 里有进程而跳过**。

所以「切走要关会话」在 Maestro 这边等价于「切走要走 composite 的 `close(host)`」—— 而那正是
`setTabKind` 的 composite 拆卸分支。**不能**改成只 `detach` 容器:那样会留下孤儿会话,和 cowork 那条
缺口([cowork docs/issues/zellij-session-survives-page-type-switch.md])一模一样。

反过来也有一条不许碰的:**退出 app / 窗口重置**那条路径不走 `close(host)`,会话要留到下次启动恢复
(`restorable: true`)。本次只在显式切换上挂关闭意图,不动任何通用拆卸。

## #4 固定 tab 与禁用

- `pinned` 的 Home tab 不可切。菜单**整个置灰而不是隐藏** —— 与 cowork 同一条理由:「为什么不能点」
  要看得见。
- Workbench 在前台时按钮 `disabled`(和 back/forward/reload 同一条判据 `workbenchStore.visible`):
  那时地址栏显示的不是某个 tab 的内容。

## #5 落点

| 层 | 文件 | 加了什么 |
|---|---|---|
| 渲染 | `src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue` | 按钮 + 测 rect |
| 渲染 | `.../MenuBar/tab.store.ts` | `showPageTypeMenu(anchor)` |
| 契约 | `src/shared/maestro/coach.api.ts` | `showPageTypeMenu({ tabId, x, y })` |
| xpc | `src/main/maestro/xpc/coach.handler.ts` | 透传 |
| 窗口 | `src/main/maestro/windows/main/maestroWindow.controller.ts` | 透传 |
| main | `.../main/maestroBrowserView.service.ts` | `showPageTypeMenu` / `setTabKind` / 抽出的 `mountComposite` / `OperationTab.websiteUrl` |

`setTabKind` **不上 xpc 契约**:它只被 main 里那个原生菜单的 click 调用。菜单点击不回调 renderer,
改完状态后 `broadcastTabs()` 让每个渲染进程从快照重渲染 —— 这是仓内既有约定(`showTabMenu` 同形)。

## #6 验收

| # | 判据 |
|---|---|
| A1 | 普通网页 tab → 菜单选 Zellij:同一个 tab 变成终端,tab 条数量不变 |
| A2 | A1 的 tab 里跑 `tail -f`,菜单选 Website:回到原来那个网页,`zellij list-sessions` 里那条会话消失 |
| A3 | Zellij → OnlyPreview(composite → composite)同样关会话 |
| A4 | 在 Zellij tab 上再选一次 Zellij:空操作,会话不动 |
| A5 | 已经有一个 OnlyPreview 时,在另一个 tab 上选 OnlyPreview:聚焦已有的那个,当前 tab 不变 |
| A6 | pinned Home tab 上按钮可点但菜单项全灰 |
| A7 | 退出 app 再启动:Zellij tab 照旧恢复(本改动没有碰通用拆卸) |

## #7 按钮尺寸对齐 Cowork（2026-09-15）

Ral:「bl 的 menubar__pagetype__button 应该像 cowork 那样的尺寸」。

两边按钮容器均为 32×32 CSS px；实际差异是 BL 显式指定了 18×18、stroke 1.8 的 IconApps，
Cowork 使用 Tabler 默认 24×24、stroke 2。沿用既有配色、无边框透明背景、居中布局与交互，
只让 BL 此按钮的图标使用 Cowork 同样的尺寸与线宽，并补齐同名 BEM class。
通过 Vue 模板编译、图标渲染属性和编译后的 Less 核对；人工对比两边地址栏按钮。

Status: implemented; code-verified, human testing pending.

Vue script/template 编译通过；实际 Tabler SSR 属性为 24×24、stroke 2，两边参数一致。
编译后的 MenuBar Less 确认容器为 32×32、border 0、透明背景和双向居中。
未启动 Electron/E2E，视觉比较由 Ral 完成。
