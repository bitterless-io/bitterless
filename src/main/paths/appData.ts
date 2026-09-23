import { app } from 'electron';
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homeDataIn, homeDataRoot } from '@shared/pathHelper/main/homeData';

/**
 * Every owner-facing directory under the home data root, and the boot-time ensure.
 *
 * Ral 2026-09-20:「~ 下的 data 目录应该通过 pathhelper 通用的方式获取……例如现在我在 workflows 目录下
 * 看不到 skills 目录,首先这些目录都需要 ensure 的」, and on which shape wins:「cowork 的环境目录设计
 * 对的,以此为准」— one directory per product per environment, every piece of owner-facing app data a
 * named subdirectory of it.
 *
 * Before this, the default workspace and the workflow library each computed the same root expression
 * separately, and global skills lived somewhere else entirely (`<userData>/cowork/skills`), so
 * opening the root told you nothing about where the rest of the app's data was.
 *
 * **Where the root is** now lives in `@shared/pathHelper/main/homeData` — including the profile
 * table and the reasoning for deriving it from `appName`. This module is the other half: WHICH
 * directories exist under it, and creating them at boot.
 */
/**
 * Where the root IS lives in the path helper (Ral 2026-09-20:「~ 下的 data 目录应该通过 pathhelper
 * 通用的方式获取」). This module owns what is UNDER it — the directory list and the boot-time ensure.
 * Re-exported rather than re-derived so existing callers keep working and the two cannot disagree.
 */
export const appDataRoot = (): string => homeDataRoot();

/**
 * Every owner-facing directory under the root, in one list.
 *
 * This list is what `ensureAppData()` creates, so "which directories exist" has exactly one answer
 * and a new one cannot be added without also being created at boot.
 */
export const APP_DATA_DIRS = {
  /** The shared default workspace — where every file tool works when no directory is bound. */
  workspace: 'default_workspace',
  /** Workflow packages, one directory each. */
  workflows: 'workflows',
  /** Global skills: the owner's own, outside any workspace or institution scope. */
  skills: 'skills',
} as const;
export type AppDataDir = keyof typeof APP_DATA_DIRS;

/**
 * 每个目录**干什么用的** —— 给人看,也给模型看。
 *
 * 这些说明以前只存在于上面那几行注释里,于是提示词里根本没有 home 根这回事:模型被问到
 * "把某个工作流装到哪 / 从哪卸",只能猜或者去读源码(Ral 2026-09-23,实测一个会话就卡在这)。
 *
 * **写成 `Record<AppDataDir, string>` 是故意的**:新加一个目录而不写用途,直接编译不过 ——
 * 一份会漏项的清单,比没有清单更糟,因为它看起来是全的。
 */
export const APP_DATA_DIR_PURPOSE: Record<AppDataDir, string> = {
  workspace: 'the shared default workspace — where file tools write when no project directory is bound',
  workflows: 'workflow packages, one directory each; install or remove a workflow here',
  skills: 'global skills authored on this machine, outside any workspace or institution scope'
};

export const appDataDir = (name: AppDataDir): string => homeDataIn(APP_DATA_DIRS[name]);

/**
 * `mkdir -p` the root and every directory in `APP_DATA_DIRS`, then move anything still sitting in a
 * pre-unification location. Called once at boot.
 *
 * Creating them all up front is the point: the owner opens the root expecting to see what the app
 * keeps there, and a directory that only appears after its feature has first written something reads
 * as that feature being broken.
 */
export const ensureAppData = (): string => {
  const root = appDataRoot();
  mkdirSync(root, { recursive: true });
  for (const name of Object.keys(APP_DATA_DIRS) as AppDataDir[]) adopt(name);
  for (const name of Object.keys(APP_DATA_DIRS) as AppDataDir[]) {
    // One unusable entry must not take the app down with it. It is reported rather than swallowed:
    // the feature that owns the directory will surface its own error when the owner reaches for it.
    try { mkdirSync(appDataDir(name), { recursive: true }); }
    catch (error) { console.warn(`[appData] could not create ${appDataDir(name)}`, error); }
  }
  return root;
};

/**
 * Where each directory used to live, before they were unified. `workspace` and `workflows` are
 * absent because they were already under this root — only global skills move.
 */
const legacyLocations = (): Partial<Record<AppDataDir, string>> => ({
  skills: join(app.getPath('userData'), 'cowork', 'skills'),
});

/**
 * Move a pre-unification directory into the root, once.
 *
 * Only ever runs when the new location does **not** exist: an owner who has already used the new
 * directory must never have it replaced by an older copy. A failure is swallowed — a missed
 * migration leaves the old data where it is, which is recoverable; a crash at boot is not.
 */
const adopt = (name: AppDataDir): void => {
  const from = legacyLocations()[name];
  const to = appDataDir(name);
  // Only ever a directory: renaming a stray *file* onto the target would make the directory a file,
  // and the create loop below would then fail on every boot.
  if (!from || from === to || existsSync(to) || !existsSync(from) || !statSync(from).isDirectory()) return;
  try {
    mkdirSync(join(to, '..'), { recursive: true });
    renameSync(from, to);
    console.info(`[appData] moved ${from} → ${to}`);
  } catch (error) {
    console.warn(`[appData] could not move ${from} → ${to}; leaving it in place.`, error);
  }
};
