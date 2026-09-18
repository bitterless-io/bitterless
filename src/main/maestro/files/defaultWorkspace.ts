import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { getRuntimeProfile } from '@main/environment/runtimeProfile.runtime';

/**
 * The one shared default workspace — where every workspace tool works when no directory is bound
 * (Ral 2026-09-10:「不要区分会话,实际工作的时候 n 个会话都在做一个事情,干脆就搞一个大的默认工作空间
 * 得了」). See docs/features/maestro-default-workspace.md.
 *
 * It replaces the per-chat `<userData>/cowork/chat_workspaces/<chat id>` fallback: n chats working on
 * one job were writing into n directories nobody could find again.
 *
 * **The directory name carries the environment, exactly like `userData`** (Ral 2026-09-18:
 * 「~/.micromeet 或 .bitterless 文件名要带上环境例如 bitterless_preview 和 userdata 类似……
 * 具体参考现在的情况」). The profile's `appName` IS the userData directory name, so the workspace
 * root is simply its lowercase form — one axis, one source, no second table to drift:
 *
 * | profile id | userData (`appName`) | default workspace |
 * | --- | --- | --- |
 * | `production` | `Bitterless` | `~/.bitterless/default_workspace` |
 * | `production-preview` | `Bitterless_PREVIEW` | `~/.bitterless_preview/default_workspace` |
 * | `production-debug` | `Bitterless_DEBUG_PROD` | `~/.bitterless_debug_prod/default_workspace` |
 * | `test-debug` | `Bitterless_DEBUG_DEV` | `~/.bitterless_debug_dev/default_workspace` |
 * | `test-release` | `Bitterless_DEV` | `~/.bitterless_dev/default_workspace` |
 *
 * Deriving it from `appName` rather than from `id` is deliberate: the ask was「和 userdata 类似」,
 * and `appName` is literally what names `userData`. A new edition therefore gets its workspace
 * directory for free, with no chance of the two lists disagreeing.
 *
 * `app.getPath('home')`, not `os.homedir()`: E2E redirects the home path, and a test run must not
 * write into a real `~/.bitterless*`.
 */
export const defaultWorkspaceRoot = (): string =>
  join(app.getPath('home'), `.${getRuntimeProfile().appName.toLowerCase()}`, 'default_workspace');

/** `mkdir -p` the default workspace and return it. Idempotent — called at boot and on every resolve. */
export const ensureDefaultWorkspace = (): string => {
  const root = defaultWorkspaceRoot();
  mkdirSync(root, { recursive: true });
  return root;
};
