# Workbench chip 右边多一条分隔线,而且右键什么都不弹

Status: implemented; owner verification pending (2026-09-16).

Ral 2026-09-16:「bl cowork tab 中打开 workbench 的时候 workbench 的效果有问题:1. workbench tab
右侧不应该有分割线;2. workbench 右击应该有和 mini app 右击一样的菜单」。第 2 条经确认指的是
**右击 tab 条上那个 chip**,不是右击 Workbench 页面内容区。

## 现状

```text
今天(Workbench 打开时)
┌──────────────────────────────────────────────────────────────┐
│ [Home] │ [⚙ Workbench ×] │ [example.com ×] [zellij ×]  +   │
│         ↑ 左分隔          ↑ 右分隔 ——— 多的是这一条          │
└──────────────────────────────────────────────────────────────┘

右击 [Home] / [zellij] → 原生菜单
右击 [⚙ Workbench ×]   → 什么都不发生
```

两条都出在 `MenuBar.vue` 的同一段 `v-for` 里:

1. Workbench chip 自带一条左分隔(`workbenchStore.open && i === workbenchChipAfterIndex`),而
   「pinned 组之后、第一个可关闭 tab 之前」那条通用分隔在**同一轮迭代里紧跟其后**发出,于是落在
   chip 的右边。两条一夹,chip 被围成一个孤岛。上游 cowork 的
   [workbench-tab.md #7](../../../micromeet-cowork/docs/features/workbench-tab.md) 写的就是「前后各
   一条」,这次是 BL 侧改掉这半条。
2. chip 上只绑了 `@click` / `@keydown`,没有 `@contextmenu`;而且 Workbench **不是** `OperationTab`
   (它是 `WorkbenchViewService` 上的两个布尔,#2 of workbench-tab.md),所以既有的
   `showTabMenu({ id })` 按 id 在 `this.tabs` 里找不到它 —— 不能靠传个 id 复用。

## 契约

### #1 Workbench chip 右边没有分隔线

- Workbench 打开时,它占掉「pinned 组收尾」那个槽位:chip 左边那条保留,通用那条**不发**。
- Workbench 关着时,通用那条行为一字不变(pinned 组与第一个可关闭 tab 之间仍然有线)。
- 判据写成一个具名函数而不是模板里的长表达式,理由是它有两个互相不相关的前提(pinned 边界、
  Workbench 是否占位),混在 `v-if` 里下一个人读不出为什么。

### #2 右击 chip 弹和 mini app 一样的菜单

**同一份模板、同一个顺序、同一批分隔符**,不同的只是哪几项是亮的。不亮的**置灰而不是隐藏** ——
与 `showTabMenu` 里默认固有 tab 的既有口径一致:「为什么不能点」要看得见。

| 菜单项 | Workbench 上 | 为什么 |
|---|---|---|
| `New tab` | **亮** | 与 tab 菜单同义的全局动作;`newTab()` 这个 facade 本来就会先把 Workbench 退后台 |
| `Reload` | 灰 | Workbench view 是 boot 建一次、**活过关 tab** 的那一个,而且是唯一被允许把录制写进磁盘的 renderer。reload 它等于把刻意保住的 Capture 状态清掉 |
| `Duplicate` | 灰 | 单例 —— 结构上就做不出第二个(workbench-tab.md #9) |
| `Alias…` | 灰 | 名字来自 i18n registry(`menuBar.maestro.workbenchTab`),没有落脚点存别名;同默认固有 Home 的理由 |
| `Set as homepage` | 灰 | 只有 mini-app 能当主页(custom-homepage-tab.md #1) |
| `Restore default homepage` | 灰 | 作用在 pinned 槽位上,与这个 chip 无关 |
| `Close` | **亮** | → `closeWorkbenchTab()`:摘 chip + 隐藏 view,**不销毁** view |
| `Close other tabs` | 有可关闭 tab 时亮 | 「其余」= 所有非 pinned 的 operation tab |
| `Close tabs to the right` | 有可关闭 tab 时亮 | chip 锚在 pinned 组正后方,所以它右边的**就是**那一批 —— 与上一条同集合,这是位置决定的事实,不是复制粘贴 |

- 右击**不**把 Workbench 切到前台,也不把它退后台:右击一个 chip 从来不改变屏幕上显示的是谁,
  mini-app chip 也是这个行为。
- `Close other tabs` / `Close tabs to the right` 走既有的 `closeTabsAsUser`,所以范围里有 Zellij
  tab 时仍然只问一次确认(maestro-zellij-close-confirm.md G4),取消 = 一个都不关。
- 菜单在 main 里 build + popup:操作区那个原生 view 画在这份 DOM 之上,renderer 内的下拉会被盖住。
- 新增 XPC `showWorkbenchTabMenu()`,不给 `showTabMenu` 加一个「假 id」旁路 —— 那会把
  「`this.tabs` 里找不到就返回」这条守卫变成可被绕过的。

## 触点

| 文件 | 改动 |
|---|---|
| `src/shared/maestro/coach.api.ts` | 契约加 `showWorkbenchTabMenu()` |
| `src/main/maestro/xpc/coach.handler.ts` | 同名转发 |
| `src/main/maestro/windows/main/maestroWindow.controller.ts` | facade → browserView |
| `src/main/maestro/windows/main/maestroBrowserView.service.ts` | `showWorkbenchTabMenu()`;state 接口补 `closeWorkbenchTab()` seam |
| `src/renderer/maestro/home/src/store/workbench.store.ts` | `showMenu()` |
| `src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue` | chip 加 `@contextmenu`;`pinnedGroupDivider()` 判据 |

## 验收

1. 打开 Workbench:chip 左边有一条竖线,**右边没有**;右边直接接第一个浏览 tab。
2. 关掉 Workbench:pinned 组与第一个可关闭 tab 之间那条线**回来**。
3. 右击 chip → 菜单弹出,项与顺序和右击一个 mini-app tab 完全一致;`Reload` / `Duplicate` /
   `Alias…` / `Set as homepage` / `Restore default homepage` 五项置灰。
4. 菜单里 `Close` → chip 消失、网页露出来;齿轮再点开,**Capture 面板里之前的录制行还在**。
5. 菜单里 `New tab` → 新 tab 出现且 Workbench 退后台。
6. 只有 pinned Home + Workbench(没有别的 tab)时:`Close other tabs` 与 `Close tabs to the right`
   两项置灰。
7. 右击 chip 本身不切换前后台:Workbench 在后台时右击它,前台那个网页仍然显示。
8. 范围里有 Zellij tab 时,`Close other tabs` 仍然先弹一次确认,取消则一个都不关。
