export type OnlyPreviewBookmarkDropEdge = 'before' | 'after';

export const reorderOnlyPreviewBookmarkPaths = (
  paths: readonly string[],
  sourcePath: string,
  targetPath: string,
  edge: OnlyPreviewBookmarkDropEdge
): string[] | null => {
  if (sourcePath === targetPath || !paths.includes(sourcePath) || !paths.includes(targetPath)) return null;
  const reordered = paths.filter(path => path !== sourcePath);
  const targetIndex = reordered.indexOf(targetPath);
  reordered.splice(targetIndex + (edge === 'after' ? 1 : 0), 0, sourcePath);
  return reordered.every((path, index) => path === paths[index]) ? null : reordered;
};
