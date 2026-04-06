import { Tray, Menu, nativeImage, app } from 'electron';
import { join } from 'path';
import { i18nHelper } from '../i18n/i18n.helper';
import type { MainWindowHelper } from '../windows/mainWindow.helper';
import { dialogHelper } from '../dialog/dialog.helper';

class TrayHelper {
  private tray: Tray | null = null;
  private mainWindowHelper: MainWindowHelper | null = null;

  init(mainWindowHelper: MainWindowHelper): void {
    if (process.platform !== 'win32' && process.platform !== 'darwin') {
      return;
    }

    this.mainWindowHelper = mainWindowHelper;

    const isWin = process.platform === 'win32';
    let iconPath: string;

    if (app.isPackaged) {
      const unpacked = join(app.getAppPath(), '..', 'app.asar.unpacked', 'icons');
      iconPath = isWin ? join(unpacked, 'icon.ico') : join(unpacked, 'icon.png');
    } else {
      iconPath = join(__dirname, '../../build', isWin ? 'icon.ico' : 'icon.png');
    }

    let icon = nativeImage.createFromPath(iconPath);
    if (process.platform === 'darwin') {
      icon = icon.resize({ width: 16, height: 16 });
    }

    this.tray = new Tray(icon);

    this.updateMenu();

    this.tray.on('click', () => {
      this.showMainWindow();
    });

    console.log('[TrayHelper] Tray initialized, iconPath:', iconPath);
  }

  updateMenu(): void {
    if (!this.tray) return;
    
    const messages = i18nHelper.getMessages();
    const contextMenu = Menu.buildFromTemplate([
      {
        label: messages.app.show,
        click: () => this.showMainWindow(),
      },
      {
        type: 'separator',
      },
      {
        label: messages.app.quit,
        click: () => this.requestQuit(),
      },
    ]);
    
    this.tray.setContextMenu(contextMenu);
    this.tray.setToolTip('Bitterless');
  }

  private showMainWindow(): void {
    if (this.mainWindowHelper) {
      this.mainWindowHelper.show();
    }
  }

  private async requestQuit(): Promise<void> {
    const shouldQuit = await dialogHelper.showQuitConfirmDialog();
    if (shouldQuit) {
      app.quit();
    }
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

export const trayHelper = new TrayHelper();
