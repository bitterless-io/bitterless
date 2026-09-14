import { XpcMainHandler } from 'electron-xpc/main';
import { maestroWindowHelper } from '@maestro-main/windows/main/maestroWindow.controller';
import type { BrowserHistoryPopupApi, BrowserHistoryPopupRequest, BrowserHistoryPopupSnapshot } from '@maestro-shared/browserHistoryPopup.api';

export class BrowserHistoryPopupHandler extends XpcMainHandler implements BrowserHistoryPopupApi {
  async show(params: BrowserHistoryPopupRequest): Promise<void> { await maestroWindowHelper.historyView.show(params); }
  async hide(params: { sessionId: string }): Promise<void> { maestroWindowHelper.historyView.hide(params.sessionId); }
  async addressBlur(params: { sessionId: string }): Promise<void> { maestroWindowHelper.historyView.addressBlur(params.sessionId); }
  async snapshot(): Promise<BrowserHistoryPopupSnapshot> { return maestroWindowHelper.historyView.snapshot(); }
  async mounted(params: { token: string }): Promise<void> { maestroWindowHelper.historyView.mounted(params.token); }
  async action(params: Parameters<BrowserHistoryPopupApi['action']>[0]): Promise<void> { await maestroWindowHelper.historyView.action(params); }
}

export const browserHistoryPopupHandler = new BrowserHistoryPopupHandler();
