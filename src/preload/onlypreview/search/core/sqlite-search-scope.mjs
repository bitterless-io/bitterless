import { hasHiddenPathSegment } from './filename-tier.mjs';

export const SQLITE_SCOPE_SQL = Object.freeze({
  project: 'f.in_project = 1',
  'visible-directory': 'f.in_project = 1 AND f.relative_path >= ? AND f.relative_path < ?',
  'hidden-directory': 'f.in_project = 1 AND f.relative_path >= ? AND f.relative_path < ?'
});

export const createSqliteScopePlan = (scope) => {
  const keys =
    scope && typeof scope === 'object' && !Array.isArray(scope)
      ? Object.keys(scope).sort().join(',')
      : '';
  if (scope?.kind === 'project' && keys === 'kind') return { key: 'project', params: [] };
  if (
    scope?.kind !== 'directory' ||
    keys !== 'kind,relativePath' ||
    typeof scope.relativePath !== 'string' ||
    scope.relativePath.length > 16_384 ||
    scope.relativePath.startsWith('/') ||
    scope.relativePath.includes('\\') ||
    /^[a-zA-Z]:/u.test(scope.relativePath) ||
    scope.relativePath.includes('\0') ||
    scope.relativePath
      .split('/')
      .some(
        (segment) => (!segment && scope.relativePath !== '') || segment === '.' || segment === '..'
      )
  ) {
    throw new TypeError('Invalid search scope');
  }
  if (scope.relativePath === '') return { key: 'project', params: [] };
  return {
    key: hasHiddenPathSegment(scope.relativePath) ? 'hidden-directory' : 'visible-directory',
    params: [`${scope.relativePath}/`, `${scope.relativePath}0`]
  };
};
