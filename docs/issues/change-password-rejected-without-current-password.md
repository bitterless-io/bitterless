# 头像菜单「修改密码」对已设过密码的账号总是失败 —— 客户端没发旧密码

Status: root cause confirmed 2026-09-24（读码）；fix in progress

## 现象

Ral 2026-09-24 要求头像菜单里「像 cowork 那样」有修改密码，并说「如果 bitterless-private 不支持修改密码的话，
需要将这个接口配上去，前后端一起改」。核对下来：**服务端支持，客户端调错了**。

## 根因

- 客户端：`#/account/password`（`localHome/src/ChangePassword.vue` + `changePassword.store.ts`）只有「新密码 / 确认」；
  `homeShellBridge.changePassword({ newPassword })` → `homeShellBridge.handler.ts` → `authStore.changePassword()` →
  `changePasswordApi(token, { new_password })`。契约解析器 `parseHomeShellPasswordChangeRequest` 只接受恰好
  `['newPassword']` 一个键。
- 服务端（`bitterless-private` `apps/core/src/modules/auth/auth.service.ts` `changePassword`）：
  `POST /auth/change-password`，`ChangePasswordDto { old_password?, new_password (>=8) }`；
  **`status === 'active'` 且已有密码时必须带 `old_password` 且正确**，否则 400 `"Old password incorrect"`。
  受邀账号的首次设密（`status === 'invited'`）不需要旧密码。
- 能走到这个页面的恰好都是 active + 有密码的账号（其余的被路由送去首次设密），所以它**每次都 400**。
  桥接层把 400 映射成「邮箱、密码或验证码不正确」，页面再把任何失败显示成通用的「Could not change the password.」。
- 单测把 API 打桩成成功（`tests/maestro/accountMenu.test.mjs`），所以没拦住。

服务端不需要改：接口已存在且语义正确。`bitterless-private` 补一条 active 账号改密的契约测试
（带对 / 带错 / 不带旧密码），把客户端这次依赖的语义钉住 —— 该仓原来只测了受邀首次设密。

## 修法

- 页面加「当前密码」（`autocomplete="current-password"`），必填；顺序：当前密码 → 新密码 → 确认。
- `HomeShellPasswordChangeRequest` 增加可选 `oldPassword`；解析器接受 `['newPassword']` 或
  `['newPassword', 'oldPassword']`（`oldPassword` 非空字符串），其余键仍拒绝。
- `authStore.changePassword(newPassword, oldPassword?)` 在有旧密码时带上 `old_password`；首次设密路径不变。
- 旧密码错误（桥接层 `credentialsRejected`）时显示「The current password is incorrect.」而不是通用失败。
- 成功后的行为不变：保持当前会话，显示「Password updated.」。
- **成功后刷新资料不能翻阶段。** 现在的 `authStore.changePassword()` 成功后调 `fetchMe()`，它会置 `checking = true`，
  Home 快照于是 `ready → restoring → ready`；main 的 `applicationAuth` 把这当成未登录，执行
  `suspendAuthenticatedSession()` —— `agentService.shutdown()` 中止所有进行中的回合、清掉 browser-use 会话、挂起受保护
  tab —— 页面本身也会在保存中途闪成 `SignInGuide`。以前没人见过，只因为请求总在 400 那一步先失败了；修好旧密码之后
  它会**第一次真正发生**。已是 `ready` 的账号改密后改用不碰 `checking` 的校验（保留 `fetchMe()` 的 token 围栏与失效语义）；
  受邀首次设密（本来就不是 `ready`）照旧走 `fetchMe()`。

## 已知、不在本次范围

- 服务端 active 账号改密**不会**吊销其它设备的会话（只有受邀首次设密会）。`personal-signup.md` 里
  「Password changes revoke old sessions」写在注册段落里，指的是注册设密；是否要让改密也踢掉其它设备，
  是一个产品/安全决定，留给 Ral。
- Cowork 改密成功后客户端主动登出（`cowork.handler.ts` 在 `changeAiCrmsPassword` 之后调 `logoutAiCrms()`）；
  本仓保持登录（`6bf96d09` 的既有行为，有测试钉着）。这次不改这一点，两端是否统一也留给 Ral。
