import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  cloneDefaultOnlyPreviewSettings,
  OnlyPreviewContractError,
  unwrapOnlyPreviewResult
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_SETTINGS_CHANGED_EVENT,
  type OnlyPreviewSettings
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { getOnlyPreviewErrorMessage, onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import type { OnlyPreviewSettingsCategory } from './onlyPreviewSettings.type';

class OnlyPreviewSettingsStore {
  committed: OnlyPreviewSettings = cloneDefaultOnlyPreviewSettings();
  draft: OnlyPreviewSettings = cloneDefaultOnlyPreviewSettings();
  loading = false;
  saving = false;
  errorMessage = '';
  activeCategory: OnlyPreviewSettingsCategory = 'preview';
  private initialized = false;

  get dirty(): boolean {
    return JSON.stringify(this.draft) !== JSON.stringify(this.committed);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    xpcRenderer.subscribe(ONLY_PREVIEW_SETTINGS_CHANGED_EVENT, () => {
      if (!this.dirty && !this.saving) void this.load();
    });
    await this.load();
  }

  setEditorFontSize(value: number | undefined): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    this.draft.editorFontSize = Math.round(Math.min(24, Math.max(11, value)));
  }

  setWordWrap(value: boolean | string | number): void {
    this.draft.wordWrap = value === true;
  }

  setOpenFilesWithSingleClick(value: boolean | string | number): void {
    this.draft.openFilesWithSingleClick = value === true;
  }

  selectCategory(category: OnlyPreviewSettingsCategory): void {
    this.activeCategory = category;
  }

  async save(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken || this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    try {
      const settings = unwrapOnlyPreviewResult(
        await onlyPreviewClient.saveSettings({
          hostToken,
          settings: { ...this.draft }
        })
      );
      this.committed = { ...settings };
      this.draft = { ...settings };
      await this.close();
    } catch (error) {
      this.errorMessage =
        error instanceof OnlyPreviewContractError
          ? getOnlyPreviewErrorMessage(error.code)
          : onlyPreviewI18n.settings.saveFailed;
    } finally {
      this.saving = false;
    }
  }

  async cancel(): Promise<void> {
    this.draft = { ...this.committed };
    await this.close();
  }

  private async load(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) {
      this.errorMessage = onlyPreviewI18n.errors.HOST_NOT_FOUND;
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    try {
      const settings = unwrapOnlyPreviewResult(await onlyPreviewClient.getSettings({ hostToken }));
      this.committed = { ...settings };
      this.draft = { ...settings };
    } catch {
      this.errorMessage = onlyPreviewI18n.settings.loadFailed;
    } finally {
      this.loading = false;
    }
  }

  private async close(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    try {
      unwrapOnlyPreviewResult(await onlyPreviewClient.closeSettings({ hostToken }));
    } catch (error) {
      this.errorMessage =
        error instanceof OnlyPreviewContractError
          ? getOnlyPreviewErrorMessage(error.code)
          : onlyPreviewI18n.errors.OPERATION_FAILED;
    }
  }
}

export const onlyPreviewSettingsStore = reactive<OnlyPreviewSettingsStore>(
  new OnlyPreviewSettingsStore()
);
