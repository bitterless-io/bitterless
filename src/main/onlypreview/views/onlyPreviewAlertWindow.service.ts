import type { BaseWindow, Rectangle, WebContentsView } from 'electron';
import { webContents as electronWebContents } from 'electron';
import { xpcMain } from 'electron-xpc/main';
import type { OnlyPreviewHostCapability } from '@main/onlypreview/onlyPreviewHost.registry';
import type {
  OnlyPreviewAlertConfirmRequest,
  OnlyPreviewAlertErrorRequest,
  OnlyPreviewAlertNewFolderRequest,
  OnlyPreviewAlertProgressRequest
} from '@shared/onlypreview/onlyPreviewAlert.types';
import {
  onlyPreviewAlertViewService,
  type OnlyPreviewAlertCommitOutcome
} from './onlyPreviewAlertView.service';
import { onlyPreviewViewLayerService } from './onlyPreviewViewLayer.service';

interface AlertWindowRuntime {
  window: BaseWindow;
  host: OnlyPreviewHostCapability;
  createView: () => WebContentsView;
  loadView: (view: WebContentsView) => Promise<void>;
}

// The seam between the window helper and the alert view service, mirroring
// `OnlyPreviewGlobalSearchWindowService`: the helper owns the window and the view factory, the view
// service owns the dialog stack, and this binds the two without either importing the other.
export class OnlyPreviewAlertWindowService {
  start(runtime: AlertWindowRuntime): void {
    onlyPreviewAlertViewService.start({
      window: runtime.window,
      host: runtime.host,
      createView: runtime.createView,
      loadView: runtime.loadView,
      broadcast: (eventName, params) => xpcMain.broadcast(eventName, params),
      showInAlertLayer: (view) => {
        onlyPreviewViewLayerService.show('alert', 'alert', view);
      },
      hideAlertLayer: () => {
        onlyPreviewViewLayerService.hide('alert', 'alert');
      },
      focusedContents: () => electronWebContents.getFocusedWebContents() ?? null
    });
  }

  preload(hostToken: string): void {
    onlyPreviewAlertViewService.preload(hostToken);
  }

  isOpen(hostToken: string): boolean {
    return onlyPreviewAlertViewService.isOpen(hostToken);
  }

  updateBounds(hostToken: string, bounds: Rectangle): void {
    onlyPreviewAlertViewService.updateBounds(hostToken, bounds);
  }

  async requestNewFolder(
    hostToken: string,
    request: OnlyPreviewAlertNewFolderRequest,
    commit: (name: string) => Promise<OnlyPreviewAlertCommitOutcome>
  ): Promise<boolean> {
    return await onlyPreviewAlertViewService.requestNewFolder(hostToken, request, commit);
  }

  async requestConfirm(
    hostToken: string,
    request: OnlyPreviewAlertConfirmRequest
  ): Promise<boolean> {
    return await onlyPreviewAlertViewService.requestConfirm(hostToken, request);
  }

  showProgress(hostToken: string, request: OnlyPreviewAlertProgressRequest): string {
    return onlyPreviewAlertViewService.showProgress(hostToken, request);
  }

  updateProgress(dialogId: string, completed: number): void {
    onlyPreviewAlertViewService.updateProgress(dialogId, completed);
  }

  closeProgress(dialogId: string): void {
    onlyPreviewAlertViewService.closeProgress(dialogId);
  }

  async showError(hostToken: string, request: OnlyPreviewAlertErrorRequest): Promise<void> {
    await onlyPreviewAlertViewService.showError(hostToken, request);
  }

  destroy(): void {
    onlyPreviewAlertViewService.destroy();
  }
}

export const onlyPreviewAlertWindowService = new OnlyPreviewAlertWindowService();
