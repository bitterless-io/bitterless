// XPC facade for the one Main-owned Submodules runtime. Every prototype method of an XpcMainHandler
// becomes a callable channel, so this class carries the four contract methods and nothing else. The
// channel name is unchanged from the former preload handler, so renderer emitters are untouched.
import { XpcMainHandler } from 'electron-xpc/main';
import type { SubmodulesApi, SubmodulesSnapshot } from '@shared/submodules/submodules.type';
import { submodulesRuntime } from '@main/submodules/submodulesRuntime.service';

export class SubmodulesHandler extends XpcMainHandler implements SubmodulesApi {
  async initialize(): Promise<SubmodulesSnapshot> {
    return await submodulesRuntime.initialize();
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
