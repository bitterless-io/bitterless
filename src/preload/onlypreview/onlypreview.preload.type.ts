export type OnlyPreviewEntryMode = 'shell' | 'previewHeader' | 'preview' | 'settings' | 'guide';
export type OnlyPreviewHostPlatform = 'darwin' | 'win32' | 'other';

export interface OnlyPreviewEnvApi {
  readonly hostToken: string | null;
  readonly hostId: string | null;
  readonly mode: OnlyPreviewEntryMode;
  readonly platform: OnlyPreviewHostPlatform;
}
