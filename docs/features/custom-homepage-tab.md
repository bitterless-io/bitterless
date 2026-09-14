# 自定义固有 tab(Set as homepage)

Status: implemented — owner testing pending(2026-09-14,Ral:「set as homepage 任何 tab 都能被设为固有 tab
并持久化,而不一定是 bl cowork 的当前的固有 tab 的页面。固有 tab 右击菜单要能还原成默认的固有
页面的入口」;同日收敛:「改为**只有 miniapp 才能被设为固有 tab**」)。

## #0 目标

| # | 目标 | 判据 |
|---|---|---|
| G1 | mini-app tab 右键 → `Set as homepage` | 网页 tab 上这一项**置灰**,不是隐藏 |
| G2 | 设完立刻生效 | 那个 mini-app 就地占住固有槽位,条上仍然恰好一个固有 tab |
| G3 | 跨重启存活 | 下次启动固有槽位装的还是它 |
| G4 | 能还原 | 固有 tab 右键有 `Restore default homepage` |
| G5 | 默认行为不变 | 没设过的机器,固有 tab 还是今天那个(cowork: AI-CRMS;bl: 本地 Home) |

> **G5 已被后续需求改写(2026-09-14,Ral:「将 bl 的固有 tab 默认就设为 onlypreview」)。**
> bl 没设过主页时固有槽位现在装 OnlyPreview,默认值来自 registry(`spec.defaultHome`)而不是
> 一份默认设置;cowork 那一份不跟,仍然是 AI-CRMS。「默认固有 tab」与「内置本地 Home」从此不是
> 同一件事,`isDefaultHomeTab` / `canRestoreHome` / `restoreDefaultHomepage` 三处判据随之改写。
> 见 [onlypreview-default-homepage.md](onlypreview-default-homepage.md)。本页其余各节仍然有效。

## #1 「只有 mini-app」这一条把风险面砍掉了大半

最初的设计要让**任意**网页也能占固有槽位,那会让每一条既有保护在用户选了普通网页之后变成 bug:

| 既有机制 | 键在什么上 | 装了任意**网页**会怎样 | 装 mini-app |
|---|---|---|---|
| 地址栏锁死 / `micromeet://` 导航禁闭 | `isNonWebTab`(mini-app 或文件预览) | 变成单页 kiosk,站内链接全被吞 | ✅ 本来就该锁 —— 它就是个应用 |
| 不许录制 / 不当录制继承者 | 同上 | 静默重新打开,固有 tab 会被选成 heir(仓里记过这是真实缺陷) | ✅ 判据原样成立 |
| **bl** `preventPinnedHomeEscape` | `pinned && kind === 'home'` | 任意跳转被 `preventDefault()` | ✅ 触不到(composite tab 不是 `kind:'home'`) |
| **bl** `buildPinnedHomeView()` 挂第一方 preload | 固有 tab 专用工厂 | **把 XPC 桥交给远端站点 —— 信任边界破口** | ✅ mini-app 本来就是第一方 |
| **bl** 登出落地强制回固有 Home | 同上 | 登出落在那个远端站点上 —— **安全回归** | ✅ 落在一个第一方 mini-app 上,可接受 |

**所以定案:`homeTarget` 只能指向一个 mini-app。** 地址栏锁不锁这个问题随之消失(Ral 原话:
「这样改为只有 miniapp 才能被设为固有 tab 就不用考虑这个问题了」)。

`pinned` 与 `kind` 仍然要**在概念上**分开 —— `pinned` 是「第一个槽位 ＋ 不可关」这件结构性的事,
`kind` 决定行为 —— 但因为取值被限制在 mini-app,今天所有按 `kind` 写的判据**一条都不用改**。

## #2 存哪里:和既有的休眠 `startUrl` 对账

两个仓**都已经有**一个「从哪里开始」的设置,而且都没有 UI:

| | cowork | bitterless |
|---|---|---|
| 设置项 | `CoworkSettings.startUrl` | `CoachSettings.startUrl` |
| 落盘 | `<userData>/coach-settings.json` | `<userData>/cowork/coach-settings.json` |
| 哨兵 | `DEFAULT_COACH_START_URL = 'https://example.com'` = 「没设」 | 同 |
| 行为 | 启动时**额外**开一个 tab,且明确拒绝 mini-app URL | 同 |
| UI | **没有** —— `setActiveAsStartup` / `resetStartupToDefault` 零调用方 | 同 |

那两个死方法的名字就是本需求,只是当年接在「额外开一个 tab」这个概念上。

**决定:同一个 settings service / 同一个 json,新增一个语义明确的键 `homeMiniappId`;
`startUrl` 原样不动。** 不合并的理由:`startUrl` 说的是「除固有 tab 之外再开一个网页」,
`homeMiniappId` 说的是「固有槽位装哪个 mini-app」——取值域不相交(前者拒 mini-app URL,
后者只收 mini-app),两件事真的不是一件事。文档里把这层区别写死,免得下一个人再来合一次。

```ts
/** 固有槽位装哪个 mini-app。`undefined` / 未知 id = 用 registry 里 `pinned: true` 的那个。 */
homeMiniappId?: MiniappId
```

**fail closed**:读回来的 id 在 registry 里不存在(降级、改名、脏数据)一律当作没设 —— 与
`miniappDef()` 既有的「未知 id 返回 undefined,不兜底到某个默认 mini-app」同一条纪律。

### #2.1 这条设置是**三格**,不是一格

固有 tab 是 `pinned` 的,而 pinned tab 按设计**不进** SavedTab 持久化(bl 的
`tab.store.ts` 里 `isRestorableComposite` 要求 `!t.pinned`;放松它会让固有 tab 在启动时被 restore
再开一份)。所以这一格的 tab 每次启动都是**从设置重建**的 —— 设置里没有的东西就等于不存在:

| 键 | 存什么 | 少了会怎样 |
|---|---|---|
| `homeCompositeId` | 装哪个 mini-app | 主页跨不过重启(G3) |
| `homeInstanceId` | 设为主页那一刻它**真实的** `instanceId` | 重建只能按 spec id 推导一个身份 —— 晋升时装在槽位里的那条 Zellij 会话既不被接管也不被关掉,**每设一次主页留一条孤儿会话** |
| `homeAlias` | 它当时的别名,以及之后每一次改名 | 用户起的名字重启即失,而 `Set as homepage` 还顺手关掉了旧 Home tab,连第二份带名字的副本都不存在([tab-alias.md](tab-alias.md) G5) |

按 spec id 推导的那个 instanceId(sha256 前 12 位)**只留作存量兜底** —— 给本字段出现之前写下的
设置用。它保证每次启动稳定(不会每启动一次多漏一条会话),但跟晋升那一刻的会话对不上。

三格一起写、一起清:`Restore default homepage` 必须把三格都清掉,否则下一次设主页会捡到上一任
的会话和名字,而那条会话此刻可能还活着 —— 两个 tab 抢一条 Zellij 会话。

## #3 落地顺序

1. `homeMiniappId` 进 shared 契约 ＋ settings service 读写 ＋ 一个 `resolveHomeMiniappId()`
   (settings 优先,fail closed 落回 `pinnedMiniappId()`)
2. 建固有 tab 的 boot 链改读 `resolveHomeMiniappId()`
3. 右键菜单两项:`Set as homepage`(mini-app 且非固有时可用)、`Restore default homepage`
   (固有 tab 且**当前是自定义值**时可用)
4. **运行时换槽位**,不是只写设置等下次启动 —— G2 要立刻生效

### #3.1 boot 链有两处,漏一处就是「假完成」

cowork 的 `createPinnedHomeTab()` **只建对象与 view slot**,真正的导航发生在
`MainWindowController.create()` 的 `initialReady` 链里。仓里两处注释都把「只改其中一个」点名为
**这个功能最典型的假完成**。bl 同形(`createPinnedHomeTab()` 与 `loadPinnedHomeTab()` 分离)。

### #3.2 换槽位不能出现「零个 pinned」的中间态

`MenuBar.vue` 在没有任何 tab 报 `pinned` 时回落到 index 0,注释写着「不该发生」。所以换槽位要
**先设后清**或在同一个同步块里完成,并且在 `broadcastTabs()` 之前收敛。

### #3.3 cowork:registry 的 `pinned` 要重新表述

`check-crms-fork.mjs` 硬断言 `MINIAPPS.crms` 带 `pinned: true`。`pinned` 的含义从
「固有 tab 装它」变成「**默认**固有 tab 装它」,守卫的措辞跟着改 —— 否则一个被支持的用户操作
会让构建变红。`check-miniapp.mjs` 的「至多一个 pinned」保持不变(默认值只能有一个)。

### #3.4 cowork:last-active 哨兵是字面量

`tab.store.ts` 用字面量 `'ai-crms'` 当「回落到固有 tab」的哨兵,已经写进用户的 localStorage,
刻意没改名。新功能必须继续认这个字面量,不许顺手改成 `homeMiniappId` 的取值。

### #3.5 bl:`kind: 'home'` 仍然专指内置 Home

bl 的默认固有 tab 是 `kind: 'home'`(本地 Home 渲染进程);自定义主页是一个 composite tab
(`kind: 'zellij' | 'onlypreview' | 'trench'`)。两者都 `pinned: true`,但:

- **登出 / 鉴权拆卸那条链**的落地保证在**下一次启动**:`forcePinnedHomeIntentVersion` ＋
  `createPinnedHomeTab()` 里的 `forcePinnedHomeBoot()` 无视 `homeMiniappId`,装回内置本地 Home
  —— 拆卸必须落在本地登录门上(A8)。
  拆卸**前**那一步(`prepareForAuthShutdown` 把前台收到固有槽位上,免得销毁那一帧露出当时的页面)
  判据只能是 `pinned`,**不能带 kind**:设了自定义主页时条上根本没有 `kind: 'home'` 的 tab,
  带 kind 的找法返回 `undefined`,这一步会被静默跳过。两件事不同层,不要合并成一条判据。
- `isPinnedHomeTab(tab) = tab.pinned && tab.kind === 'home'` 这个谓词**不改**。它护的是内置
  Home 的那几条;自定义主页不该继承它们(composite tab 有自己的一套)。
- 于是 bl 多一个判据:`isDefaultHomeTab` vs `isCustomHomeTab`,前者就是现在的 `isPinnedHomeTab`。

## #4 与 alias 的交点

Ral 2026-09-14 定:**自定义主页可以设 alias**。所以 `Alias…` 的 enable 判据不是
`!tab.pinned`,而是「不是**默认**固有 tab」:

| tab | 能改 alias? | 理由 |
|---|---|---|
| 默认固有 tab(crms / 本地 Home) | ❌ | 它的名字来自 registry,不是页面给的 |
| 自定义主页(用户选的 mini-app) | ✅ | 用户自己选进来的,理应能起名 |
| 其余所有 tab | ✅ | |

见 [tab-alias.md](tab-alias.md) #3。

## #5 验收

| # | 判据 |
|---|---|
| A1 | mini-app tab 右键 → Set as homepage:它成为第一个、不可关的 tab |
| A2 | A1 之后重启:固有槽位还是它 |
| A3 | 固有 tab 右键 → Restore default homepage:回到默认入口 |
| A4 | 普通网页 tab 上 `Set as homepage` **置灰** |
| A5 | 全新机器(没设过)行为与今天逐帧一致 |
| A6 | 设置里写了一个 registry 不认识的 id:静默落回默认,不崩、不空条 |
| A7 | 任何时刻条上**恰好**一个 pinned tab,换槽位过程中也是 |
| A8 | **bl**:设了自定义主页之后登出 —— 落地页仍是本地 Home |
| A9 | 给 mini-app tab 起名 → Set as homepage → 重启:名字还在,且槽位接回的是**同一条**会话(不是新开一条)。设为主页**之后**再改名,同样跨重启存活 |
| A10 | 自定义主页那个 mini app 这次拒绝打开(Zellij:Terminal 开关关着)—— 固有槽位退回内置本地 Home,启动 tab 照常开,设置一个字不改,下次启动再试它 |

## #rejected

| 方案 | 为什么否 |
|---|---|
| 任意网页都能当固有 tab | Ral 2026-09-14 收敛掉了。理由见 #1 那张表:每一条按 `kind` 写的保护都会在网页上变成 bug,bl 那边还有两条是安全级的(第一方 preload 交给远端站点、登出落在远端站点) |
| 把 `homeMiniappId` 合并进 `startUrl` | 取值域不相交:`startUrl` 明确拒 mini-app URL,而本需求只收 mini-app。合并等于让一个键同时表达两件互斥的事 |
