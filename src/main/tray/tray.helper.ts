import { Tray, Menu, nativeImage, app } from 'electron';
import { join } from 'path';
import { i18nHelper } from '../i18n/i18n.helper';
import type { MainWindowHelper } from '../windows/mainWindow.helper';
import { dialogHelper } from '../dialog/dialog.helper';

class TrayHelper {
  private tray: Tray | null = null;
  private mainWindowHelper: MainWindowHelper | null = null;

  init(mainWindowHelper: MainWindowHelper): void {
    if (process.platform !== 'win32') {
      return;
    }

    this.mainWindowHelper = mainWindowHelper;
    
    const iconPath = app.isPackaged
      ? join(process.resourcesPath, 'build', 'icon.png')
      : join(__dirname, '../../build/icon.png');
    
    const icon = nativeImage.createFromPath(iconPath);
    this.tray = new Tray(icon.resize({ width: 16, height: 16 }));
    
    this.updateMenu();
    
    this.tray.on('click', () => {
      this.showMainWindow();
    });
    
    console.log('[TrayHelper] Tray initialized');
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
