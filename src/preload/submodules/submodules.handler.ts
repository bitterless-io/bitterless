// XPC facade for the Submodules runtime. Every prototype method of an XpcPreloadHandler becomes a
// callable channel, so this class carries the four contract methods and nothing else.
import { XpcPreloadHandler } from 'electron-xpc/preload';
import type { SubmodulesApi, SubmodulesSnapshot } from '@shared/submodules/submodules.type';
import { submodulesRuntime } from './submodulesRuntime.service';

export class SubmodulesHandler extends XpcPreloadHandler implements SubmodulesApi {
  async initialize(): Promise<SubmodulesSnapshot> {
    return await submodulesRuntime.restore();
  }

  async setRoot(params: { rootPath: string }): Promise<SubmodulesSnapshot> {
    const rootPath = params?.rootPath?.trim();
    if (!rootPath) return submodulesRuntime.rescan();
    return await submodulesRuntime.open(rootPath);
  }

  async refresh(): Promise<SubmodulesSnapshot> {
    return submodulesRuntime.rescan();
  }

  async clearRoot(): Promise<SubmodulesSnapshot> {
    return await submodulesRuntime.forget();
  }
}

export const submodulesHandler = new SubmodulesHandler();
