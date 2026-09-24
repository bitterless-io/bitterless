# 地址栏最右侧的设置按钮被删了 —— 找回来，头像菜单回到「邮箱 / 修改密码 / 退出登录」

Status: fix in progress 2026-09-24 · Paired with `micromeet-cowork`

## 请求

Ral 2026-09-24：「帮我看一下浏览器的地址栏最右边的设置按钮，我想了一下，这个设置按钮不能去掉，否则容易让用户
产生困扰。将 Cowork 的设置按钮找回来，然后在 bitless 中也需要增加这样一个 AVATAR 的按钮。BITTERLESS 的登录页面要和
cowork 对齐，包括 avatar 按钮，点击之后还可以退出登录。……点击 avatar 之后展示菜单，菜单下面有不可点击的邮箱地址
以及一个退出登录的按钮。像 cowork 那样，也需要修改密码的按钮。」

## 发生了什么

`6bf96d09`（2026-09-23 18:56，批量 sync）把 `MenuBar.vue` 里的齿轮 `menubar__workbench__open` 换成了
`<UserAvatar />`，「打开 Workbench」挪进头像原生菜单的第 2 行（`accountMenu.service.ts` 硬编码 `'Workbench'`）。
Cowork 的 `bf99801` 晚 3 分钟做了同一件事。两边都没有文档记录这次取舍。

## 契约

```text
地址栏尾部（data-slot="actions"）：
│ [Snapshot?] [AI 面板] [⚙ 设置] [头像] [Update?]
                         │       └─ 原生菜单：
                         │          邮箱（不可点）/ Not signed in / 取不到邮箱
                         │          Change password（仅登录时可点）→ Home tab 的 #/account/password
                         │          Log out        （仅登录时可点）→ 登出 → Control 显示登录表单
                         └─ workbenchStore.openTab()：幂等「打开」，不是开关（任务 167）
```

- 齿轮按删除前的形态恢复：`name="menubar__workbench__open"`、`navBtn`、`IconSettings`、
  标题 `i18nHelper.menuBar.maestro.showWorkbench`；位置在 AI 面板开关右侧、头像左侧。
- 头像菜单去掉 `Workbench` 行（它只是齿轮被删后的替身），`AccountMenuAction` 去掉 `'workbench'`，
  `accountMenu.store.ts` 去掉对应分支。
- 头像本身不变：登录时显示邮箱首字母，未登录显示人形图标；登出后 `requestLogin()` 打开并聚焦 Control，
  Control 显示登录表单（[control-login-form.md](../features/control-login-form.md)）。
- 修改密码这一行目前总是失败，单独记在
  [change-password-rejected-without-current-password.md](change-password-rejected-without-current-password.md)。

## 验证

- `tests/maestro/accountMenu.test.mjs`：原生菜单断言改为三行（邮箱行 `enabled: false` 且无 click）；
  未登录时两个动作行禁用；分发只剩 password / logout。
- 源码守卫：`MenuBar.vue` 里齿轮存在、调用 `workbenchStore.openTab()`、排在 `<UserAvatar />` 之前。
