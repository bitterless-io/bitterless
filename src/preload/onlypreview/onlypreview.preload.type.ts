export type OnlyPreviewEntryMode = 'shell' | 'preview' | 'settings';
export type OnlyPreviewContainerMode = 'standalone' | 'omni';
export type OnlyPreviewHostPlatform = 'darwin' | 'win32' | 'other';

export interface OnlyPreviewEnvApi {
  readonly hostToken: string | null;
  readonly hostId: string | null;
  readonly mode: OnlyPreviewEntryMode;
  readonly containerMode: OnlyPreviewContainerMode;
  readonly platform: OnlyPreviewHostPlatform;
}
