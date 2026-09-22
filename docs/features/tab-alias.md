# Tab 别名(Alias)

Status: implemented — owner testing pending(2026-09-14,Ral:「tab 需要支持配置 alias 的能力,右击增加
按钮 Alias 点击弹出 alert view 是一个 form 可以编辑 alias。有 alias 的 tab 优先展示 alias 而不是
页面 title。另外 alias 清空并保存,就能展示回页面的 title 了。固有 tab 不能被 edit alias」)。

> bl 侧 2026-09-16 Ral 报「alias 无效」(cowork 正常)。排查与修复见
> [maestro-tab-alias-does-nothing.md](../issues/maestro-tab-alias-does-nothing.md) —— 本文的设计
> 一条没改,改的是 bl 那一层覆盖层的加载方式与失败收场。

## #0 目标

| # | 目标 | 判据 |
|---|---|---|
| G1 | 右键菜单有 `Alias…` | 固有 tab 上**置灰**(不是隐藏)—— 「为什么不能点」要看得见 |
| G2 | 点它弹出一个可编辑的表单 | 单行输入 ＋ 确定/取消,预填当前 alias |
| G3 | 有 alias 就显示 alias | chip 标签优先 alias,页面 title 退居其次 |
| G4 | 清空并保存 = 回到页面 title | 空串是**删除**,不是「标题是空的」 |
| G5 | 跨重启存活 | alias 进 sqlite `tabs` 行 |
| G6 | 页面改标题不覆盖 alias | 导航、`page-title-updated`、mini-app 的 `setTitle` 都不许碰它 |

## #1 alias **必须**是独立字段,不能写进 `tab.title`

这条是整份设计的地基,而且有具体证据:

| 写 `tab.title` 的地方 | 触发时机 |
|---|---|
| `page-title-updated` 监听 | 每次导航、每次页面自己改 `document.title` |
| OnlyPreview composite 的 `setTitle` seam | 每换一个预览文件 |
| `newTab` 的 mini-app 分支 | 建 tab 时写成 `miniDef.name` |
| 两个 tab 工厂 / `restoreTabs` | 建 tab 与恢复时 |

把 alias 存进 `title`,上面任何一条一响就把用户起的名字**静默冲掉**。所以:

- 新增 `OperationTab.alias?: string`(main 侧状态)
- 新增 `TabInfo.alias?: string`(上线,渲染层与 agent 都看得到)
- 新增 `SavedTab.alias?: string`(持久化)
- 显示端 `tabLabel()` 取 `alias || title || host || 新标签页`

## #2 表单怎么显示 —— 这是本需求真正的成本

操作区是一个**原生 view,绘制在 home 渲染进程的 DOM 之上**。所以三条路都走不通:

| 方案 | 为什么不行 |
|---|---|
| home DOM 里放一个居中卡片 | 被操作区 view 盖住(`miniapp-tabs.md` #4.1,原生菜单存在的同一条理由) |
| 原生 `dialog.showMessageBox` | Electron 根本没有文本输入对话框;而且本仓有三处记录:窗口级 modal 会卡死整个窗口并让 CDP 钻探死锁,已全部迁走 |
| 先把操作区 view 藏起来再用 DOM | 被既有不变量禁止 —— Workbench 刻意**不**对被盖住的 view `setVisible(false)`,因为 CDP 截图/快照在不可见 view 上会退化或失败,而 agent 的 `page_snapshot` 与钻探都靠它 |

**唯一可行且有先例的做法:一个新的覆盖层 `WebContentsView`。** 形制照 `WorkbenchViewService`
(append 进 `win.contentView` = 置顶、`setBounds(opBounds)`、透明背景),协议照 OnlyPreview 的
alert 层(main 持有 Promise,渲染层拉快照、回 `resolveAlert`)。

OnlyPreview 那个 alert 层**不能直接复用**:它的每个入口都 `requireRuntime(hostToken)`,view 是
composite 自己容器的子节点,不是 `win.contentView` 的。复用它等于把整个 composite 重新宿主一遍。

### #2.1 覆盖层的四条硬约束(都来自既有代码里的教训)

1. **没有对话框时不许挂在子节点列表里。** 一个透明的全矩形 view 挂着就是一个隐形的点击与按键
   黑洞。OnlyPreview 用 `ready && 有可见对话框` 双闸挡这件事。
2. **不许 `removeChildView` 再 `addChildView` 去置顶。** `addChildView` 对已在列表里的子节点
   是**重排**;摘掉再挂会走「新挂」路径,而一个还没绘制过的 view 在 macOS 上会沉到最底。
3. **bounds 要进 `applyContentBounds` 与首帧兜底**,否则第一次弹窗时它是 0×0(OnlyPreview 为此
   专门记了一个 `gate=bounds` 日志)。
4. **矩形取操作区,不是整窗**,否则控制面板在对话框打开期间整个不可点。

## #3 哪些 tab 不能改名

**只有「默认固有 tab」不能** —— 不是所有 pinned tab。Ral 2026-09-14 定:自定义主页可以设 alias。

| tab | `Alias…` | 理由 |
|---|---|---|
| 默认固有 tab(cowork: AI-CRMS;bl: 本地 Home) | **置灰** | 它的名字来自 registry(`pinnedDef?.name`),`page-title-updated` 本来就 `if (!tab.pinned)` 跳过它 —— 它的名字从来不是页面给的,所以「改页面的名字」在它身上没有意义 |
| 自定义主页(用户自己选进固有槽位的 mini-app) | 可用 | 是用户选进来的,理应能起名 |
| 其余所有 tab | 可用 | |

置灰而不是隐藏 —— 「为什么不能点」要看得见,和页面类型菜单同一条纪律。

判据因此是 `isDefaultHomeTab(tab)`,**不是** `tab.pinned`。
见 [custom-homepage-tab.md](custom-homepage-tab.md) #4。

## #4 持久化

`tabs` 表加一列。本仓的硬性做法是**两处同时改**:

| 位置 | 改什么 | 漏了会怎样 |
|---|---|---|
| `sqliteManager.ts` 的 `CREATE_TABS` | 新列 | 全新安装没有这列 |
| `sqlite.preload.ts` 的 `addMigration(<versionCode>, …)` | `addColumnIfMissing` | 升级用户没有这列 |

两个已记录的坑:

- **版本号必须高于当前构建的 `version_code`**,不只是高于上一条迁移。全新库的分支会把构建的
  version_code 直接盖进账本并且**一条不跑** —— 夹在中间的迁移对装了那个版本的人永远不执行。
- **迁移失败是静默的**:`runMigrations` 吞掉异常、打一行 warn,然后**照样记成已执行**。所以必须
  用 `addColumnIfMissing` 形式。

- **读路径必须容忍这一列不在**。上面那条「版本号高于当前构建」的规矩,本地 DEBUG/PREVIEW 包
  一定会违反:它的 `version_code` 是打包时刻的时间戳,一个在 alias 列存在之前打出来的包,
  时间戳照样比 `260914120000` 大。那个包建出来的库账本上写着「已经迁过了」,表里却没有这一列,
  迁移从此永远跳过。而渲染层 `listAll().catch(() => [])` 会把 `no such column: alias` 吞成
  「一个 tab 都没有」——**缺一列最多是没有别名,绝不能变成没有 tab**。所以 `TabsDao` 读写两侧
  都先问一次 `PRAGMA table_info(tabs)` 再决定用哪条 SQL。迁移本身不动:改版本号会让从**已提交的
  代码树**(version_code 更低)启动时 `assertSqliteMigrationManifest` 直接抛在启动上,更糟。

另外两条与 alias 直接相关:

- 渲染层 `persistSoon` 把响应式行 `map` 成纯字面量再过 XPC(Vue proxy 不能结构化克隆)。
  **新字段忘在那个 `.map()` 里 = 静默永不落盘。**
- `TabsDao.replaceAll` 会丢掉「既没 url 也没 miniappId」的行。一个空白新标签页被改了名字,
  今天存不下来 —— 这一条要一起决定(见 `#pending-questions` PQ-2)。

## #5 alias 会自动进入 LLM 的上下文

`list_tabs` / `activate_tab` / `open_tab` 三个工具都是 `JSON.stringify(await this.getTabs())`,
整个 `TabInfo` 原样给模型。所以 `TabInfo` 上一加 `alias`,**用户写的文本就直接流进 prompt**,
不需要任何额外改动。这是要的(agent 按人起的名字找 tab 更准),但要写下来:

- 工具描述里要说明 `alias` 是**用户起的名字**,`title` 才是页面自己的标题;
- 它是用户输入,不是可信指令 —— 与 tab 标题同级对待。

## #pending-questions

| # | 问题 | 倾向 | 阻塞什么 | 状态 |
|---|---|---|---|---|
| PQ-1 | 长度上限? | 64 字符,超出截断并在表单里提示 | chip 宽度是固定的,超长 alias 会把条挤变形 | **已定** — 64,三处同时钳(shared 常量 / 表单 maxlength / main 侧 slice);不另出提示,输入框本来就打不进第 65 个字 |
| PQ-2 | 空白新标签页起了名字,要不要能存活重启? | **不放开** `replaceAll` 的丢弃闸 —— 它挡的是脏行;一个没有 url 的 tab 恢复出来也是空白页 | G5 的边界 | **已定** — 没放开。一个没有 url 也没有 mini-app 身份的 tab 恢复出来仍是空白页,起的名字救不回它 |
| PQ-3 | composite tab(Zellij / OnlyPreview)的 alias 要不要跟着 `instanceId` 恢复? | 要 —— 它们正是最需要起名的(三个 Zellij tab 全叫 "Zellij") | 需要 `restoreTabs` 在 `openCompositeTab` 之后补写一次 | **已定并实施** — composite 行按 spec 重建、忽略存下来的那一行,所以 alias 由 `restoreTabs` 在 `openCompositeTab` 返回之后补写 |
| PQ-4 | 换页面类型(`setTabKind`)后 alias 保不保留? | 保留 —— 名字是**这个 tab 的**,不是它当前内容的 | bl 的 `becomeWebTab()` 会把 `title` 清空,alias 必须显式豁免 | **已定并实施** — 两个仓的换类型路径都只动 `title`,`alias` 原样留在 tab 上 |
| PQ-5 | 默认固有 tab 换成自定义主页后,原来那条(如果有)alias 怎么办? | alias 跟着 **tab** 走,不跟槽位走 —— 换槽位不动任何 alias | 与 custom-homepage-tab.md 的交点 | **已定** — 换槽位不动任何 tab 的 alias;`Set as homepage` 把这个 tab **已有的** alias 一起搬进设置,`Restore default homepage` 把设置里那条清掉 |
| PQ-6 | 自定义主页的 alias 存哪儿?它是 pinned,不进 `tabs` 表 | 存 settings 的 `homeAlias`,与 `homeCompositeId` / `homeInstanceId` 同一条记录 —— **不放松** `isRestorableComposite` 的 `!t.pinned`(放松了固有 tab 会在启动时被 restore 再开一份) | G5 在固有槽位上的落地;`Set as homepage` 还会关掉旧 Home tab,连第二份带名字的副本都没有 | 已定,见 custom-homepage-tab.md #2.1 |

## 改名入口只有这一个(2026-09-22)

Ral 2026-09-22:「取消 tab 双击改名的功能,只能右击点击 alias 改名」。原本 Zellij chip 上还有一个
双击就地改名的入口([zellij-tab-inline-rename.md](zellij-tab-inline-rename.md)),已连同整套编辑态
从代码里删除并加了反向守卫。**本文档的 G1 现在是唯一入口。**
