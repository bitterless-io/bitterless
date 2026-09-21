/// <reference types="vite/client" />

// `__BITTERLESS_VERSION_CODE__` 移到 `src/shared/env.d.ts` —— 那里每个 typecheck surface 都看得到。

interface ImportMetaEnv {
  readonly VITE_ENV: 'dev' | 'prod';
  readonly VITE_MODE: 'debug' | 'release';
  readonly VITE_MAIN_TITLE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
