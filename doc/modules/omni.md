# Omni Browser

在独立窗口中同时浏览多个网页，支持自由分屏布局，布局和窗口位置自动持久化。

## 功能

- 多窗格分屏（水平/垂直，任意嵌套），可拖动调整比例
- 每个窗格独立导航（URL 输入、前进/后退/刷新）
- 点击 Layout 按钮展开控制叠加层，可对窗格进行分裂/关闭/URL 编辑
- 布局和窗口位置在关闭后自动恢复

## 技术实现

### 视图结构

基于 `BaseWindow` + `WebContentsView`，所有 view 挂载在同一窗口上：

```
┌──────────────────────────────┐
│  menubarView (32px)          │  omniWindow 渲染器（标题栏 + 控制按钮）
├──────────────┬───────────────┤
│ cell.menubar │ cell.menubar  │  omniCell 渲染器 × N（导航栏）
│ cell.browser │ cell.browser  │  网页内容（按站点选择持久化 session）
└──────────────┴───────────────┘
  [controlView 叠加层，toggle 显示]  omniControl 渲染器（splitpanes 分屏控制）
```

### 核心文件

| 文件 | 职责 |
|---|---|
| `main/windows/omniWindow.helper.ts` | 窗口和视图生命周期管理 |
| `main/xpc/omniWindow.handler.ts` | XPC 接口暴露 |
| `renderer/omni/omniControl/` | 布局控制 UI（splitpanes + layout store） |
| `renderer/omni/omniCell/` | 单窗格导航栏 |

### 数据模型

布局以递归树 `OmniPaneNode` 存储，leaf 节点对应一个网页窗格，split 节点定义分屏方向和比例。持久化到 SettingDao（key: `omni_layout`，窗口位置: `window_layout/omni`）。

### 关键设计

- **controlView 单例**：`create()` 时创建，窗口关闭仅 detach 不销毁，再次打开直接复用
- **并发保护**：`_creating` 锁防止 `ipcMain.handle` 并发调用导致 `create()` 重入
- **XPC 事件方向**：main 通过 `xpcMain.broadcast` 推送 URL 变更；renderer 通过 `xpcRenderer.send` 发起导航和布局保存
- **无反馈循环**：`onResize` 只更新内存 sizes，仅 `onResizeEnd`（拖动结束）触发一次 XPC 同步；URL 变更由 `lastUrl` 去重拦截重复广播
- **浏览器身份分流**：普通站点保持原生 Electron + `persist:omni`；Google/YouTube 在首个请求前切到 `persist:omni-google`，UA 只删除 `Electron/<version>` 并保留真实 `Bitterless/<version>` 应用标识
