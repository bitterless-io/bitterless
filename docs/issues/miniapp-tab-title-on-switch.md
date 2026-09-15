# 切换 miniapp 后 tab 名称更新

Status: implemented; code-verified, human testing pending (2026-09-15).

Ral:「bl cowork 切 miniapp 的时候 tab 名字要跟着更新」。

## 契约与根因

`maestroBrowserView.service.ts#setTabKind` 已设置目标 spec.title，但等待 `mountComposite`
完成后才广播；真实方法 mock 中，open 挂起时 title 已写入，renderer 却收不到新快照。
`mountComposite` 的旧 host 在切走后仍能 `setTitle`；旧 open 的 rejection 还会无条件删除新
composite 的注册并把当前 tab 回退到 browser。Zellij `openOnTab` 等待 surface、失效后抛错
就是这条路径的实际入口。

- 同一 tab 切入 miniapp 时，立即广播目标 registry title，不等内容挂载完成。
- miniapp A → B 同样更新；切回 Website 清除旧 miniapp 标题，随后由网页标题接管。
- 当前 miniapp 的合法动态标题继续生效；切走、关闭后的旧 host 和旧 mount 完成结果不能
  覆盖当前 tab 的标题、挂载状态或激活结果。
- 用户 alias 按 [tab-alias.md](../features/tab-alias.md) PQ-4 原样保留；不以清别名解决自动标题问题。
- pinned、未知目标、同类型空操作、已有 singleton 聚焦保留原语义。
- 不改 tab 身份、历史存储或 Zellij 会话关闭策略。按钮尺寸另见
  [页面类型切换器 #7](../features/maestro-page-type-switcher.md#7-按钮尺寸对齐-cowork2026-09-15)。

## 验证与人工验收

真实方法 mock 单测覆盖挂载未完成时已广播标题、当前动态标题、旧 host 的迟到回调、旧挂载
失败不覆盖新选择、关闭后的回调，以及 alias 保留。运行相关 composite 回归单测。
由 Ral 在原分支测试网页 → Zellij → 其他 miniapp → Website，确认名称及时跟随，快速切换
也不会跳回旧标题；显式别名保留。Electron E2E 不运行。

验证完成：以下命令 33/33 通过（12 项新回归、21 项既有 composite 导航/实例测试）：

```sh
node --test tests/maestro/maestroMiniappTitleSwitch.test.mjs tests/maestro/maestroCompositeTabNavigation.test.mjs tests/maestro/maestroCompositeTabInstances.test.mjs
```

差异空白检查通过；按钮 Vue 编译、Tabler SSR 属性与编译后 Less 检查通过。本轮未运行全仓
类型检查、构建、Electron/E2E 或打包发布。改动留在原项目当前分支，交 Ral 人工测试。
