import { appDataDir, ensureWorkDirectory } from '@main/paths/appData';

/**
 * The one shared default workspace — where every workspace tool works when no directory is bound
 * (Ral 2026-09-10:「不要区分会话,实际工作的时候 n 个会话都在做一个事情,干脆就搞一个大的默认工作空间
 * 得了」). See docs/features/maestro-default-workspace.md.
 *
 * It replaces the per-chat `<userData>/cowork/chat_workspaces/<chat id>` fallback: n chats working on
 * one job were writing into n directories nobody could find again.
 *
 * **The path comes from `@main/paths/appData`** (Ral 2026-09-20:「~ 下的 data 目录应该通过 pathhelper
 * 通用的方式获取」), which owns the per-environment root, the table of editions, and the boot-time
 * creation of every directory under it. Keeping a second copy of that table here is exactly the
 * drift this module stopped owning.
 */
export const defaultWorkspaceRoot = (): string => appDataDir('workspace');

/** `mkdir -p` the default workspace and return it. Idempotent — called at boot and on every resolve. */
export const ensureDefaultWorkspace = (): string => ensureWorkDirectory();
