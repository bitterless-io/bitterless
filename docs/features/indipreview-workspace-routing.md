# Workspace 与 IndiPreview

Ral 2026-09-23：完成 onlypreview 收尾，BL 与 Cowork 同步。状态：代码实现与针对性验证完成，待人工验收。

## 行为约定

1. Workspace 首次打开自动加载默认 `work`；已有有效的主动选择则恢复该目录。沿用现有默认目录创建、迁移和 `isDefault` 语义。
2. Main 提供统一的有效 workspace 与文件归属判断。有效目录为当前选择／有效的上次选择，无选择时为默认 `work`。使用真实路径和路径边界，不能用字符串前缀；索引是否完成不参与内外判断。
3. workspace 内文件在 Workspace 中预览；外部文件在独立的 IndiPreview 窗口和独立渲染进程中预览。IndiPreview 不占浏览器 Tab，不改变 Workspace 目录、选中、索引或最近文件记录。
4. IndiPreview 是当前 Electron 应用内的独立预览窗口，复用相同 Vue Preview 与 Chromium Preview 实现。先明确可复用内容层，再接窗口宿主；不复制 Markdown、Office、HTML/PDF、查找或安全协议实现。Vue/Chromium 会话与 Workspace 渲染隔离，文件权限仍限定到各 host 的单文件。并发 IndiPreview 窗口各自租用 Chromium session 槽位；完成异步挂载收尾与数据清理后才归还，后续窗口复用槽位，持久分区数量随并发峰值而非累计打开次数增长。
5. OS、地址栏、Chat/Agent、MCP、历史文件入口和 Markdown 链接都遵守同一归属路由。目录仍按原规则选择 workspace；远程网页保持浏览器行为。
6. 弃用外部文件专用 Tab 入口及其宿主实现；普通网页 Tab、自定义别名、Workspace 的 Tab／独立窗口切换继续保留。IndiPreview 关闭只释放自己的视图、权限、Find 路由，不关闭 Workspace。
7. 原有行号／锚点跳转、文件名路径、文件内查找、在系统应用打开及定位文件保留。打开失败明确返回错误，并清理部分创建的窗口与视图。

```text
open(local target) → Main workspace scope
  directory      → Workspace (bind directory)
  file inside    → Workspace → shared Vue / Chromium Preview
  file outside   → IndiPreview window → shared Vue / Chromium Preview
```

## 冷启动文件预览修复（2026-09-23）

### 根因与取舍

Cowork 内置 `preview_file ~/Downloads/Invoice-0CSZ9QB2-0006.pdf` 在未打开 Workspace 时失败，原因是工具路由先调用 `inspectTarget`，而 Project authority 所在的隐藏读取进程原来只由 Workspace 启动。此时尚未进入 PDF 渲染，便返回 `Project authority runtime unavailable`。路径展开与 workspace 外文件权限不是这次失败的原因。

IndiPreview 已复用 `OnlyPreviewPreviewRegionService`、Vue Preview factory 和 Chromium Preview；缺的是读取进程独立于 Workspace 的生命周期。因此保留共用渲染层，补齐共享运行时，不复制另一套 `onlypreview__previewRegion` 页面。

### 本次改动

1. 工具、MCP／OS 和直接文件入口在检查目标前取得短期运行时租约，等 authority、Office 和 Preview reader 就绪后再判断归属；结束或失败均释放。
2. IndiPreview 自身持有长期租约，独立窗口关闭时释放。冷启动期间关闭窗口会归还晚到的租约，不再创建内容视图。
3. Workspace 附着到已就绪的运行时，关闭时仅释放自己的使用权。仍有 IndiPreview 时保持读取能力；最后一个使用者退出后才销毁。并发启动复用一个隐藏进程和一个启动 Promise。
4. 无 Workspace 的外部文件预览不绑定项目、不触发目录索引，也不创建 Workspace 窗口／Tab。启动失败会清理并允许后续调用重试。

### 验证与人工验收

- 本次 BL 路由／生命周期／运行时测试 74/74；Cowork 路由等相关测试 141/141，加独立运行时测试 13/13，均通过。
- Cowork Main 类型检查通过；BL Main 检查仍有 64 项既有诊断，相比之前 70 项基线无新增。没有将其他并行修改减少的诊断归功于本修复。
- Cowork 额外执行的 RestorePresentation 有一项既有源码形状断言失败：测试要求先 present 后 restore，HEAD 实际早已先 restore 后 present；未修改该无关断言。
- 未启动 Electron／E2E，未打包安装或发布。上述是代码级验证，不能代替已安装应用的实际显示验收。

重启包含本次 Main 改动的 Cowork／BL 构建后验收（仅 HMR 不够）：

1. 不先打开 Workspace，在 Cowork Chat 调用 `preview_file ~/Downloads/Invoice-0CSZ9QB2-0006.pdf`，应直接进入独立 IndiPreview；BL 同测外部文件入口。
2. 同一入口打开 workspace 内文件，应在 Workspace 预览；外部文件不增加浏览器 Tab。
3. 保持外部 PDF／Markdown 窗口打开，关闭再打开 Workspace，验证独立窗口的内容读取、刷新及 Cmd+F 仍正常。
4. 同时打开两个独立窗口，关闭其中一个，另一个应继续正常工作。

## 初次实现的验证与交付

2026-09-23 代码级交付完成；尚未打包安装、发布或人工验收。

- BL 与 Cowork 的路由、共享预览层、独立窗口与会话生命周期相关测试各 148/148 通过；Cowork 另有前台快照 5/5 通过。
- 默认 workspace／恢复／清除／目录基线：BL 48/48、Cowork 29/29 通过（与上述聚合有重叠，不累加）。
- 两端预览前端类型检查、完整 electron-vite build 通过；Cowork 主进程类型检查、check:miniapp、preview-tool 检查通过；修改范围 diff 检查通过。
- BL 全量 Main 类型检查仍有 70 处诊断；新增 IndiPreview、workspace scope、Vue factory 文件无诊断。本次没有扩展到无关模块修复。
- 非通过项如实保留：BL 宽泛 AppWiring 的 5 项旧源码形状断言、ExternalFilePreview 的 1 项断言仍要求快照不含外部路径，但 HEAD 已通过 fileDisplayPath 提供路径，此断言未通过；AgentSkill 中 renderer inventory 断言为 16、实际为 17，HEAD 也已不匹配。Cowork foreground 快照最后一项的旧 fixture 缺少 manualCompactions，未计入上述 5 项通过结果。
- 保留当前工作树其他任务修改；未启动 Electron/E2E，未提交或切换 Git 分支。

人工验收需重启包含本次 Main 改动的 BL / Cowork 构建，HMR 不足以验证：

1. 未主动选择 workspace 时打开 Workspace，应显示默认 work；有有效选择时恢复该目录。清除或重新选择后，后续文件归属应按新目录判断。
2. 从 OS、地址栏、Chat/Agent 打开内部 MD、Office、HTML、PDF，应在 Workspace 预览；同入口打开外部文件应进入独立 IndiPreview，浏览器 Tab 数量不增加。BL 的 MCP preview.open 同测。
3. 同时保持两个外部 HTML/PDF 预览窗口，检查内容与资源仍可加载、Cmd+F 只作用于活跃预览；关闭其中一个后，另一个与 Workspace 仍正常。
4. Markdown 链接分别从内部指向外部、从外部指向内部，检查窗口路由及行号／锚点。外部预览不改变 Workspace 的目录、选中、最近记录与索引。
