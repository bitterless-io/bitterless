import { contextBridge } from 'electron';
import 'electron-xpc/preload';
import type {
  OnlyPreviewEntryMode,
  OnlyPreviewEnvApi,
  OnlyPreviewHostPlatform
} from './onlypreview.preload.type';

const getArgument = (name: string): string | null => {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : null;
};

const resolveEntryMode = (): OnlyPreviewEntryMode => {
  const value = getArgument('onlypreview-mode');
  if (value === 'preview' || value === 'settings') return value;
  return 'shell';
};

const resolvePlatform = (): OnlyPreviewHostPlatform => {
  if (process.platform === 'darwin' || process.platform === 'win32') return process.platform;
  return 'other';
};

const onlyPreviewEnv: OnlyPreviewEnvApi = Object.freeze({
  hostToken: getArgument('onlypreview-host-token'),
  hostId: getArgument('onlypreview-host-id'),
  mode: resolveEntryMode(),
  platform: resolvePlatform()
});

contextBridge.exposeInMainWorld('onlyPreviewEnv', onlyPreviewEnv);
