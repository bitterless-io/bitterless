import { XpcMainHandler } from 'electron-xpc/main';
import { maestroWindowHelper } from '@maestro-main/windows/main/maestroWindow.controller';
import type { BrowserHistoryPopupApi, BrowserHistoryPopupSnapshot, BrowserHistoryPopupAction } from '@maestro-shared/browserHistoryPopup.api';

export class BrowserHistoryPopupHandler extends XpcMainHandler implements BrowserHistoryPopupApi {
  async update(params: BrowserHistoryPopupSnapshot): Promise<boolean> { return maestroWindowHelper.historyView.update(params); }
  async hide(params: { session: number }): Promise<void> { maestroWindowHelper.historyView.hide(params.session); }
  async blur(): Promise<void> { maestroWindowHelper.historyView.blur(); }
  async snapshot(): Promise<BrowserHistoryPopupSnapshot | null> { return maestroWindowHelper.historyView.snapshot(); }
  async action(params: BrowserHistoryPopupAction): Promise<void> { maestroWindowHelper.historyView.action(params); }
  async focusHost(): Promise<void> { maestroWindowHelper.historyView.focusHost(); }
}

export const browserHistoryPopupHandler = new BrowserHistoryPopupHandler();
