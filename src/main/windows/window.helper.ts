import { BrowserWindow, BrowserWindowConstructorOptions, shell, screen } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';

export abstract class WindowHelper {
  browserWindow: BrowserWindow | null = null;
  private isQuitting = false;

  protected abstract preloadFile: string;
  protected abstract rendererPath: string;
  protected abstract windowOptions: Partial<BrowserWindowConstructorOptions>;

  create(): BrowserWindow {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    
    const windowWidth = Math.floor(screenWidth / 2);
    const windowHeight = Math.floor(screenHeight / 2);
    const x = 0;
    const y = screenHeight - windowHeight;

    const options: BrowserWindowConstructorOptions = {
      show: false,
      autoHideMenuBar: true,
      ...this.windowOptions,
      width: windowWidth,
      height: windowHeight,
      x: x,
      y: y,
      webPreferences: {
        preload: join(__dirname, `../preload/${this.preloadFile}`),
        sandbox: false,
        ...this.windowOptions.webPreferences,
      },
    };

    this.browserWindow = new BrowserWindow(options);

    this.browserWindow.on('ready-to-show', () => {
      this.browserWindow?.show();
      const shouldOpenDevTools = import.meta.env.VITE_ENV === 'dev' || import.meta.env.VITE_MODE === 'debug';
      if (shouldOpenDevTools) {
        this.browserWindow?.webContents.openDevTools();
      }
    });

    this.browserWindow.on('close', (event) => {
      if (this.browserWindow && !this.browserWindow.isDestroyed() && !this.isQuitting) {
        event.preventDefault();
        this.browserWindow.hide();
      }
    });

    this.browserWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url);
      return { action: 'deny' };
    });

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.browserWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${this.rendererPath}`);
    } else {
      this.browserWindow.loadFile(join(__dirname, `../renderer/${this.rendererPath}`));
    }

    return this.browserWindow;
  }

  show(): void {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      if (this.browserWindow.isMinimized()) {
        this.browserWindow.restore();
      }
      this.browserWindow.show();
      this.browserWindow.focus();
    }
  }

  hide(): void {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      this.browserWindow.hide();
    }
  }

  destroy(): void {
    this.isQuitting = true;
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      this.browserWindow.destroy();
      this.browserWindow = null;
    }
  }
}
