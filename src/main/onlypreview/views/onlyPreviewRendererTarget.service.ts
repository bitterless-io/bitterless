import { shell } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { is } from '@electron-toolkit/utils';
import type { OnlyPreviewHostCapability } from '@main/onlypreview/onlyPreviewHost.registry';

export type OnlyPreviewRendererMode =
  | 'shell'
  | 'preview'
  | 'globalSearch'
  | 'settings'
  | 'guide';

export const getOnlyPreviewRendererTarget = (
  mode: OnlyPreviewRendererMode,
  outputDirectory: string
): { filePath: string; url: string } => {
  const rendererPath = `onlypreview/${mode}/index.html`;
  const filePath = join(outputDirectory, `../renderer/${rendererPath}`);
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return {
      filePath,
      url: `${process.env['ELECTRON_RENDERER_URL'].replace(/\/+$/, '')}/${rendererPath}`
    };
  }
  return { filePath, url: pathToFileURL(filePath).href };
};

export const getOnlyPreviewRendererArguments = (
  host: OnlyPreviewHostCapability,
  mode: OnlyPreviewRendererMode,
  previewRuntimeToken?: string
): string[] => [
  `--onlypreview-host-token=${host.hostToken}`,
  `--onlypreview-host-id=${host.hostId}`,
  `--onlypreview-mode=${mode}`,
  ...(previewRuntimeToken ? [`--onlypreview-runtime-token=${previewRuntimeToken}`] : [])
];

export const configureOnlyPreviewNavigationFence = (
  webContents: Electron.WebContents,
  expectedUrl: string,
  allowExternalHttp = true
): void => {
  webContents.setWindowOpenHandler(({ url }) => {
    if (allowExternalHttp && /^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  const fenceNavigation = (event: Electron.Event, url: string): void => {
    if (url === expectedUrl) return;
    event.preventDefault();
    if (allowExternalHttp && /^https?:\/\//i.test(url)) void shell.openExternal(url);
  };
  webContents.on('will-navigate', fenceNavigation);
  webContents.on('will-redirect', fenceNavigation);
};
