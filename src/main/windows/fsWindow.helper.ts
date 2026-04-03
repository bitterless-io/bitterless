import { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { WindowHelper } from './window.helper';

class FsWindowHelper extends WindowHelper {
  protected preloadFile = 'fs.js';
  protected rendererPath = 'fs/index.html';
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

export const fsWindowHelper = new FsWindowHelper();
