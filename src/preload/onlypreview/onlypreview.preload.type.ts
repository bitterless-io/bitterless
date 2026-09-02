export type OnlyPreviewEntryMode = 'shell' | 'preview' | 'globalSearch' | 'settings' | 'guide';
export type OnlyPreviewHostPlatform = 'darwin' | 'win32' | 'other';

export interface OnlyPreviewEnvApi {
  readonly hostToken: string | null;
  readonly hostId: string | null;
  readonly previewRuntimeToken: string | null;
  readonly openTag: string | null;
  readonly mode: OnlyPreviewEntryMode;
  readonly platform: OnlyPreviewHostPlatform;
}
