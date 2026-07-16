import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, resolve, win32 } from 'node:path';
import type { EyesOnAgentsProjectMetadata } from '@shared/eyesOnAgents/eyesOnAgents.type';

const MAX_GITDIR_MARKER_BYTES = 4096;
const ABSENT_ERROR_CODES = new Set(['ENOENT', 'ENOTDIR']);

type GitMarkerResult =
  | { type: 'found' }
  | { type: 'absent' }
  | { type: 'unavailable' };

export type EyesOnAgentsProjectResolution =
  | { type: 'project'; project: EyesOnAgentsProjectMetadata }
  | { type: 'none' }
  | { type: 'unavailable' };

const stripTrailingSeparators = (value: string): string => {
  if (value === '/' || /^[a-z]:\/$/i.test(value)) return value;
  return value.replace(/\/+$/, '');
};

export const normalizeEyesOnAgentsProjectKey = (
  root: string,
  platform: NodeJS.Platform = process.platform
): string => {
  if (platform === 'win32') {
    const normalized = win32.normalize(root).replace(/\\/g, '/').normalize('NFC').toLowerCase();
    return stripTrailingSeparators(normalized);
  }
  return stripTrailingSeparators(normalize(root).normalize('NFC'));
};

const isAbsentError = (error: unknown): boolean => {
  return typeof error === 'object' && error !== null && 'code' in error &&
    ABSENT_ERROR_CODES.has(String((error as NodeJS.ErrnoException).code));
};

const readBoundedGitdir = (
  markerPath: string,
  markerSize: number
): { type: 'gitdir'; path: string } | { type: 'absent' } | { type: 'unavailable' } => {
  let descriptor: number | null = null;
  try {
    if (markerSize > MAX_GITDIR_MARKER_BYTES) return { type: 'absent' };
    descriptor = openSync(markerPath, 'r');
    const buffer = Buffer.alloc(MAX_GITDIR_MARKER_BYTES + 1);
    const size = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (size > MAX_GITDIR_MARKER_BYTES) return { type: 'absent' };
    const content = buffer.subarray(0, size).toString('utf8').trim();
    const match = /^gitdir:\s*(.+)$/i.exec(content);
    if (!match?.[1] || /[\0\r\n]/.test(match[1])) return { type: 'absent' };
    return { type: 'gitdir', path: match[1].trim() };
  } catch (error) {
    return isAbsentError(error) ? { type: 'absent' } : { type: 'unavailable' };
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // The marker contents were already read; a close failure must not escape the resolver.
      }
    }
  }
};

const inspectGitMarker = (directory: string): GitMarkerResult => {
  const markerPath = join(directory, '.git');
  let marker: ReturnType<typeof statSync>;
  try {
    marker = statSync(markerPath);
  } catch (error) {
    return isAbsentError(error) ? { type: 'absent' } : { type: 'unavailable' };
  }
  if (marker.isDirectory()) return { type: 'found' };
  if (!marker.isFile()) return { type: 'absent' };
  const gitdir = readBoundedGitdir(markerPath, marker.size);
  if (gitdir.type !== 'gitdir') return gitdir;
  const target = isAbsolute(gitdir.path) ? gitdir.path : resolve(directory, gitdir.path);
  try {
    return statSync(target).isDirectory() ? { type: 'found' } : { type: 'absent' };
  } catch (error) {
    return isAbsentError(error) ? { type: 'absent' } : { type: 'unavailable' };
  }
};

export const resolveEyesOnAgentsProject = (
  cwd: string | null | undefined
): EyesOnAgentsProjectResolution => {
  if (!cwd || !isAbsolute(cwd)) return { type: 'unavailable' };
  let current: string;
  try {
    current = realpathSync.native(cwd);
    if (!statSync(current).isDirectory()) return { type: 'unavailable' };
  } catch {
    return { type: 'unavailable' };
  }

  for (;;) {
    const marker = inspectGitMarker(current);
    if (marker.type === 'unavailable') return { type: 'unavailable' };
    if (marker.type === 'found') {
      const projectName = basename(current) || current;
      return {
        type: 'project',
        project: {
          projectKey: normalizeEyesOnAgentsProjectKey(current),
          projectRoot: current,
          projectName
        }
      };
    }
    const parent = dirname(current);
    if (parent === current) return { type: 'none' };
    current = parent;
  }
};

export const projectMetadataFromResolution = (
  resolution: EyesOnAgentsProjectResolution
): EyesOnAgentsProjectMetadata | null | undefined => {
  if (resolution.type === 'project') return resolution.project;
  if (resolution.type === 'none') return null;
  return undefined;
};
