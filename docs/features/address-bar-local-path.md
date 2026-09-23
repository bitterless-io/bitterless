

2026-09-23 update: [Workspace 与 IndiPreview](indipreview-workspace-routing.md) supersedes the file-tab routing below. Existing local files use the common workspace-scope route; external files open in IndiPreview. Missing paths retain the Chromium error page. The following is historical context.
# 地址栏吃本机绝对路径 —— maestro 顶栏输入一条路径就预览它

Ral 2026-09-09 原话：

> bl cowork 的 new tab 需要支持 打开 `/Users/ral/Documents/projects/overmind/tmp/wecom-markdown-v2-doc.html`
> 这样的绝对路径进行渲染，先判断是不是 win/mac 的绝对路径然后判断文件是否存在，不存在需要展示不存在，
> 和网页共用不存在的组件最好

「bl」= 本仓的 maestro 顶栏；「cowork」那一半在
[`micromeet-cowork/docs/features/file-preview-tabs.md`](../../../micromeet-cowork/docs/features/file-preview-tabs.md)。

## 改之前会发生什么

`maestroBrowserView.service.navigate()` 把输入交给 `normalizeUrl()`，它对没有 scheme 的串一律补
`https://`。于是 `/Users/ral/…/x.html` 变成一发 `https:///Users/ral/…/x.html` 的请求 ——
落地是 Chromium 的「找不到服务器」页。**补完 scheme 之后就再也认不出它本来是一条路径了**，
所以判定必须排在 `normalizeUrl` 之前。

## 落法

```
输入 → isAbsoluteFilePath?
        ├─ 否 → 原路:normalizeUrl → loadURL
        └─ 是 → resolveLocalPathTarget
                 ├─ chrome  → loadURL(file://…)                     ← Chromium 自己渲染(pdf/图片/音视频/html)
                 ├─ preview → openOnlyPreviewAbsoluteTarget(path)   ← OnlyPreview 独立窗口
                 └─ missing → loadURL(file://…)                     ← Chromium 自己的「文件不存在」页
```

`chrome` 与 `missing` 落的是**同一发加载** —— 一个是 Chromium 渲染这个文件,一个是 Chromium 的
「文件不存在」页。两张落地页都不是我们画的,这也是它们能共用一条代码路径的原因。

`chrome` 那一支是 Ral 2026-09-09 加的:「这个文件不会进入 onlypreview 的预览,而是 new tab 打开一个
页面去单独预览」。判据 `rendersInPlainWebContents` **不是** adapter 表的 `surface === 'chrome'` ——
`image`/`audio`/`video` 在那张表里是 `vue`(要接进预览面的状态机),但在一个普通 tab 里 Chromium 的
内置查看器完全够用;反过来 `.md` 在表里是 `markdown-dom`,在普通 tab 里只会是一坨没渲染的源码。
所以它是**第二个判据**,与 adapter 表并列而不是从它推导。

### #1 判据两仓共用，落点各自不同

判据在 [`src/shared/onlypreview/onlyPreviewTargetInput.ts`](../../src/shared/onlypreview/onlyPreviewTargetInput.ts)
（`isAbsoluteFilePath`）。**这个位置是有意的**：`src/shared/onlypreview/` 是与 micromeet-cowork
逐字节等同的那一面，所以两个 app 的地址栏问的是同一个问题，而**差异可机检**。各写一份的话两份正则会
各自演化，且分歧不会以任何形式报错 —— 一边能打开的路径另一边被拿去搜索，只能靠人肉发现。

判据本身两条，都是全串锚定：

| 形状 | 正则 | 为什么这么写 |
| --- | --- | --- |
| POSIX | `^\/[^/]` | 排除 `//`（协议相对写法，既不是本机路径也不该补 scheme）与单独一个 `/`（根目录，作为地址栏输入更可能是手滑） |
| Windows | `^(?:[A-Za-z]:[\\/]\|\\\\[^\\])` | **盘符后面必须跟分隔符**。少了这一条，`c:8080`（单标签主机 ＋ 端口，内网 dev server 的常见写法）会被读成 C 盘 —— 一条真地址被判成一个不存在的文件 |

两个平台的形状**都认，不管当前跑在哪个平台**：判据是「输入长什么样」，不是「本机能不能解析」。
一条 Windows 路径贴进 mac 上的地址栏，正确结果是「这个文件不存在」，而不是把它拿去搜索引擎搜。

**落点分歧**：本仓落 OnlyPreview **独立窗口**（`openOnlyPreviewAbsoluteTarget` → `ensureStandalone`），
cowork 落 **mini-app tab**。这是刻意的：本仓的 OnlyPreview 本来就是一个一等窗口，在 tab 里再造一个
预览面等于同一件事有两个入口。同一条分歧在
`micromeet-cowork/src/main/miniapps/onlypreview/host/onlyPreviewOpenTarget.ts` 的开头也记了一遍。

### #2 「不存在」不新建组件 —— 用 Chromium 的那张页

Ral 说「和网页共用不存在的组件最好」。网页那条路上一次失败的加载，落地本来就是 Chromium 自己的错误页
（cowork 侧 `browser.controller.ts` 的 did-fail-load 注释把这条写成了
"Chromium's own error page is the right answer"）。所以路径不存在时落一发 `file://<path>`，
Chromium 给出 `ERR_FILE_NOT_FOUND`。

**不自建一个空状态组件**，理由两条：新建一个就等于同一件事有两种长相；而且它还得把 Chromium 已经做好的
本地化、路径显示与「重新加载」再实现一遍。

### #3 存在性判断在归一之后

`resolveLocalPathTarget` 先 `resolve()`（去掉 `..`、`.`、重复斜杠）再 `existsSync()`。顺序反了的代价是
`/Users/ral/sub/../x.html` 这种真文件被判成不存在。

一个前置判断守着一个静默缺陷：**输入不是绝对路径时直接返回**，因为 `resolve('')` 是当前工作目录，
而当前工作目录一定存在 —— 少了它，空输入会变成「预览 cwd」。返回的 `fileUrl` 是空串，调用方既有的
`if (!target) return` 会把它吞掉。

## 验证

- [`tests/onlypreview/onlyPreviewLocalPathAddress.test.mjs`](../../tests/onlypreview/onlyPreviewLocalPathAddress.test.mjs)
  —— 20 条：判据两侧的形状表（含带空格的路径、`c:8080`、`//example.com`）、**三个**落点分支、
  `rendersInPlainWebContents` 的两侧（pdf/图片/音视频/html 落 `chrome`；docx/xlsx/pptx/drawio/`.md`/
  代码/目录落 `preview`）、URL 编码、归一顺序、"不存在优先于格式判定"、cwd 那个静默缺陷，
  以及 maestro 侧的接线（含「判据没被复制一份」）。
- 判据的每一条边界都做过变异测试：把路径判定挪到空白规则之后、只认一个平台、放宽成 `^/`、
  盘符不要求分隔符、`isAbsoluteFilePath` 不兜 `null` —— 6/6 都被断言抓到。

## 不做

- **`file://` 开头的输入不改路。** 它是一个显式的地址，仍然由网页引擎打开。分类只回答「这是地址、
  路径，还是一句话」；「一个地址该由谁打开」是路由决定。
- **不支持 `~/` 开头。** 那不是绝对路径，Ral 也没要求。
- **不在本仓做搜索兜底。** cowork 的地址栏同时是 DuckDuckGo 搜索框，本仓没有那个需求，
  所以本仓只有「路径 / 地址」两类，没有第三类。
- **`preview` 那一支不在本仓改成 tab 内预览页。** cowork 那边 Ral 裁定要把
  `ChromePreview`/`VuePreview` 拷一份进 `renderer/filepreview/`（`file-preview-tabs.md` 的裁定 D）；
  本仓的 OnlyPreview 本来就是一等窗口，没有那个需求。
