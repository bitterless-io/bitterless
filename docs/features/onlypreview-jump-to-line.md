# OnlyPreview 跳到指定行,聊天里的 `file:line` 双击可达

Status: 设计已定;分层实施中。

## 要解决什么

Ral 2026-09-21:回答里大量出现
`/Users/ral/Documents/projects/overmind/projects/micromeet-cowork/apps/cli/src/http.ts:340`
这样的「文件:行号」。它现在是一串**纯文本** —— 想看那一行,人得手动复制路径、打开预览、再自己滚到 340 行。

`quick_scan` / `code_review` 每条发现都带 `file:line`,一次 14 条,这个动作要重复十几遍。

## 要做成什么

1. 聊天里的 `路径:行号` 渲染成**可点的引用**,**双击**在 OnlyPreview 里打开并**滚到那一行**。
2. OnlyPreview 的内置技能具备「导航到指定行号」的能力,模型可以主动用。
3. **行号无法导航时直接忽略,绝不报错、绝不阻塞打开。**

第 3 条是硬约束,不是补充说明:一个 PDF、一张图、一个 docx 没有「第 340 行」这回事。
**打开文件本身永远要成功** —— 行号是锦上添花,不能变成打不开的理由。

## 现状(已核实)

| | |
| --- | --- |
| 代码类预览 | **Monaco**(`preview/src/components/MonacoTextPreview/MonacoTextPreview.vue` 持有 `IStandaloneCodeEditor`) |
| 行号导航能力 | Monaco 原生就有:`revealLineInCenter(line)` + `setPosition({ lineNumber, column: 1 })` |
| 打开链路 | `openOnlyPreviewAbsoluteTarget(target, options)`,**已经带 options 对象**(现有 `preserveTreeSelection`) |
| 工具 | `preview_file { path }` → `host.toolPreviewFile(sessionKey, path)` |
| 内置技能 | `PREVIEW_BUILTIN_SKILL`(`coworkAgent.service.ts`),带版本号 `ONLY_PREVIEW_AGENT_SKILL_VERSION_CODE` |
| 非代码预览 | 图片 / PDF / docx / drawio / 媒体各有自己的 service,**都没有行的概念** |

所以最难的那层反而是现成的 —— Monaco 自带。工作量在**把行号从调用方一路送到编辑器**,以及**在没有行的地方安静地丢掉它**。

## 设计

### 分层

**A · 行号送达并生效(核心)**

- `openOnlyPreviewAbsoluteTarget(target, { line })` —— 挂在已有的 options 上,不新开参数通道。
- 行号随「选中这个文件」一起送到预览侧;Monaco 就绪后 `revealLineInCenter` + `setPosition`,并做一次**短暂的行高亮**(看得见落点,不留下持久装饰)。
- **非 Monaco 预览:收到就丢掉。**不记 warning、不弹提示 —— 那是正常情况,不是异常。

**行号规范化**放在**入口一处**,不散到各层:非正整数、NaN、超出文件行数 → 当作没给。
超出行数尤其要当没给而不是钳到末行:跳到一个「最后一行」会让人以为那就是目标。

**B · 工具与技能**

- `preview_file { path, line? }`,`line` 可选。
- 技能描述里写清两件事:能带行号;**带了也不保证跳**(取决于文件类型),不保证不是失败。
- 技能有版本号,改了要 bump `ONLY_PREVIEW_AGENT_SKILL_VERSION_CODE`。

**C · 聊天里的引用**

- 在助手消息里识别 `绝对路径:行号`(以及不带行号的绝对路径),渲染成引用样式。
- **双击**触发打开(Ral 指定)。单击不触发 —— 聊天里选中文本、复制路径是常见操作,单击会把它抢走。
- 路径识别要保守:只认**绝对路径**且带已知源码/文本扩展名的,避免把普通句子里的冒号数字当成行号。

### 为什么是双击

Ral 明确要求。同时它解决了一个真问题:这些路径出现在正文里,人经常要**选中它复制**。
单击打开会让复制变得困难,双击则和「双击选词」冲突最小 —— 在这里双击的语义被我们接管为「打开」。

### 不做什么

- **不做「跳到列」**。发现里只有行号,列号会引入一个永远对不齐的精度。
- **不改非代码预览**去支持行。PDF 的「第 340 行」没有意义,强行映射只会造出一个骗人的落点。
- **不在打开失败时回退成「至少打开文件」以外的行为**。行号无效就是没有行号,不降级成搜索、不猜。

## BL 侧的两点差异(与 Cowork 不同,不是遗漏)

1. **没有 B 层。** BL 没有 `preview_file` 这个工具 —— `src/main/agent/agentPrompt.ts` 里原话:
   「在 bl 侧就没有着力点(cowork 侧对应的是 `preview_file`)」。这是本规则生效前就存在的历史差异,
   按配对开发规则不回填。所以 BL 只做 A 层(行号送达)+ C 层(聊天双击)。
2. **C 层用的是 maestro 自己的一份引用识别**(`src/shared/maestro/fileReference.service.ts`)。
   `check:maestro` 的别名边界禁止 maestro 树 import `@shared/onlypreview/*`,而那条边界正是为了
   不把整棵 onlypreview 子树拖进 maestro 的打包。**纯函数复制不带来任何宿主实现**,而「打开」这一步
   仍然走已有的 `MaestroPreviewOpener` 端口 —— maestro 至今不知道宿主的预览应用是谁。
   两份各有测试钉着(`tests/onlypreview/onlyPreviewLine.test.mjs`、`maestroFileReference.test.mjs`)。

另外 BL 聊天里**单击**产出物链接是「在 Finder 里定位」,和双击「在预览里看内容」是两个不同的动作,
所以是两个手势,不是同一件事的两种触发。

## 验证

- 行号规范化:0 / 负数 / NaN / 超出文件行数 → 与不传等价(单测)。
- 非 Monaco 预览拿到 line:不抛、不打日志、正常打开(单测)。
- 聊天引用:识别 `abs:line`、`abs`、不误伤普通文本里的 `词:数字`(单测)。
- Monaco 真的滚到目标行:需要跑起应用手验 —— 自动化要起 Electron,按本仓规矩不主动跑。
