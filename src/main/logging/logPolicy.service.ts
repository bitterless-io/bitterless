import { join } from 'node:path';
import type { ApplicationRuntimeProfile } from '@shared/diagnostics/applicationDiagnostics.contract';

export const APPLICATION_LOG_FILE_FORMAT =
  '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{profile}] [{level}] [{processType}] {text}';

export const FIRST_PARTY_RENDERER_PATHS = [
  '/home/index.html',
  '/sqlite/index.html',
  '/connector/index.html',
  '/llama/index.html',
  '/todo/index.html',
  '/eyesOnAgents/index.html',
  '/translator/index.html',
  '/motto/index.html',
  '/coin/index.html',
  '/omni/omniCell/index.html',
  '/omni/omniControl/index.html',
  '/omni/omniWindow/index.html',
  '/maestro/home/index.html',
  '/maestro/control/index.html',
  '/maestro/workbench/index.html',
  '/maestro/sqlite/index.html'
] as const;

const normalizedRendererPath = (value: string): string =>
  value.startsWith('/') ? value : `/${value}`;

export const isFirstPartyRendererUrl = (value: string, rendererBaseUrl?: string): boolean => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const rendererPath = normalizedRendererPath(url.pathname);
  const pathMatches = FIRST_PARTY_RENDERER_PATHS.some((path) => rendererPath.endsWith(path));
  if (!pathMatches || url.search || url.hash || url.username || url.password) return false;

  if (url.protocol === 'file:') {
    return rendererPath.includes('/out/renderer/');
  }
  if (!rendererBaseUrl) return false;

  try {
    const base = new URL(rendererBaseUrl);
    return (base.protocol === 'http:' || base.protocol === 'https:') && url.origin === base.origin;
  } catch {
    return false;
  }
};

export const resolveApplicationLogFile = (
  profile: ApplicationRuntimeProfile,
  paths: {
    userData: string;
    libraryDefaultDir: string;
  }
): string =>
  profile.viteMode === 'debug'
    ? join(paths.userData, 'logs', 'main.log')
    : join(paths.libraryDefaultDir, 'main.log');
