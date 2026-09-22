# `MAESTROSDK` —— 给 miniapp 的宿主 SDK(第一发:刷新事件 ＋ confirm)

Status: implemented — owner testing pending (2026-09-22,Ral:「bl cowork 的 miniapp 都需要一个 MAESTROSDK…
点击刷新时,对应 tab 下的 miniapp 通过 `MAESTROSDK.onRefresh` 能捕获事件,以及我还要
`MAESTROSDK.beforeRefresh`,先做这两个事件的回调」)。

姊妹实现:`micromeet-cowork` `docs/features/maestro-sdk-refresh-events.md`。这是**共通能力**,两边都做。

## #0 今天是什么样

miniapp 的渲染进程今天拿到的注入**不是一个 SDK**,是「一个 miniapp 一份 preload」:

| | 注入了什么 |
|---|---|
| 全体共有 | `xpcRenderer`(一行 `import 'electron-xpc/preload'` 自动 expose) |
| 各自 | `trenchHost` / `todoEnv` / `onlyPreviewEnv` / `submodulesEnv` / `homeEnv` / `fileBridge` … |

没有 `window.maestro`,也没有任何以 `maestro` 命名的注入全局 —— `maestro` 在本仓是**目录/模块命名
空间**(`src/main/maestro/**`、`@maestro-main/`)。所以这一发是**新增**,不是改名。

### #0.1 刷新今天对 miniapp tab 是坏的,不只是空的

`MaestroBrowserViewService.reload()`(`maestroBrowserView.service.ts:600`)只认 `active.view`:

```ts
const wc = active.view?.webContents
if (!wc || wc.isDestroyed()) { await this.warmAndLoad(active); return }
```

composite miniapp tab **没有 `tab.view`** —— 它的内容是 mini app 自己挂上去的原生 `View` 容器
(`mountComposite`)。于是刷新落进 `warmAndLoad` → `ensureWarm()`,而 `ensureWarm` **没有 composite
分支**(`:1191-1225`,只特判了 `home`):它会给这个 tab 取一个浏览器 view slot、写进 `tab.view`,再
`startTabNavigation` 拿 `tab.url` 去导航。

也就是说今天在 Zellij / OnlyPreview / Trench 的 tab 上按刷新,不是「没反应」,是**给它盖一层浏览器
view**。这条在本需求之前就存在,顺带修掉(见 #3)。

## #1 形状:一份共享 preload,一行引入

**注入面两仓逐字相同。** `src/shared/maestroSdk.api.ts`(契约)与 `src/preload/maestroSdk/index.ts`
(实现)在 bitterless 与 micromeet-cowork 是**同一份文件的两个副本**,差异全部关在 main 侧
(哪个覆盖层、哪条刷新路径)。分叉了,同一个 mini-app 在两个宿主里就得写两套代码,而这个 SDK 存在的
理由正是不要那样。守卫:`maestroSdkRefresh` 测试里有一条 `diff` 断言,两仓各一条,互指对方。

契约放 `shared` 而不是跟实现一起放 preload,是因为 **cowork 的 main 构建没有 `@preload` alias**
(只有 `@main` / `@shared` / `@renderer`),而 main 要用里面的事件名与参数前缀。

```ts
// src/preload/<miniapp>/<miniapp>.preload.ts
import 'electron-xpc/preload';
import '@preload/common/maestroSdk.preload';   // ← 加这一行
```

和 `electron-xpc/preload` 同一种用法(副作用 import,自己 expose),**不是**让每个 miniapp 去
`contextBridge.exposeInMainWorld` 一遍 —— 那就是又一张要靠纪律维护的名单。

渲染层拿到:

```ts
declare const MAESTROSDK: {
  /** 刷新即将发生。返回一个取消注册的函数。 */
  beforeRefresh(handler: () => void): () => void
  /** 刷新发生。返回一个取消注册的函数。 */
  onRefresh(handler: () => void): () => void
}
```

两个都返回 unsubscribe,而不是只提供 `addXxx`:miniapp 的组件会挂载/卸载多次,没有取消口的注册表
在第二次挂载后就会双跑。

## #2 触发与寻址

| 步骤 | 谁 |
|---|---|
| 人点工具栏刷新 / 右键 `Reload` | `menuBar.store.reload()` → `coach.reload()` → `MaestroBrowserViewService.reload()` |
| main 判定活动 tab 是 composite miniapp | `reload()` 新增的分支 |
| main 依次广播 `before` / `refresh` | `xpcMain.broadcast(MAESTRO_SDK_REFRESH_EVENT, { instanceId, phase })` |
| preload 过滤出「是不是我」,跑对应那组 handler | `maestroSdk.preload` |

**为什么是广播 + 过滤,而不是点对点调用。** `electron-xpc` 的注册表是 `handleName → webContentsId`,
**一个名字只有一个主人**;N 个 miniapp 共用一个 `XpcPreloadHandler` 类名会互相顶掉,最后注册的那个
赢。而 `XpcMainHandler` 的方法只收 `params`、**拿不到 sender 的 webContents**(`tab-alias.md` 记过
同一条),所以 main 也没法靠「谁调的我」反查身份。剩下的唯一可靠通路就是广播 + 收方自己判断。

### #2.1 身份从哪来:`additionalArguments`

SDK preload 从 `process.argv` 读 `--maestro-instance-id=<id>`,与广播里的 `instanceId` 比对。
`instanceId` 就是 `MaestroCompositeTabHostApi.instanceId` —— Maestro 铸的、跟着 tab 持久化、恢复时
原样发还的那一个,composite tab 的一切都以它为键。

`additionalArguments` 是本仓既有惯例(`--coach-userdata=`、`--mode=standalone`、
`--onlypreview-mode=detached`、`--trenchSurfaceToken=`)。为了让 mini app 不必自己拼这个字符串,
host API 加一格:

```ts
/** 这个 tab 的 mini app 在建自己的 preload-bearing view 时,要把这些摊进 additionalArguments。 */
rendererArguments(): string[]
```

mini app 那边就是一行 `additionalArguments: [...host.rendererArguments(), …自己的]`。

## #3 顺带修掉 #0.1

`reload()` 增加 composite 分支,**在取 `active.view` 之前**:活动 tab 是 composite ⇒ 只发事件,
一个 view 都不碰,直接返回。

这同时就是「miniapp 接管刷新」的落地:对 composite tab 宿主本来就没有正确的重载动作可做
(硬重载会毁掉 Zellij 的终端会话、OnlyPreview 的工作区绑定),所以这一发**不需要**再设计
「miniapp 注册了就不硬刷新」那套 —— 宿主对这些 tab 什么都不该做,与有没有人注册无关。

普通网页 tab / `home` tab 的刷新**一字不改**:SDK 根本不注入到它们那儿。

## #5 `MAESTROSDK.confirm()` —— 借宿主弹确认

mini-app 自己弹不了:它的页面是一张原生 `WebContentsView`,而它自己的**子 view 画在它之上**
(Zellij 的终端就是),页面里居中的 DOM 卡片会被整块盖住。宿主那一层覆盖层是唯一能画在操作区之上
的对话框层;窗口级原生 modal 在两仓都有记录会卡死整窗,不用。

```ts
const ok = await MAESTROSDK.confirm({ title, message, confirmLabel?, cancelLabel? })
```

| 环节 | 落点 |
|---|---|
| preload → main | `createXpcPreloadEmitter<MaestroSdkXpcContract>('MaestroSdkXpcHandler')`,载荷里带 `instanceId` |
| main handler | `MaestroSdkXpcHandler.confirm()` —— **类名是契约的一部分**,两仓一致,因为 preload 那一份逐字相同 |
| 前台判据 | 非活动 tab 一律 `false`,**不弹**:背景 tab 弹出来的对话框人不知道是谁在问,还会挡住前台那个 mini-app 的操作区 |
| 覆盖层起不来 | `false`。**与关闭确认相反** —— 那里放行是因为拦住会让 tab 永远关不掉;这里没有那种不可逆的代价,而默默替人答"是"更危险 |

**文案由 mini-app 给。** 它自己是第一方渲染进程、有自己的 i18n;main 与覆盖层在这条链上都只是管道,
不作者。这与「main 不许硬编码面向用户的文本」不冲突 —— 文本从来没在 main 里产生过。

## #6 Zellij 接住刷新:先 confirm,再 reload 渲染进程

Ral 2026-09-22:「zellij 捕获到刷新事件时需要先 confirm 然后 reload renderer」。

```ts
sdk.onRefresh(() => {
  if (asking) return            // 连点两下只问一次
  asking = true
  void sdk.confirm({ … }).then((ok) => { if (ok) window.location.reload() })
})
```

- **为什么要问**:这一格看着像网页,背后却挂着一条活的 shell 会话。先说清代价再动。
- **为什么重载的是渲染进程**:会话活在 Zellij 服务端,`location.reload()` 只把这一层 chrome 重新
  挂一遍、重新连回去。会话、scrollback、正在跑的进程都不受影响 —— 确认文案里写的就是这句。
- 没有 `MAESTROSDK`(独立 Zellij 窗口)⇒ 绑定直接返回空,那儿本来就没有宿主的刷新按钮。

## #4 两个事件的语义

| | 何时 | 给谁用 |
|---|---|---|
| `beforeRefresh` | 刷新动作开始前 | 保存草稿、停掉轮询、记住滚动位置 |
| `onRefresh` | 紧接其后 | 真正去重拉数据 / 重建视图 |

两条都是 **fire-and-forget**:`xpcMain.broadcast` 不等订阅方(`electron-xpc` 明写
"Fire-and-forget: does not wait for subscriber responses"),所以 main **不会** await
`beforeRefresh` 再发 `onRefresh`。这不成问题,因为 #3 定了宿主对 composite tab 不做任何动作 ——
没有东西在和 handler 抢时间。**不要**把 `beforeRefresh` 当成「能拦住刷新」的闸,它不是;要"可否决"
是另一条设计(见 PQ-2)。

handler 抛异常不影响其它 handler,也不影响另一个 phase:每个 handler 各自 try/catch,错误落一行
`maestro-sdk` scope 的日志。一个 miniapp 的 bug 不该让刷新这条链断掉。

## Acceptance

- Zellij / OnlyPreview / Trench 的 tab 上点刷新 ⇒ 该 tab 的 miniapp 依次收到 `beforeRefresh`、
  `onRefresh`;**其它** tab 里的 miniapp 一个都不收到。
- 同一个 miniapp 开两个 tab ⇒ 只有活动的那个收到。
- 注册返回的函数调用后不再收到。
- 普通网页 tab 的刷新行为逐字不变;composite tab 的刷新不再给它套浏览器 view(#0.1)。
- handler 抛异常 ⇒ 另一个 handler 与另一个 phase 照常执行。

## #pending-questions

| # | 问题 | 倾向 | 状态 |
|---|---|---|---|
| PQ-1 | 新 miniapp 忘了摊 `rendererArguments()` 怎么办? | 加一条守卫:扫每个 miniapp 建 preload-bearing view 的地方,断言摊了。这正是今天刚清掉的「靠纪律维护的名单」那类坑 | **未定** — 第一发先不做,等 SDK 的面稳定 |
| PQ-2 | `beforeRefresh` 要不要能**否决**刷新? | 要的话得改成可 await 的点对点调用(广播做不到),是另一条设计 | **未定** — Ral 只要「捕获事件」 |
| PQ-3 | SDK 还要哪些面(生命周期、可见性、标题、存储…)? | 按需加,不预先铺 | **未定** |
| PQ-4 | 「先开独立窗口、后 dock 进 tab」的那份收不到事件 | 身份是**建 view 时**摊进 `additionalArguments` 的,而三个 composite 的 `openOnTab` 都是**搬**同一个 view(`host.attach(surface.view)`)、不重建 —— 所以创建期没有 host 的那一份,身份永远补不上 | **已知缺口,第一发不修**。zellij 由构造避开了(surfaceId 就是 instanceId);trench / onlypreview 会中。选择是**严格**:拿不到身份就一条都不跑,绝不在别的 tab 刷新时误触发。要补,得给 SDK 一条「晚绑身份」的通路,而广播 + `handleName → webContentsId` 单主人的注册表都做不到点对点,那是另一条设计 |
