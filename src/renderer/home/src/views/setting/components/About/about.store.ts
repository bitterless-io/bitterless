import { reactive } from 'vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { ShellHandler } from '@main/xpc/shell.handler';

const shellEmitter = createXpcRendererEmitter<ShellHandler>('ShellHandler');

interface AppInfo {
  name: string;
  version: string;
  versionCode: number;
  website: string;
}

class AboutState {
  appInfo: AppInfo = {
    name: 'Bitterless',
    version: '0.0.1',
    versionCode: 2026032801,
    website: 'https://bitterless.io',
  };

  async openWebsite(): Promise<void> {
    try {
      await shellEmitter.openExternal({ url: this.appInfo.website });
    } catch (err) {
      console.error('[AboutState] Failed to open website:', err);
    }
  }
}

export const aboutStore = reactive(new AboutState());
