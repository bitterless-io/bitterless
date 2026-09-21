/// <reference types="vite/client" />

/**
 * 打包时注入的版本号。
 *
 * 原来只声明在 `src/preload/env.d.ts` —— 那个文件不在任何 typecheck surface 的 `include` 里,
 * 而用到它的 `src/renderer/trench-io/trenchIo.preload.ts` 偏偏住在 renderer 树下,于是
 * `renderer/trench-io` 报 `TS2304: Cannot find name`。`declare const` 不像 interface 会合并,
 * 两处声明就是重复声明 —— 所以是**搬**过来,不是抄一份。
 */
declare const __BITTERLESS_VERSION_CODE__: string;

/**
 * `import.meta.env` 的全量声明,**放在 `src/shared` 下是有意的**。
 *
 * 原来三份声明分别在 `src/env.d.ts`、`src/main/env.d.ts`、`src/preload/env.d.ts`。
 * 那对 `yarn build` 够用(vite 按入口打包,每棵树都看得到自己那份),但对
 * `scripts/typecheck/surfaces.mjs` 不够:每个 surface 的 `include` 只有自己那棵树加
 * `src/shared` 通配,**三份声明一份都不在里面**。于是任何被 shared 拉进来的文件
 * (`pathMain.helper.ts`、`runtimeProfile.runtime.ts`)一读 `import.meta.env.VITE_MODE`
 * 就是 `TS2339: Property 'VITE_MODE' does not exist` —— 在 12 个 preload/renderer surface 上
 * **各报一遍**,而代码本身没有任何问题。
 *
 * `src/shared` 是**唯一一个每个 surface 都包含**的目录,所以声明放这里,每个 surface 都看得到。
 * 原来那三份保持不动:接口同名会合并,相同成员声明两次是合法的,而它们各自那棵树仍然需要
 * 自己的 `/// <reference types="vite/client" />`。
 *
 * 新增一个 `VITE_` 变量时改这里,否则它又只对一部分 surface 可见。
 */
interface ImportMetaEnv {
  readonly VITE_ENV: 'dev' | 'prod';
  readonly VITE_MODE: 'debug' | 'release';
  readonly VITE_RELEASE_CHANNEL: 'dev' | 'prod' | 'preview';
  readonly VITE_MAIN_TITLE: string;
  readonly VITE_BITTERLESS_CORE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
