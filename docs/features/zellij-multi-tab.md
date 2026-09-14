# 多个 Zellij tab,每个一条会话,重启后跟着 tab 一起回来

> 2026-09-12 更新：[自动打开与目录记忆](./zellij-auto-open-directory.md) 取代本文的手动
> Initialize 入口。每个 tab 的稳定会话身份和恢复规则保留；打开时自动准备并显示加载动画。
> 新会话继承最近活动 pane 的目录，首次使用从 `~` 开始；Omni cell 也使用独立稳定会话。
> 主动关闭 tab 会结束对应会话和全部 pane；退出应用仍保留会话以便恢复。
> 下文旧入口和未覆盖范围记录原始实现背景，当前行为以新契约为准。

Status: implemented; owner testing pending
Owner: Ral
Date: 2026-09-11
Sibling: `micromeet-cowork` 已经落地了同一套(mini-app tab + `SavedTab.id/miniappId` + 恢复),
本文按那边的形状对齐,差异逐条写明。

## 0. 要解决的三件事

Ral 2026-09-11:

> terminal 能启动,快捷键也满足需求了,app 重启 session 没恢复,因为 zellij 的窗口都没恢复,
> 但是点击 init and open 恢复了上次的 session,这和我的预期不符合,因为我期望 zellij 可以存在于
> 多个 tab,init and open 应该打开新的 session,只有重启时一打开的 zellij tab 能恢复之前的会话。
> 另外 bl 的 tab new tab 按钮 hover 时不能展示像 cowork 那样的菜单,需要展示的这样好让我打开多个
> zellij tab。

拆成三条互相咬合的需求:

- **G1 多实例** —— 一个窗口里可以同时开 N 个 Zellij tab,各自是**独立的 pane 树**。
- **G2 新开即新会话** —— 「Initialize and open」/ + 菜单里点一次 Zellij,开的是一条**新**会话,
  不是重新贴回上一条。
- **G3 重启即恢复** —— 只有**上次留在条带里的那些 Zellij tab**会回来,并且各自贴回**自己**那条
  会话。tab 没了,会话就不再自动回来。

G2 和 G3 是同一枚硬币:会话名必须由**这个 tab 的身份**决定,而不是由「应用」或「运行档位」决定。

## 1. 为什么以前会串台

会话名原来是 `resolveZellijSessionName(profile)` —— 只看运行档位(Production / Preview / …)。
于是同一个档位下**所有** surface 都解析到 `bitterless` 这一条会话:

- 再点一次「Initialize and open」→ 贴回上次那条(违反 G2);
- 真开出第二个 surface → 两个终端驱动**同一棵 pane 树**(违反 G1)。

现在是 `resolveZellijSessionName(profile, surfaceId)`,档位退化成前缀(Production 和 Preview
可以并排跑,`zellij list-sessions` 里要认得出来),身份由 surface 提供。

## 2. 身份从哪来:Maestro 铸造的 `instanceId`

这是整个设计的支点,也是唯一一处**不能**将就的地方。

- **不能用 `tab.id`**。它是 `tab-${++this.tabSeq}` 的进程内序号,`tabSeq` 每次启动从 0 重来
  (`maestroBrowserView.service.ts`)。重启后 `tab-2` 会贴到一条完全无关的旧会话上 —— 比不恢复更糟。
- **不能在 Zellij 侧 `randomUUID()`**。那个 id 不跨 XPC、不落盘,重启必然换新的,G3 无从谈起。

所以:**Maestro 在建 composite tab 时铸造一个短、稳定、高熵的 `instanceId`**,随 tab 落盘,
恢复时原样传回。Zellij 拿它当 `surfaceId`,会话名由它推导。

```
+ 菜单 / Initialize and open → openCompositeTab({ id: 'zellij' })        → 新 instanceId → 新会话
重启恢复                      → openCompositeTab({ id: 'zellij', instanceId }) → 旧 instanceId → 旧会话
```

`instanceId` 用 12 位 hex(`randomBytes(6)`)。不用完整 UUID 的理由是会话名有 48 字符上限
(`ZELLIJ_SESSION_MAX_LENGTH`),而 `bitterless-test-debug-` 这个前缀已经占了 22 位 —— 截断把两个
surface 压成同一条会话,正是本文要防的那个 bug。12 位 hex 放得下,且截断永远轮不到它。

## 3. 单例改成 opt-in

`openCompositeTab` 原来硬性一种 spec 一个 tab:`this.tabs.find((tab) => tab.kind === spec.id)`。
现在 `MaestroCompositeTabSpec` 多一个 `singleton?: boolean`:

| spec | singleton | 理由 |
| --- | --- | --- |
| `onlypreview` | `true` | 绑定一个工作区、一套搜索运行时,第二份没有意义 |
| `trench` | `true` | 同上,一份 coin 运行时 |
| `zellij` | 省略 | Zellij 共享的是**一个 web server**,server 本来就是多客户端的;N 个 tab = N 个 HTTP 客户端 |

和 cowork 的判据一致(那边 `connector` / `only-preview` 标 `singleton: true`,zellij 不标)。

## 4. spec 生命周期回调改成按 host 寻址

`close()` / `setActive(active)` / `refresh()` 原来都不带参数,于是每个注册点用一个模块级
`let host` 闭包接住 —— 开第二个 tab 会把第一个的 host 覆盖掉,第一个 tab 的几何与拆卸回调就此成为孤儿。

改成 `close(host)` / `setActive(host, active)` / `refresh(host)`,Maestro 侧新增
`compositeHosts: Map<tabId, MaestroCompositeTabHostApi>` 存住每个 tab 自己的 host。
`zellijCoworkTab.ts` / `trenchCoworkTab.ts` 里的模块级 `let host` 随之删掉 —— 它们本来就是
「只有一个实例」这个假设的物证。

`ZellijWindowService` 同步从单槽位改成 `Map<surfaceId, { surface, tabHost }>`。

## 5. `setContentBounds` 必须带 surfaceId

chrome(`zellij/index.html`)量出终端该占的那个洞,推给 main。契约原来是
`setContentBounds({ x, y, width, height })` —— **没有办法说是谁量的**。N 个 surface 时,最后一个
量的赢,其余终端全部错位。

`XpcMainHandler` 的方法只收 `params`,拿不到 sender webContents,所以 id 必须显式进契约:

- surface 建 chrome 时把 id 放进 URL:`zellij/index.html?surface=<instanceId>`
  (dev 走 `loadURL` 拼 query,打包走 `loadFile(path, { query: { surface } })`);
- renderer 从 `location.search` 读出来,随 `setContentBounds` 一起发;
- main 按 id 路由到那一个 surface,查不到就丢弃 —— 不回退到「随便找一个」。

## 6. 持久化:composite tab 现在能落盘了

`tabs` 表原来只存 `{ url, title, favicon, position }`,composite tab 被**三道**闸拦下:

1. renderer 写入过滤 `t.kind === 'browser'`;
2. `isPersistableUrl(t.url)` —— composite 的 `url` 出生就是空串;
3. DAO 事务里 `const url = (t.url || '').trim(); if (!url) continue` —— 这道最隐蔽,前两道放开了它还会静默丢行。

改动:

- 表加 `kind TEXT NOT NULL DEFAULT ''` 与 `instance_id TEXT NOT NULL DEFAULT ''`;
  `CREATE_TABS` 与新的 `maestroSqliteMigrations` 条目(`versionCode: '260911140000'`)一起改 —— 前者管新装,后者管升级,漏一边就只坏一半人。
- DAO 放行 `if (!url && !kind) continue`。
- renderer 写入条件改成「browser 且 URL 可持久化」**或**「带 `restorable` 标记的 composite tab」。

`restorable` 是 spec 上的第二个 opt-in 标记,目前只有 `zellij` 打开。**刻意**不让
OnlyPreview / Trench 顺带被恢复:放开 `kind` 过滤本身会让它们一起开机自启,而 Ral 没有要求那件事。

## 7. 恢复路径

`restoreTabs` 原来只认 URL 行(`if (tab.url) this.addTab(...)`)。现在按行分派:

- 有 `kind` 且该 kind 注册过 spec → `openCompositeTab({ id: kind, instanceId, activate: false })`;
- 否则走原来的 `addTab({ url })`。

三条约束:

- **串行 + 逐行 catch**。Zellij 关着的时候 `openOnTab` 会 reject;一行失败不能带走整条 tab 条带。
- **不激活**。恢复出来的 tab 是冷的,焦点仍归固定 Home tab,由 `restoreLastActive` 决定最终落点。
- **仍然骑在那一次调用上**。`restoreTabs` 开头的 `if (this.tabs.some((tab) => !tab.pinned)) return`
  是一次性闸;composite 行必须在同一次调用里恢复,不能另开一次。

「上次激活的是哪个 tab」原来 key 用 URL(`tabKey`),composite 的空 URL 会退化成 `'home'`。
改成 composite 用 `${kind}:${instanceId}`,`restoreLastActive` 相应放行 composite。

## 8. + 按钮的 hover 菜单

对齐 cowork:

- 按钮同时挂 `@click`(新建空白 tab,行为不变)与 `@mouseenter` / `@mouseleave`(600ms 停留后弹菜单)。
- **600ms 不是随手取的**。原生 `Menu.popup()` 一弹出来就是模态且没有 hover-close,已经弹出的原生
  菜单**不能**被一次点击穿过去。延迟短于「把鼠标移过去再按下」所需的时间时,常见结果是菜单先弹出来、
  那一下点击落在菜单上 —— 从操作者角度看就是「点加号没有新建 tab」。600ms 让点击稳赢,停下来看选项
  仍然弹得出来。这条不是靠 cancel 能解决的:定时器可以取消,弹出的菜单不能。
- 菜单在 **main** 侧用 `Menu.buildFromTemplate` 构建(和已有的 tab 右键菜单 `showTabMenu` 同一套):
  operation view 是盖在 renderer DOM 之上的原生 view,renderer 里的下拉一超过一行就被页面盖住。
- 条目 = `New tab` + 分隔线 + 每个注册过的 composite spec 的 `title`。列表由注册表提供
  (`listMaestroCompositeTabs()`),不手写 —— 少注册一个 mini app 菜单里就该少一项,这是同一个事实。

## 9. 明确不做

- **孤儿会话回收**。关掉 tab 会拆掉 surface,但 Zellij 会话还在(`zellij list-sessions` 里能看到)。
  每开一个新 surface 就永久多一个名字。留到 `docs/issues/zellij-multi-instance.md` 记账。
- **per-surface 状态拆分**。`zellijStore` 的 `settingsOpen` / `error` / `status` 仍然是应用级的,
  一个 surface 加载失败会翻掉所有 surface 的状态灯。同上,记在那份 issue 里。
- **OnlyPreview / Trench 的恢复**。见 #6。
- **Omni cell 的会话寻址**。`omniWindow.helper.ts` 里 Omni 的 zellij cell 装的是**裸 origin**
  (`zellijOrigin()`),不带 session,所以在 Omni 里打开终端仍然会被问一次 session 名。这条本来就
  如此,本次没有改动:Omni cell 走的不是 `ZellijSurface`,也还没有一个能落盘的 per-cell 身份 ——
  要修就是把 #2 那套 `instanceId` 复制到 Omni cell 上,属于另一件事。

## 10. 验证

- `node --test tests/zellij/` —— 会话名 per-surface、菜单条目来自注册表、持久化往返、
  composite spec 的 host 寻址。
- `yarn typecheck`、`yarn lint`、i18n 检查、`yarn build`。
- **E2E 未运行**(CLAUDE.md:未经 Ral 当场要求不得自行启动 Electron E2E)。
  renderer → preload DAO → 加密 SQLite 这条链只有真跑一次应用才走得到,需要 Ral 手测:
  开两个 Zellij tab → 各自跑不同命令 → 退出 → 重开 → 两个 tab 都在,各自贴回自己那条会话。
