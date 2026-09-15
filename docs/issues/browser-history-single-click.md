# 浏览历史 click 前提前移走焦点

Status: implemented; code-verified, human testing pending (2026-09-15).

Ral 反馈浏览历史应单击跳转；与 Cowork 同步检查。既有
[browser-history-suggestions.md](../features/browser-history-suggestions.md) 已约定点击候选即导航。

## 根因与证据

HistoryApp 根节点 `mouseup` 发送 focus，候选按钮则在随后的 `click` 发送 accept。
实际 Vue 模板挂载 jsdom、接入实际 main action/focusAddress 方法，复现 click 之前已发生
focus → native home focus → address focus event，之后才 accept → hide → navigate。
这证实提前移走原生焦点的风险；jsdom 无法证明 Electron 每次都会丢失 click，未宣称 BL 实机必现双击。

`webContents.focus()` 会聚焦其网页，见 [Electron 官方说明](https://www.electronjs.org/docs/latest/api/web-contents#contentsfocus)。

## 修复契约与验证

- 移除根节点 mouseup 提前聚焦；候选正常 click 单次执行 accept，不改为按下即导航。
- 历史/Google 单击导航一次；删除只删除，关闭/删除/重试继续由现有 main 动作完成后恢复焦点。
- 保留 Enter/Space 按钮语义、方向键、IME、关闭与 session 校验。
- 实际组件事件回归检查 click 前无 focus、副作用只发生一次，并运行既有输入/popup 回归。
- 不启动 Electron/E2E 或独立 review。人工测试：刚输入后单击历史/Google 即跳转；删除按钮不导航。

验证：真实 HistoryApp SFC 与 historyStore 的 jsdom 事件回归 8/8 通过，覆盖 click 前无动作、
历史/Google/删除/关闭/重试单击、键盘及 IME 边界。与现有输入 13 项、原生 popup mock 14 项
联合运行 35/35 通过：

```sh
node --test tests/maestro/maestroBrowserHistoryClick.test.mjs tests/maestro/maestroBrowserHistoryInput.test.mjs tests/maestro/maestroBrowserHistoryPopup.test.mjs
```

源码只删除一处提前聚焦绑定；无 main/store/CSS 变更。未运行全仓类型检查、构建或 Electron/E2E。
