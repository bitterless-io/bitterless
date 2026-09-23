import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveAddressBarLocalPath } from '@shared/onlypreview/onlyPreviewTargetInput';

export type LocalPathTarget =
  | { kind: 'preview'; path: string }
  | { kind: 'missing'; fileUrl: string };

/** Existing local targets always use the shared Workspace/IndiPreview router, for every format. */
export const resolveLocalPathTarget = (
  input: string,
  exists: (path: string) => boolean = existsSync
): LocalPathTarget | null => {
  const raw = resolveAddressBarLocalPath(input);
  if (raw === null) return null;
  const target = resolve(raw);
  return exists(target)
    ? { kind: 'preview', path: target }
    : { kind: 'missing', fileUrl: pathToFileURL(target).href };
};
