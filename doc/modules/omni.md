# Omni Browser

Omni 是一个多窗格浏览器模块，允许用户在一个独立窗口中同时打开和管理多个网页。支持分屏布局、URL 导航、前进/后退、刷新等浏览器基本功能，并持久化保存布局和窗口位置。

## 架构

Omni 基于 Electron 的 `BaseWindow` + `WebContentsView` 构建，不使用 `BrowserWindow`。所有 view 作为 child view 挂载在同一个 `BaseWindow` 上。

### 进程与视图

| 视图 | 渲染器 | 说明 |
|---|---|---|
| **menubarView** | `omniWindow` | 顶部 32px 菜单栏，包含标题、layout 按钮、窗口控制 |
| **controlView** | `omniControl` | 布局控制叠加层（透明背景），含分屏操作和 URL 编辑。懒加载，首次 toggle 时创建 |
| **cell.menubar** | `omniCell` | 每个窗格的 36px 导航栏（URL、前进/后退/刷新） |
| **cell.browser** | 无 preload | 实际的网页内容视图，使用 `persist:omni` 共享会话 |

```
┌─────────────────────────────────┐
│         menubarView (32px)      │  ← omniWindow 渲染器
├────────────────┬────────────────┤
│  cell.menubar  │  cell.menubar  │  ← omniCell 渲染器 × N
│  cell.browser  │  cell.browser  │  ← 原生网页 (sandbox)
│                │                │
└────────────────┴────────────────┘
        ↑ controlView (覆盖层)     ← omniControl 渲染器（toggle 显示）
```

### 文件结构

```
src/
├── main/
│   ├── windows/omniWindow.helper.ts    # 核心：窗口和视图管理
│   └── xpc/omniWindow.handler.ts       # XPC handler，暴露操作接口
├── preload/
│   └── omni/omni.preload.ts            # 暴露 cellId、initialUrl
├── shared/
│   └── omni/omni.types.ts              # OmniPaneNode、OmniCellLayout、OmniLayoutConfig
└── renderer/omni/
    ├── omniWindow/                     # 顶部菜单栏
    ├── omniControl/                    # 布局控制叠加层
    │   ├── components/
    │   │   ├── OmniPane.vue            # 递归分屏组件（splitpanes）
    │   │   └── OmniPaneMenuBar.vue     # 窗格菜单栏（分裂/URL/关闭）
    │   └── store/layout.store.ts       # 布局状态管理
    └── omniCell/                       # 单个窗格导航栏
```

## 数据模型

### OmniPaneNode (布局树)

递归树结构，描述分屏布局：

```ts
interface OmniPaneNode {
  id: string;
  type: 'leaf' | 'split';
  url?: string;              // leaf 节点的网址
  direction?: 'h' | 'v';    // split 节点的分屏方向
  children?: OmniPaneNode[]; // split 节点的子节点
  sizes?: number[];          // 子节点比例 (百分比，总和 100)
}
```

示例（左右两栏，左栏又上下分屏）：

```json
{
  "type": "split", "direction": "h", "sizes": [50, 50],
  "children": [
    {
      "type": "split", "direction": "v", "sizes": [60, 40],
      "children": [
        { "type": "leaf", "url": "https://github.com" },
        { "type": "leaf", "url": "https://bing.com" }
      ]
    },
    { "type": "leaf", "url": "https://google.com" }
  ]
}
```

### 持久化

| SettingDao key | sub_key | 内容 |
|---|---|---|
| `omni_layout` | — | `OmniLayoutConfig`（布局树） |
| `window_layout` | `omni` | `WindowLayout`（窗口位置和大小） |

## 生命周期

### 打开

1. `OmniWindowHandler.openOmniWindow()` → `omniWindowHelper.create()`
2. `create()` 先调 `cleanupAllViews()` 清理旧资源
3. 从 SettingDao 加载窗口位置，创建 `BaseWindow`
4. 创建 `menubarView`（omniWindow 渲染器）
5. 注册 `closed` 事件 → `cleanupAllViews()`
6. `restoreSavedLayout()`：从 SettingDao 加载布局树，提取叶子节点，调 `updateLayout()` 创建所有 cell

### 关闭

1. `baseWindow.close()` 触发 `closed` 事件
2. `cleanupAllViews()`：遍历所有 cell 和 view，显式 `webContents.close()`，重置所有状态

### 应用退出

`app.main.ts` 的 `cleanupResources()` 调用 `omniWindowHelper.destroy()`。

## XPC 通信

### Handler (main → renderer 调用)

通过 `OmniWindowHandler` (XpcMainHandler) 暴露：

| 方法 | 参数 | 说明 |
|---|---|---|
| `openOmniWindow` | — | 打开/聚焦 omni 窗口 |
| `toggleOmniControl` | — | 切换布局控制叠加层 |
| `updateLayout` | `{ cells, tree }` | 更新布局（增删 cell） |
| `navigateCell` | `{ cellId, url }` | 导航指定 cell |
| `cellGoBack` | `{ cellId }` | 后退 |
| `cellGoForward` | `{ cellId }` | 前进 |
| `cellRefresh` | `{ cellId }` | 刷新 |
| `closeCell` | `{ cellId }` | 关闭指定 cell |
| `saveLayout` | `{ config }` | 保存布局到 SettingDao |
| `loadLayout` | — | 从 SettingDao 读取布局 |
| `minimize` | — | 最小化窗口 |
| `toggleMaximize` | — | 切换最大化 |
| `close` | — | 关闭窗口 |
| `isMaximized` | — | 查询是否最大化 |

### Broadcast (main → renderer 广播)

| 事件 | 数据 | 说明 |
|---|---|---|
| `omniCell/urlChanged` | `{ cellId, url }` | cell 导航后通知 cell menubar 更新 URL |
| `omniCell/activeChanged` | `{ activeCellId }` | 焦点变化，高亮活跃 cell |
| `omniControl/cellUrlChanged` | `{ cellId, url }` | 通知 control 叠加层 URL 变更 |

## 性能设计

### controlView 单例

- `controlView` 在首次 `create()` 时创建，之后跨窗口 open/close 循环复用
- `toggleControl()` 纯 show/hide（`addChildView`/`removeChildView`），无创建开销
- 关闭 omni 窗口时 `cleanupAllViews()` 仅从 baseWindow 分离 controlView，不销毁
- 仅在应用退出时 `destroy()` 才彻底销毁 controlView

### 节流

| 操作 | 节流间隔 | 说明 |
|---|---|---|
| `applyLayoutInternal` | 16ms | 窗口 resize 时重排 cell 位置 |
| `saveWindowLayout` | 100ms | 窗口移动/缩放后保存位置 |
| `saveLayoutToDao` | 500ms | SPA 频繁导航时防止过多 DB 写入 |

### webContents 安全检查

所有 webContents 操作前调用 `isWebContentsAlive(wc)` 检查 `!isDestroyed() && !isCrashed()`，防止操作已销毁或已崩溃的实例。

### 崩溃自动清理

每个 cell 的 browser webContents 注册 `render-process-gone` 事件，崩溃时自动移除该 cell 的所有视图并从 `this.cells` 中清除。

### 资源清理链路

```
窗口关闭 → closed 事件 → cleanupAllViews()
                              ├── 遍历 cells: removeChildView + webContents.close()
                              ├── menubarView: webContents.close()
                              ├── controlView: webContents.close()
                              ├── baseWindow.destroy() (如未销毁)
                              └── 重置所有状态

应用退出 → cleanupResources() → omniWindowHelper.destroy() → cleanupAllViews()
```

## 常量

| 常量 | 值 | 说明 |
|---|---|---|
| `MENUBAR_HEIGHT` | 32px | 顶部菜单栏高度 |
| `CELL_MENUBAR_HEIGHT` | 36px | cell 导航栏高度 |
| `DIVIDER_SIZE` | 4px | 分屏分隔条宽度 |
| `OMNI_PARTITION` | `persist:omni` | 共享 session 分区 |
| `CHROME_USER_AGENT` | Chrome 146 UA | 伪装 Chrome 避免网站兼容性问题 |
