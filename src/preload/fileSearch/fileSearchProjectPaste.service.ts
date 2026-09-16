import { constants, type BigIntStats } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, readlink, realpath, rm, symlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import { validateOnlyPreviewEntryName } from '@shared/onlypreview/onlyPreviewEntryName.shared';

const exists = async (path: string): Promise<BigIntStats | null> =>
  lstat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });

const sameIdentity = (a: BigIntStats, b: BigIntStats): boolean =>
  a.dev === b.dev && a.ino === b.ino;

/** Called only by the private file authority, with paths read by Main from the OS clipboard. */
export const pasteOnlyPreviewProjectFiles = async (
  sourcePaths: string[],
  parentPath: string,
  assertCurrent: () => Promise<void>
): Promise<string[]> => {
  if (
    !Array.isArray(sourcePaths) ||
    !sourcePaths.length ||
    sourcePaths.length > 200 ||
    sourcePaths.some((path) => typeof path !== 'string' || !isAbsolute(path) || path.includes('\0'))
  ) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Clipboard file list is invalid.');
  }
  parentPath = await realpath(parentPath);
  const plan: { source: string; target: string; identity: BigIntStats; name: string }[] = [];
  const names = new Set<string>();
  for (const sourcePath of [...new Set(sourcePaths)]) {
    const identity = await lstat(sourcePath, { bigint: true });
    if (!identity.isFile() && !identity.isDirectory()) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'Only files and directories can be pasted.'
      );
    }
    const source = await realpath(sourcePath);
    const name = basename(sourcePath);
    const validation = validateOnlyPreviewEntryName(name);
    if (!validation.ok || validation.name !== name) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'The copied item name is not supported.');
    }
    const target = join(parentPath, name);
    const destinationWithinSource = relative(source, parentPath);
    if (
      identity.isDirectory() &&
      (destinationWithinSource === '' ||
        (destinationWithinSource !== '..' &&
          !destinationWithinSource.startsWith(`..${sep}`) &&
          !isAbsolute(destinationWithinSource)))
    ) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'A folder cannot be pasted into itself.');
    }
    // Conservatively reject case collisions on platforms whose usual volumes ignore case.
    const key = process.platform === 'linux' ? name : name.toLowerCase();
    if (names.has(key) || (await exists(target))) {
      throw new OnlyPreviewContractError(
        'NAME_EXISTS',
        'An item with this name already exists in this folder.'
      );
    }
    names.add(key);
    plan.push({ source, target, identity, name });
  }

  const created: { path: string; identity: BigIntStats }[] = [];
  const copy = async (source: string, target: string, root: boolean): Promise<void> => {
    await assertCurrent();
    if ((await realpath(dirname(target))) !== dirname(target)) {
      throw new OnlyPreviewContractError(
        'PATH_OUTSIDE_WORKSPACE',
        'The paste destination changed.'
      );
    }
    const info = await lstat(source, { bigint: true });
    if (info.isDirectory()) {
      await mkdir(target, { mode: Number(info.mode & 0o777n) | 0o700 });
      if (root) created.push({ path: target, identity: await lstat(target, { bigint: true }) });
      for (const name of await readdir(source))
        await copy(join(source, name), join(target, name), false);
    } else if (info.isFile()) {
      await copyFile(source, target, constants.COPYFILE_EXCL);
      if (root) created.push({ path: target, identity: await lstat(target, { bigint: true }) });
    } else if (info.isSymbolicLink() && !root) {
      // Preserve links inside a copied folder without traversing their targets.
      await symlink(await readlink(source), target);
    } else {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'The copied folder contains an unsupported item.'
      );
    }
  };
  try {
    for (const item of plan) {
      if (!sameIdentity(item.identity, await lstat(item.source, { bigint: true }))) {
        throw new OnlyPreviewContractError(
          'OPERATION_FAILED',
          'A copied item changed before paste.'
        );
      }
      await copy(item.source, item.target, true);
    }
    await assertCurrent();
    return plan.map((item) => item.name);
  } catch (error) {
    // Roll back only roots this operation created, never pre-existing or replaced entries.
    for (const item of created.reverse()) {
      if ((await realpath(dirname(item.path)).catch(() => null)) !== dirname(item.path)) continue;
      const current = await exists(item.path);
      if (current && sameIdentity(current, item.identity)) await rm(item.path, { recursive: true });
    }
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
      throw new OnlyPreviewContractError(
        'NAME_EXISTS',
        'An item with this name already exists in this folder.'
      );
    }
    throw error;
  }
};
