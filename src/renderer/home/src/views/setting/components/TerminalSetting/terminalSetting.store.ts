import { reactive } from 'vue';
import { Message } from '@arco-design/web-vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import {
  ZELLIJ_HANDLER_NAME,
  type ZellijApi,
  type ZellijErrorCode,
  type ZellijSnapshot
} from '@shared/zellij/zellij.type';

const api = createXpcRendererEmitter<ZellijApi>(ZELLIJ_HANDLER_NAME);

class TerminalSettingState {
  loading = false;
  saving = false;
  ready = false;
  error: ZellijErrorCode | null = null;
  configDirectory = '';
  revision = '';
  draft = { splitDown: '', splitRight: '', closePane: '' };

  get errorMessage(): string | null {
    return this.error ? i18nHelper.zellij.errors[this.error] : null;
  }

  private apply(snapshot: ZellijSnapshot): void {
    if (!snapshot?.shortcuts || typeof snapshot.configRevision !== 'string') {
      throw new Error('Invalid terminal settings response');
    }
    this.configDirectory = snapshot.configDirectory;
    this.draft = { ...snapshot.shortcuts };
    this.revision = snapshot.configRevision;
    this.ready = Boolean(snapshot.configRevision);
    // Server/session errors belong to the terminal surface; this page only reports config errors.
    this.error =
      !snapshot.configRevision || (snapshot.error && /^(config|shortcut)-/.test(snapshot.error))
        ? snapshot.error
        : null;
  }

  async load(): Promise<void> {
    if (this.loading || this.saving) return;
    this.loading = true;
    this.ready = false;
    this.error = null;
    try {
      // Shared settings are independent of any terminal surface and never start a session.
      this.apply(await api.snapshot({ surfaceId: '' }));
    } catch (error) {
      console.error('[TerminalSetting] Failed to load settings:', error);
      this.error = 'operation-failed';
    } finally {
      this.loading = false;
    }
  }

  async save(): Promise<void> {
    if (!this.ready || this.saving || this.loading) return;
    this.saving = true;
    this.error = null;
    try {
      const next = await api.saveShortcuts({
        revision: this.revision,
        shortcuts: { ...this.draft }
      });
      if (next?.error) this.error = next.error;
      else {
        this.apply(next);
        Message.success(i18nHelper.zellij.saved);
      }
    } catch (error) {
      console.error('[TerminalSetting] Failed to save shortcuts:', error);
      this.error = 'operation-failed';
    } finally {
      this.saving = false;
    }
  }

  async copyDirectory(): Promise<void> {
    this.error = null;
    try {
      const result = await api.copyConfigDirectory();
      if (!result?.ok) this.error = result?.error ?? 'operation-failed';
      else Message.success(i18nHelper.zellij.copied);
    } catch (error) {
      console.error('[TerminalSetting] Failed to copy configuration directory:', error);
      this.error = 'operation-failed';
    }
  }

  async openDirectory(): Promise<void> {
    this.error = null;
    try {
      const result = await api.openConfigDirectory();
      if (!result?.ok) this.error = result?.error ?? 'directory-open-failed';
    } catch (error) {
      console.error('[TerminalSetting] Failed to open configuration directory:', error);
      this.error = 'directory-open-failed';
    }
  }
}

export const terminalSettingStore = reactive<TerminalSettingState>(new TerminalSettingState());
