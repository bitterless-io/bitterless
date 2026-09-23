import { reactive } from 'vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type { DownloadSettingsApi, DownloadSettingsSnapshot } from '@shared/downloads/downloadSettings.api';

// The cast is load-bearing, same as `lanAddress.store.ts`: `XpcEmitterOf<T>` erases the return type
// of every zero-arg method to `Promise<any>`, and every method on this contract is zero-arg.
const downloadSettingsEmitter = createXpcRendererEmitter<DownloadSettingsApi>(
  'DownloadSettingsHandler'
) as DownloadSettingsApi;

/**
 * electron-xpc answers `null` instead of throwing — for an unregistered channel (a dropped
 * `import './downloadSettings.handler'`) and for a handler that threw. Stored as-is that renders
 * exactly like "not loaded yet", so anything that is not a snapshot becomes `failed`.
 */
const isSnapshot = (reply: unknown): reply is DownloadSettingsSnapshot =>
  Boolean(reply) && typeof (reply as DownloadSettingsSnapshot).effective === 'string';

/**
 * Settings → General → Downloads (docs/features/browser-downloads.md #1.1).
 *
 * A SEPARATE store from `generalSetting.store.ts` for the same reason as `lanAddress.store.ts`:
 * `loadSettings()` awaits preload-backed emitters the Maestro workbench preload never registers.
 * This one talks only to a MAIN handler, which every surface rendering this pane can reach.
 */
class DownloadSettingState {
  snapshot: DownloadSettingsSnapshot | null = null;
  busy = false;
  failed = false;

  /** Label above the path: "Download folder" only when the operator actually picked one. */
  get folderLabel(): string {
    const copy = i18nHelper.setting.general.downloads;
    return this.snapshot?.configured ? copy.folder : copy.systemFolder;
  }

  /** Non-empty only when a configured folder is currently unusable. */
  get unavailableMessage(): string {
    if (!this.snapshot?.unavailable) return '';
    return i18nHelper.setting.general.downloads.unavailable.replace('{path}', this.snapshot.configured);
  }

  /** Re-read on every mount: the folder can vanish (a drive unplugged) while the pane is closed. */
  async load(): Promise<void> {
    await this.run(() => downloadSettingsEmitter.state());
  }

  async choose(): Promise<void> {
    await this.run(() => downloadSettingsEmitter.choose());
  }

  async reset(): Promise<void> {
    await this.run(() => downloadSettingsEmitter.reset());
  }

  async reveal(): Promise<void> {
    try {
      await downloadSettingsEmitter.reveal();
    } catch (err) {
      console.error('[DownloadSettingState] reveal failed:', err);
    }
  }

  private async run(call: () => Promise<DownloadSettingsSnapshot>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const reply = await call();
      this.failed = !isSnapshot(reply);
      if (isSnapshot(reply)) this.snapshot = reply;
      else console.error('[DownloadSettingState] download settings xpc returned no snapshot', reply);
    } catch (err) {
      console.error('[DownloadSettingState] download settings xpc failed:', err);
      this.failed = true;
    } finally {
      this.busy = false;
    }
  }
}

// Method shorthand only — an arrow class field's `this` is the raw instance and bypasses the
// `reactive()` proxy (stuck spinner, value that never renders).
export const downloadSettingStore = reactive(new DownloadSettingState());
