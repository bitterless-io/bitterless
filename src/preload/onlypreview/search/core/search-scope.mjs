export const requireOnlyPreviewSearchScope = (
  scope,
  treeEntries,
  hasBrowseDirectory = () => false
) => {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new TypeError('Invalid search scope');
  }
  if (scope.kind === 'project') {
    if (Object.keys(scope).length !== 1) throw new TypeError('Invalid search scope');
    return { kind: 'project' };
  }
  if (
    scope.kind !== 'directory' ||
    Object.keys(scope).sort().join(',') !== 'kind,relativePath' ||
    typeof scope.relativePath !== 'string' ||
    scope.relativePath.length > 16_384 ||
    scope.relativePath.includes('\0') ||
    scope.relativePath.startsWith('/') ||
    scope.relativePath.includes('\\') ||
    /^[a-zA-Z]:/u.test(scope.relativePath) ||
    scope.relativePath
      .split('/')
      .some(
        (segment) => (!segment && scope.relativePath !== '') || segment === '.' || segment === '..'
      )
  ) {
    throw new TypeError('Invalid search scope');
  }
  if (
    scope.relativePath &&
    !treeEntries.some(
      (entry) => entry.nodeKind === 'directory' && entry.relativePath === scope.relativePath
    ) &&
    !hasBrowseDirectory(scope.relativePath)
  ) {
    throw new TypeError('Search directory scope does not exist');
  }
  return { kind: 'directory', relativePath: scope.relativePath };
};
