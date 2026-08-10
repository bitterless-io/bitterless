import { BrowserWindow, BrowserWindowConstructorOptions, screen } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';

class LlamaWindowHelper {
  browserWindow: BrowserWindow | null = null;

  create(): BrowserWindow {
    const isDev = is.dev;

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    
    const windowWidth = Math.floor(screenWidth / 2);
    const windowHeight = Math.floor(screenHeight / 2);
    const x = 0;
    const y = screenHeight - windowHeight;

    const options: BrowserWindowConstructorOptions = {
      show: isDev,
      width: isDev ? windowWidth : 0,
      height: isDev ? windowHeight : 0,
      x: isDev ? x : undefined,
      y: isDev ? y : undefined,
      skipTaskbar: !isDev,
      title: 'Llama Worker',
      webPreferences: {
        preload: join(__dirname, '../preload/llama.js'),
        sandbox: false,
        nodeIntegration: true,
      },
    };

    this.browserWindow = new BrowserWindow(options);

    const shouldOpenDevTools =
      process.env.BITTERLESS_E2E !== '1' && import.meta.env.VITE_MODE === 'debug';
    if (shouldOpenDevTools) {
      this.browserWindow.webContents.openDevTools({ mode: 'detach' });
    }

    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      this.browserWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/llama/index.html`);
    } else {
      this.browserWindow.loadFile(join(__dirname, '../renderer/llama/index.html'));
    }

    return this.browserWindow;
  }

  destroy(): void {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      this.browserWindow.destroy();
    }
    this.browserWindow = null;
  }
}

export const llamaWindowHelper = new LlamaWindowHelper();
