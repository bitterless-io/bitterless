import { reactive } from 'vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { ShellHandler } from '@main/xpc/shell.handler';
import { packageHelper } from '@shared/packageHelper/renderer/packageRenderer.helper';

const shellEmitter = createXpcRendererEmitter<ShellHandler>('ShellHandler');

interface AppInfo {
  name: string;
  version: string;
  versionCode: number;
  website: string;
}

class AboutState {
  appInfo: AppInfo = {
    name: '',
    version: '',
    versionCode: 0,
    website: '',
  };

  async init(): Promise<void> {
    try {
      const info = await packageHelper.getPackageInfo();
      this.appInfo = {
        name: info.name,
        version: info.version,
        versionCode: info.versionCode,
        website: info.homepage,
      };
    } catch (err) {
      console.error('[AboutState] Failed to load package info:', err);
    }
  }

  async openWebsite(): Promise<void> {
    try {
      await shellEmitter.openExternal({ url: this.appInfo.website });
    } catch (err) {
      console.error('[AboutState] Failed to open website:', err);
    }
  }
}

export const aboutStore = reactive(new AboutState());
