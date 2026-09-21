export type PathName =
  | 'home'
  | 'appData'
  | 'userData'
  | 'sessionData'
  | 'temp'
  | 'exe'
  | 'module'
  | 'desktop'
  | 'documents'
  | 'downloads'
  | 'music'
  | 'pictures'
  | 'videos'
  | 'recent'
  | 'logs'
  | 'crashDumps';

/**
 * `PathMainHelper` 的方法形状,**住在 shared 里**,给 XPC emitter 用。
 *
 * 为什么不直接 `import type { PathMainHelper } from '../main/pathMain.helper'`(原来的写法):
 * 那个模块是主进程专属的 —— 它 import `@main/environment/runtimeProfile.runtime`,而
 * `tsconfig.web.json` **刻意不给 `@main/*` 映射**(「renderer 不该能解析 main,这条边界是刻意的」)。
 * `import type` 也会把整个模块拉进 renderer 的类型图,于是每个 renderer surface 都报
 * `TS2307: Cannot find module '@main/…'` —— 15 个 surface 各一条。
 *
 * 那句 `@main` import 不能删:`homeDataRoot()` 要 `getRuntimeProfile()`,而它在 profile 尚未 apply 时
 * **会抛错**,那是承重的 fail-fast(否则数据会写进 `~/.bitterless` 而不是 `~/.bitterless_preview`)。
 * 所以断开的是**类型这一侧**:契约放 shared,两端都指向它。
 *
 * `PathMainHelper implements PathMainHelperContract` 由编译器钉住,签名漂移会当场报错。
 * 形状必须和类**逐字一致**(单参数对象,`XpcMainHandler` 的约定),否则 emitter 的调用形状会错。
 */
export interface PathMainHelperContract {
  getAppPath(): Promise<string>;
  getPath(params: { name: PathName }): Promise<string>;
  getUserDataPath(): Promise<string>;
  getHomeDataPath(): Promise<string>;
  openPath(params: { path: string }): Promise<string>;
  getChromiumPath(): Promise<string | null>;
}

export type PathHelperApi = {
  getAppPath: () => Promise<string>;
  getPath: (name: PathName) => Promise<string>;
  getUserDataPath: () => Promise<string>;
  openPath: (path: string) => Promise<string>;
};
