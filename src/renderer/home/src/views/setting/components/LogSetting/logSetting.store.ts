import { reactive } from 'vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type {
  ApplicationDiagnosticDirectoryKey,
  ApplicationDiagnosticsApi,
  ApplicationDiagnosticsSnapshot
} from '@shared/diagnostics/applicationDiagnostics.contract';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

const diagnosticsEmitter =
  createXpcRendererEmitter<ApplicationDiagnosticsApi>('DiagnosticsHandler');

type LogSettingError = '' | 'load' | 'open' | 'directory-not-created';

class LogSettingState {
  loading = false;
  openingKey: ApplicationDiagnosticDirectoryKey | null = null;
  snapshot: ApplicationDiagnosticsSnapshot | null = null;
  error: LogSettingError = '';

  get errorMessage(): string {
    if (this.error === 'load') return i18nHelper.setting.log.loadFailed;
    if (this.error === 'directory-not-created') {
      return i18nHelper.setting.log.directoryNotCreated;
    }
    if (this.error === 'open') return i18nHelper.setting.log.openFailed;
    return '';
  }

  async init(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.error = '';
    try {
      this.snapshot = await diagnosticsEmitter.getSnapshot();
    } catch (error) {
      this.error = 'load';
      console.error('[LogSettingState] Failed to load diagnostics:', error);
    } finally {
      this.loading = false;
    }
  }

  async openDirectory(key: ApplicationDiagnosticDirectoryKey): Promise<void> {
    if (this.openingKey) return;
    this.openingKey = key;
    this.error = '';
    try {
      const result = await diagnosticsEmitter.openDirectory({ key });
      if (!result.ok) {
        this.error = result.error === 'directory-not-created' ? 'directory-not-created' : 'open';
      }
    } catch (error) {
      this.error = 'open';
      console.error('[LogSettingState] Failed to open directory:', error);
    } finally {
      this.openingKey = null;
    }
  }
}

export const logSettingStore = reactive<LogSettingState>(new LogSettingState());
