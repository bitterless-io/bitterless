/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { loadOnlyPreviewWorkspaceConfig } from '../../../src/preload/onlypreview/search/core/workspace-config.mjs';
import { createTraversalPolicy, walkWorkspace } from '../plans/walker.mjs';

/**
 * Picks directories by their share of the corpus text, not by name, so a scope speedup can be read
 * against the work the scope actually removes. A plan that reads files at query time should track
 * the share; a plan whose per-query cost is dominated by a project-wide scan should not.
 */
export const pickScopeSamples = async ({ rootPath, targets = [0.5, 0.1, 0.01] }) => {
  const config = await loadOnlyPreviewWorkspaceConfig(rootPath);
  const policy = createTraversalPolicy(config);
  const ownBytes = new Map([['', { bytes: 0, files: 0 }]]);
  const directories = new Set(['']);
  await walkWorkspace({
    rootPath,
    policy,
    onDirectory: (entry) => directories.add(entry.relativePath),
    onFile: (file) => {
      if (file.mediaType !== 'text') return;
      const bucket = ownBytes.get(file.parentRelativePath) ?? { bytes: 0, files: 0 };
      bucket.bytes += file.size;
      bucket.files += 1;
      ownBytes.set(file.parentRelativePath, bucket);
      directories.add(file.parentRelativePath);
    }
  });
  const subtree = new Map();
  for (const directory of directories) subtree.set(directory, { bytes: 0, files: 0 });
  const byDepthDescending = [...directories].sort(
    (left, right) => right.split('/').length - left.split('/').length
  );
  for (const directory of byDepthDescending) {
    const own = ownBytes.get(directory) ?? { bytes: 0, files: 0 };
    const accumulated = subtree.get(directory);
    accumulated.bytes += own.bytes;
    accumulated.files += own.files;
    if (!directory) continue;
    const separator = directory.lastIndexOf('/');
    const parent = separator < 0 ? '' : directory.slice(0, separator);
    const parentAccumulated = subtree.get(parent) ?? { bytes: 0, files: 0 };
    parentAccumulated.bytes += accumulated.bytes;
    parentAccumulated.files += accumulated.files;
    subtree.set(parent, parentAccumulated);
  }
  const totalBytes = subtree.get('')?.bytes ?? 0;
  const candidates = [...subtree.entries()]
    .filter(([relativePath]) => relativePath !== '')
    .map(([relativePath, accumulated]) => ({
      relativePath,
      textFiles: accumulated.files,
      textBytes: accumulated.bytes,
      share: totalBytes > 0 ? accumulated.bytes / totalBytes : 0
    }))
    .filter((candidate) => candidate.textFiles > 0);
  const picked = [];
  for (const target of targets) {
    const best = candidates
      .filter((candidate) => !picked.some((entry) => entry.relativePath === candidate.relativePath))
      .sort((left, right) => Math.abs(left.share - target) - Math.abs(right.share - target))[0];
    if (best) picked.push({ ...best, target });
  }
  return { totalBytes, totalDirectories: directories.size - 1, samples: picked };
};
