# page_snapshot 静默丢掉屏幕上可见的整棵子树，agent 把它读成"页面是空的"

Status: fixed; owner verification pending (2026-09-23) — real chatgpt.com acceptance needs Ral's login

Related: [Maestro](../features/maestro.md)，
工作区记录：`areas/agent-runtime/browser-use/page-snapshot.md`（现行方案）、
`areas/agent-runtime/browser-use/page-snapshot-closeout.md`（issue close-out 台账）

## Report

Ral 2026-09-23，Maestro 会话 `2n6mbjo9h5hmudg8q41`。任务是导出 ChatGPT 账号的报销凭证。
agent 进到 `chatgpt.com/#settings/Billing`，点 "View all" 进入 Transaction history，
`page_snapshot` 返回 **11 个元素**：

```
- tabpanel "Billing" [ref=e9]:
  - heading "Transaction history" [level=3] [ref=e8]:
    - button "Back" [ref=e6]
    - text: Transaction history
```

屏幕上实际有 7 行交易（`ChatGPT Pro 20x · 9/17/2026 · Paid · $200.00 · >`），一行都不在树里。
agent 回复「当前账号的 Transaction history 为空，没有可导出的报销凭证」，并建议换账号。

Ral:「命名有记录可以点，看这个对话怎么判断不去点的」/「为什么没能触发点击这行」。

答案是它没法点：树里没有那一行，就没有 `eN`，`ui_act` 无从下手。工具没报错、agent 没编造，
结论对世界却是错的 —— **静默假阴性**。

## Confirmed cause

把 `snapshotWalker` 原样抽出来（esbuild 转译，未改一行），在 Chrome 里对构造页求值：

| 结构 | 屏幕可见 | 快照可见 |
| --- | :---: | :---: |
| 普通 div 包裹 | ✅ | ✅ |
| `display: contents` 包裹 | ✅ | ❌ 整棵子树消失 |
| shadow DOM | ✅ | ❌ |
| iframe | ✅ | ❌ |
| overflow 滚动容器 | ✅ | ✅ |

`snapshotWalker` 有两道闸，性质完全不同：

```js
// 闸一 · 遍历闸（debuggerCapture.ts:1249）—— 破坏性
if (isHidden(child)) continue            // 整棵子树不进 walk，一个 stamp 都不执行

// 闸二 · 保留闸（debuggerCapture.ts:1266）—— 无损
if (isMeaningful(el)) { ... }            // 自己不留，孩子照样上提
```

判据是闸一：如果只是闸二，行里的文字叶子 `<span>$200.00</span>` 满足
`children.length === 0 && directText()`，会以 `text` 角色保留。快照里连一个金额、一个日期都没有，
说明 walker **压根没往下走一层**。

四条根因：

1. **`display:contents` 被判隐藏。** `isHidden`（:1113）用 `getClientRects().length === 0`，
   而 `display:contents` 元素自身不生成盒子，rect 恒为空 —— 判它自己不可见没错，错在闸一
   连它**可见的孩子**一起剪了。
   同类前科：`<select>` 关闭时 `<option>` 也没有 client rect，被同一道闸剪掉，当时用
   `selectOptions()`（:1206）点对点绕过，没修判据。这是同一根因第二次发作。
2. **shadow DOM 不遍历。** `walk()` 只走 `Array.from(el.children)`，不跨 shadow root；
   host 元素若无 role/文本/标识，闸二把它自己也筛掉，输出里一点痕迹不留。
3. **iframe 不遍历，且 iframe 本身也不出现。** `<iframe>` 的 `children` 为空，`Runtime.evaluate`
   只在主 frame 跑；同时 `roleOf`（:1030）的标签表里没有 iframe 条目，一个只有 `src`/`style` 的
   iframe 在 `isMeaningful` 全部判据下都不中。
4. **剪枝静默 —— 真正致命的放大器。** 全流程只有 `MAX_NODES` 触发时的 `truncated` 一个完整性信号。
   闸一剪枝、`MAX_DEPTH` 截断都不计数不上报；`# elements: N` 只报保留数；ref 编号因为
   计数器只在保留时自增而**天然连续**，连"有东西被跳过"都反推不出来。
   对 agent 来说，"被剪掉"和"确实没有"在输出里完全同形。

源码注释自称 "Coverage is comprehensive — the only caps are high safety bounds against a runaway
DOM, never a content limit."，与实际行为有落差：真正的覆盖率上限是闸一的可见性判据和
`el.children` 的遍历范围，而这两处都不产生任何可观测信号。

## Fix

四条走查完，外加一条修复过程中发现的。每条单独验证。

### 1. `display:contents` 不再当隐藏 ✅

新增 `isBoxlessPassthrough()`：rect 为空时补查 `getComputedStyle(el).display === 'contents'`，是则
**继续下钻但不保留该节点**。不保留是必须的 —— 点击走坐标派发（`clickLocator` 注释写明是为了让真实
指针序列冒泡到真正挂监听的祖先），boxless 节点没有坐标，给它 ref 等于给一个点不了的 ref。
`aria-hidden` / `[hidden]` 仍然优先剪掉：那是"不要出现在无障碍树里"，与布局无关。
`getComputedStyle` 只在 rect 为空的冷路径上调用。

### 2. 穿 open shadow root ✅

新增 `renderedChildren()`：open shadow root 存在时**用 `shadowRoot.children` 取代** light children
（后者只能经 `<slot>` 到达，两边都走会重复计入）；`<slot>` 解析为 `assignedElements()`，无分配时
回落到它自己的内容。

**slot 这一步不是锦上添花**：只改成走 shadow 而不处理 slot，会让被 slot 分发的 light DOM 内容从
快照里消失 —— 那是把一个盲区换成另一个。守这条的是新 guard 里的 slot 用例。

closed shadow root 从页面脚本**无法探测**（`el.shadowRoot` 对"没有 shadow"和"closed"都返回 `null`，
不可区分），不做 `attachShadow` 猴补丁。这块既读不到也标不出来，第 4 步的文本自检同样抓不到
（closed shadow 的文本不进 `innerText`）—— 真实残留盲区，见 Scope。

### 3. iframe ✅

- **同源**：`renderedChildren()` 经 `contentDocument.body` 下钻，ref 照常分配。
- **跨源**：`roleOf` 增加 `iframe` 角色（iframe 节点**永远出现**），`describe()` 在 `contentDocument`
  取不到时给节点挂 `note`，`toAriaYaml` 渲染成 `-- content not readable from this page (cross-origin frame)`。

### 4. 剪枝留痕 ✅

走完树后做一次完整性自检，把浏览器自己的答案当基准：`root.innerText` 逐行（去重、≥3 字符、上限
500 行）比对树里采到的全部 `name` / `value`，缺口写在输出**顶部**：

```
# INCOMPLETE: N line(s) of text are rendered on this page but are NOT in the tree below (e.g. …).
Treat this snapshot as a partial view: do NOT conclude content is absent. Read it another way
(browser_exec / an API call), or act on it with ui_act {"selector":"<css>"} — a ref is not required.
```

`MAX_DEPTH` 截断另给一行 NOTE。**`aria-hidden` / `[hidden]` 子树的文字从缺口里剔除** —— `innerText`
仍然包含它们，不剔掉的话几乎每个真实页面都会报缺口，而一个永远在响的警报等于没有警报。
成本闸：`truncated` 已经报过、或 `innerText` 超 500KB 时跳过自检；整个自检包在 `try/catch` 里。

**这是探测器，不是补丁** —— 它对还没发现的盲区同样会响，这是它存在的主要理由。

### 5. `ui_act` 解析不了 shadow / iframe 里的 ref ✅（修复过程中发现）

第 2、3 步让 shadow 和 iframe 里的元素**拿到了 ref**，但 `clickLocator` / `browserStepRunner.find`
解析 ref 的路径是 `document.querySelector('[data-coach-ref="eN"]')` —— 既不穿 shadow root，也不进
iframe 文档。实测修复后 `C-ROW` / `D-ROW` 的 ref `resolvable=false`。

不修就是把一个静默失败换成另一个：agent 看得见那一行、拿得到 ref、点下去得到 "Selector not found"。

`replayEngine.ts` 新增 `deepFindElement(root, selector, frames)`，序列化后**作为参数传给**两个执行器
（它们必须自包含，没法闭包引用）：先 `root.querySelector`（快路径不变），未命中才展开 `*` 扫描找
open shadow root 与同源 frame，递归下去，并返回**命中的 frame 链**。`clickLocator` 先把链上每个 frame
滚进视野、再滚元素（frame 内的 `scrollIntoView` 不会滚外层），**滚完之后**才逐层累加
`frame.getBoundingClientRect()` + border + padding，把 rect 换算进顶层视口坐标 —— iframe 内元素的
rect 是相对它自己那个 frame 的视口，直接拿去派发会点到完全错误的位置。

**未覆盖**：`waitForSelector` / `readText` / `elementExists`（技能脚本用）仍是主文档 `querySelector`。
技能脚本用录制选择器而非 ref，本次不动；技能若开始跨 shadow/frame 操作，这三个要一起改。

## Verification

| 项 | 方式 | 结果 |
| --- | --- | --- |
| 结构覆盖 10 例 | 抽取真实 `snapshotWalker` → esbuild → Chrome 对构造页求值 | 全通过（A/B/B2/C/D/I/E 可见；F/G/H 反向守卫仍不可见） |
| 跨源 iframe 标注、`MAX_DEPTH` 信号 | 同上 | 通过 |
| `aria-hidden` 不产生假缺口 | 同上 | 通过（missingLines 2 → 1） |
| 反事实 | `git show HEAD:` 取修复前 walker 跑同一页 + 新自检逻辑 | 报 6 行缺口，样本 `B-ROW` / `7/4/2026` / `SGD 275.23` —— **正是事故的形状** |
| ref 可解析性 | 主文档 `querySelector` 逐个解析 | 修前 shadow/iframe 为 false |
| 端到端点击落点 | 真实 `clickLocator` 取坐标 → 真实鼠标点击 → 断言监听器触发 | 5/5 命中正确元素，含 shadow 内与同源 iframe 内 |
| 类型 | `tsc -p`（main surface，复刻 `typecheck:surfaces` 的配置） | 两个改动文件 **0 error**；仓库既有诊断 64–65 项全在未触碰的文件里（数字会浮动是因为**另一个会话正在同一 worktree 并行改动**） |
| 既有守卫 | `check-snapshot-selects` / `check-capture-gating` / `check-browser-exec-workflow` / `check-browser-exec-auth` | 全 ok |
| 新增守卫有效性 | 把 `debuggerCapture.ts` 回退到 HEAD 再跑 | 失败（有牙），恢复后通过 |

`scripts/maestro/check-snapshot-selects.mjs` 增补了一个 blind-spot 场景（fake DOM + `vm`，沿用该文件
既有做法）：`display:contents` 透传、shadow 内容、跨源 iframe 标注、`aria-hidden` 反向守卫、自检缺口
计数与样本。该文件的 `stripTs` 是手写的类型剥离正则表，walker 签名一变就得同步 —— 本次已补。

**没做的**：Electron E2E 未跑（按工作区规则，非 Ral 要求不主动跑）；真实 chatgpt.com 账单页未验收
（需 Ral 登录态）；打包发布未做。探针跑的是 Chrome + 抽取的真实源码，不是 Electron 运行时。
`tests/maestro/maestroAgentBrowserSession.test.mjs` 失败，但在 HEAD 上同样失败（`Cannot find module
'@maestro-main/skills/skillScope.context'`，模块解析问题），与本次无关。

## Scope

~~CoWork 没有 `src/main/maestro/capture/` 这个模块，本次为 Bitterless 单边修复。~~

**更正（2026-09-23 同日）**：上面那句是错的。当时查的路径是 `micromeet-cowork/src`，
而 cowork 的代码在 **`apps/cowork/src`** —— 它有同一套 walker
（`apps/cowork/src/main/capture/snapshotWalker.inject.ts`），四个盲区**一个不少**：
`getClientRects().length === 0` 判可见、无 `display:contents` 透传、不穿 shadow root、
不下钻 iframe、`MAX_DEPTH` 静默 `return []`、无完整性自检。

按配对开发规则，ISS-1/2/3/4/7 必须同样落到 cowork。**这一条在两边都做完之前不算完成。**

**残留盲区**（明写，不粉饰）：closed shadow root 不可读不可标；canvas / WebGL 渲染的文字不在
`innerText` 里，自检抓不到；`waitForSelector` / `readText` / `elementExists` 仍是主文档解析。

行为层的 ISS-5（agent 把"快照里没有"当成"世界上没有"，且没把 `ui_act` 的裸 `selector` 当成逃生
通道）不在本 issue 的代码范围，台账在
`areas/agent-runtime/browser-use/page-snapshot-closeout.md`。建议先带着这次的改动跑一段真实使用，
看 `INCOMPLETE` 出现时 agent 的实际反应，再决定提示词动不动 —— 那一条留给 Ral 拍板。

## 第二起复现（2026-09-23 12:16，修复前的构建）

会话 `hj2g7k2sxolmudlc8dg`（`COWORK_TEST_DEBUG/agent-io/20260923121623152-…`）。
任务：「帮我导出 ChatGPT 9 月份的账单」。跑的是 **11:40 那个构建**，
`out/main/app.main.js` 里 `isBoxlessPassthrough` / `renderedChildren` / `deepened` 全部 0 命中，
遍历闸还是 `if (isHidden(child)) continue;` —— **不含本 issue 的任何修复**，所以这是一次干净的复现，
不是回归。

证据一句话说清：**整个会话里 `tabpanel` 出现 7 次，`tab` 和 `tablist` 各 0 次。**

```
# page: https://chatgpt.com/#settings        # elements: 27
- generic [testid="modal-settings"]:
  - dialog "Settings":
    - heading "Settings" / button "Close" / searchbox "Search settings"
    - tabpanel "General":          ← 只有面板，没有任何 tab
```

`tabpanel` 按 ARIA 必须由某个 `tab` 通过 `aria-labelledby` 命名，孤立的 tabpanel 不成立。
所以左侧那列分区导航（General / Personalization / … / **Account**，订阅与账单在 Account 底下）
**在 DOM 里，但没进树**。agent 手上因此一个通往 billing 的 ref 都没有。

后果不是"少看了一块"，是**把 agent 推去改用户账号的状态**：

| 时刻 | 动作 | 结果 |
| --- | --- | --- |
| 04:17:53 | 打开 Settings | 27 个元素，无 tab |
| 04:18:12 | 在搜索框搜 `invoice` | No settings found |
| 04:18:21 | 再搜 `subscription` | No settings found |
| 04:18:44 | 关掉 Settings | —— |
| 04:19:33 | **点 `menuitemradio "Sheldon Cooper's Workspace"`** | **把 Ral 的 ChatGPT 从 Personal 切到了 Business 工作区**，且直到会话结束都没切回来 |
| 04:20:46 | `open_tab https://chatgpt.com/admin/billing` | 被重定向到 `/admin/members`（他不是该组织的账单管理员） |
| 04:22:09 | 在 Cloudflare 人机验证页 `ui_act click "iframe"` | Selector not found，回合结束，任务失败 |

**快照里查不到 ≠ 页面上没有**，这条这次的代价是一次账号状态变更。
行为层的那几条（切工作区属于状态变更、撞人机验证该停）记在
`areas/agent-runtime/browser-use/page-snapshot-closeout.md` 的 ISS-8 / ISS-9，不在本 issue 范围。

复核用探针：`areas/agent-runtime/browser-use/settings-nav-probe.js`（开着 Settings 弹窗跑，
同时普查 iframe 与 open shadow root）。

### 同一会话第 3 轮：真实页面上的直接复现 ✅

Ral 自己把 `#settings/Billing` 打开后交给 agent，于是留下了这份对照——**这就是一直缺的那一步，
不必再跑 Console 脚本了**：

| | 快照 | 内容 |
| --- | --- | --- |
| 点 "View all" **之前**（line 61） | `# elements: 56` | Billing 面板**完整**：套餐、钱包、Transaction history 标题、"View all" 按钮、账单信息、三张卡、取消订阅 |
| 点 "View all" **之后**（line 63） | `# elements: 11` | 只剩 `heading "Transaction history"` + `button "Back"`，**一行交易都没有** |
| 24 秒后再拍两次（line 64/65） | `# elements: 11` | 字节完全相同 —— 不是渲染没跟上 |

`# elements: 11` 与 2026-09-23 上午那起事故（会话 `2n6mbjo9h5hmudg8q41`）**是同一个数字、同一屏**。

判据很干净：**父面板 `tabpanel "Billing"` 完好无损，子列表整棵不见**。
`isMeaningful` 是无损闸（子节点会上浮），不可能只吃掉列表而留下标题；
能一次吞掉整棵子树的只有遍历闸 `if (isHidden(child)) continue`，
也就是 `getClientRects().length === 0` —— ISS-1（`display: contents`）那一类。

agent 最后是**绕过快照**拿到数据的：`start_recording {mode:"api"}` → 再点一次 "View all" →
`capture_search "transaction"` 在录制里捞到
`GET /backend-api/payments/transaction-history?account_id=…&limit=4` 的 200 响应体。
换句话说，**页面把数据取回来了、渲染出来了，只是没进树**——这条独立证据把"没有数据"这个可能性也排除了。

顺带：那次录制走的是 `limit=4`，agent 没翻页。要"9 月全部账单"时这会漏。
