---
status: in_progress
depends-on:
  - dev-prod-core-api
verify:
  - yarn build
  - yarn dev:prod opens the OTP login flow against production
  - invited customer can verify OTP, set a password, and enter the workspace
---

# Customer OTP Login

## Goal

Allow a Bitterless customer to enter the desktop app with an email OTP, including the first login
for an invited account that has not set a password.

## Flow

```text
+------------------------------+
| Bitterless                   |
| [密码登录] [邮箱验证码]        |
| Email                        |
| Code              [发送验证码] |
| [验证并登录]                  |
+------------------------------+
              |
              | invited + valid OTP
              v
+------------------------------+
| 设置登录密码 Modal            |
| New password                 |
| Confirm password             |
| [设置密码并继续]              |
+------------------------------+
              |
              v
        Desktop workspace
```

## Contract

- Password and OTP are mutually exclusive login modes.
- Every request-triggering button shows a loading state and blocks duplicate submission until its
  request settles: send OTP, password/OTP login, and first-password setup.
- OTP login uses the same customer JWT storage and XPC session activation as password login.
- Home renderer CSP permits connections only to the production and development Bitterless Core domains.
- An invited customer may request and verify a login OTP because the customer row was created by
  an administrator invitation.
- The invited JWT may access only auth endpoints marked for password setup.
- First-password setup is an unclosable modal over the login page; mask clicks and Escape cannot
  dismiss it.
- The router redirects any customer with `must_set_password` back to login, including after an app
  restart or direct navigation to a workspace route.
- Worker windows are activated only after an invited customer completes password setup.
- Active customers enter the workspace immediately after OTP verification.

## Verification

- `yarn build` passes.
- The production Core URL is allowed by the renderer CSP.
- Electron flow passed with API responses mocked at the renderer boundary: send OTP, verify an
  invited customer, show the first-password modal, set the password, and route to `/chat`.
- Escape and mask clicks do not dismiss the modal; direct navigation to `/chat` returns to login
  while `must_set_password` is true.
- The detached-DevTools debug viewport (`756x474`) keeps the complete modal reachable without
  overlap.
- Production Core `260713190244` is published to `bl-prod-hk`; the DirectMail SMTP environment diff
  is clean.
- A real `POST /auth/send-otp` request for the invited customer returned `201 {"ok":true}`, proving
  the old invitation-link-only rejection is gone.
- Final acceptance remains the customer's manual step: enter the delivered OTP and choose the first
  password in the desktop modal. The agent does not consume that OTP or choose the account password.
