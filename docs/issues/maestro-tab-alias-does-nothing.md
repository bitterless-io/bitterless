# `Alias…` 点了没反应 —— 别名表单在打包版里起不来

Status: repaired against the proven cowork implementation; owner verification pending (2026-09-16)

Related: [Tab 别名(Alias)](../features/tab-alias.md),
micromeet-cowork `apps/cowork/src/main/modules/window-manager/windows/main/shellAlertView.service.ts`
(同一个功能在 cowork 的落地,Ral 确认是好的)

## Report

Ral 2026-09-16: 「alias 无效」，同一个功能在 micromeet-cowork 里是好的。他跑的是打包的
**Bitterless Preview**(`version_code` 260916131737，日志见 `~/Library/Logs/Bitterless_PREVIEW/main.log`)。

## 已经排除的

逐条对着运行中的那个包核过，不是这些：

| 怀疑 | 证据 |
|---|---|
| 代码没进包 | `app.asar` 里有 `MaestroTabAliasXpcHandler`(未被压缩改名，且 `new` 过)、`Alias…` 菜单项、`/out/renderer/maestro/tabAlias/index.html`、`maestroTabAlias-*.js`、`TabAliasApp-*.js`、`TabAliasApp-*.css`、`/out/preload/maestroCoach.js` |
| XPC 通道名对不上 | 主进程 `class MaestroTabAliasXpcHandler`,渲染层 `createXpcRendererEmitter("MaestroTabAliasXpcHandler")`,两边字面量一致 |
| `alias` 列没迁移 | 他这台机器的 `cowork/config/config.db` 建于 2026-09-01,账本停在那时的 version_code,`260914120000` 那条迁移会跑;`TabsDao` 读写两侧本来也按列在不在降级 |
| 菜单项被置灰 | 判据是 `!isDefaultHomeTab(tab)`,普通网页 tab 恒为可点 |
| 布局矩形没喂进去 | `layout()` 与 `applyContentBounds()` 两条路都调 `tabAliasView.setBounds(content)`,开窗时就跑过 |

日志里也没有 `[maestro] event=tab-alias-blocked gate=…` —— 但那行是 `console.info`,electron-log
只收自己那一路，所以**它的缺席不构成证据**(这一点本身要修，见下)。

## 与 cowork 那份能用的实现的结构差异

同一个需求、同一份设计文档，cowork 的 `ShellAlertViewService` 与 bl 的
`MaestroTabAliasViewService` 在四处不一样，每一处都是 cowork 的注释里明写过的坑：

1. **表单入口用了动态 `import()`。** `tabAlias.ts` 是全仓**唯一**一个
   `await import('./TabAliasApp.vue')` 才挂载的 maestro 渲染入口(home / localHome / workbench /
   history / control 全是静态 import)。打包后这条路要走 Vite 的 `__vitePreload`：它给拆出去的
   `TabAliasApp-*.css` 建一个 `<link rel="stylesheet" crossorigin>` 并**等它的 load/error**,
   失败就整条 `import()` 抛错。页面是 `file://` 且带 `default-src 'self'` 的 CSP —— 这条链上任何
   一环拒掉，`bootstrap()` 就在 `createApp().mount()` 之前抛出，而 `loadFile` 的 Promise 早已
   resolve(HTML 本身加载成功)。于是主进程认定「表单已就绪」，挂上一张**什么都没画的透明覆盖层**：
   点 `Alias…` 看不到任何东西，一行错误都没有。**这是首位嫌疑。**
2. **没有失败闩。** `ensureView()` 对一个已经加载失败、但 webContents 还活着的 view 直接复用，
   `ready` 永远停在 `false`;于是下一次 `requestAlias` 存下 `settle` 后**再也没人结掉它**,
   而此后每一次点 `Alias…` 都因为 `this.dialog` 还占着直接返回 `null` —— 菜单项照样可点，点了
   什么也不发生。cowork 为此专门有 `unavailable` + `failOpen()`,注释写的就是这个症状。
3. **渲染进程崩了没人收场。** 同 2 的形状，触发点不同。
4. **从不 `setVisible`。** cowork 建完 `setVisible(false)`,`addChildView` 之后 `setVisible(true)`,
   摘下时再 `setVisible(false)`。bl 只挂/摘。

另外 bl 是**点开菜单那一刻**才建 view 并加载(cowork 在开窗时就预建预载)，所以第一次弹窗必须
靠加载完成后的那次补挂 —— 链路更长，失败面更大。

## Fix contract

- `tabAlias.ts` 改成**静态 import** `TabAliasApp.vue`,与其余每一个 maestro 渲染入口一致。
  「先拉快照再挂载」这条意图由 `await tabAliasStore.init()` 保证，与动态 import 无关。
- 覆盖层对齐 cowork 那份已验证的实现：开窗时预建预载;`unavailable` 失败闩 ＋ `failOpen()`,
  加载失败与渲染进程消失都**当场按「什么都不改」结掉**,绝不留一个谁也结不掉的 Promise;
  `setVisible` 在挂/摘两侧成对。
- 诊断要能被看见:闸门与失败都走 `console.error`/`console.info` 之外的既有诊断通路
  (`emitTrace`),这样下一次「点了没反应」在 trace 里是有名有姓的一行。

## Acceptance

- 普通网页 tab 右键 → `Alias…` → 表单弹出，预填当前别名。
- 填名字保存 → chip 立刻显示别名;清空保存 → 回到页面标题;Escape / 取消 → 一个字不改。
- 连点两次 `Alias…`:第二次不排队，也不会把功能卡死。
- 表单起不来的极端情况:菜单项仍可点，每次点都在 trace 里留一行，且 alias 一个字都不会被改。
