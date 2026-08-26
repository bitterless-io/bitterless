import type { WebContents } from 'electron';
import type { OnlyPreviewGlobalSearchFocusOrigin } from '@shared/onlypreview/onlyPreview.types';

interface OnlyPreviewGlobalSearchOpener {
  hostToken: string;
  origin: OnlyPreviewGlobalSearchFocusOrigin;
  webContents: WebContents;
}

export class OnlyPreviewGlobalSearchFocusService {
  private opener: OnlyPreviewGlobalSearchOpener | null = null;

  capture(
    hostToken: string,
    origin: OnlyPreviewGlobalSearchFocusOrigin,
    webContents: WebContents
  ): void {
    if (!this.opener) this.opener = { hostToken, origin, webContents };
  }

  restoreOpener(hostToken: string): boolean {
    const opener = this.opener;
    this.opener = null;
    if (
      !opener ||
      opener.hostToken !== hostToken ||
      opener.origin === 'shell' ||
      opener.webContents.isDestroyed()
    ) {
      return false;
    }
    opener.webContents.focus();
    return true;
  }

  clear(hostToken?: string): void {
    if (!hostToken || this.opener?.hostToken === hostToken) this.opener = null;
  }
}

export const onlyPreviewGlobalSearchFocusService = new OnlyPreviewGlobalSearchFocusService();
