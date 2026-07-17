import { reactive } from 'vue';
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer';
import type { MainWindowHandler } from '@main/xpc/mainWindow.handler';
import { homeEnv } from '@/contextBridge/homeEnv.bridge';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import {
  STARTUP_DIAGNOSTICS_CHANGED_EVENT,
  selectNewerStartupDiagnosticsSnapshot,
  type StartupDiagnosticIssue,
  type StartupDiagnosticStage,
} from '@shared/startup/startupDiagnostics';

const mainWindowEmitter = createXpcRendererEmitter<MainWindowHandler>('MainWindowHandler');

class MenuBarState {
  isWindows: boolean = homeEnv.platform === 'win32';
  isMac: boolean = homeEnv.platform === 'darwin';
  maximized: boolean = false;
  startupIssues: StartupDiagnosticIssue[] = [];
  startupTooltipFocused: boolean = false;
  private startupDiagnosticsRevision: number = -1;
  private isInitialized: boolean = false;

  async init(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    xpcRenderer.subscribe(STARTUP_DIAGNOSTICS_CHANGED_EVENT, (payload) => {
      this.applyStartupDiagnostics(payload.params);
    });

    try {
      const snapshot = await mainWindowEmitter.getStartupDiagnostics();
      this.applyStartupDiagnostics(snapshot);
    } catch (err) {
      console.warn('[MenuBar] Startup diagnostics unavailable:', err);
    }

    if (this.isWindows) this.maximized = await mainWindowEmitter.isMaximized();
  }

  get startupIssueCount(): number {
    return this.startupIssues.length;
  }

  get startupIssueButtonLabel(): string {
    return i18nHelper.menuBar.startupDiagnostics.buttonLabel.replace(
      '{count}',
      String(this.startupIssueCount),
    );
  }

  getStartupStageLabel(stage: StartupDiagnosticStage): string {
    return i18nHelper.menuBar.startupDiagnostics.stages[stage];
  }

  showStartupTooltipOnFocus(): void {
    this.startupTooltipFocused = true;
  }

  hideStartupTooltipOnBlur(): void {
    this.startupTooltipFocused = false;
  }

  async minimize(): Promise<void> {
    await mainWindowEmitter.minimize();
  }

  async toggleMaximize(): Promise<void> {
    await mainWindowEmitter.toggleMaximize();
    this.maximized = !this.maximized;
  }

  async close(): Promise<void> {
    await mainWindowEmitter.close();
  }

  private applyStartupDiagnostics(value: unknown): void {
    try {
      const snapshot = selectNewerStartupDiagnosticsSnapshot(
        this.startupDiagnosticsRevision,
        value,
      );
      if (!snapshot) return;
      this.startupDiagnosticsRevision = snapshot.revision;
      this.startupIssues = snapshot.issues;
    } catch (err) {
      console.warn('[MenuBar] Invalid startup diagnostics snapshot:', err);
    }
  }
}

export const menuBarStore = reactive<MenuBarState>(new MenuBarState());
