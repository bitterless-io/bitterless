import { app, BrowserWindow } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import { packageMainHelper } from '../shared/packageHelper/main/package.helper';
import { pathMainHelper } from '../shared/pathHelper/main/pathMain.helper';
import { mainWindowHelper } from './windows/mainWindow.helper';
import { sqliteWindowHelper } from './windows/sqliteWindow.helper';
import { connectorWindowHelper } from './windows/connectorWindow.helper';
import { initXpc } from './xpc/xpc.helper';
import { initDirectory } from './directoryHelper/directory.helper';
import { llamaWindowHelper } from './windows/llamaWindow.helper';
import { fsWindowHelper } from './windows/fsWindow.helper';
import { omniWindowHelper } from './windows/omniWindow.helper';
import * as path from 'path';
import { trayHelper } from './tray/tray.helper';
import { dialogHelper } from './dialog/dialog.helper';
import './xpc/app.handler';
import { updateService } from '@main/updateHelper/update.service';

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron');
  if (process.platform === 'darwin') {
    app.dock.setBadge('');
  }
  initXpc();

  packageMainHelper.init();
  pathMainHelper.init();
  initDirectory();

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // 先启动 SQLite 进程并等待其准备就绪
  const sqliteWindow = sqliteWindowHelper.create();
  await new Promise<void>((resolve) => {
    sqliteWindow.webContents.on('did-finish-load', () => {
      resolve();
    });
  });

  // 启动 FS 进程
  fsWindowHelper.create();

  // SQLite 进程准备就绪后，再启动主窗口和其他窗口
  // llamaWindowHelper.create();
  mainWindowHelper.create();
  // connectorWindowHelper.create();

  // 初始化系统托盘 (仅 Windows)
  trayHelper.init(mainWindowHelper);

  app.on('activate', () => {
    // macOS: 点击 dock 图标显示主窗口
    mainWindowHelper.show();
  });
});

let isQuitting = false;

let hasShownQuitDialog = false;

function cleanupResources(): void {
  console.log('[app] Cleaning up resources...');

  try {
    mainWindowHelper.destroy();
  } catch (err) {
    console.error('[app] Error destroying mainWindow:', err);
  }

  try {
    sqliteWindowHelper.destroy();
  } catch (err) {
    console.error('[app] Error destroying sqliteWindow:', err);
  }

  try {
    fsWindowHelper.destroy();
  } catch (err) {
    console.error('[app] Error destroying fsWindow:', err);
  }

  try {
    llamaWindowHelper.destroy();
  } catch (err) {
    console.error('[app] Error destroying llamaWindow:', err);
  }

  try {
    connectorWindowHelper.destroy();
  } catch (err) {
    console.error('[app] Error destroying connectorWindow:', err);
  }

  try {
    omniWindowHelper.destroy();
  } catch (err) {
    console.error('[app] Error destroying omniWindow:', err);
  }

  try {
    trayHelper.destroy();
  } catch (err) {
    console.error('[app] Error destroying tray:', err);
  }

  console.log('[app] Cleanup complete');
}

app.on('before-quit', async (event) => {
  if (isQuitting) return;

  // 新增：如果是更新导致的退出，直接放行
  if (updateService.isUpdating) {
    isQuitting = true;
    cleanupResources();
    return;   // 不要 preventDefault，让 quitAndInstall 继续执行
  }

  if (process.platform === 'darwin' && !hasShownQuitDialog) {
    event.preventDefault();
    hasShownQuitDialog = true;

    const shouldQuit = await dialogHelper.showQuitConfirmDialog();
    if (shouldQuit) {
      isQuitting = true;
      cleanupResources();
      app.exit(0);
    } else {
      hasShownQuitDialog = false;
    }
    return;
  }

  // Windows: 正常退出流程，清理资源后放行
  if (process.platform !== 'darwin') {
    isQuitting = true;
    cleanupResources();
  }
});

app.on('will-quit', () => {
  // 更新和正常退出均不干预，让系统正常退出
});

app.on('window-all-closed', () => {
  // 不自动退出，保留 tray 功能，由用户主动触发退出
});
