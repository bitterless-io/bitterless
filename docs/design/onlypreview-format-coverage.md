# OnlyPreview 预览格式覆盖

本文决定 OnlyPreview「渲染一切」的格式边界：哪些格式由谁渲染、保真上限在哪、哪些明确不渲染但要给
真话状态。核对日期 2026-08-18，依据实码：`src/main/onlypreview/onlyPreviewClassifier.service.ts`、
`src/main/onlypreview/onlyPreviewProtocol.service.ts`、
`src/renderer/onlypreview/preview/src/components/`、`package.json`。

来源：Ral 2026-08-18「Monaco 不够啊，我要渲染一切：excel pdf doc 等 图片，音视频就是播放器可播放」。
姊妹文档：[`onlypreview-preview-merge-find.md`](onlypreview-preview-merge-find.md)（视图边界与查找归属，
本文所有新组件都挂在那份文档定的单个 Preview 视图内）、
[`features/onlypreview.md`](../features/onlypreview.md)（当前分类与渲染合同）。

## #0 · 总纲：真话优先于覆盖面

| 目标 | 判据 | 现状 |
|---|---|---|
| G1 表格 | `.xlsx` 打开即见网格、sheet 页签、合并单元格与数字格式 | ❌ 今天落 `unsupported` → [#2](#2--xlsx-已定-2026-08-18) |
| G2 文档 | `.docx` 打开即见接近 Word 的分页版式，而不是纯文本 | ❌ 今天落 `unsupported` → [#3](#3--docx-已定-2026-08-18) |
| G3 图片 / 音视频 | 能解码的直接看/直接播；不能解码的显示明确原因 | ⚠ 能播的已能播，不能解码时是空白/破图 → [#5](#5--图片与音视频-已定-2026-08-18) |
| G4 不吹保真 | 每种格式写明保真上限与不做项，界面不假装渲染成功 | ❌ 今天只有一个笼统 `unsupported` 态 → [#6](#6--保真上限与真话状态-已定-2026-08-18) |

覆盖面不是唯一目标。**能渲染的高保真渲染，不能渲染的说清楚为什么并给出外部打开**，比半坏的渲染更有用。

## #1 · 读取通道不变 `已定 2026-08-18`

新增格式**不新增任何读取通道**：沿用 `onlypreview://` 特权 scheme（`standard`/`secure`/
`supportFetchAPI`/`stream`/`corsEnabled` 已就绪）+ Preview 渲染进程内 `fetch(assetUrl)` →
`ArrayBuffer`，这正是 `PdfPreview.vue` 今天的做法。

| 层 | 改动 |
|---|---|
| Main classifier | 新增扩展名集合与 MIME，新增 `kind`：`sheet`、`document`（`slides` 视 PQ-B） |
| Main 资产注册 | 无改动（已按 token + 相对路径出流） |
| 能力/权限边界 | 无改动：渲染进程仍拿不到绝对路径、Node、文件写入 |
| Preview 渲染进程 | 新增按 `kind` 挂载的格式组件，与现有 generation/dispose/cancel 围栏一致 |

## #2 · `.xlsx` `已定 2026-08-18`

| 项 | 决定 |
|---|---|
| 引擎 | **`exceljs`**（仓库已有 `^4.4.0`，Main 侧 Maestro 已在用，浏览器构建可直接读 `ArrayBuffer`） |
| 渲染 | 自研只读网格：sheet 页签、列宽/行高、合并单元格、对齐、数字格式（日期/百分比/货币）、基础字体与填充色 |
| 公式 | 显示 exceljs 读到的缓存结果值；**不重算** |
| 大表 | 视口虚拟化 + 行数/单元格上限（超限显示"仅渲染前 N 行"的真话提示，不静默截断） |
| 不做 | 图表、透视表、条件格式、批注、数据验证、宏、迷你图、图片浮动对象 |
| 选区字符数 | 网格选区不接入底部字符数（它统计的是文本选区语义） |

`.csv` 继续走 Monaco 文本预览，不进网格 —— 它是文本文件，Monaco 的行列定位与查找对它更有用。

## #3 · `.docx` `已定 2026-08-18`

| 项 | 决定 |
|---|---|
| 引擎 | **`docx-preview`**（新依赖）。仓库里的 `mammoth` 只产语义 HTML、丢分页与版式，达不到「渲染」要求；`docx` 包是生成端，不是渲染端 |
| 渲染 | 分页版式、段落/表格/列表样式、内嵌图片（转 `blob:`）、页眉页脚 |
| 安全 | 渲染结果在插入前清一遍：禁 `script`/`iframe`/`object`/`embed`/外链样式与远程资源。CSP 与「不出网」约束不变；宏与 OLE 对象永不执行 |
| 不做 | 修订痕迹与批注渲染、域代码重算、字体嵌入替换（缺字回退系统字体）、精确分页与 Word 的像素级一致 |
| 查找 | DOM adapter 直接复用（渲染结果是 DOM），归 019 |

## #4 · 旧二进制格式与幻灯片 `待定`

`.doc` / `.xls` / `.ppt`（Office 97–2003 二进制）与 `.pptx` 的处置见
[#pending-questions](#pending-questions--待定项) PQ-A / PQ-B。倾向：二进制旧格式**不渲染**，给明确
不支持态 + 现有「用系统默认应用打开」；`.pptx` 先不做或只做低保真大纲。

## #5 · 图片与音视频 `已定 2026-08-18`

| 类别 | 现状 | 本轮决定 |
|---|---|---|
| 图片 | `<img>` 覆盖 png/jpg/gif/webp/avif/bmp/ico/svg | 保持原生解码；**新增解码失败的真话状态**（文件名、扩展名、大小 + 外部打开），不再是破图图标 |
| HEIC / HEIF / TIFF / RAW | 未列入，落 `unsupported` | 保持不渲染；是否加 Main 侧转码见 PQ-C |
| 音频 | `<audio>` 覆盖 mp3/wav/ogg/m4a/aac/flac | 保持原生播放器 + `MediaError` 真话状态 |
| 视频 | `<video>` 覆盖 mp4/webm/ogv/mov/m4v | 同上。`.mkv`/`.avi`/`.wmv`/`.flv` 与 ProRes 等平台不解码的容器/编码**不加进可预览集合**，落明确不支持态 |

判据：`Ral「音视频就是播放器可播放」` —— 能播的直接播，不能播的说明白，不做转码墙。

## #6 · 保真上限与真话状态 `已定 2026-08-18`

每个格式组件必须区分三种终态，界面语义不同：

```text
渲染成功        → 内容体
可识别但超限     → "只渲染了前 N 行 / 该文档 M 页超过上限"，附外部打开
不支持 / 解码失败 → 类型 + 大小 + 修改时间 + 外部打开（现有 unsupported 态复用）
```

不允许出现：空白内容体、破图占位、静默截断、把解析异常显示成"空文件"。

## #7 · 引擎装载与包体 `已定 2026-08-18`

Preview 渲染进程今天**静态**引入 `monaco-editor` 与 `unpdf/pdfjs`；再叠加 exceljs 与 docx-preview 会
让首帧体积继续膨胀，而任一次预览只用得上其中一个引擎。

决定：**为 Preview 的格式引擎开一个记录在案的动态 `import()` 例外**，仅限
`src/renderer/onlypreview/preview/src/components/` 下的格式引擎模块（Monaco、pdf.js、exceljs、
docx-preview）。这与 bitterless「静态顶层 import，函数内禁止动态 import」的通用规则冲突，因此在此
显式留档：Vite 只能通过动态 import 做 code-split，没有例外就只能全量 eager 装载。规则的其余部分
（业务代码、store、service）不变。

## #8 · 扩展名路由与装载前闸门 `已定 2026-08-18`

来源：Ral 2026-08-18「注意要能依据不同的文件后缀进行渲染，而且防止出现视频文件改成 txt 结尾也去渲染
导致的性能问题」。

### 现状：闸门链已存在，继续沿用

| 步 | 机制 | 实码 | 对"视频改名 `.txt`"的效果 |
|---|---|---|---|
| 1 | 扩展名路由 | `classifyOnlyPreviewExtension()`：TEXT/PDF/IMAGE/AUDIO/VIDEO 扩展名集合 | `.txt` → `text` |
| 2 | 8KiB 采样嗅探 | `isProbablyOnlyPreviewText()`：遇 `0x00` 直接否；控制字符占比 >10% 否 | mp4 头部含 NUL → 翻成 `unsupported`，**全文永不读取** |
| 3 | 魔数签名 | `matchesSignature()`：pdf/png/jpg/gif/webp/avif/bmp/ico/svg/mp3/wav/ogg/flac/aac/mp4/mov/m4v/webm | 后缀与内容不符 → `previewError: SIGNATURE_MISMATCH`，**不签发 `assetUrl`**，播放器与 pdf.js 都拿不到字节 |
| 4 | 大小上限 | `ONLY_PREVIEW_MAX_TEXT_BYTES` 8MiB、Markdown/HTML 各 1MiB | 500MiB 日志改名 `.txt` → `TEXT_TOO_LARGE`，不进渲染 |

结论：**文本路径今天已经安全**——`describe()` 只读 8KiB 就能否掉伪装文本，`readText()` 还有 8MiB 硬顶。
真正的新缺口在本文新增的格式与既有 PDF 上，见下。

### 本轮必须补齐的闸门

| id | 闸门 | 归属任务 | 理由 |
|---|---|---|---|
| **G1** | OOXML zip 魔数：`.xlsx`/`.xlsm`/`.docx` 必须以 `50 4B 03 04`（`PK\x03\x04`）开头，否则 `SIGNATURE_MISMATCH` 且不签发 `assetUrl` | [020](../plan/tasks/onlypreview-xlsx-grid-020.md)、[021](../plan/tasks/onlypreview-docx-render-021.md) | 伪装文件不得进入 exceljs / docx-preview |
| **G2** | 装载前大小硬顶：新增 `ONLY_PREVIEW_MAX_SHEET_BYTES` 与 `ONLY_PREVIEW_MAX_DOCUMENT_BYTES`（各 25MiB）；超限 → "超过预览上限"真话态 + 外部打开，**不解析** | 020、021 | exceljs 与 docx-preview 都把整包读进内存再展开，没有硬顶等于把渲染进程交给文件大小 |
| **G3** | 顺序不可颠倒：**扩展名 → 签名/大小闸门 → 才动态 `import()` 引擎**。伪装或超限文件不得触发引擎装载 | 020、021 | 否则一个改名文件就白拉一个 MiB 级 chunk 并进入解析 |
| **G4** | 解压炸弹上限：zip 内部累计展开字节 ≤ 200MiB 且条目数 ≤ 5,000，超限中止并落真话态 | 020、021 | 25MiB 的 OOXML 展开后可达 GB 级 |
| **G5** | 渲染侧纵深校验：`fetch` 得到 `ArrayBuffer` 后先核前 4 字节与长度，再交引擎。主进程闸门是权威，这一层是防御深度 | 020、021、[023](../plan/tasks/onlypreview-preview-guards-023.md) | 单点闸门失效时不至于直接打死渲染进程 |
| **G6** | `SIGNATURE_MISMATCH` 的界面文案明确说"后缀与内容不符"，而不是笼统失败 | 023 | 用户需要知道是改名而不是文件坏了 |
| **G7** | PDF 页数/字节上限 + 按需分页渲染 | 023 | **既有缺口**：`PdfPreview.vue` 今天 `for pageNumber = 1..numPages` 顺序渲染全部页，且没有页数或大小上限；一个几百 MiB / 上千页的合法 PDF 就能拖死 Preview |

G7 是这次顺带查出来的既有性能缺口，与改名无关，但属于同一类"输入规模没有上限"的问题，因此并进
[023](../plan/tasks/onlypreview-preview-guards-023.md) 一起收口。

## #pending-questions · 待定项

| id | 项 | 所在 | 类型 | 阻塞性 | 倾向 / 拍板需要什么输入 | 状态 |
|---|---|---|---|---|---|---|
| **PQ-A** | `.doc` / `.xls` / `.ppt`（97–2003 二进制）要不要渲染？ | [#4](#4--旧二进制格式与幻灯片-待定) | 待拍板 | 阻塞 021 的范围，不阻塞 020 | **倾向不渲染**：浏览器内没有可靠解析栈；引 SheetJS 只能解决 `.xls`，`.doc`/`.ppt` 仍然无解。给明确不支持态 + 系统应用打开。若必须要，需要额外一轮（Main 侧调用系统转换，成本与可靠性都要单独评估） | 待定 |
| **PQ-B** | `.pptx` 期望保真度？ | [#4](#4--旧二进制格式与幻灯片-待定) | 待拍板 | 不阻塞 020/021 | **倾向先不做**，或只做"按幻灯片分块的文本+图片大纲"低保真；浏览器端没有成熟的 pptx 渲染库（`pptxgenjs` 是生成端） | 待定 |
| **PQ-C** | HEIC / HEIF / TIFF 是否需要 Main 侧转码后预览？ | [#5](#5--图片与音视频-已定-2026-08-18) | 待拍板 | 不阻塞 022 | **倾向本轮不做**，先给真话不支持态；HEIC 在 macOS 相册/iPhone 照片里常见，若要做则单列一轮（Main 侧 `sips`/`sharp` 转码 + 缓存 + 失效策略） | 待定 |

收敛记账：账本 3 行 · 已解 0 行 · 待拍板 3 行 · 未解的 `阻塞定案` **0 条**（三条都不阻塞 `.xlsx` 与
`.docx` 交付）。

---

交付任务：
[onlypreview-preview-guards-023](../plan/tasks/onlypreview-preview-guards-023.md)（闸门与 PDF 上限，先行）、
[onlypreview-xlsx-grid-020](../plan/tasks/onlypreview-xlsx-grid-020.md)、
[onlypreview-docx-render-021](../plan/tasks/onlypreview-docx-render-021.md)、
[onlypreview-media-truthful-state-022](../plan/tasks/onlypreview-media-truthful-state-022.md)。
三者都依赖 [018 视图合并](../plan/tasks/onlypreview-preview-header-merge-018.md)；建议在
[019 查找](../plan/tasks/onlypreview-find-in-file-019.md) **之前**交付，这样查找 adapter 一次覆盖
全部内容类型，不必为新格式返工一遍。
