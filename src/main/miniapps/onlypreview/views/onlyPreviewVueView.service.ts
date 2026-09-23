import { WebContentsView } from 'electron';
import { join } from 'node:path';
import type { OnlyPreviewHostCapability } from '../onlyPreviewHost.registry';
import { installOnlyPreviewVueSessionProtocol } from '../onlyPreviewProtocol.service';
import {
  configureOnlyPreviewNavigationFence,
  getOnlyPreviewRendererArguments,
  getOnlyPreviewRendererTarget
} from './onlyPreviewRendererTarget.service';

/** Shared Vue content renderer for Workspace and independent single-file hosts. */
export const createOnlyPreviewVueView = (params: {
  host: OnlyPreviewHostCapability;
  baseDirectory: string;
  runtimeToken?: string;
  officeCapability?: string;
  readCapability?: string;
  openTag?: string;
  mountKind?: 'cowork' | 'window';
  hostArguments?: string[];
  partition?: string;
}): WebContentsView => {
  const view = new WebContentsView({
    webPreferences: {
      preload: join(params.baseDirectory, '../preload/onlypreviewContent.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      ...(params.partition ? { partition: params.partition } : {}),
      additionalArguments: [
        ...(params.hostArguments ?? []),
        ...getOnlyPreviewRendererArguments(params.host, 'preview', params.runtimeToken,
          params.officeCapability, params.readCapability, params.openTag, params.mountKind ?? 'window')
      ]
    }
  });
  configureOnlyPreviewNavigationFence(view.webContents,
    getOnlyPreviewRendererTarget('preview', params.baseDirectory).url);
  if (params.partition) {
    const releaseProtocol = installOnlyPreviewVueSessionProtocol(view.webContents.session);
    view.webContents.once('destroyed', releaseProtocol);
  }
  return view;
};
