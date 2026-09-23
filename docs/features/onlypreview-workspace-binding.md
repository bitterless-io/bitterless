# 会话的工作区和 OnlyPreview 绑在一起

> **2026-09-23 标题文案**：BL 与 Cowork 的 OnlyPreview menu bar 标题和默认 Tab 标题统一为
> `Workspace`（W 大写），所有界面语言一致。文件预览标题、用户自定义 Tab 别名及内部标识保持原有语义。
> 验证：OnlyPreview 宿主切换及占位 Tab 单测 15/15。全局 renderer-i18n 与 tab-alias 检查
> 分别停在 Maestro 初始化顺序、退出前 pinned Tab 两条既有断言，HEAD 同样不通过。
> 未运行 Electron/E2E；需重启包含改动的构建，确认 menu bar 和 Tab 均显示 `Workspace`。

> **2026-09-17 自动打开入口修复**：Chat 按钮与 Agent 请求的原生目录选择器都在 Main 的
> `chooseWorkspaceDirectory` 成功绑定后，通过宿主适配器打开一次 Preview；不再等待 Chat 保存队列。
> Preview 失败保留工作区，并提示点击工作区名称重试。`setWorkspaceDirectory`、恢复和发送前刷新
> 仍不触发自动打开。此规则替代下文“只在 renderer chooseWorkspace 接线”的历史实现记录，见
> [picker 自动打开修复](../issues/onlypreview-workspace-picker-auto-open.md)。

> **2026-09-14 当前规则**：停用 workspace 只解绑匹配的 Project，保留 OnlyPreview tab / window
> 及进程，显示选择工作区引导；再次选择复用该承载和有效索引。下文 2026-09-10
> “收掉 / destroyStandalone”实现记录已被替代，详见
> [清除 workspace 保留 tab](../issues/onlypreview-workspace-clear-retains-tab.md)。

Ral 2026-09-10：

> 2. 选择 workspace 后自动就打开 onlypreview 如果关闭 workspace（clear workspace）onlypreview
> 也要关闭 但是这个文案表达有问题不应该叫 clear 因为这只是用 workspace 不用或替换的关系
> 如果替换也需要触发 onlypreview 加载替换后的目录

## 规则

会话的工作区绑定，和 OnlyPreview 里开着什么，从此是**一件事**：

| 人的动作 | OnlyPreview |
| --- | --- |
| 选中一个工作区 | 打开它 |
| 换成另一个目录 | 加载换过之后那个目录 |
| 停用（原「clear」） | 仅解绑匹配的 Project，保留承载并展示选择工作区引导 |

「替换」不需要单独一条路径：显式打开会把项目根换成新的那个目录，所以选中和替换是**同一个调用**。

## 2026-09-10 实现记录（关闭承载部分已被替代）

**1. 挂在人的动作上，不挂在状态同步上。**

接线写在渲染进程的 `chooseWorkspace()` / `stopUsingWorkspace()` 里，不写在 main 侧的
`setWorkspaceDirectory`。后者还被 `refreshWorkspace()` 用来做状态同步 —— 每次载入会话、切会话都会
调它。接在那儿会变成「一开 app 就自己弹出预览」，而人要的是他**点了**之后才开。

**2. 停用时要比对当前项目根，不能无条件关。**

他说的是「关闭 workspace onlypreview 也要关闭」。但 OnlyPreview 里**可能不是这个工作区**：人可以自己
另开一个项目，也可以在预览一个工作区外的文件。无条件关会毁掉和这次操作无关的东西，所以端口收的是
**带路径**的 `closeForPath(absolutePath)`，宿主那边比对：

```ts
closeForPath: async (absolutePath: string) => {
  const host = onlyPreviewWindowHelper.getStandaloneHost();
  if (!host) return;
  const rootRealPath = await realpath(absolutePath).catch(() => absolutePath);
  if (!onlyPreviewWorkspaceRegistry.isActiveProjectRoot(host.hostToken, rootRealPath)) return;
  onlyPreviewWindowHelper.destroyStandalone();
}
```

比对在**真实路径**上做，两边都过 `realpath`：芯片给的是人选的那一串，绑定时存的是 `inspectTarget`
产出的 `rootRealPath`。不统一的话，一个软链拼法或 macOS 的 `/tmp` vs `/private/tmp` 就会比不上，
表现是「停用了工作区但预览还开着」。

`destroyStandalone()` 按承载各走各的：独立窗口关窗口，Cowork tab 关那一个 tab（它自己那行注释就是
这么写的），所以调用方不需要分情况。

**3. 停用前先把路径取下来。**

```ts
const previousPath = session.detail.workspace?.path      // ← 必须在解绑之前
await coach.setWorkspaceDirectory({ sessionId, path: '' })
...
if (previousPath) await coach.closeWorkspacePreview({ path: previousPath })
```

顺序反了就是 `undefined`，那一步静默不做任何事。变异测试里专门有一条。

## 文案：不再说 clear

他指出「clear」不对：这只是**用 / 不用 / 替换**的关系，没有任何东西被清除。

| | 原 | 现 |
| --- | --- | --- |
| tooltip | Clear workspace | Stop using this workspace |
| 标题 | Clear the workspace? | Stop using this workspace? |
| 确认 | Clear workspace | Stop using it |
| 取消 | Keep it | Keep using it |

正文补了一句 **Nothing is deleted — the files stay where they are**，因为「clear」造成的误解正是
「文件会不会没了」。cowork 那侧原来的正文还说了两件真正会变的事（新文件改落默认工作区、这一步不
记住目录），**保留**——换文案不该顺手删信息，测试里有一条钉着它。

顺带把 bl 这一块三处硬编码英文（`content="Switch workspace"` / `content="Clear workspace"` /
`aria-label="Open workspace in OnlyPreview"`）改成走 `i18nHelper`，en/zh 两套键都补齐 —— 本项目
的 i18n 规则不允许硬编码用户可见文本，而这几行正好在这次要改的范围里。预览应用的名字来自
`MAESTRO_ONLY_PREVIEW_APP_NAME`（和 tab id 放在一起），main 侧端口的 `displayName` 和面板那句
tooltip 从此说同一个名字。

## 落地位置

| | bitterless | micromeet-cowork |
| --- | --- | --- |
| 端口 | `shared/maestro/previewOpener.api.ts` +`closeForPath` | 直接是 `closeOnlyPreviewForPath` |
| 宿主实现 | `main/windows/onlyPreviewMaestroOpener.ts` | `main/miniapps/onlypreview/host/onlyPreviewOpenTarget.ts` |
| 契约 | `shared/maestro/coach.api.ts` | `shared/cowork.api.ts` |
| handler | `main/maestro/xpc/coach.handler.ts` | `main/xpc/cowork.handler.ts` |
| 渲染进程 | `renderer/maestro/control/src/store/message.store.ts` | `renderer/control/src/store/message.store.ts` |
| 文案 | `renderer/common/i18n/{en,zh}.ts` + `ChatPanel.vue` | `ChatPanel.vue`（`controlText` 内联） |

bl 走端口是因为 `check:maestro` 的别名边界禁止 maestro 那棵树 import OnlyPreview；cowork 没有这条
边界，宿主适配器直接导出函数。

## 2026-09-10 验证记录（关闭承载断言需按当前契约更新）

- **源码守卫 12 条 / 两仓各一份**：`tests/onlypreview/onlyPreviewWorkspaceBinding.test.mjs` ·
  cowork `tests/unit/onlyPreviewWorkspaceBinding.test.mjs`。
- **变异测试两仓各 5 条，全部被捕获**（清单见
  `docs/issues/onlypreview-workspace-chip-does-not-activate-the-tab.md`）。
- bl typecheck 108 → 107；`test:onlypreview` 1150 条 / 17 失败，与 HEAD 逐条相同；
  `scripts/maestro/check-*.mjs` 15 失败与 HEAD 逐条相同。cowork typecheck 20、单测 503 / 1 失败，
  均为既有基线。
- **未跑**：`yarn build`（会改写 package.json 的 name）、`yarn lint`（已知 OOM）、Electron E2E。
- **运行时那一半要你跑一次**：选一个工作区 → 应该直接开出来；换一个 → 应该换目录；点停用 → 应该
  收掉；在 OnlyPreview 里手动另开一个别的项目再点停用 → **不该**收掉。
