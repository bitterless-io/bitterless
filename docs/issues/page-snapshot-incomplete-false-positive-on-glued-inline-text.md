# `# INCOMPLETE` 把 innerText 粘成一行的相邻行内元素报成缺口

Status: root cause confirmed, fix in progress (2026-09-23)

Related: [`# INCOMPLETE` 对 CSS `text-transform` 误报](./page-snapshot-incomplete-false-positive-on-text-transform.md)（ISS-13，同一道比对的上一次修复），
[page_snapshot 静默丢掉屏幕上可见的整棵子树](./page-snapshot-drops-visible-subtrees.md)（自检本身 = ISS-4 / ISS-7），
台账 `areas/agent-runtime/browser-use/page-snapshot-closeout.md`（本条 = ISS-14），
基线 `areas/agent-runtime/tooling/browser_use/baseline.html`（#3 第 15 条、#6 第 6 项）

## Report

2026-09-23 做 browser-use 对照基线时，`areas/agent-runtime/tooling/browser_use/probe/inline-fp.cjs`
在 Chrome 里跑抽取出来的 walker：

| 构造 | `# INCOMPLETE` |
| --- | --- |
| `<nav><a>Home</a><a>About</a><a>Pricing</a></nav>`（JSX 渲染出来常常就是这样：标签之间没有空白） | 报 `"HomeAboutPricing"` |
| `<div><button>Save</button><button>Cancel</button></div>` | 报 `"SaveCancel"` |
| 同样的标记，标签之间有空白，或容器是 `display:flex` | 不报（正确） |

探针页 `probe/index.html` 另报了一条 `"Under modal buttonInvisible button"`：两个按钮中间夹着一个
`visibility:hidden` 的 `<ul>`（里面是 "Log out" 链接）。

修的过程中又测出同一族的一形（修前就有）：`<label for="q">Search</label><input id="q" value="ct"><button>Go</button>`
报 `"SearchGo"`，标签之间有空白时报 `"Search Go"` —— agent 往搜索框里打完字、紧接着拍快照，正是这个形状。

这些行里的文字，树里全都有。

## Confirmed cause

自检逐行比对 `root.innerText` 和树里采到的文字（名字 / value / 保留元素的直接文本）。有三处口径不一致：

1. **分隔符。** 采集侧每段之间补一个空格（`captured += ' ' + …`）。DOM 里相邻的行内元素之间**没有空白**时，
   innerText 不加任何分隔，渲染成一整行 `HomeAboutPricing`，于是 `"homeaboutpricing"` 在
   `" home about pricing"` 里找不到。标签之间有空白时 innerText 自带空格；flex 子项会被转成块级、各占一行
   —— 所以这两种不报。
2. **`visibility:hidden`。** innerText 跳过 computed `visibility` 不是 `visible` 的文字，**连这个块自己的换行也不加**。
   而这个块照样占着布局，把两侧的按钮分到两个匿名块里，源码里的换行在行首行尾被吃掉 —— 两侧就粘成了一行：

   ```
   两个按钮中间夹 visibility:hidden 的 <ul>   → "Under modal buttonInvisible button"
   同样位置换成 display:none 的 <ul>          → "Under modal button Invisible button"
   同样位置换成可见的 <ul>                    → "Under modal button\nLog out\nInvisible button"
   ```

   walker 不看 `visibility`（基线 #6 第 2 项），隐藏的链接照样进树，采集侧的顺序是
   `…under modal button · hidden menu: log out · invisible button…` —— 只去掉空白也对不上。
3. **表单控件的值。** innerText 从不渲染 input 的值，但采集侧按树序把 value 紧跟在控件名字后面：
   `search · ct · go`。而 `<label>` 自己不进树，它的文字只以控件名字的身份出现 —— 于是 `SearchGo` 两半
   中间隔着一个页面上根本不在这一行里的 `ct`。

实测（Chrome 153；跑真实的 BL 源码、Cowork 注入文件、修复前的 walker 三份，三份结果一致）：

| 页面 | 修前 | 只去空白 | + 直接文本跳过不可见 | + value 接在名字后面 |
| --- | --- | --- | --- | --- |
| 导航 / 按钮 / 中文导航 / CSS 大写导航 / aria-label 箭头链接，标签之间无空白 | 误报 1 | **0** | **0** | **0** |
| 标签之间有空白 / flex | 0 | 0 | 0 | 0 |
| 两个按钮夹 `visibility:hidden` 的块（探针 c13/c16/c17） | 误报 1 | 误报 1 | **0** | **0** |
| 两个按钮夹 `visibility:hidden` 的 span | 误报 1 | 误报 1 | **0** | **0** |
| label + 有值的 input + button（有无空白都算） | 误报 1 | 误报 1 | 误报 1 | **0** |
| 真缺口：svg 图表文字、`Total due: <b>$200.00</b>` | 报 | 报 | 报 | 报 |
| ISS-4 反事实（修复前的 walker + 新比对，盲区构造页） | 6 行 | 6 行 | 6 行 | 6 行，样例 `B-ROW` / `7/4/2026` / `SGD 275.23` |

## Fix

只动比对，不动采集（和 ISS-13 同一原则）：

1. **比对时去掉全部空白**（叠在 ISS-13 的大小写折叠上）：`captured`、每行的 `key`、`aria-hidden` 文字三处都
   `.replace(/\s+/g, '')` 再 `toLowerCase()`。`missingSample` 照旧回报 `line.raw` 原文。
2. **直接文本那一遍（ISS-7 加的）跳过 computed `visibility` 不是 `visible` 的保留元素** —— innerText 对文字就是
   这么取舍的。实测成本：7,500 个带 ref 的元素多 2 ms。
3. **value 不再按树序夹在名字中间，统一接在所有名字后面。** 它仍参与比对，只是不再把两个在页面上相邻的名字隔开。

没选的：

- **只做第 1 条**：`visibility:hidden` 那一形还在（上表第 3、4 行）。
- **把一行拆成几段、每段在树里找得到就算覆盖**：ChatGPT 账单那种页面，缺失的行和在树里的兄弟行共享大部分文字
  （套餐名、Paid、$200.00），拼凑能把真缺口"覆盖"掉 —— 探测器就废了。
- **等基线 #6 第 2 项（walker 不再列 `visibility:hidden`）**：那是采集改动，还在等 Ral 定；而且比对本来就该和
  innerText 同口径，不该依赖采集碰巧一致。

去空白的代价：跨词边界也能命中（`"log out"` 会在 `"catalogo utensils"` 里找到）。能接受 —— 这道自检找的是
整行缺失，短行本来就松（`"Paid"` 在 `"Unpaid"` 里也算找到）。

保持不变（别顺手"优化"掉）：去重（按比对用的 key，所以只差大小写 / 空白的两行算一行）、
`line.length < 3` 下限（按折叠空白后的原行计）、500 行上限、
`aria-hidden` / `[hidden]` 反向守卫、`truncated` 早退、500KB 早退、`toLowerCase` 而非 `toLocaleLowerCase`。

**给基线 #6 第 2 项留一句**：它若把 `opacity:0` 的元素也从树里拿掉，innerText 仍然渲染那些字。自检得同步把
那些字算作"有意排除"，而且要按片段排除、不能按整行 —— 否则同一种粘行会换个形状回来（探针那一行的右半截
`Invisible button` 就是 `opacity:0` 的按钮）。

## Not covered（另一类：照报，而且报得对）

容器里既有子元素又有文字时，容器本身不进树，它自己的文字也就不在树里：`<div>Total due: <b>$200.00</b></div>`
树里只有 `$200.00`；`<a>Terms</a> · <a>Privacy</a>` 中间的 ` · ` 也一样。这是树真的少了字，不是比对口径的问题。

同族残留（仍会误报，少见，这次不修）：粘行中间夹的是 **innerText 不渲染、但在树里当名字**的文字。实测
`<span>Note:</span><textarea>hello</textarea><span>end</span>` 报 `"Note:end"` —— textarea 的内容成了它的名字，
也是它的直接文本。aria-label / title 这类属性名字夹在粘行中间是同一形状。要修得给表单控件单独开口子，
比这次的三处改动重得多，等真实会话里撞到再说。

## Verification

修复落地后补。

## Scope

配对改动，两处逐行同形：

- BL：`src/main/maestro/capture/debuggerCapture.ts`（`snapshotWalker` 末尾的自检），守卫 `scripts/maestro/check-snapshot-selects.mjs`
- Cowork：`apps/cowork/src/main/capture/snapshotWalker.inject.ts`，守卫 `apps/cowork/scripts/check-snapshot-selects.mjs`；
  对应 issue `projects/micromeet-cowork/docs/issues/page-snapshot-incomplete-false-positive-on-glued-inline-text.md`
- 可粘贴版 walker `areas/agent-runtime/browser-use/fixed-walker-console.js` 同步（`inline-fp.cjs` 跑的就是它）
