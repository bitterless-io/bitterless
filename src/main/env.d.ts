/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENV: 'dev' | 'prod';
  readonly VITE_MODE: 'debug' | 'release';
  readonly VITE_MAIN_TITLE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
