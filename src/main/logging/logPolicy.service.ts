import { join } from 'node:path';
import type { ApplicationRuntimeProfile } from '@shared/diagnostics/applicationDiagnostics.contract';

export const APPLICATION_LOG_FILE_MAX_SIZE = 5 * 1024 * 1024;

const FIRST_PARTY_RENDERER_ENTRIES = [
  { path: '/home/index.html', process: 'renderer:home' },
  { path: '/sqlite/index.html', process: 'renderer:sqlite' },
  { path: '/connector/index.html', process: 'renderer:connector' },
  { path: '/llama/index.html', process: 'renderer:llama' },
  { path: '/todo/index.html', process: 'renderer:todo' },
  { path: '/eyesOnAgents/index.html', process: 'renderer:eyesOnAgents' },
  { path: '/translator/index.html', process: 'renderer:translator' },
  { path: '/motto/index.html', process: 'renderer:motto' },
  { path: '/onlypreview/shell/index.html', process: 'renderer:onlypreviewShell' },
  {
    path: '/onlypreview/previewHeader/index.html',
    process: 'renderer:onlypreviewPreviewHeader'
  },
  { path: '/onlypreview/preview/index.html', process: 'renderer:onlypreviewPreview' },
  { path: '/onlypreview/settings/index.html', process: 'renderer:onlypreviewSettings' },
  { path: '/onlypreview/guide/index.html', process: 'renderer:onlypreviewGuide' },
  { path: '/coin/index.html', process: 'renderer:coin' },
  { path: '/omni/omniCell/index.html', process: 'renderer:omniCell' },
  { path: '/omni/omniControl/index.html', process: 'renderer:omniControl' },
  { path: '/omni/omniWindow/index.html', process: 'renderer:omniWindow' },
  { path: '/maestro/home/index.html', process: 'renderer:maestroHome' },
  { path: '/maestro/control/index.html', process: 'renderer:maestroControl' },
  { path: '/maestro/workbench/index.html', process: 'renderer:maestroWorkbench' },
  { path: '/maestro/sqlite/index.html', process: 'renderer:maestroSqlite' }
] as const;

const normalizedRendererPath = (value: string): string =>
  value.startsWith('/') ? value : `/${value}`;

export const resolveFirstPartyRendererProcess = (
  value: string,
  rendererBaseUrl?: string
): string | null => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const rendererPath = normalizedRendererPath(url.pathname);
  const rendererRoot = '/out/renderer';
  const entryPath =
    url.protocol === 'file:' && rendererPath.includes(rendererRoot)
      ? rendererPath.slice(rendererPath.lastIndexOf(rendererRoot) + rendererRoot.length)
      : rendererPath;
  const entry = FIRST_PARTY_RENDERER_ENTRIES.find(({ path }) => entryPath === path);
  if (!entry || url.search || url.username || url.password) return null;

  if (url.protocol === 'file:') {
    return rendererPath.includes(`${rendererRoot}/`) ? entry.process : null;
  }
  if (!rendererBaseUrl) return null;

  try {
    const base = new URL(rendererBaseUrl);
    return (base.protocol === 'http:' || base.protocol === 'https:') && url.origin === base.origin
      ? entry.process
      : null;
  } catch {
    return null;
  }
};

export const isFirstPartyRendererUrl = (value: string, rendererBaseUrl?: string): boolean =>
  resolveFirstPartyRendererProcess(value, rendererBaseUrl) !== null;

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

export const resolveTranslatorLogFile = (
  profile: ApplicationRuntimeProfile,
  paths: {
    userData: string;
    libraryDefaultDir: string;
  }
): string =>
  profile.viteMode === 'debug'
    ? join(paths.userData, 'logs', 'translator', 'translator.log')
    : join(paths.libraryDefaultDir, 'translator', 'translator.log');
