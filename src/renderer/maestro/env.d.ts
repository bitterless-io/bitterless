/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

declare global {
  interface Window {
    // Exposed by coach.preload.ts — resolves a File to its absolute path (no bytes read).
    fileBridge: { getPathForFile: (file: File) => string }
    // Exposed by coach.preload.ts — writes renderer-recorded audio to a temp file and returns a path.
    audioBridge: { writeTempAudio: (params: { bytes: ArrayBuffer; extension?: string }) => string }
  }
}

export {}
