import { contextBridge } from 'electron';
import { xpcRenderer } from 'electron-xpc/preload';
import type { PackageInfo, PackageHelperApi } from '../shared/packageHelper.type';

/**
 * Returns a contextBridge-safe object for exposeInMainWorld.
 */
const createPackageHelperApi = (): PackageHelperApi => {
  return {
    getPackageInfo: (): Promise<PackageInfo> => {
      return xpcRenderer.send('PackageMainHelper/getPackageInfo');
    },
  };
};

/** The packageHelper API instance, usable in preload code */
export const packageHelper: PackageHelperApi = createPackageHelperApi();

// Auto-expose packageHelper to window on import
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('packageHelper', packageHelper);
  } catch (error) {
    console.error('[packagePreload] exposeInMainWorld failed:', error);
  }
} else {
  (globalThis as any).packageHelper = packageHelper;
}
