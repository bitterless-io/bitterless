import { app } from 'electron';
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
import { trayHelper } from './tray/tray.helper';
import { dialogHelper } from './dialog/dialog.helper';
import './xpc/app.handler';
import { updateService } from '@main/updateHelper/update.service';
import { mcpBridgeServer } from './mcp/mcpBridge.server';
import { startBitterlessMcpStdioServer } from './mcp/mcpStdio.helper';

const isMcpHelperMode = process.argv.includes('--mcp-helper');

let isQuitting = false;
let hasShownQuitDialog = false;

const redirectConsoleToStderr = (): void => {
  const write = (level: string, args: unknown[]): void => {
    process.stderr.write(`[${level}] ${args.map((arg) => {
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }).join(' ')}\n`);
  };

  console.log = (...args: unknown[]) => write('log', args);
  console.info = (...args: unknown[]) => write('info', args);
  console.warn = (...args: unknown[]) => write('warn', args);
  console.error = (...args: unknown[]) => write('error', args);
};

function cleanupResources(): void {
  try { console.log('[app] Cleaning up resources...'); } catch {}

  try { mcpBridgeServer.stop(); } catch {}
  try { mainWindowHelper.destroy(); } catch {}
  try { sqliteWindowHelper.destroy(); } catch {}
  try { fsWindowHelper.destroy(); } catch {}
  try { llamaWindowHelper.destroy(); } catch {}
  try { connectorWindowHelper.destroy(); } catch {}
  try { omniWindowHelper.destroy(); } catch {}
  try { trayHelper.destroy(); } catch {}

  try { console.log('[app] Cleanup complete'); } catch {}
}

app.whenReady().then(async () => {
  if (isMcpHelperMode) {
    redirectConsoleToStderr();
    await startBitterlessMcpStdioServer();
    return;
  }

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

  try {
    await mcpBridgeServer.start();
  } catch (err) {
    console.warn('[app] MCP bridge failed to start:', err);
  }

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

app.on('before-quit', async (event) => {
  if (isQuitting) return;

  if (isMcpHelperMode) {
    isQuitting = true;
    return;
  }

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
