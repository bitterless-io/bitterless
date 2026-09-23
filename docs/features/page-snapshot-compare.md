# `/page_snapshot_compare` —— 把"看到了什么"和"页面上有什么"一起导出

Status: implemented in BL and Cowork; owner verification pending (2026-09-23)

Related: [maestro-slash-commands.md](./maestro-slash-commands.md) 里的 `/page_snapshot`（同族，先落地的那条），
[page_snapshot 静默丢掉屏幕上可见的整棵子树](../issues/page-snapshot-drops-visible-subtrees.md)（催生这条命令的事故）

## Report

Ral 2026-09-23：「page_snapshot_compare 需要能导出一个压缩包，包含了目标页面的 html 原文和 page_snapshot yml」。

## 为什么需要它

`/page_snapshot` 交出的是**无障碍树**——"walker 看见了什么"。当树是对的，这就够了。
当树是错的，它恰恰**不够**，而且是系统性的不够：

2026-09-23 的 ChatGPT 账单事故里，三份快照（09:55:42 / 09:56:02 / 09:56:22）字节完全相同，都是 11 个元素，
而同一时刻屏幕上有 7 行交易。拿那三份快照去判断根因，得到的信息量和当时 agent 面临的一样多——零。
因为**"被剪掉"和"确实没有"在树里同形**，树本身不携带任何能反推的痕迹。

要判断，必须把**同一时刻的 DOM 原文**摆在树旁边。人（或另一个 agent）对着两份一比，
`display:contents` / shadow root / iframe / 深度超限 这些盲区立刻现形。

一句话：`/page_snapshot` 是给操作用的，`/page_snapshot_compare` 是给**排障**用的。

## 导出什么

一个 zip，顶层一个带时间戳的文件夹（沿用 `/export` 的 `createArchive(target, [basename(dir)], { cwd })` 形状，
解压出来是一个文件夹而不是一摊散文件），里面至少三个文件：

| 文件 | 内容 |
| --- | --- |
| `snapshot.yml` | `page_snapshot` 的**完整**产物：`# tab:` / `# page:` / `# title:` / `# elements:` 四行页头 + 任何 `# NOTE:` / `# INCOMPLETE:` + 整棵树 |
| `page.html` | 目标页面的 HTML 原文（`document.documentElement.outerHTML`），**脚本内容剥除**，见下 |
| `meta.json` | tab id、url、title、时间戳、viewport 尺寸、devicePixelRatio、UA、应用版本 |

`meta.json` 不是可选项：没有它，一个 zip 过两天就说不清是哪一屏、什么窗口尺寸下抓的，
而"窗口多宽"对布局类盲区恰恰是关键变量。

## 三条必须守住的约束

### 1. 两份必须来自同一次取

`snapshot.yml` 和 `page.html` 必须是**同一个瞬间**的。不能先 snapshot 再回头抓 HTML——
页面在两次取之间变了，两份就对不上，而这个命令要诊断的偏偏就是"页面在变/页面和树不一致"这类问题。
实现上取完树立刻在同一次 `Runtime.evaluate` 里取 `outerHTML`，或至少同一个 CDP 往返内完成。

### 2. 不截断

跟 `/page_snapshot` 同理：`toolPageSnapshot` 尾部那个 200k `clipText` 是给上下文窗口的。
文件没有上下文窗口，一棵停在半路的树对"对照页面上到底有什么"这件事最没用。

### 3. **HTML 原文里会有活凭据——必须剥脚本**

这是 `/page_snapshot` 没有的新风险，务必不要漏。无障碍树天然不含 `<script>` 内容；HTML 原文含。

实证：2026-09-23 Ral 贴 chatgpt.com 整页 HTML 时，里面 `<script id="client-bootstrap">` 的 JSON 中
带着一个**当前有效的 accessToken（JWT）**、account id 和 user id——拿到即可直接调 API。

所以导出时**默认把每个 `<script>` 的内容替换掉**（保留标签与属性，正文换成
`/* stripped by page_snapshot_compare */`），`<style>` 同样处理以控制体积。
需要原样脚本时必须由人显式要求，且导出结果要在 `meta.json` 里标明 `scriptsStripped: false`。

剥除是默认值，不是可选项：这个 zip 的用途就是发给别人看。

## 它不只是导出——它当场报根因

只导出 zip 有个问题：还得有人去比对两份文件。但这个比对**是确定性的**，不需要模型判断，
所以应该做进命令里。这是这条命令真正的价值，`/page_snapshot` 那条没有这一层。

### 判据

走完 walker，**每个被保留下来的元素身上都带着刚写的 `[data-coach-ref]`**。于是：

> 页面上**可见的文字叶子** + 身上**没有** `data-coach-ref` ＝ 漏网的

"文字叶子"的判据必须和 walker 的 `isMeaningful` 最后一条**逐字一致**
（非 `<label>`、`children.length === 0`、有直接文本）。不一致就会把 walker 本来就不打算收的东西
算成漏网，报一堆假缺口——又是那个"永远在响的警报"。

### 定位剪枝点

对每个漏网的叶子往上走祖先链，走到第一个 `isHidden` 判真的祖先就停 —— **那就是剪枝点**。
它为什么被判真是可读的：`getComputedStyle().display`、`getClientRects().length`、
`aria-hidden`、`hidden`、`getRootNode()` 是不是 ShadowRoot、`ownerDocument` 是不是当前文档、祖先深度。

### 归因表（确定性，不是模型猜的）

| 判据 | 归因 | 是缺陷吗 |
| --- | --- | :---: |
| 祖先 `display: contents` 且 rects 为空 | `display:contents` 剪枝 | 是 |
| 叶子的 `getRootNode()` 是 ShadowRoot | shadow DOM（open / closed 分开报） | 是 |
| 叶子的 `ownerDocument !== document` | iframe（同源 / 跨源分开报） | 是 |
| 祖先深度 > `MAX_DEPTH` | 超深度截断 | 是 |
| 祖先 `aria-hidden="true"` 或 `[hidden]` | 按设计剪掉 | **否** |
| 祖先 rects 为空且 display 正常 | 真隐藏 | **否** |
| 以上都不中 | **未知盲区** | 是，且最该发出来 |

最后一行是这条命令存在的主要理由：它对**还没被发现的盲区**同样能给出剪枝点元素，
下一次不必再花一整天去猜是哪一类。后两行必须明确归到"不是缺陷"，否则正常页面上天天报警。

### 输出

聊天里只给结论，正文进文件：

```
✅ page-snapshot-compare-20260923-1142.zip
   snapshot.yml · page.html · meta.json · diagnosis.md

⚠ 树里漏了 21 处页面上可见的文字

   剪枝点   div.transactions-list
   计算样式  display: contents      getClientRects(): 0
   归因     display:contents —— 自身不生成盒子，遍历闸把整棵子树剪掉
   样本     "ChatGPT Pro 20x" · "9/17/2026" · "$200.00" · "Paid" · "SGD 275.23"
```

无缺口时一行：`树完整覆盖了页面上所有可见文字，未发现盲区`。
`diagnosis.md` 里放完整清单：每个漏网叶子、它的剪枝点、归因、以及剪枝点的
outerHTML 头部（截断到 200 字符，够认出是哪个组件）。

### 两个实现陷阱

**做差必须和 walker 在同一次 `Runtime.evaluate` 里完成。** `data-coach-ref` 是 walker 刚写上去的，
而每次快照开头都会先清掉上一轮的标记 —— 分两次取，标记就对不上了。

**诊断器的可达范围和 walker 相同**：主文档 + open shadow root + 同源 frame。
closed shadow root 和跨源 iframe 里的叶子它**也枚举不到**，所以那两类只能报"这里有一块读不到"，
报不出具体漏了什么。这正是保留 `innerText` 文本覆盖自检的理由 —— 两者机制不同、互补：
诊断器精确（点名到元素）但范围受限，文本自检粗糙（只说"漏了 N 行"）但走的是另一条路。

## 与 `/page_snapshot` 的分别

| | `/page_snapshot` | `/page_snapshot_compare` |
| --- | --- | --- |
| 产物 | 剪贴板里的树 | 磁盘上的 zip |
| 用途 | 操作、贴给人看 | 排障、对照、归档 |
| 含 DOM 原文 | 否 | 是（脚本已剥） |
| 目标 tab | `currentCaptureTarget()`（人正在看的那页） | 同上，不另写第三份解析器 |

其余口径与 `/page_snapshot` 一致，不重复发明：只读（不激活 tab、不开录制、不设 browser-use 标记、
不 emit trace、`shot: false`）；失败给理由不给 `null`，且**失败时不落半个 zip**；
回渲染端只有有界元数据（路径、字节数、元素数），正文不跨 XPC 回去。

## Verification

| 项 | BL | Cowork |
| --- | --- | --- |
| 守卫（源码断言） | 11/11，红灯检查有牙 | 10/10 |
| 类型 | main surface 我碰的文件 0 error | `yarn typecheck` 通过 |
| 注入脚本约束 | n/a | `check:injected-scripts` 通过 |
| 邻居 | `pageSnapshotClipboard` 6/6、4 个 maestro 守卫全 ok | `pageSnapshotClipboard` 6/6 |
| **运行时诊断** | 见下 | 输出与 BL 逐项一致 |

**运行时验证是这条命令真正的验收**：把诊断探针分别喂「修复前」和「修复后」的 walker，
跑那张带 `display:contents` / shadow / iframe / 超深度的构造页。

修复前，它把人花一整天手工查出来的四条盲区**自己全指认出来了**：

```
⚠ div.contents-wrap   display: contents — 自身不生成盒子，遍历闸剪掉整棵子树
                      display=contents rects=0  吞掉 5 处  ["B-ROW","7/4/2026","SGD 275.23"]
⚠ div#sh-open         inside a shadow root       吞掉 2 处
⚠ span（frame 内）     inside a frame document     吞掉 2 处
⚠ span                deeper than the walk depth limit
```

修复后只剩最后那条——`MAX_DEPTH` 是安全上限不是缺陷，而快照顶部同时也有 `# NOTE: deepened`，两者一致。

**没做的**：Electron 没跑、没打包、真实站点未验收。

## Scope

常见功能，不是产品专属 —— BL 与 micromeet-cowork 均已实现。

**cowork 的实现差异**（不是技术方案不同，是构建约束不同）：注入脚本必须"整份文件一条函数表达式、
只 `import type`、不导出"（`keepNames` 会给具名函数套模块作用域的 `__name`，随文本进页面就
ReferenceError）。所以探针在 BL 是 `String()` 直接进表达式，在 cowork 得单独成
`snapshotCompare.inject.ts` 并注册进 `INJECT_ENTRIES` + `injectedScript.d.ts`，
由 `(${SNAPSHOT_COMPARE})(${SNAPSHOT_WALKER})` 把 walker 作为参数传进去。

## 实现提示

- zip：复用 `createArchive`（`maestroAgent.service.ts` 的 `writeSessionIoArchive` 已经这么用）
- 保存位置：沿用 `/export` 的两步——先 `pickSessionIoExportTarget` 式的保存对话框拿目标路径，再写盘；
  等待提示的存续区间就是写盘那一次调用
- 树的生成直接复用 `pageSnapshotForOperator()`，不要另起一份
