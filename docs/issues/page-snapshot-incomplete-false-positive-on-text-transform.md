# `# INCOMPLETE` 对 CSS `text-transform` 误报，把唯一的盲区警报变成噪声

Status: fixed in BL and Cowork; owner verification pending (2026-09-23)

Related: [page_snapshot 静默丢掉屏幕上可见的整棵子树](./page-snapshot-drops-visible-subtrees.md)（本自检就是那条 issue 的 ISS-4 / ISS-7），
台账 `areas/agent-runtime/browser-use/page-snapshot-closeout.md`

## Report

2026-09-23：`page_snapshot` 的 `# INCOMPLETE` 完整性自检在用了 CSS `text-transform` 的页面上必然误报。

## Confirmed cause

自检拿 `root.innerText` 逐行去比树里采到的文字。三者对 `text-transform` 的态度不一致：

| | 来源 | 应用 `text-transform` |
| --- | --- | --- |
| 自检的基准 | `root.innerText`（**渲染后**文字） | **是** |
| 采集路径 ① | `nameOf` → [`clean(el.textContent, 200)`](../../src/main/maestro/capture/debuggerCapture.ts) | 否 |
| 采集路径 ② | `directText` → `node.nodeValue` | 否 |

拿一个会变形的基准去比两个不变形的采集，凡是用 CSS 做大写/首字母大写的标签（导航、按钮、
徽标、表头——真实站点上极其普遍）都会被判成"页面上看得见但树里没有"。

**构造页复现**（把 `areas/agent-runtime/browser-use/fixed-walker-console.js` 里那份真实抽取的
walker 丢进 headless Chromium）：

```
① 只有 CSS 大小写     missingLines=3  ["DEMO CENTER","BOOKING","Demo Two"]
② 只有超深度真盲区     missingLines=1  ["REAL-DEEP-ROW"]
③ 两者同页            missingLines=2  ["DEMO CENTER","REAL-DEEP-ROW"]
```

**线上复现**（我们自己的公开 demo 站 `https://ai-crms-demo.micromeet.ai`，首屏）：

```
uppercase   源文="Demo Center"   渲染="DEMO CENTER"
uppercase   源文="Booking"       渲染="BOOKING"

missingLines=2  ["DEMO CENTER","BOOKING"]
```

两条都是假盲区：那两处文字树里都有，只是大小写被 CSS 改过。

## 为什么值得单独修

判据不是"误报讨厌"。这条自检**全部的价值**建立在"它响的时候值得看"上 —— ISS-4/ISS-7 立它时
写的原话就是「一个永远在响的警报等于没有警报」。它长期在响，agent 就学会跳过它，
ISS-1/2/3 修掉的那些真盲区也就再没有信号了。

## Fix

只动**比对**，不动采集：比对前两侧都折叠大小写。

```ts
captured = captured.replace(/\s+/g, ' ').toLowerCase()
const lines: { raw: string; key: string }[] = []
for (const raw of rendered.split('\n')) {
  const line = raw.replace(/\s+/g, ' ').trim()
  const key = line.toLowerCase()
  if (line.length < 3 || seen[key]) continue
  …
}
if (captured.indexOf(line.key) < 0) candidates.push(line)
…
if (missingSample.length < 5) missingSample.push(line.raw.slice(0, 60))
```

三个刻意的选择：

### 1. `toLowerCase()`，**不是** `toLocaleLowerCase()`

```
IPHONE   toLowerCase="iphone"   toLocaleLowerCase(tr)="ıphone"
iPhone   toLowerCase="iphone"   toLocaleLowerCase(tr)="iphone"
```

CSS `uppercase` 把 `iPhone` 渲染成 `IPHONE`。在 tr / az 宿主区域下，按区域折叠会得到
`ıphone` vs `iphone` —— **反而新造一条误报**。"两边同样处理所以安全"在这里不成立：
两侧输入本来就不同，一侧已经被 CSS 变过。归一必须是确定性的，不能跟宿主区域走。

### 2. 归一只用于比对，`missingSample` 回报**原文**

`# INCOMPLETE` 打印的样例是给 agent 拿去页面上找的字符串。若连样例一起小写，
它会打印 `"real-deep-row"` 这种页面上根本不存在的东西，等于把剩下那条真信号也废掉。
所以 `lines` / `candidates` 存 `{ raw, key }` 两份：比对用 `key`，打印用 `raw`。
（写这条修法时第一版就踩了这个坑，验证时才发现。）

### 3. 已知残留，不声称修干净

`toLowerCase` 覆盖 `uppercase` / `lowercase` / `capitalize`，**不覆盖**：

- `text-transform: full-width` / `full-size-kana`（日文，罕见）
- ß：`"straße"` 渲染成 `"STRASSE"`，再小写是 `"strasse"` ≠ `"straße"`

保持不变的部分（不要顺手"优化"掉）：去重、`length < 3` 下限、500 行上限、
`aria-hidden` / `[hidden]` 反向守卫、`truncated` 早退、500KB 页面早退。

## Verification

| 项 | BL | Cowork |
| --- | --- | --- |
| `check:snapshot-selects`（含新增 text-transform 场景） | ✅ | ✅ |
| 其余 maestro 守卫 | ✅ | ✅ |
| typecheck（改动文件） | ✅ | ✅ |
| 构造页三组（headless Chromium，跑真实抽取的 walker） | ✅ | 同源代码 |
| 线上 `ai-crms-demo.micromeet.ai` | ✅ 2 → 0 | 同源代码 |

守卫加了两条断言，分别钉住上面的 #1 和 #2：

- text-transform 的那一行**不能**出现在 `missingSample` 里；
- `missingSample` 的每个元素都必须能在 `innerText` 里**原样** `indexOf` 到 ——
  否则第 2 点的回归下次照样溜过去。

**没做的**：Electron 没跑、没打包（CLAUDE.md 明令不主动跑 E2E）。

## Scope

配对改动。BL 在 `src/main/maestro/capture/debuggerCapture.ts`（自检在 `snapshotWalker` 末尾），
Cowork 在 `apps/cowork/src/main/capture/snapshotWalker.inject.ts`，两处逐行同形。

## 顺带发现（另记，不在本 issue 范围）

做对照组时发现 **`innerText` 看不进 shadow root**：闭合 shadow root 里的文字既不在树里、
也不在 `innerText` 里，`missingLines` 完全没反应。也就是说**自检对 ISS-2 那一类盲区
从来就是瞎的**。这不是本次改动引入的，已补进 closeout 的残留清单。
