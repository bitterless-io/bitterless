---
id: agent-web-tools
kind: feature
status: implemented
area: agent 工具面 · 联网读页 / 受控标签
---

# bl 的联网工具:`web_search` · `web_fetch` · `deep_fetch`(+ 受控 tab)

2026-09-15：[deep-fetch 文本技能与 tab 加载修复](../issues/deep-fetch-tab-workflow.md)
规定，用户说「deep fetch / deep search」时先走内置浏览器操作流程，主动开页、观察、
检索并核验；原生 `deep_fetch` 保留为已知 URL 的可选一次性读取工具，失败可转普通 tab。

- **提出**:Ral 2026-09-11 ——「在一个 miniapp 里让 agent 查看天气,agent 让我自己去打开 tab」;
  随后:「websearch 是不能获取那些需要 js 渲染的页面的内容的,所以还需要一个内置技能,
  当 websearch 不够能升级到 deep_fetch」;
  再随后:「deep_fetch 需要打开一个显式的 tab 的 WebContentsView 去搜索内容,且和浏览器共用 session
  (免得需要登录,内置浏览器登录过的网页就能免登录了);另外 tab store 增加状态,
  一个 tab 是否处于被控制状态,然后需要 tab 的 favicon 区域有动画表明正在被控制」。

## 起点:bl 的 agent 完全上不了网

查过整个 `src/main`:**零个联网工具** —— 没有 `web_search`、没有 `web_fetch`、没有 `deep_fetch`,
`browser_exec` 只是页内 `fetch`,`list_tabs` / `activate_tab` 只能列举和切换已存在的 tab。

所以「查一下天气」这件事,agent 当时的可选项是**空集**。它让人自己去开 tab,
是当时唯一诚实的回答 —— 缺陷不在措辞,在工具面。

## 升级链

```
web_search(找 URL,付费)→ web_fetch(免费读正文)→ deep_fetch(真浏览器渲染 JS 后再读)
```

判据写进了工具描述本身,而不是留给模型自己悟:`web_fetch` 拿回来是 app 壳、转圈、
"enable JavaScript" 或登录墙时,**那不是错误,那是客户端渲染的站点**,只有会渲染的取页能读它。

## `deep_fetch` 的载体:真实 tab,不是隐藏窗口

从 cowork 移植过来时它用的是 `new BrowserWindow({ show: false })`。按 Ral 的要求改成
**真实 tab 的 WebContentsView**:

| | 隐藏窗口(原) | 真实 tab(现) |
|---|---|---|
| session | 默认 session | **与浏览器共用** —— 内置浏览器登录过的站点直接可读 |
| 可见性 | 完全不可见 | 在 tab 条里,chip 上有动画 —— **但不抢当前 tab**(见下) |
| 隔离 | `sandbox` + `contextIsolation` + 无 preload | 浏览器 tab 的常规配置 |

**代价写明白**:真实 tab 不再比普通 tab 更严。这不是新增的暴露面 ——
任何一个用户自己打开的页面本来就是这个配置 —— 但原来那层额外隔离没有了。
所以四道闸一条不少地留着:URL 策略(私网/环回/云元数据一律拒)、权限一律拒、
`window.open` 拒、下载拒。

**空白 tab 是硬要求**:载体只负责开一个空白受控 tab,导航由 `deep_fetch` 自己做 ——
那三道闸必须装在 `loadURL` 之前,由载体顺手导航会让第一跳绕过全部闸门。传给载体的 `url`
只用来给 chip 一个占位(cowork 那边还用它挑 session profile),不许拿它导航。

**不 activate**:tab 出现在条上、chip 带动画,但焦点留在人正在看的那个 tab 上。一次取页几秒钟,
把人拽走再拽回来比看不见更糟 —— 受控动画存在的意义正是"不用切过去也知道它在被驱动"。
代价是要手动给这个隐藏着的 view 摆一次位:零尺寸视口会让响应式页面按 0×0 布局,列表干脆不渲染。

隐藏窗口那条路**保留**,不是为了兼容,是为了没有窗口可用时(主窗口还没建)仍能工作。

## 受控状态与动画

`OperationTab.controlled` 上线到渲染层,tab chip 的 **favicon 槽**在被驱动时换成核心＋绕行卫星动效。

三个刻意的决定:

- **接在 favicon 槽,不新增元素** —— 那个槽恒定 16px、已经有 loading 换图的先例,chip 不会重排。
- **优先级高于 loading** —— agent 驱动时页面本来就常在加载,两个都显示会变成"转圈套转圈",
  而人要看的是**谁**在动它。形状也刻意不同:转圈=页面在加载,核心＋卫星=有人在动它。
- **计数而不是布尔** —— 同一个 tab 上可能同时有两件事在驱动它,先结束的那件不该把动画关掉。
- **只是展示,不是闸** —— 被标记的 tab 照样能被人点击、切换、关闭。做成闸会让"agent 忙着"
  变成"用户被锁住",那是两件事。

无边框、`prefers-reduced-motion` 下退成静态(全仓 Borderless UI 规则)。

2026-09-14 扩展：[统一 browser-use 生命周期](../plan/tasks/browseruse-lifecycle-002.md) 将普通网页操作和钻探接入同一动效。
`start_browser_use({tab_id})` / `end_browser_use({tab_id})` 只切换当前任务的活动标记；自动执行和异常收尾共用此状态。
历史关联、LRU 保留和钻探录制清单不是正在操作状态；这两个工具不切换操作目标、不关闭网页、不移动前台、不直接改变录制清单。

## `web_search`:走 bitterless-private,凭 bl 自己的登录

Ral 2026-09-11 拍板:**先在 bitterless-private 实现,和 cowork 共用一个 Exa key**,
并且「search 接口需要登录才能用哦」—— 不是 SK,是 bl 自己那套登录。

所以端点落在 **core**(`bitterless-private` `apps/core/src/modules/search/`):

- `POST /search/web`,`@UseGuards(JwtAuthGuard)` + `@Scope("customer")` —— 与 bl 登录同一道闸;
- 请求体与响应跟 micromeet relay 的 `/v1/search/web` **逐字一致**,所以两端的客户端实现同源;
- 花费按**登录用户**分账(`user.sub`),不是按服务器 —— 否则一个人能把别人的额度用光;
- **应用里没有任何搜索厂商 key**:Exa 凭据只在服务端。

为什么不是 relay:2026-09-11 探活确认线上**只部署了 core** ——
`POST /auth/login` 回 400(路由在)、`POST /v1/messages` 回 404(relay 入口不在这台上),
且该函数的 env 是 `CORE_PORT`。relay 这个 app 没有线上函数,端点放那儿等于发不出去。

### token 怎么到主进程

这是这次唯一的结构性改动。登录态原本**只在渲染层**(`authToken.service.ts` 的 localStorage),
而 `web_search` 跑在**主进程** —— `grep -rn "getCustomerToken" src/main/` 零命中。

做法:登录成功时由渲染层经**已有的** `AuthHandler` xpc 通道把 token 推给主进程。

- 推送点只有一处:`auth.store.ts` 的 `activateAuthenticatedSession()` ——
  密码登录、验证码登录、设置密码、**启动时恢复会话**全都汇到这里,分头推会漏掉其中一条;
- `baseUrl` **一起推**,让"测试还是生产"这个判断只留在 `auth.api.ts` 的 `getCoreBaseUrl()` 一处,
  不在主进程再写一遍然后走岔;
- 主进程**只放内存**(`customerSession.service.ts`)。重启后渲染层会再推一次,
  落盘只是多存一份能被读走的凭据;
- 失效路径三条都清:渲染层 `clearLocalSession()`、主进程 `deactivateSession()` 与
  `invalidateSession()` —— 后两条不等渲染层广播回来,401 之后主进程手里的 token 立刻作废。

未登录时 `web_search` 返回 `not-signed-in`，指出该搜索服务需要登录并停止对它的重复调用。
需要在线核验时，转入 deep search：复用合适的会话 tab 或后台 `open_tab`，用
`page_snapshot / ui_act` 输入查询、查看结果、打开来源并核验；没有操作 tab 时先创建。
这是现有浏览器工具组成的流程，不是独立 `deep_search` 工具。`web_fetch` / `deep_fetch`
可读取流程中找到的 URL；`deep_fetch` 本身只渲染单页，不等于完成搜索。
只有实际阻塞任务的登录或工具限制才需要交给用户处理，不要求先修好可替代的搜索服务。
其他搜索失败也遵守[搜索失败后的浏览器检索约定](../issues/web-search-browser-fallback.md)，
保留当前 user 前置提示词机制及用户对浏览器操作的明确限制。
