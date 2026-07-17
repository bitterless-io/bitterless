/// <reference types="vite/client" />

declare const __BITTERLESS_VERSION_CODE__: string;

interface ImportMetaEnv {
  readonly VITE_ENV: 'dev' | 'prod';
  readonly VITE_MODE: 'debug' | 'release';
  readonly VITE_MAIN_TITLE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
