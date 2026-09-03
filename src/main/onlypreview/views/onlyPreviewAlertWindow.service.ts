import type { BaseWindow, Rectangle, WebContentsView } from 'electron';
import { webContents as electronWebContents } from 'electron';
import { xpcMain } from 'electron-xpc/main';
import type { OnlyPreviewHostCapability } from '@main/onlypreview/onlyPreviewHost.registry';
import type {
  OnlyPreviewAlertConfirmRequest,
  OnlyPreviewAlertErrorRequest,
  OnlyPreviewAlertNewFolderRequest
} from '@shared/onlypreview/onlyPreviewAlert.types';
import { onlyPreviewAlertViewService } from './onlyPreviewAlertView.service';
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

  async requestNewFolderName(
    hostToken: string,
    request: OnlyPreviewAlertNewFolderRequest
  ): Promise<string | null> {
    return await onlyPreviewAlertViewService.requestNewFolder(hostToken, request);
  }

  async requestConfirm(
    hostToken: string,
    request: OnlyPreviewAlertConfirmRequest
  ): Promise<boolean> {
    return await onlyPreviewAlertViewService.requestConfirm(hostToken, request);
  }

  async showError(hostToken: string, request: OnlyPreviewAlertErrorRequest): Promise<void> {
    await onlyPreviewAlertViewService.showError(hostToken, request);
  }

  destroy(): void {
    onlyPreviewAlertViewService.destroy();
  }
}

export const onlyPreviewAlertWindowService = new OnlyPreviewAlertWindowService();
