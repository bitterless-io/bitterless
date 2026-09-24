# Control 自己的登录表单 —— 与 Cowork 的 `ControlLogin` 对齐，不再借用 Home 的登录页

Status: in progress 2026-09-24 · Paired with `micromeet-cowork`

Supersedes the *UI* part of [Control-owned login](control-login.md): that feature moved credential
entry into Control but rendered Home's `views/login/Login.vue` in `compact` mode inside it. The
authority model, the anonymous-browsing contract and the protected-surface gates of that feature
are unchanged.

## 请求

Ral 2026-09-24：「Bitterless 应该也像 cowork 那样，在右侧的 control 会话中进行登录。只有登录之后才能进行对话。……
home 页面的登录页面不再使用了，转而直接使用 CTRL 里面的登录。你需要把这个登录表单做出来让我能用到，并且在未登录的
状态下，直接显示这个登录页面。」以及「control-card control-login__card 在 cowork 中登录的表单组件并没有垂直居中，
需要改成垂直居中。bitterless 也是同理，需要去优化。」

## 为什么不再借用 Home 的 `Login.vue`

- 它是整页登录页的缩小版：中文硬编码（违反本仓 i18n 规则）、Arco 大号控件、重置密码与首次设密都是
  **弹窗**（Control 这么窄，弹窗只能 `calc(100% - 8px)` 地挤进去）、成功后弹 `Message.success('登录成功')`
  toast —— 在 Control 里这些都不对。
- Cowork 的 `ControlLogin.vue` 已经是为 Control 这个窄面板设计的表单；Ral 要的是两端一致。
- Home 的 `Login.vue` 本身**保留**：隐藏的 Home 权威渲染层（`src/renderer/home`）仍有 `login` 路由，
  `_syncHiddenRoute()` 会导航到它。这次只是 Control 不再引用它。

## 布局（对照 Cowork `apps/cowork/src/renderer/control/src/auth/ControlLogin.vue`）

```text
Control viewport — 现有冷灰外框 / 8px 内缩                         （ControlAuthApp，已有）
┌────────────────────────────────────────────┐
│ ▏resize handle（左缘 8px）                  │
│ ┌────────────────────────────────────────┐ │
│ │ 圆角暖白卡片 16px #FFFCF7，聚焦时蓝色 2px 阴影 │ │ ← control-app__card（已有）
│ │                                    [×] │ │ ← chrome：只有关闭按钮，右对齐
│ │ ┌ scroll（flex:1, overflow:auto, 纵向 flex）┐ │
│ │ │        ┌ panel（flex:none, margin-block:auto）┐ │ ← 有富余 → 上下等分 = 垂直居中
│ │ │        │ [BL icon] Bitterless     [English ▾]  │ │   放不下 → 边距塌成 0，从顶部滚动
│ │ │        │ Sign in                              │ │
│ │ │        │ [Sign in with password][with code]   │ │
│ │ │        │ Email                                │ │
│ │ │        │ [you@example.com               ]     │ │
│ │ │        │ Password / Verification code         │ │
│ │ │        │ [••••••••        ] [Send code]       │ │ ← Send code 只在验证码模式
│ │ │        │                  Forgot password?    │ │ ← 只在密码模式
│ │ │        │ [            Sign in             ]   │ │
│ │ │        │ error / notice（role=alert/status）   │ │
│ │ │        └──────────────────────────────────────┘ │
│ │ └──────────────────────────────────────────┘ │
│ └────────────────────────────────────────┘ │
└────────────────────────────────────────────┘
```

尺寸与配色逐项照 Cowork `ControlLogin.less`：表单宽 420px（`max-width: 100%`）、面板内边距 24px 20px、
控件 42px 高、8px 圆角、`#f3f5fc` 底、无边框、主按钮 `#155dfc`、焦点 2px 描边。Cowork 那边的区域选择、
机构选择、同意条款、版权行是 CRMS 的业务，本仓没有，不搬。

**控件用原生 `<input>/<button>/<select>` + Less，而不是 Arco。** 这是为了与 Cowork 逐像素一致（Cowork 的表单
就是原生控件）；Arco 的输入框有自己的高度、悬停描边与尺寸档，做不到同形。样式全部在 `.less` 里、BEM 平铺。

**垂直居中不依赖任何工具类。** Cowork 这次的缺陷正是根元素的 Tailwind `flex` 被 `arco.css` 里 normalize 的
`main { display: block }`（未分层）压掉（见 Cowork `docs/issues/control-login-form-not-vertically-centered.md`）。
本仓没有 Tailwind，但同样加载 Arco 的全局样式，所以：根用 `<section>`（normalize 不碰）、高度链上每一层的
`display: flex` 都写在本仓的 Less 里，并用渲染实测验收，而不是只断言 CSS 源文本。

## 状态（全部由隐藏 Home 权威的快照驱动）

| 快照 / 本地状态 | Control 显示 | 动作 |
|---|---|---|
| 未解析（`phase: unknown`）、正在登出 | 转圈 + 「Checking your Bitterless sign-in status…」 | — |
| 权威不可达（`authorityUnavailable`） | 「Sign-in status is temporarily unavailable.」 | Retry → `refreshAuthSnapshot()` |
| `restoring` | 转圈 + 「Verifying your saved sign-in…」 | Cancel → `cancelSessionRecovery()` |
| `saved-session`（有 token、未验证） | 本次 Control 生命周期内自动恢复一次（首次看到的若已是 `restoring`，就算作这一次 —— 所以 Cancel 之后落在下面的恢复面，不会立刻又开始恢复）；失败或取消后：「We could not verify your saved sign-in. It is kept — check your connection, then retry.」 | Retry → `restoreSession()`；Use another account → `clearLocalSession()` |
| `password-setup`（受邀、首次设密） | 「Set your password」+ 邮箱（只读）+ 新密码 + 确认 | Set password → `changePassword(new)`（受邀账号服务端不要旧密码） |
| `signed-out` | 登录表单（密码 / 验证码两种模式） | Sign in；Send code（60s 倒计时）；Forgot password? |
| 忘记密码（本地子状态） | 「Reset password」：邮箱 + 验证码（Send code）+ 新密码 + 确认 | Reset → `resetPassword()`；成功后回到密码模式、邮箱预填、提示「Password reset. Sign in with your new password.」；Back |
| `ready` | **聊天**（`ControlApp`），登录表单卸载 | — |

- 错误**就地显示**在表单下方（`role="alert"`），不弹 toast。桥接层返回的错误信息是
  `HOME_SHELL_AUTH_ERROR_MESSAGES` 里的固定中文常量；表单按常量反查键名，换成当前语言的文案
  （`i18nHelper.auth.controlLogin.errors.<key>`），查不到时用通用失败文案。契约本身不改。
- 本地校验：邮箱必填；密码模式密码必填；验证码 6 位；新密码至少 8 位（服务端 `@MinLength(8)`）；两次一致。
- 上次用的邮箱与模式存 `localStorage`（仅偏好，读写失败忽略），与 Cowork 相同；默认密码模式（本仓原有默认）。
- 模式切换、阶段变化时清空凭据类输入（密码 / 验证码 / 新密码），不清邮箱。
- 语言选择：English / 中文，调用 `requestApplicationLanguageChange()`，与应用设置同一条路。
- 首次显示与每次 `coach/login-request` 时把焦点给第一个输入框（已有行为，保留）。

## 聊天闸门

只有 `ready` 才渲染聊天；其余任何状态 Control 都是登录表单。**模型提供方不参与这个判断** —— 选 Bitterless
provider 时出现「Not signed in to Bitterless…」而不是登录页的缺陷单独记在
[bitterless-provider-asks-to-sign-in-inside-chat.md](../issues/bitterless-provider-asks-to-sign-in-inside-chat.md)。

## 验证

- 渲染实测：SSR 渲染真实 `ControlLogin.vue`，CSS 按 Control 入口真实顺序拼（Arco 全局样式 + 本仓 Less），
  headless Chromium 在 400×{600, 760, 900, 1100} 量表单上下留白：放得下时相差 ≤ 1px，放不下时从顶部开始。
- 源码/单元守卫：各状态的分支与动作（打桩 `localHomeAuthStore`）、错误文案映射、倒计时、偏好读写失败不抛；
  `ControlAuthApp` 不再 import `views/login/Login.vue`；en/zh 键齐全。
- `yarn typecheck:web`、scoped ESLint、`tests/maestro/controlLogin*.test.mjs` 等既有守卫按新结构更新后全绿。
- 不跑 Electron E2E（本仓规则）。真实账号登录 / 登出 / 忘记密码 / 首次设密需 Ral 人工验收。
