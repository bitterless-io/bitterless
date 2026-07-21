# Bitterless desktop auth and device plan

## Current desktop change

- Home renderer now has a public `#/login` page.
- All normal app routes are guarded. Without a valid customer token the user is redirected to `#/login`.
- Password login calls `bitterless-private` core `/auth/login` with `scope: "customer"`, then validates the session with `/auth/me`.
- After a successful login, the user is redirected to the original route or `#/chat`.
- Connector and proxy-setting initialization now starts from the authenticated layout instead of the renderer bootstrap.
- JWT invalidation is centralized through main-process XPC: when any process reports a protected API 401 through `AuthHandler/invalidateSession`, the main process closes user-facing secondary windows, preserves worker windows such as SQLite/FS, and broadcasts the main window back to `#/login`.
- After login succeeds, the renderer calls `AuthHandler/activateSession` so SQLite/FS worker windows are available before the app route opens.

## Current compatibility bridge

`bitterless-private` currently requires `device_id` before it can issue a token. The final desired device ID needs the customer id, which is only known after credential validation.

For this first desktop page, the renderer uses this bridge:

1. Create a local 32-char random device seed and submit a temporary `bootstrap-<seed>` device id.
2. Decode the returned customer JWT payload to read `sub`.
3. Submit the password login once more using the canonical desktop device id:
   `<8-digit customer id tail><32-char device seed>`.
4. Revoke the temporary bootstrap token.
5. Persist the canonical device id locally for later device/Meta work.

This keeps the desktop device id in the requested format without waiting for the backend migration, but the backend should replace this with a single-step flow.

## Recommended final login flow

1. Renderer shows only the login page before authentication.
2. User submits email/password or OTP.
3. Backend validates credentials against `Customer`.
4. Backend creates or reuses a `CustomerDevice` row and generates the canonical device id:
   `<8-digit customer id tail><32-char uuid/random id>`.
5. Backend creates a customer token bound to that device row and returns:
   `token`, `customer`, `device`.
6. Renderer stores the token and device id, then derives or loads the SQLite password.
7. Renderer initializes the encrypted SQLite database.
8. Renderer writes a `Meta` row with `customer_id`, `device_id`, auth server URL, and schema/auth version.
9. Only after those steps does the app route into `#/chat`.

## SQLite password and Meta table

Recommended renderer-side sequence after successful auth:

1. Read `customer.id` and backend-returned `device.id`.
2. Create a fixed local DB secret if absent. The requested minimum is 8 random bytes; 16 or 32 random bytes would be stronger if acceptable.
3. Derive SQLite password from `customer id tail 8 + fixed local DB secret` with a KDF, then keep using the existing localStorage + keychain envelope to persist the encrypted SQLite password.
4. Initialize SQLite with that password.
5. Add a `Meta` table before other app writes:

```sql
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Minimum keys:

- `customer_id`
- `customer_email`
- `device_id`
- `auth_base_url`
- `auth_schema_version`
- `db_key_version`

## Human/backend support needed

- The development desktop Core API is `https://bl-test-api.terncloud.com`. After the Shanghai
  backend release gate passes, production and `yarn dev:prod` use
  `https://prod-bitterless-hcqmtqwtox.cn-shanghai.fcapp.run`. Keep
  `VITE_BITTERLESS_CORE_URL`, the renderer fallback, CSP, and the main-process allowlist aligned.
- Create or invite the real customer accounts in `bitterless-private`.
- Add backend device APIs:
  - `POST /auth/login` returns `{ token, customer, device }` and generates device id server-side.
  - `GET /auth/devices` lists active devices for the current customer.
  - `POST /auth/devices/rename` renames a device.
  - `POST /auth/devices/:id/revoke` revokes one device token/device.
  - `POST /auth/logout-all` revokes all other devices.
- Match the `dsh-service` interface convention: expose only `GET` and `POST` endpoints. Update/delete/revoke actions should be `POST` actions, not `PATCH`/`PUT`/`DELETE`.
- Add a `CustomerDevice` table or extend `CustomerToken` with durable device metadata:
  `device_id`, `name`, `platform`, `app_version`, `last_ip`, `last_user_agent`, `authorized_at`, `revoked_at`.
- Migrate existing `customer_tokens.device_id` comments and DTO docs away from "frontend nanoid" once backend owns device ids.
- Decide whether first login from a new device is automatically authorized or requires an admin/customer approval step.
- Decide whether device authorization is per token, per physical device, or both.
- Add desktop logout/account UI once the backend device list endpoints exist.
