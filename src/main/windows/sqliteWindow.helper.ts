import { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { WindowHelper } from './window.helper';

class SqliteWindowHelper extends WindowHelper {
  protected preloadFile = 'sqlite.js';
  protected rendererPath = 'sqlite/index.html';
  protected windowOptions: Partial<BrowserWindowConstructorOptions> = {
    width: 800,
    height: 600,
    minWidth: 800,
    minHeight: 600,
  };

  create(): BrowserWindow {
    const win = super.create();

    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [''],
        },
      });
    });

    win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
      callback({ requestHeaders: details.requestHeaders });
    });

    return win;
  }
}

export const sqliteWindowHelper = new SqliteWindowHelper();
