# Workbench ▸ Log 里显示 home 数据目录

**状态:** 🚧 **实现中**(2026-09-23)。**来源:** Ral 2026-09-23:
「你先将 `~/.micromeet-cowork` 的 dev home 目录找到 并显示在 workbench log 下,bl 同样要做,
我说的是这个目录下的 workflow」。

**配对:** 共用能力,`bitterless` 同步实现。

---

## 0 · 为什么要显示

**同一台机器上,一个产品有好几个 home 数据目录,而人从界面上看不出当前这个 build 用的是哪一个。**
实测(2026-09-23)机器上并存:

```
~/.micromeet-cowork              打包版
~/.micromeet-cowork_test_debug   dev 版        ← 工作流实际装在这里
~/.bitterless-production  ~/.bitterless_debug_dev  ~/.bitterless_preview  …
```

规则本身是清楚的,但它只写在代码里:

| | 怎么推出来 | 结果 |
|---|---|---|
| **cowork** | `~/.micromeet-cowork` + `app.isPackaged ? '' : '_test_debug'`(`pathHelper.homeData()`) | dev ⇒ `~/.micromeet-cowork_test_debug` |
| **bitterless** | `~/.` + runtime profile 的 `appName` 小写(`homeDataRoot()`) | `Bitterless_DEBUG_DEV` ⇒ `~/.bitterless_debug_dev` |

**这次要装/卸一个工作流,第一步就卡在"到底是哪个目录"** —— 只能去翻 `pathHelper` 的源码才答得上来。
Workbench ▸ Log 已经是"这个 app 在盘上用了哪些目录"的那一页,答案就该在那里。

> ⚠️ **cowork 的清单里恰恰缺它自己的 home 根。** 现有 `appDirectorySet()` 列了 userData 底下一堆
> 加一个 `~/.micromeet`(CLI home),**唯独没有 `~/.micromeet-cowork*`** —— 而 `workflows/`、
> `skills/` 正是装在那里。缺的就是人最需要的那一条。

## 1 · 要显示什么

| 条目 | 路径 | 为什么单列 |
|---|---|---|
| **Home data root** | `pathHelper.homeData()` / `homeDataRoot()` | 回答"这个 build 用哪个目录",也是下面两条的根 |
| **Workflows** | `<home>/workflows` | Ral 这次点名的那个;装/卸工作流直接到这儿 |
| **Skills** | `<home>/skills` | 同一层的另一个人手放东西的地方 |

## 2 · 两条纪律

**① 路径只从 path 权威拿,不要再手拼。** cowork 走 `pathHelper.homeData()` / `inHomeData()`,
bl 走 `homeDataRoot()` / `homeDataIn()`。项目规则原话:「**新代码不要再自己拼
`join(homedir(), '.micromeet-cowork…')`**」,有测试钉着。现有清单里那条 `~/.micromeet`
是手拼的(CLI home,另一条规则),**不要照着它抄**。

**② 目录不存在也要显示,不要过滤掉。** 这些目录是**惰性创建**的,"还没有"与"我找错地方了"在
界面上必须分得开 —— 把不存在的条目藏起来,人会以为自己看的是另一个 build。
cowork 现有 UI 已经这么做(`appDirectorySet` 的注释写着 "Some may not exist yet")。

## 3 · 两仓落点

两仓的现状差很多,**不要为了对齐去给 bl 补一整套目录清单机制** —— 那是另一个功能。

| | `micromeet-cowork` | `bitterless` |
|---|---|---|
| 现状 | 已有 `getAppDirectories` / `openAppDirectory` + UI 列表 | Log 视图只有 `file` + `env` 两行 |
| 改法 | **只往 `appDirectorySet()` 加三条**,UI 零改动 | `LogInfo` 加 `home` / `workflows` 两个字段,视图各加一行 |
| 路径来源 | `pathHelper.homeData()` · `inHomeData()` | `homeDataRoot()` · `workflowsRoot()` |

## 4 · 验收

| 判据 | 怎么测 |
|---|---|
| dev 版 Log 里显示的 home 根 = `pathHelper` 推出来的那个 | 与 `~/.micromeet-cowork_test_debug` 逐字比对 |
| 打包版显示的是不带后缀的那个 | `app.isPackaged` 为真时后缀为空 |
| bl 显示的随 runtime profile 变 | `Bitterless_DEBUG_DEV` ⇒ `~/.bitterless_debug_dev` |
| 目录不存在时仍然显示 | 删掉 `<home>/skills` 后那一行还在 |
| 路径不是手拼的 | 源码里新增的这几条不出现 `homedir()` |
