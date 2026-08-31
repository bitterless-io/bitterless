// The OnlyPreview asset registry imports Electron's `net` so `network` delivery can hand a file to
// Chromium instead of reading it in Main. Unit bundles cannot load the real `electron` module, and
// the suites that use this stub only exercise `stream` delivery, so calling it is a test defect.
export const net = {
  fetch: async () => {
    throw new Error('net.fetch is unavailable in OnlyPreview unit-test bundles');
  }
};

export const clipboard = {
  writeText: () => {
    throw new Error('clipboard.writeText must be injected in OnlyPreview unit-test bundles');
  }
};

export const app = { isPackaged: false };
export const session = {};
export const ipcMain = {};
export class BrowserWindow {}
export class MessageChannelMain {}
export const utilityProcess = {};
export const webContents = {};
