# page_snapshot 丢掉"既有子元素、又有自己文字"的容器里的文字

Status: root cause confirmed 2026-09-23；修法是采集改动，等 Ral 定（见 Decision needed；基线 PQ-3）

Related: [`# INCOMPLETE` 把 innerText 粘成一行的相邻行内元素报成缺口](./page-snapshot-incomplete-false-positive-on-glued-inline-text.md)
（修它的时候在真实站点上撞出来的），[page_snapshot 静默丢掉屏幕上可见的整棵子树](./page-snapshot-drops-visible-subtrees.md)，
台账 `areas/agent-runtime/browser-use/page-snapshot-closeout.md`（本条 = ISS-15），基线 `areas/agent-runtime/tooling/browser_use/baseline.html`

## Report

2026-09-23，修完相邻行内元素误报（ISS-14）之后，在 Chrome 153 里对公开页面跑修好的 walker：

| 页面 | 保留节点 | `# INCOMPLETE` 行数 | 其中属于本条 |
| --- | ---: | ---: | ---: |
| `ai-crms-demo.micromeet.ai`（我们的 demo 站首屏） | 15 | 0 | – |
| `react.dev` | 554 | 33 | 33 |
| `news.ycombinator.com` | 583 | 63 | 63 |
| `www.anthropic.com` | 530 | 3 | 3 |
| `github.com/browser-use/browser-use` | 1095 | 33 | 33 |

归类办法：对每一行报出来的缺口，找它里面没进树的文字节点落在哪；132 行全部落在同一种地方。例子：

- react.dev 首段 `React lets you build user interfaces out of individual pieces called components…` —— `<p>` 里夹着链接
- GitHub README 的段落、`Path 1: Fully Hosted Cloud: …` —— `<p>` / `<strong>` 里夹着链接
- HN 每条下面的 `117 points by … 2 hours ago | hide | 41 comments` —— 链接之间的 `by`、`|`
- 代码块里的标点 —— 语法高亮的 `<span>` 之间的 `=`、`{`

这些行是**真缺口**：树里确实没有那些字，自检报得对。

## Confirmed cause

`isMeaningful` 只在元素是**叶子**时才因为文字保留它：`el.children.length === 0 && directText(el)`。
`<p>Read our <a href="/terms">terms</a> first.</p>` 这种容器有子元素，所以 `<p>` 不进树；链接进树，
`Read our` 和 `first.` 这两段 `<p>` 自己的文字节点**哪儿都不出现**。唯一的例外是它落在一个按
`textContent` 取名字的祖先里（link / button / heading 等），那时祖先的名字把它带上了。

## Impact

1. **agent 读不到带链接或行内格式的正文。** 段落里只剩链接名，前后的句子没了。
2. **`# INCOMPLETE` 在几乎每个内容页上都响**（上表四个内容页全响，react.dev 33 行、HN 63 行）。
   这正是 ISS-4 / ISS-13 立这道自检时写下的判据要防的：「一个永远在响的警报等于没有警报」。
   ISS-14 修掉的是比对口径的误报；这一条不是误报，是树真的缺字 —— 只有采集改了，警报才会重新变得稀有、值得看。
3. Playwright 和 browser-use 都保留这类文字，基线 #3 的对照表漏了这一项（已补为第 16 条）：
   - Playwright 1.61.1 `ariaSnapshot({ mode: 'ai' })` 实测：`<p>Read our <a>terms</a> first.</p>` 出
     `paragraph` 下 `text: Read our` · `link "terms"` · `text: first.`；HN 那一行的 `by`、`|`，`Terms · Privacy`
     中间的 `·`，也都在。
   - browser-use（commit `d8110c5`）读源码：`dom/serializer/serializer.py:554-558`、`:1163-1175`，可见的文字节点
     各占一行，但**去掉首尾空白后长度 ≤ 1 的丢掉** —— `|`、`·` 这类分隔符它不列。

## Options

| 方案 | 做法 | 代价 |
| --- | --- | --- |
| **A（推荐）** | 容器自己的文字节点按文档顺序作为 `text` 节点放进树，和子元素交错（Playwright 同形） | 快照变大：上面五页里这类文字最多约 2,000 字（GitHub README 页，上限估计，部分已被链接名覆盖），另加每段一行的 YAML 开销；对 20 万字符的上限是零头 |
| B | 把容器本身保留为节点、名字取整段 `textContent` | 子元素的文字重复出现；名字 200 字截断，长段落照样丢 |
| C | 不改采集，让自检忽略这类行 | **否决**：把真缺口藏起来，agent 仍然读不到那段话 |

做 A 的口径跟 Playwright：所有非空白文字都进树。别学 browser-use 丢单字符 —— 否则 `Terms · Privacy`、
HN 的 `hide | 41 comments` 这类行，自检照样报。

## Decision needed

要不要做 A、排在基线 #6 的 P0 之前还是一起？推荐：做 A，和 P0 一起立项 —— 不做的话，`# INCOMPLETE` 在内容页上就是噪声，
而正文读不到本身就是 ChatGPT 账单那一类"看不见 = 不存在"的风险。

## Scope（做的话）

配对改动：BL `src/main/maestro/capture/debuggerCapture.ts` 的 `snapshotWalker`（`isMeaningful` / `walk` / `toAriaYaml`），
Cowork `apps/cowork/src/main/capture/snapshotWalker.inject.ts` 同形；折叠（`collapseWrappers`、表格行折叠）和
`check:snapshot-prune` 要一起看。Cowork 侧 issue：`projects/micromeet-cowork/docs/issues/page-snapshot-drops-mixed-content-text.md`。
