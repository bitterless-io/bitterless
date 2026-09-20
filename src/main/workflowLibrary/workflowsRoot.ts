import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { getRuntimeProfile } from '@main/environment/runtimeProfile.runtime';

/**
 * Where workflow packages live — one directory per edition, owned by the user
 * (Ral 2026-09-20:「取消从远程拉取 workflow 改为读取 ~/.bitterless /workflows 的资源」).
 * Scheme of record: `areas/agent-runtime/workflow/workflow.html` #1.1.
 *
 * **The directory name carries the environment, exactly like `userData`.** The profile's `appName`
 * IS the userData directory name, so the home root is simply its lowercase form — one axis, one
 * source, no second table to drift. This is the same expression `defaultWorkspaceRoot()` uses; a new
 * edition therefore gets its workflows directory for free.
 *
 * | profile id | userData (`appName`) | workflows |
 * | --- | --- | --- |
 * | `production` | `Bitterless` | `~/.bitterless/workflows` |
 * | `production-preview` | `Bitterless_PREVIEW` | `~/.bitterless_preview/workflows` |
 * | `production-debug` | `Bitterless_DEBUG_PROD` | `~/.bitterless_debug_prod/workflows` |
 * | `test-debug` | `Bitterless_DEBUG_DEV` | `~/.bitterless_debug_dev/workflows` |
 * | `test-release` | `Bitterless_DEV` | `~/.bitterless_dev/workflows` |
 *
 * `app.getPath('home')`, not `os.homedir()`: E2E redirects the home path, and a test run must not
 * write into a real `~/.bitterless*`.
 */
export const workflowsRoot = (): string =>
  join(app.getPath('home'), `.${getRuntimeProfile().appName.toLowerCase()}`, 'workflows');

/**
 * `mkdir -p` the workflows root and return it. Called at boot, not on first write
 * (Ral 2026-09-20:「~/.bitterless 带 env 的目录都是在 app 启动时需要 ensure 创建的」) — the user has to
 * be able to open the folder before anything has put a package in it, and a directory that only
 * appears after the first successful install reads as a broken feature. Idempotent.
 */
export const ensureWorkflowsRoot = (): string => {
  const root = workflowsRoot();
  mkdirSync(root, { recursive: true });
  return root;
};
