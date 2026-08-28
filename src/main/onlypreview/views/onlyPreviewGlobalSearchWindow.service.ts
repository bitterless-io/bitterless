import type { BaseWindow, Rectangle, WebContents, WebContentsView } from 'electron';
import { xpcMain } from 'electron-xpc/main';
import type { OnlyPreviewGlobalSearchFocusOrigin } from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewHostCapability } from '@main/onlypreview/onlyPreviewHost.registry';
import { onlyPreviewGlobalSearchFocusService } from '@main/onlypreview/onlyPreviewGlobalSearchFocus.service';
import { onlyPreviewPreviewRegionService } from './onlyPreviewPreviewRegion.service';
import { onlyPreviewGlobalSearchViewService } from './onlyPreviewGlobalSearchView.service';

interface GlobalSearchWindowRuntime {
  window: BaseWindow;
  host: OnlyPreviewHostCapability;
  shellView: WebContentsView;
  isCurrent: () => boolean;
  createView: () => WebContentsView;
  loadView: (view: WebContentsView) => Promise<void>;
}

export class OnlyPreviewGlobalSearchWindowService {
  start(runtime: GlobalSearchWindowRuntime): void {
    onlyPreviewGlobalSearchViewService.start({
      window: runtime.window,
      host: runtime.host,
      createView: runtime.createView,
      loadView: runtime.loadView,
      broadcast: (eventName, params) => xpcMain.broadcast(eventName, params),
      restoreOpener: () =>
        onlyPreviewGlobalSearchFocusService.restoreOpener(runtime.host.hostToken),
      clearOpener: () => onlyPreviewGlobalSearchFocusService.clear(runtime.host.hostToken),
      focusProject: () => {
        if (!runtime.isCurrent() || runtime.shellView.webContents.isDestroyed()) return false;
        runtime.shellView.webContents.focus();
        return true;
      },
      focusPreview: () =>
        onlyPreviewPreviewRegionService.focusActiveContent(runtime.host.hostToken)
    });
  }

  open(
    host: OnlyPreviewHostCapability,
    origin: OnlyPreviewGlobalSearchFocusOrigin | 'search',
    opener: WebContents
  ): void {
    if (origin !== 'search') {
      onlyPreviewGlobalSearchFocusService.capture(host.hostToken, origin, opener);
    }
    onlyPreviewGlobalSearchViewService.show(
      host.hostToken,
      origin === 'search' ? 'shell' : origin
    );
  }

  closeForFind(hostToken: string): void {
    if (onlyPreviewGlobalSearchViewService.isActive(hostToken)) {
      onlyPreviewGlobalSearchViewService.close(hostToken, 'discard');
    }
  }

  updateBounds(hostToken: string, bounds: Rectangle): void {
    onlyPreviewGlobalSearchViewService.updateBounds(hostToken, bounds);
  }

  raiseAfterPreviewAttach(hostToken: string): void {
    onlyPreviewGlobalSearchViewService.raiseAfterPreviewAttach(hostToken);
  }

  destroy(): void {
    onlyPreviewGlobalSearchViewService.destroy();
  }
}

export const onlyPreviewGlobalSearchWindowService =
  new OnlyPreviewGlobalSearchWindowService();
