import { BrowserWindow, session } from 'electron';
import {
  isAllowedClaudeAuthNavigation,
  resolveClaudeLoopbackCallbackFence
} from './claudeAuth.navigation';

export interface OpenClaudeAuthBrowserInput {
  partition: string;
  authorizationUrl: URL;
  onClosed(): void;
  onFailed(): void;
}

export interface ClaudeAuthBrowserSession {
  close(): void;
}

export interface ClaudeAuthBrowserFactory {
  open(input: OpenClaudeAuthBrowserInput): ClaudeAuthBrowserSession;
  clear(partition: string): Promise<void>;
}

const ACCOUNT_PARTITION_PATTERN =
  /^persist:bitterless-claude-account-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const assertManagedPartition = (partition: string): void => {
  if (!ACCOUNT_PARTITION_PATTERN.test(partition)) {
    throw new Error('Refusing to use a non-managed Claude account partition.');
  }
};

export class ElectronClaudeAuthBrowserFactory implements ClaudeAuthBrowserFactory {
  open(input: OpenClaudeAuthBrowserInput): ClaudeAuthBrowserSession {
    assertManagedPartition(input.partition);
    const callbackFence = resolveClaudeLoopbackCallbackFence(input.authorizationUrl);
    if (!isAllowedClaudeAuthNavigation(input.authorizationUrl.href, callbackFence)) {
      throw new Error('Refusing to open an untrusted Claude authorization page.');
    }

    const browserSession = session.fromPartition(input.partition);
    const preventDownload = (event: Electron.Event, item: Electron.DownloadItem): void => {
      event.preventDefault();
      item.cancel();
    };
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false)
    );
    browserSession.on('will-download', preventDownload);
    const cleanupSession = (): void => {
      browserSession.off('will-download', preventDownload);
      browserSession.setPermissionCheckHandler(null);
      browserSession.setPermissionRequestHandler(null);
    };

    let window: BrowserWindow;
    try {
      window = new BrowserWindow({
        width: 820,
        height: 720,
        minWidth: 640,
        minHeight: 520,
        show: false,
        title: 'Claude subscription sign-in',
        autoHideMenuBar: true,
        backgroundColor: '#F8FAFA',
        webPreferences: {
          partition: input.partition,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInWorker: false,
          nodeIntegrationInSubFrames: false,
          webSecurity: true,
          webviewTag: false,
          allowRunningInsecureContent: false,
          devTools: false
        }
      });
    } catch (error) {
      cleanupSession();
      throw error;
    }
    window.setMenuBarVisibility(false);

    let reportedFailure = false;
    const fail = (): void => {
      if (reportedFailure || window.isDestroyed()) return;
      reportedFailure = true;
      input.onFailed();
      if (!window.isDestroyed()) window.destroy();
    };
    const fenceNavigation = (event: Electron.Event, target: string): void => {
      if (!isAllowedClaudeAuthNavigation(target, callbackFence)) event.preventDefault();
    };
    const fenceMainFrameRedirect = (
      event: Electron.Event,
      target: string,
      _isInPlace: boolean,
      isMainFrame: boolean
    ): void => {
      if (isMainFrame) fenceNavigation(event, target);
    };
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.webContents.on('will-navigate', fenceNavigation);
    window.webContents.on('will-redirect', fenceMainFrameRedirect);
    window.webContents.on(
      'did-fail-load',
      (_event, errorCode, _description, _validatedUrl, isMainFrame) => {
        if (isMainFrame && errorCode !== -3) fail();
      }
    );
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.show();
    });
    window.once('closed', () => {
      cleanupSession();
      input.onClosed();
    });
    void window.loadURL(input.authorizationUrl.href).catch(fail);

    return {
      close: () => {
        if (!window.isDestroyed()) window.destroy();
      }
    };
  }

  async clear(partition: string): Promise<void> {
    assertManagedPartition(partition);
    await session.fromPartition(partition).clearStorageData();
  }
}
