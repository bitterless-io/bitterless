import { createOnlyPreviewVueView } from '@main/miniapps/onlypreview/views/onlyPreviewVueView.service';
import { acquireIndiPreviewChromePartition } from './indiPreviewChromePartition.service';
import { View, WebContentsView, type BaseWindow, type Rectangle, type WebContents } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { is } from '@electron-toolkit/utils';
import { xpcMain } from 'electron-xpc/main';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import { onlyPreviewHostRegistry } from '@main/miniapps/onlypreview/onlyPreviewHost.registry';
import { onlyPreviewWorkspaceRegistry } from '@main/miniapps/onlypreview/onlyPreviewWorkspace.registry';
import { OnlyPreviewPreviewRegionService } from '@main/miniapps/onlypreview/views/onlyPreviewPreviewRegion.service';
import {
  configureOnlyPreviewNavigationFence,
  getOnlyPreviewRendererArguments,
  getOnlyPreviewRendererTarget
} from '@main/miniapps/onlypreview/views/onlyPreviewRendererTarget.service';
import { ONLY_PREVIEW_FIND_FOCUS_EVENT } from '@shared/onlypreview/onlyPreview.types';
import {
  isApplicationFindFocusWithin,
  registerApplicationFindDispatch
} from '@main/menu/applicationFindMenu.service';

export interface OnlyPreviewSingleFileHost {
  window: BaseWindow;
  path: string;
  /** 打开时要滚到的行。尽力而为:渲染不了行的预览器忽略它,不是错误。 */
  line?: number;
  fragment?: string;
  isOpen(): boolean;
  bounds(): Rectangle;
  attach(container: View): void;
}

/** A single-file host owns one file authority and one region, independent of the OnlyPreview singleton. */
export class OnlyPreviewSingleFileSurface {
  readonly container = new View();
  private readonly host = onlyPreviewHostRegistry.issue('standalone', 'content');
  private readonly region = new OnlyPreviewPreviewRegionService();
  private readonly chromeLease = acquireIndiPreviewChromePartition();
  private toolbar: WebContentsView | null = null;
  private disposed = false;
  private active = false;
  private readonly shortcutContents = new WeakSet<WebContents>();
  private readonly releaseFindDispatch: () => void;

  constructor(private readonly owner: OnlyPreviewSingleFileHost) {
    this.container.setVisible(false);
    this.releaseFindDispatch = registerApplicationFindDispatch((command, window) => {
      if (command !== 'find-in-file' || !this.active || !this.isLive()) return false;
      if (
        window !== this.owner.window ||
        !isApplicationFindFocusWithin(window, this.shortcutContents)
      ) return false;
      this.openFind();
      return true;
    });
  }

  async open(): Promise<void> {
    try {
      const inspected = await fileSearchWindowService.inspectTarget(this.owner.path);
      if (!this.isLive()) throw new Error('IndiPreview closed during startup.');
      const fileRef = onlyPreviewWorkspaceRegistry.registerExternalPreview(
        this.host.hostToken,
        inspected
      );
      const previewTarget = getOnlyPreviewRendererTarget('preview', __dirname);
      const toolbarPath = join(__dirname, '../renderer/filepreview/index.html');
      const toolbarBase =
        is.dev && process.env.ELECTRON_RENDERER_URL
          ? `${process.env.ELECTRON_RENDERER_URL.replace(/\/+$/, '')}/filepreview/index.html`
          : pathToFileURL(toolbarPath).href;
      const toolbarUrl = `${toolbarBase}?path=${encodeURIComponent(this.owner.path)}`;
      this.toolbar = new WebContentsView({
        webPreferences: {
          preload: join(__dirname, '../preload/onlypreview.js'),
          partition: `indipreview-${this.host.hostId}`,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          additionalArguments: getOnlyPreviewRendererArguments(
            this.host,
            'shell',
            undefined,
            undefined,
            undefined,
            undefined,
            'cowork'
          )
        }
      });
      configureOnlyPreviewNavigationFence(this.toolbar.webContents, toolbarUrl, false);
      this.bindShortcuts(this.toolbar.webContents);
      this.container.addChildView(this.toolbar);
      this.owner.attach(this.container);
      this.region.start({
        host: this.host,
        container: this.container,
        isHostLive: () => this.isLive(),
        createVuePreviewView: (runtimeToken, officeCapability, readCapability) => {
          const view = createOnlyPreviewVueView({
            host: this.host, baseDirectory: __dirname, runtimeToken,
            officeCapability, readCapability,
            partition: `indipreview-${this.host.hostId}`
          });
          this.bindShortcuts(view.webContents);
          return view;
        },
        loadVuePreviewView: (view) => view.webContents.loadURL(previewTarget.url),
        // The Chrome protocol admits one file token per session; concurrent windows cannot share it.
        chromePartition: this.chromeLease.partition,
        bindChromeShortcuts: (contents) => this.bindShortcuts(contents)
      });
      this.refresh();
      await this.toolbar.webContents.loadURL(toolbarUrl);
      if (!this.isLive()) throw new Error('IndiPreview closed during startup.');
      await this.region.present(this.host.hostToken, fileRef, undefined, { line: this.owner.line, fragment: this.owner.fragment });
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  setActive(active: boolean): void {
    if (!this.isLive()) return;
    this.active = active;
    this.container.setVisible(active);
    if (active) {
      this.refresh();
      this.region.focusActiveContent(this.host.hostToken);
    }
  }


  refresh(): void {
    if (!this.isLive()) return;
    const bounds = this.owner.bounds();
    this.container.setBounds(bounds);
    const toolbarHeight = Math.min(32, bounds.height);
    this.toolbar?.setBounds({ x: 0, y: 0, width: bounds.width, height: toolbarHeight });
    this.region.updateBounds(this.host.hostToken, {
      x: 0,
      y: toolbarHeight,
      width: bounds.width,
      height: Math.max(0, bounds.height - toolbarHeight)
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseFindDispatch();
    this.region.destroy();
    this.chromeLease.release(this.region.waitForChromeDisposal());
    onlyPreviewHostRegistry.revoke(this.host.hostToken);
    if (this.toolbar && !this.toolbar.webContents.isDestroyed()) this.toolbar.webContents.close();
    this.toolbar = null;
    if (!this.owner.window.isDestroyed())
      this.owner.window.contentView.removeChildView(this.container);
  }

  private isLive(): boolean {
    return !this.disposed && this.owner.isOpen() && !this.owner.window.isDestroyed();
  }

  private bindShortcuts(contents: WebContents): void {
    this.shortcutContents.add(contents);
    contents.on('before-input-event', (event, input) => {
      if (!this.active || input.type !== 'keyDown' || event.defaultPrevented || input.isComposing) return;
      const command = process.platform === 'darwin' ? input.meta : input.control;
      const key = input.key.toLowerCase();
      if (command && !input.alt && !input.shift && key === 'f') {
        event.preventDefault();
        if (!input.isAutoRepeat) this.openFind();
      } else if (command && !input.alt && !input.shift && key === 'w') {
        event.preventDefault();
        this.owner.window.close();
      } else if (key === 'escape' && this.region.isFindOpen(this.host.hostToken)) {
        event.preventDefault();
        this.region.closeFind(this.host.hostToken);
        this.region.focusActiveContent(this.host.hostToken);
      }
    });
  }

  private openFind(): void {
    const opened = this.region.openFind(this.host.hostToken);
    if (opened) this.toolbar?.webContents.focus();
    xpcMain.broadcast(ONLY_PREVIEW_FIND_FOCUS_EVENT, { hostId: this.host.hostId });
  }
}
