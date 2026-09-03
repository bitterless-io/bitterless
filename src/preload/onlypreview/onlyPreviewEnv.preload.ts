import { contextBridge } from 'electron';
import type {
  OnlyPreviewEntryMode,
  OnlyPreviewEnvApi,
  OnlyPreviewHostPlatform
} from './onlypreview.preload.type';

export const getOnlyPreviewArgument = (name: string): string | null => {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : null;
};

const resolveEntryMode = (): OnlyPreviewEntryMode => {
  const value = getOnlyPreviewArgument('onlypreview-mode');
  if (
    value === 'preview' ||
    value === 'globalSearch' ||
    value === 'alert' ||
    value === 'settings' ||
    value === 'guide'
  ) {
    return value;
  }
  return 'shell';
};

const resolvePlatform = (): OnlyPreviewHostPlatform => {
  if (process.platform === 'darwin' || process.platform === 'win32') return process.platform;
  return 'other';
};

export const exposeOnlyPreviewEnv = (): OnlyPreviewEnvApi => {
  const env: OnlyPreviewEnvApi = Object.freeze({
    hostToken: getOnlyPreviewArgument('onlypreview-host-token'),
    hostId: getOnlyPreviewArgument('onlypreview-host-id'),
    previewRuntimeToken: getOnlyPreviewArgument('onlypreview-runtime-token'),
    openTag: getOnlyPreviewArgument('onlypreview-open-tag'),
    mode: resolveEntryMode(),
    platform: resolvePlatform()
  });
  contextBridge.exposeInMainWorld('onlyPreviewEnv', env);
  return env;
};
