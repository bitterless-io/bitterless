export type OnlyPreviewEntryMode =
  | 'shell'
  | 'preview'
  | 'globalSearch'
  | 'alert'
  | 'settings'
  | 'guide'
  // 独立窗口占着 OnlyPreview 时,那一格 tab 上的占位页。**它不持有 hostToken** —— 这个 mode 是
  // 这条唯一的痕迹,所以它得在这里有名字。
  | 'detached';
export type OnlyPreviewHostPlatform = 'darwin' | 'win32' | 'other';
/**
 * Which kind of host carries this composite.
 *
 * Named `host` rather than `mount` deliberately: `mode` already means the renderer entry
 * (shell/preview/...), and `mode` vs `mount` differ by one letter in a file where both would appear
 * on adjacent lines. It is the mount's `kind` on the Main side.
 */
export type OnlyPreviewHostSurface = 'window' | 'cowork';

export interface OnlyPreviewEnvApi {
  readonly hostToken: string | null;
  readonly hostId: string | null;
  readonly previewRuntimeToken: string | null;
  readonly openTag: string | null;
  readonly mode: OnlyPreviewEntryMode;
  readonly platform: OnlyPreviewHostPlatform;
  /**
   * The host this surface is mounted on. Drives which window controls the Shell renders: a Cowork
   * tab has no traffic lights and no window of its own to minimize, so offering those buttons would
   * put controls on screen whose only possible behaviour is to do nothing.
   */
  readonly host: OnlyPreviewHostSurface;
}
