export type OnlyPreviewEntryMode = 'shell' | 'preview' | 'settings';
export type OnlyPreviewHostPlatform = 'darwin' | 'win32' | 'other';

export interface OnlyPreviewEnvApi {
  readonly hostToken: string | null;
  readonly hostId: string | null;
  readonly mode: OnlyPreviewEntryMode;
  readonly platform: OnlyPreviewHostPlatform;
}
