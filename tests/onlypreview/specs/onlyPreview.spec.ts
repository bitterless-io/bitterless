import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import sharp from 'sharp';
import {
  expect,
  test,
  type OnlyPreviewE2ESession,
  type OnlyPreviewRendererMode
} from '../fixtures/onlyPreviewApp.fixture';

const screenshotRoot = resolve('out/playwright/onlypreview/screenshots');
const ONLY_PREVIEW_ROYAL_BLUE = [0x4e, 0x58, 0x82] as const;
const NATIVE_MENU_BAR_RGB_TOLERANCE = 12;
const NATIVE_MENU_BAR_REQUIRED_MATCH_RATIO = 0.75;

const matchesOnlyPreviewRoyalBlue = (red: number, green: number, blue: number): boolean =>
  Math.abs(red - ONLY_PREVIEW_ROYAL_BLUE[0]) <= NATIVE_MENU_BAR_RGB_TOLERANCE &&
  Math.abs(green - ONLY_PREVIEW_ROYAL_BLUE[1]) <= NATIVE_MENU_BAR_RGB_TOLERANCE &&
  Math.abs(blue - ONLY_PREVIEW_ROYAL_BLUE[2]) <= NATIVE_MENU_BAR_RGB_TOLERANCE;

const execFileAsync = async (file: string, args: string[]): Promise<void> => {
  await new Promise<void>((resolveExec, rejectExec) => {
    execFile(file, args, (error) => (error ? rejectExec(error) : resolveExec()));
  });
};

const clickTreeFile = async (session: OnlyPreviewE2ESession, name: string): Promise<void> => {
  const clicked = await session.evaluateRenderer<boolean>(
    'shell',
    `(() => {
    const row = Array.from(document.querySelectorAll('[name="onlypreview__treeRow"]'))
      .find((candidate) => candidate.textContent?.trim().endsWith(${JSON.stringify(name)}));
    if (!(row instanceof HTMLButtonElement)) return false;
    row.click();
    return true;
  })()`
  );
  expect(clicked).toBe(true);
};

const dispatchTreeDoubleClick = async (
  session: OnlyPreviewE2ESession,
  name: string,
  intervalMs = 300
): Promise<void> => {
  const dispatched = await session.evaluateRenderer<boolean>(
    'shell',
    `(async () => {
      const row = Array.from(document.querySelectorAll('[name="onlypreview__treeRow"]'))
        .find((candidate) => candidate.textContent?.trim().endsWith(${JSON.stringify(name)}));
      if (!(row instanceof HTMLButtonElement)) return false;
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      await new Promise((resolve) => setTimeout(resolve, ${intervalMs}));
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
      return true;
    })()`
  );
  expect(dispatched).toBe(true);
};

const resetSelectionBroadcastProbe = async (app: ElectronApplication): Promise<void> => {
  await app.evaluate(({ webContents }) => {
    const probe = globalThis as typeof globalThis & {
      __onlyPreviewSelectionBroadcastIds?: Set<string>;
      __onlyPreviewPatchedWebContents?: Set<number>;
    };
    probe.__onlyPreviewSelectionBroadcastIds = new Set<string>();
    probe.__onlyPreviewPatchedWebContents ??= new Set<number>();
    for (const contents of webContents.getAllWebContents()) {
      if (probe.__onlyPreviewPatchedWebContents.has(contents.id)) continue;
      probe.__onlyPreviewPatchedWebContents.add(contents.id);
      const send = contents.send.bind(contents);
      contents.send = (channel: string, ...args: unknown[]): void => {
        const payload = args[0] as { id?: unknown; handleName?: unknown } | undefined;
        if (
          channel === '__xpc_broadcast_dispatch__' &&
          payload?.handleName === 'onlypreview/selectionChanged' &&
          typeof payload.id === 'string'
        ) {
          probe.__onlyPreviewSelectionBroadcastIds?.add(payload.id);
        }
        send(channel, ...args);
      };
    }
  });
};

const selectionBroadcastCount = async (app: ElectronApplication): Promise<number> =>
  await app.evaluate(() => {
    const probe = globalThis as typeof globalThis & {
      __onlyPreviewSelectionBroadcastIds?: Set<string>;
    };
    return probe.__onlyPreviewSelectionBroadcastIds?.size ?? 0;
  });

const waitForRenderer = async <T>(
  session: OnlyPreviewE2ESession,
  mode: OnlyPreviewRendererMode,
  expression: string,
  expected: T
): Promise<void> => {
  try {
    await expect
      .poll(async () => await session.evaluateRenderer<T>(mode, expression))
      .toEqual(expected);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `OnlyPreview ${mode} did not reach ${JSON.stringify(expected)}.\n${session.output
        .slice(-40)
        .join('')}\n${detail}`
    );
  }
};

const waitForPage = async (
  app: ElectronApplication,
  pattern: RegExp,
  description: string
): Promise<Page> => {
  const existing = app.windows().find((page) => pattern.test(page.url()));
  if (existing) return existing;
  return await app
    .waitForEvent('window', {
      predicate: (page) => pattern.test(page.url()),
      timeout: 30_000
    })
    .catch(() => {
      throw new Error(
        `Timed out waiting for ${description}. Open renderers: ${app
          .windows()
          .map((page) => page.url())
          .join(', ')}`
      );
    });
};

const captureNativeOnlyPreview = async (
  app: ElectronApplication,
  fileName: string,
  thumbnailSize: { width: number; height: number }
): Promise<{ width: number; height: number }> => {
  const capture = await app.evaluate(
    async ({ app, BaseWindow, desktopCapturer }, requestedSize) => {
      const window = BaseWindow.getAllWindows().find(
        (candidate) => candidate.getTitle() === 'OnlyPreview'
      );
      if (!window) throw new Error('OnlyPreview BaseWindow unavailable');
      window.show();
      window.focus();
      if (process.platform === 'darwin') app.focus({ steal: true });
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      const mediaSourceId = window.getMediaSourceId();
      const sources = await Promise.race([
        desktopCapturer.getSources({
          types: ['window'],
          thumbnailSize: requestedSize,
          fetchWindowIcons: false
        }),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('Native window capture timed out')), 15_000);
        })
      ]);
      const source = sources.find((candidate) => candidate.id === mediaSourceId);
      if (!source) throw new Error(`Native media source ${mediaSourceId} unavailable`);
      return {
        png: source.thumbnail.toPNG().toString('base64'),
        size: source.thumbnail.getSize(),
        empty: source.thumbnail.isEmpty(),
        mediaSourceId
      };
    },
    thumbnailSize
  );
  mkdirSync(screenshotRoot, { recursive: true });
  const screenshotPath = join(screenshotRoot, fileName);
  if (!capture.empty) {
    const png = Buffer.from(capture.png, 'base64');
    expect(png.length).toBeGreaterThan(10_000);
    writeFileSync(screenshotPath, png);
    return capture.size;
  }
  if (process.platform !== 'darwin') {
    throw new Error('Electron returned an empty native OnlyPreview window capture');
  }
  const match = /^window:(\d+):\d+$/.exec(capture.mediaSourceId);
  if (!match) throw new Error(`Unexpected native media source ID: ${capture.mediaSourceId}`);
  await execFileAsync('/usr/sbin/screencapture', ['-x', '-o', `-l${match[1]}`, screenshotPath]);
  const png = readFileSync(screenshotPath);
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  expect(png.length).toBeGreaterThan(10_000);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

const sampleNativeMenuBar = async (
  fileName: string,
  expectedWindowSize: { width: number; height: number }
): Promise<{ matchedPixels: number; totalPixels: number; matchRatio: number }> => {
  const screenshotPath = join(screenshotRoot, fileName);
  const image = sharp(screenshotPath);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Native OnlyPreview screenshot has no dimensions: ${screenshotPath}`);
  }

  const scaleY = metadata.height / expectedWindowSize.height;
  const left = Math.round(metadata.width * 0.55);
  const right = Math.round(metadata.width * 0.65);
  const top = Math.max(0, Math.round(6 * scaleY));
  const bottom = Math.min(metadata.height, Math.round(26 * scaleY));
  const { data, info } = await image
    .extract({ left, top, width: right - left, height: bottom - top })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels < 3) {
    throw new Error(`Native OnlyPreview screenshot has unsupported channels: ${info.channels}`);
  }

  let matchedPixels = 0;
  let totalPixels = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    totalPixels += 1;
    if (matchesOnlyPreviewRoyalBlue(data[offset], data[offset + 1], data[offset + 2])) {
      matchedPixels += 1;
    }
  }
  return {
    matchedPixels,
    totalPixels,
    matchRatio: totalPixels ? matchedPixels / totalPixels : 0
  };
};

const expectMediaMetadataAndSeek = async (
  session: OnlyPreviewE2ESession,
  tagName: 'audio' | 'video'
): Promise<void> => {
  const result = await session.evaluateRenderer<{
    duration: number;
    readyState: number;
    seekableEnd: number;
    target: number;
    currentTime: number;
    errorCode: number | null;
  }>(
    'preview',
    `(async () => {
      const media = document.querySelector(${JSON.stringify(tagName)});
      if (!(media instanceof HTMLMediaElement)) {
        return { duration: 0, readyState: 0, seekableEnd: 0, target: 0, currentTime: 0, errorCode: -1 };
      }
      if (media.readyState < HTMLMediaElement.HAVE_METADATA) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('metadata timeout')), 10_000);
          media.addEventListener('loadedmetadata', () => { clearTimeout(timeout); resolve(undefined); }, { once: true });
          media.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('media error')); }, { once: true });
          media.load();
        });
      }
      const target = Math.min(0.75, media.duration / 2);
      const seeked = new Promise((resolve) => {
        const timeout = setTimeout(resolve, 5_000);
        media.addEventListener('seeked', () => { clearTimeout(timeout); resolve(undefined); }, { once: true });
      });
      media.currentTime = target;
      await seeked;
      return {
        duration: media.duration,
        readyState: media.readyState,
        seekableEnd: media.seekable.length ? media.seekable.end(media.seekable.length - 1) : 0,
        target,
        currentTime: media.currentTime,
        errorCode: media.error?.code ?? null,
      };
    })()`
  );
  expect(result.errorCode).toBeNull();
  expect(result.duration).toBeGreaterThan(0.5);
  expect(result.readyState).toBeGreaterThanOrEqual(1);
  expect(result.seekableEnd).toBeGreaterThan(0.5);
  expect(result.target).toBeGreaterThan(0.2);
  expect(result.currentTime).toBeGreaterThan(0.2);
  expect(Math.abs(result.currentTime - result.target)).toBeLessThan(0.15);
};

test('owns three secure views, exact native geometry, shortcuts, and a composite 800x600 capture', async ({
  onlyPreview
}) => {
  const { app, evaluateRenderer, sendInput, sendInputs } = onlyPreview;
  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.querySelectorAll('[name="onlypreview__treeRow"]').length`,
    6
  );

  const graph = await app.evaluate(({ BaseWindow }) => {
    const windows = BaseWindow.getAllWindows().filter(
      (window) => window.getTitle() === 'OnlyPreview'
    );
    const window = windows[0];
    return {
      count: windows.length,
      platform: process.platform,
      minimumSize: window?.getMinimumSize(),
      bounds: window?.getBounds(),
      contentBounds: window?.getContentBounds(),
      contentSize: window?.getContentSize(),
      menuBarVisible: window?.isMenuBarVisible(),
      windowButtonPosition:
        process.platform === 'darwin' ? window?.getWindowButtonPosition() : null,
      controls: window
        ? {
            minimizable: window.isMinimizable(),
            maximizable: window.isMaximizable(),
            closable: window.isClosable()
          }
        : null,
      children:
        window?.contentView.children.map((view) => ({
          url: view.webContents.getURL(),
          bounds: view.getBounds(),
          webContentsId: view.webContents.id,
          osProcessId: view.webContents.getOSProcessId(),
          preferences: view.webContents.getLastWebPreferences()
        })) ?? []
    };
  });
  expect(graph.count).toBe(1);
  expect(graph.minimumSize).toEqual([800, 600]);
  expect(graph.bounds).toMatchObject({ width: 1180, height: 760 });
  if (!graph.bounds || !graph.contentBounds) {
    throw new Error('Fresh OnlyPreview window bounds are unavailable');
  }
  const freshMainNativeTitlebarGap = {
    originX: graph.contentBounds.x - graph.bounds.x,
    originY: graph.contentBounds.y - graph.bounds.y,
    width: graph.bounds.width - graph.contentBounds.width,
    height: graph.bounds.height - graph.contentBounds.height
  };
  expect(
    freshMainNativeTitlebarGap,
    'A fresh Main must not reserve native titlebar space outside the Shell MenuBar'
  ).toEqual({ originX: 0, originY: 0, width: 0, height: 0 });
  expect(graph.controls).toEqual({ minimizable: true, maximizable: true, closable: true });
  if (graph.platform === 'darwin') {
    expect(graph.windowButtonPosition).toEqual({ x: 12, y: 8 });
  } else if (graph.platform === 'win32') {
    expect(graph.menuBarVisible).toBe(false);
  }
  expect(graph.children).toHaveLength(3);
  expect(graph.children.map(({ url }) => url)).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/\/onlypreview\/shell\/index\.html/),
      expect.stringMatching(/\/onlypreview\/previewHeader\/index\.html/),
      expect.stringMatching(/\/onlypreview\/preview\/index\.html/)
    ])
  );
  expect(new Set(graph.children.map(({ webContentsId }) => webContentsId)).size).toBe(3);
  for (const child of graph.children) {
    expect(child.webContentsId).toBeGreaterThan(0);
    expect(child.osProcessId).toBeGreaterThan(0);
    expect(child.preferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    });
  }
  const globals = await Promise.all([
    evaluateRenderer(
      'shell',
      `({ require: typeof globalThis.require, process: typeof globalThis.process })`
    ),
    evaluateRenderer(
      'previewHeader',
      `({ require: typeof globalThis.require, process: typeof globalThis.process })`
    ),
    evaluateRenderer(
      'preview',
      `({ require: typeof globalThis.require, process: typeof globalThis.process })`
    )
  ]);
  expect(globals).toEqual([
    { require: 'undefined', process: 'undefined' },
    { require: 'undefined', process: 'undefined' },
    { require: 'undefined', process: 'undefined' }
  ]);

  const menuBar = await evaluateRenderer<{
    platform: string;
    height: number;
    backgroundColor: string;
    borderBottomColor: string;
    paddingLeft: string;
    actionNames: Array<string | null>;
    actionHeights: number[];
    identity: string;
  }>(
    'shell',
    `(() => {
      const element = document.querySelector('[name="onlypreview__menuBar"]');
      if (!(element instanceof HTMLElement)) throw new Error('OnlyPreview MenuBar unavailable');
      const style = getComputedStyle(element);
      const actions = Array.from(element.querySelectorAll('.onlypreview-shell__menu-actions button'));
      return {
        platform: window.onlyPreviewEnv.platform,
        height: Math.round(element.getBoundingClientRect().height),
        backgroundColor: style.backgroundColor,
        borderBottomColor: style.borderBottomColor,
        paddingLeft: style.paddingLeft,
        actionNames: actions.map((action) => action.getAttribute('name')),
        actionHeights: actions.map((action) => Math.round(action.getBoundingClientRect().height)),
        identity: element.querySelector('[name="onlypreview__identity"]')?.textContent?.trim() || '',
      };
    })()`
  );
  expect(menuBar.height).toBe(32);
  expect(menuBar.backgroundColor).toBe('rgb(78, 88, 130)');
  expect(menuBar.borderBottomColor).toBe('rgb(61, 70, 102)');
  expect(new Set(menuBar.actionHeights)).toEqual(new Set([27]));
  expect(menuBar.identity).toContain('OnlyPreview');
  expect(menuBar.actionNames).toEqual([
    'onlypreview__openFolder',
    'onlypreview__agentSkillGuide',
    'onlypreview__settings',
    ...(menuBar.platform === 'win32'
      ? ['onlypreview__minimize', 'onlypreview__maximize', 'onlypreview__close']
      : [])
  ]);
  expect(menuBar.paddingLeft).toBe(menuBar.platform === 'darwin' ? '78px' : '10px');
  const folderFirstChrome = await evaluateRenderer<{
    openFile: boolean;
    refresh: boolean;
    projectCount: boolean;
    statusText: string;
    locateDisabled: boolean;
  }>(
    'shell',
    `({
      openFile: Boolean(document.querySelector('[name="onlypreview__openFile"]')),
      refresh: Boolean(document.querySelector('[name="onlypreview__refresh"]')),
      projectCount: Boolean(document.querySelector('.onlypreview-shell__project-count')),
      statusText: document.querySelector('[name="onlypreview__statusRail"]')?.textContent?.trim() || '',
      locateDisabled: document.querySelector('[name="onlypreview__locateCurrentFile"]')?.hasAttribute('disabled') || false,
    })`
  );
  expect(folderFirstChrome).toMatchObject({
    openFile: false,
    refresh: false,
    projectCount: false,
    locateDisabled: true
  });
  expect(folderFirstChrome.statusText).toBe('');
  expect(folderFirstChrome.statusText).not.toMatch(/\d|READ ONLY/i);

  const isMaximized = async (): Promise<boolean> =>
    await app.evaluate(({ BaseWindow }) => {
      const window = BaseWindow.getAllWindows().find(
        (candidate) => candidate.getTitle() === 'OnlyPreview'
      );
      return Boolean(window && !window.isDestroyed() && window.isMaximized());
    });
  expect(await isMaximized()).toBe(false);
  const actionDoubleClickIgnored = await evaluateRenderer<boolean>(
    'shell',
    `(() => {
      const actions = document.querySelector('[name="onlypreview__menuActions"]');
      if (!(actions instanceof HTMLElement)) return false;
      actions.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    })()`
  );
  expect(actionDoubleClickIgnored).toBe(true);
  expect(await isMaximized()).toBe(false);
  const toggleFromIdentity = async (): Promise<void> => {
    const dispatched = await evaluateRenderer<boolean>(
      'shell',
      `(() => {
        const identity = document.querySelector('[name="onlypreview__identity"]');
        if (!(identity instanceof HTMLElement)) return false;
        identity.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        return true;
      })()`
    );
    expect(dispatched).toBe(true);
  };
  await toggleFromIdentity();
  await expect.poll(isMaximized).toBe(true);
  await toggleFromIdentity();
  await expect.poll(isMaximized).toBe(false);

  if (menuBar.platform === 'win32') {
    const clickWindowControl = async (name: 'minimize' | 'maximize'): Promise<void> => {
      const clicked = await evaluateRenderer<boolean>(
        'shell',
        `(() => {
          const control = document.querySelector('[name="onlypreview__${name}"]');
          if (!(control instanceof HTMLButtonElement)) return false;
          control.click();
          return true;
        })()`
      );
      expect(clicked).toBe(true);
    };
    await clickWindowControl('minimize');
    await expect
      .poll(
        async () =>
          await app.evaluate(({ BaseWindow }) => {
            const window = BaseWindow.getAllWindows().find(
              (candidate) => candidate.getTitle() === 'OnlyPreview'
            );
            return Boolean(window && !window.isDestroyed() && window.isMinimized());
          })
      )
      .toBe(true);
    await app.evaluate(({ BaseWindow }) => {
      const window = BaseWindow.getAllWindows().find(
        (candidate) => candidate.getTitle() === 'OnlyPreview'
      );
      window?.restore();
      window?.focus();
    });
    await clickWindowControl('maximize');
    await expect.poll(isMaximized).toBe(true);
    await clickWindowControl('maximize');
    await expect.poll(isMaximized).toBe(false);
  }

  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.querySelector('[name="onlypreview__treeRow"][data-relative-path="nested"]')?.getAttribute('aria-expanded')`,
    'false'
  );
  const expandedDirectory = await evaluateRenderer<boolean>(
    'shell',
    `(() => {
      const row = document.querySelector('[name="onlypreview__treeRow"][data-relative-path="nested"]');
      if (!(row instanceof HTMLButtonElement)) return false;
      row.click();
      return true;
    })()`
  );
  expect(expandedDirectory).toBe(true);
  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.querySelector('[name="onlypreview__treeRow"][data-relative-path="nested"]')?.getAttribute('aria-expanded')`,
    'true'
  );
  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.querySelector('[name="onlypreview__treeRow"][data-relative-path="nested/inside.txt"]')?.textContent?.trim() || ''`,
    'inside.txt'
  );

  await resetSelectionBroadcastProbe(app);
  await dispatchTreeDoubleClick(onlyPreview, 'copy.txt');
  await waitForRenderer(
    onlyPreview,
    'preview',
    `Boolean(document.querySelector('.monaco-editor'))`,
    true
  );
  await expect.poll(async () => await selectionBroadcastCount(app)).toBe(1);

  await clickTreeFile(onlyPreview, 'inside.txt');
  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.querySelector('[name="onlypreview__treeRow"][aria-selected="true"]')?.getAttribute('data-relative-path')`,
    'nested/inside.txt'
  );
  const preparedLocator = await evaluateRenderer<boolean>(
    'shell',
    `(() => {
      const nested = document.querySelector('[name="onlypreview__treeRow"][data-relative-path="nested"]');
      const search = document.querySelector('[name="onlypreview__search"] input');
      const locate = document.querySelector('[name="onlypreview__locateCurrentFile"]');
      if (!(nested instanceof HTMLButtonElement) || !(search instanceof HTMLInputElement) || !(locate instanceof HTMLButtonElement)) return false;
      nested.click();
      search.value = 'pixel';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      const original = HTMLElement.prototype.scrollIntoView;
      window.__onlyPreviewOriginalScrollIntoView = original;
      HTMLElement.prototype.scrollIntoView = function(options) {
        window.__onlyPreviewScrollProbe = {
          relativePath: this.getAttribute('data-relative-path'),
          block: typeof options === 'object' && options ? options.block : null,
        };
      };
      locate.click();
      return true;
    })()`
  );
  expect(preparedLocator).toBe(true);
  await expect
    .poll(
      async () =>
        await evaluateRenderer(
          'shell',
          `({
            search: document.querySelector('[name="onlypreview__search"] input')?.value || '',
            activePath: document.activeElement?.getAttribute('data-relative-path') || '',
            parentExpanded: document.querySelector('[name="onlypreview__treeRow"][data-relative-path="nested"]')?.getAttribute('aria-expanded'),
            scroll: window.__onlyPreviewScrollProbe || null,
          })`
        )
    )
    .toEqual({
      search: '',
      activePath: 'nested/inside.txt',
      parentExpanded: 'true',
      scroll: { relativePath: 'nested/inside.txt', block: 'center' }
    });
  await evaluateRenderer(
    'shell',
    `(() => {
      if (window.__onlyPreviewOriginalScrollIntoView) {
        HTMLElement.prototype.scrollIntoView = window.__onlyPreviewOriginalScrollIntoView;
      }
      delete window.__onlyPreviewOriginalScrollIntoView;
      delete window.__onlyPreviewScrollProbe;
    })()`
  );
  await clickTreeFile(onlyPreview, 'copy.txt');
  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.querySelector('[name="onlypreview__treeRow"][aria-selected="true"]')?.getAttribute('data-relative-path')`,
    'copy.txt'
  );
  const visibleReadOnlyLabels = await Promise.all([
    evaluateRenderer<boolean>(
      'shell',
      `/READ ONLY/i.test(document.querySelector('[name="onlypreview__shell"]')?.textContent || '')`
    ),
    evaluateRenderer<boolean>(
      'preview',
      `Boolean(document.querySelector('.onlypreview-preview__badge--read-only'))`
    )
  ]);
  expect(visibleReadOnlyLabels).toEqual([false, false]);

  expect(graph.contentSize[0]).toBeLessThanOrEqual(1180);
  expect(graph.contentSize[1]).toBeLessThanOrEqual(760);
  expect(760 - graph.contentSize[1]).toBeLessThanOrEqual(16);
  const settingsCenter = await evaluateRenderer<{ x: number; y: number }>(
    'shell',
    `(() => {
      const settings = document.querySelector('[name="onlypreview__settings"]');
      if (!(settings instanceof HTMLButtonElement)) throw new Error('Settings action unavailable');
      const bounds = settings.getBoundingClientRect();
      return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) };
    })()`
  );
  await sendInput('shell', { type: 'mouseMove', ...settingsCenter });
  await expect
    .poll(
      async () =>
        await evaluateRenderer<string>(
          'shell',
          `getComputedStyle(document.querySelector('[name="onlypreview__settings"]')).backgroundColor`
        )
    )
    .toBe('rgba(255, 255, 255, 0.15)');
  const normalCapture = await captureNativeOnlyPreview(app, 'onlypreview-normal.png', {
    width: 1180,
    height: 760
  });
  expect(normalCapture.width).toBeGreaterThanOrEqual(1180);
  expect(normalCapture.height).toBeGreaterThanOrEqual(760);
  expect(
    matchesOnlyPreviewRoyalBlue(0x32, 0x32, 0x32),
    'A deep gray native titlebar must not satisfy the OnlyPreview Royal Blue pixel matcher'
  ).toBe(false);
  const normalMenuBarSample = await sampleNativeMenuBar('onlypreview-normal.png', {
    width: 1180,
    height: 760
  });
  expect(
    normalMenuBarSample.matchRatio,
    `Fresh native MenuBar sample matched ${normalMenuBarSample.matchedPixels}/${normalMenuBarSample.totalPixels} Royal Blue pixels`
  ).toBeGreaterThanOrEqual(NATIVE_MENU_BAR_REQUIRED_MATCH_RATIO);
  await sendInput('shell', { type: 'mouseMove', x: 12, y: 80 });

  await app.evaluate(({ BaseWindow }) => {
    const window = BaseWindow.getAllWindows().find(
      (candidate) => candidate.getTitle() === 'OnlyPreview'
    );
    if (!window) throw new Error('OnlyPreview BaseWindow unavailable');
    window.setBounds({ ...window.getBounds(), width: 800, height: 600 });
  });
  await expect
    .poll(
      async () =>
        await app.evaluate(({ BaseWindow }) => {
          const window = BaseWindow.getAllWindows().find(
            (candidate) => candidate.getTitle() === 'OnlyPreview'
          );
          return window?.getBounds().width;
        })
    )
    .toBe(800);

  const compact = await app.evaluate(({ BaseWindow }) => {
    const window = BaseWindow.getAllWindows().find(
      (candidate) => candidate.getTitle() === 'OnlyPreview'
    );
    if (!window) throw new Error('OnlyPreview BaseWindow unavailable');
    return {
      bounds: window.getBounds(),
      contentSize: window.getContentSize(),
      children: window.contentView.children.map((view) => ({
        url: view.webContents.getURL(),
        bounds: view.getBounds()
      }))
    };
  });
  expect(compact.bounds).toMatchObject({ width: 800, height: 600 });
  const shell = compact.children.find(({ url }) => /\/shell\//.test(url));
  const previewHeader = compact.children.find(({ url }) => /\/previewHeader\//.test(url));
  const previewContent = compact.children.find(({ url }) => /\/preview\//.test(url));
  expect(shell?.bounds).toEqual({
    x: 0,
    y: 0,
    width: compact.contentSize[0],
    height: compact.contentSize[1]
  });
  const domBounds = await evaluateRenderer<{ x: number; y: number; width: number; height: number }>(
    'shell',
    `(() => { const bounds = document.querySelector('[name="onlypreview__previewHost"]')?.getBoundingClientRect();
      return bounds ? { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) } : null; })()`
  );
  expect(previewHeader?.bounds).toEqual({
    x: domBounds.x,
    y: domBounds.y,
    width: domBounds.width,
    height: 43
  });
  expect(previewContent?.bounds).toEqual({
    x: domBounds.x,
    y: domBounds.y + 43,
    width: domBounds.width,
    height: domBounds.height - 43
  });
  expect(previewHeader?.bounds.x).toBeGreaterThanOrEqual(185);
  expect(previewHeader?.bounds.y).toBe(32);
  expect(
    (previewContent?.bounds.y ?? 0) + (previewContent?.bounds.height ?? 0)
  ).toBeLessThanOrEqual(compact.contentSize[1] - 25);

  await sendInputs('preview', [
    { type: 'keyDown', keyCode: '1', modifiers: ['alt'] },
    { type: 'keyUp', keyCode: '1', modifiers: ['alt'] }
  ]);
  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.activeElement?.getAttribute('name')`,
    'onlypreview__treeRow'
  );
  await waitForRenderer(onlyPreview, 'shell', `document.hasFocus()`, true);

  const activeTreeState = async (): Promise<{
    activeText: string;
    hasFocus: boolean;
    tabbableItems: number;
  }> =>
    await evaluateRenderer(
      'shell',
      `({
        activeText: document.activeElement?.textContent?.trim() || '',
        hasFocus: document.hasFocus(),
        tabbableItems: document.querySelectorAll('[name="onlypreview__treeRow"][tabindex="0"]').length,
      })`
    );
  const expectActiveTreeRow = async (name: string): Promise<void> => {
    await expect.poll(activeTreeState).toEqual({
      activeText: name,
      hasFocus: true,
      tabbableItems: 1
    });
  };
  const pressTreeKey = async (keyCode: string): Promise<void> => {
    const electronKeyCode =
      {
        ArrowDown: 'Down',
        ArrowUp: 'Up',
        ArrowLeft: 'Left',
        ArrowRight: 'Right'
      }[keyCode] ?? keyCode;
    await sendInputs('shell', [
      { type: 'keyDown', keyCode: electronKeyCode },
      { type: 'keyUp', keyCode: electronKeyCode }
    ]);
  };

  await expectActiveTreeRow('copy.txt');
  await pressTreeKey('ArrowDown');
  await expectActiveTreeRow('document.pdf');
  await pressTreeKey('ArrowUp');
  await expectActiveTreeRow('copy.txt');
  await pressTreeKey('Home');
  await expectActiveTreeRow('nested');
  await pressTreeKey('ArrowRight');
  await expectActiveTreeRow('inside.txt');
  await pressTreeKey('ArrowLeft');
  await expectActiveTreeRow('nested');
  await pressTreeKey('ArrowLeft');
  await expectActiveTreeRow('nested');
  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.querySelectorAll('[name="onlypreview__treeRow"]').length`,
    6
  );
  await pressTreeKey('ArrowRight');
  await expectActiveTreeRow('nested');
  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.querySelectorAll('[name="onlypreview__treeRow"]').length`,
    7
  );
  await pressTreeKey('End');
  await expectActiveTreeRow('video.webm');
  await pressTreeKey('Home');
  await pressTreeKey('ArrowDown');
  await pressTreeKey('ArrowDown');
  await pressTreeKey('ArrowDown');
  await expectActiveTreeRow('document.pdf');
  await pressTreeKey('Space');
  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.querySelector('[name="onlypreview__treeRow"][aria-selected="true"]')?.textContent?.trim() || ''`,
    'document.pdf'
  );
  await waitForRenderer(
    onlyPreview,
    'preview',
    `document.querySelectorAll('[name="onlypreview__pdfPage"] canvas').length`,
    1
  );

  await sendInputs('shell', [
    { type: 'keyDown', keyCode: 'Shift' },
    { type: 'keyUp', keyCode: 'Shift' },
    { type: 'keyDown', keyCode: 'Shift' },
    { type: 'keyUp', keyCode: 'Shift' }
  ]);
  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.activeElement?.getAttribute('type')`,
    'search'
  );

  const compactCapture = await captureNativeOnlyPreview(app, 'onlypreview-800x600.png', {
    width: 800,
    height: 600
  });
  expect(compactCapture.width).toBeGreaterThanOrEqual(800);
  expect(compactCapture.height).toBeGreaterThanOrEqual(600);
  const compactMenuBarSample = await sampleNativeMenuBar('onlypreview-800x600.png', {
    width: 800,
    height: 600
  });
  expect(
    compactMenuBarSample.matchRatio,
    `Compact native MenuBar sample matched ${compactMenuBarSample.matchedPixels}/${compactMenuBarSample.totalPixels} Royal Blue pixels`
  ).toBeGreaterThanOrEqual(NATIVE_MENU_BAR_REQUIRED_MATCH_RATIO);

  if (process.platform === 'win32') {
    const clickedClose = await evaluateRenderer<boolean>(
      'shell',
      `(() => {
        const close = document.querySelector('[name="onlypreview__close"]');
        if (!(close instanceof HTMLButtonElement)) return false;
        close.click();
        return true;
      })()`
    );
    expect(clickedClose).toBe(true);
    await expect
      .poll(
        async () =>
          await app.evaluate(
            ({ BaseWindow }) =>
              BaseWindow.getAllWindows().filter((window) => window.getTitle() === 'OnlyPreview')
                .length
          )
      )
      .toBe(0);
  }
});

test('opens a Main-owned native file menu and revalidates each file action', async ({
  onlyPreview
}) => {
  const { app, evaluateRenderer } = onlyPreview;
  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.querySelectorAll('[name="onlypreview__treeRow"]').length`,
    6
  );

  await app.evaluate(({ BaseWindow, Menu, shell }) => {
    type StoredMenuItem = {
      id?: string;
      label?: string;
      type?: string;
      click?: () => void;
    };
    type NativeMenuProbe = {
      items: StoredMenuItem[];
      ownerMatches: boolean;
      popupCount: number;
      openedPaths: string[];
      revealedPaths: string[];
    };
    const state = globalThis as typeof globalThis & {
      __onlyPreviewNativeMenuProbe?: NativeMenuProbe;
    };
    state.__onlyPreviewNativeMenuProbe = {
      items: [],
      ownerMatches: false,
      popupCount: 0,
      openedPaths: [],
      revealedPaths: []
    };
    const originalBuildFromTemplate = Menu.buildFromTemplate.bind(Menu);
    Menu.buildFromTemplate = (template) => {
      const menu = originalBuildFromTemplate(template);
      if (template.some((item) => item.id === 'onlypreview-preview')) {
        state.__onlyPreviewNativeMenuProbe!.items = template as unknown as StoredMenuItem[];
        menu.popup = (options): void => {
          const owner = BaseWindow.getAllWindows().find(
            (window) => window.getTitle() === 'OnlyPreview'
          );
          state.__onlyPreviewNativeMenuProbe!.ownerMatches = options?.window === owner;
          state.__onlyPreviewNativeMenuProbe!.popupCount += 1;
        };
      }
      return menu;
    };
    shell.openPath = async (path): Promise<string> => {
      state.__onlyPreviewNativeMenuProbe!.openedPaths.push(path);
      return '';
    };
    shell.showItemInFolder = (path): void => {
      state.__onlyPreviewNativeMenuProbe!.revealedPaths.push(path);
    };
  });

  const dispatched = await evaluateRenderer<boolean>(
    'shell',
    `(() => {
      const row = document.querySelector('[name="onlypreview__treeRow"][data-relative-path="copy.txt"]');
      if (!(row instanceof HTMLButtonElement)) return false;
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }));
      return true;
    })()`
  );
  expect(dispatched).toBe(true);
  await expect
    .poll(
      async () =>
        await app.evaluate(() => {
          const probe = (
            globalThis as typeof globalThis & {
              __onlyPreviewNativeMenuProbe?: {
                items: Array<{ id?: string; label?: string; type?: string }>;
                ownerMatches: boolean;
                popupCount: number;
              };
            }
          ).__onlyPreviewNativeMenuProbe;
          return {
            ids: probe?.items.filter((item) => item.type !== 'separator').map((item) => item.id),
            labels: probe?.items
              .filter((item) => item.type !== 'separator')
              .map((item) => item.label),
            ownerMatches: probe?.ownerMatches,
            popupCount: probe?.popupCount
          };
        })
    )
    .toEqual({
      ids: ['onlypreview-preview', 'onlypreview-open-externally', 'onlypreview-reveal-in-folder'],
      labels: ['Preview', 'Open in system app', 'Reveal in folder'],
      ownerMatches: true,
      popupCount: 1
    });
  expect(
    await evaluateRenderer<boolean>(
      'shell',
      `Boolean(document.querySelector('[role="menu"], .arco-dropdown, .arco-trigger-popup'))`
    )
  ).toBe(false);

  await app.evaluate(() => {
    const probe = (
      globalThis as typeof globalThis & {
        __onlyPreviewNativeMenuProbe?: {
          items: Array<{ id?: string; click?: () => void }>;
        };
      }
    ).__onlyPreviewNativeMenuProbe;
    probe?.items.find((item) => item.id === 'onlypreview-preview')?.click?.();
  });
  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.querySelector('[name="onlypreview__treeRow"][aria-selected="true"]')?.getAttribute('data-relative-path')`,
    'copy.txt'
  );

  await app.evaluate(() => {
    const probe = (
      globalThis as typeof globalThis & {
        __onlyPreviewNativeMenuProbe?: {
          items: Array<{ id?: string; click?: () => void }>;
        };
      }
    ).__onlyPreviewNativeMenuProbe;
    probe?.items.find((item) => item.id === 'onlypreview-open-externally')?.click?.();
    probe?.items.find((item) => item.id === 'onlypreview-reveal-in-folder')?.click?.();
  });
  await expect
    .poll(
      async () =>
        await app.evaluate(() => {
          const probe = (
            globalThis as typeof globalThis & {
              __onlyPreviewNativeMenuProbe?: {
                openedPaths: string[];
                revealedPaths: string[];
              };
            }
          ).__onlyPreviewNativeMenuProbe;
          return {
            opened: probe?.openedPaths.map((path) => path.endsWith('copy.txt')),
            revealed: probe?.revealedPaths.map((path) => path.endsWith('copy.txt'))
          };
        })
    )
    .toEqual({ opened: [true], revealed: [true] });
});

test('toggles detached Shell, Header, and Content DevTools independently without changing view bounds', async ({
  onlyPreview
}) => {
  const { app, sendInputs } = onlyPreview;
  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.querySelectorAll('[name="onlypreview__treeRow"]').length`,
    6
  );

  type DevToolsState = Record<
    OnlyPreviewRendererMode,
    {
      bounds: { x: number; y: number; width: number; height: number };
      open: boolean;
      url: string;
    }
  >;
  type InputModifiers = NonNullable<Electron.InputEvent['modifiers']>;
  const readDevToolsState = async (): Promise<DevToolsState> =>
    await app.evaluate(({ BaseWindow }) => {
      const window = BaseWindow.getAllWindows().find(
        (candidate) => candidate.getTitle() === 'OnlyPreview'
      );
      if (!window) throw new Error('OnlyPreview BaseWindow unavailable');
      const state = Object.fromEntries(
        (['shell', 'previewHeader', 'preview'] as const).map((mode) => {
          const view = window.contentView.children.find((candidate) =>
            new RegExp(`/onlypreview/${mode}/index\\.html(?:$|[?#])`).test(
              candidate.webContents.getURL()
            )
          );
          if (!view) throw new Error(`OnlyPreview ${mode} view unavailable`);
          return [
            mode,
            {
              bounds: view.getBounds(),
              open: view.webContents.isDevToolsOpened(),
              url: view.webContents.devToolsWebContents?.getURL() ?? ''
            }
          ];
        })
      );
      return state as DevToolsState;
    });
  const sendShortcut = async (
    mode: OnlyPreviewRendererMode,
    keyCode: string,
    modifiers: InputModifiers = []
  ): Promise<void> => {
    await sendInputs(mode, [
      { type: 'keyDown', keyCode, modifiers },
      { type: 'keyUp', keyCode, modifiers }
    ]);
  };
  const expectDevTools = async (
    shellOpen: boolean,
    previewHeaderOpen: boolean,
    previewOpen: boolean
  ): Promise<void> => {
    await expect
      .poll(async () => {
        const state = await readDevToolsState();
        return {
          shell: { open: state.shell.open, scheme: state.shell.url.split(':', 1)[0] },
          previewHeader: {
            open: state.previewHeader.open,
            scheme: state.previewHeader.url.split(':', 1)[0]
          },
          preview: { open: state.preview.open, scheme: state.preview.url.split(':', 1)[0] }
        };
      })
      .toEqual({
        shell: { open: shellOpen, scheme: shellOpen ? 'devtools' : '' },
        previewHeader: {
          open: previewHeaderOpen,
          scheme: previewHeaderOpen ? 'devtools' : ''
        },
        preview: { open: previewOpen, scheme: previewOpen ? 'devtools' : '' }
      });
  };
  const expectViewBoundsUnchanged = (state: DevToolsState, baseline: DevToolsState): void => {
    for (const mode of ['shell', 'previewHeader', 'preview'] as const) {
      expect(state[mode].bounds).toEqual(baseline[mode].bounds);
    }
  };

  const initial = await readDevToolsState();
  expect(initial.shell.open).toBe(false);
  expect(initial.previewHeader.open).toBe(false);
  expect(initial.preview.open).toBe(false);

  await sendShortcut('shell', 'F12');
  await expectDevTools(true, false, false);
  let current = await readDevToolsState();
  expectViewBoundsUnchanged(current, initial);

  const inspectModifiers: InputModifiers =
    process.platform === 'darwin' ? ['meta', 'alt'] : ['control', 'shift'];
  await sendShortcut('previewHeader', 'F12');
  await expectDevTools(true, true, false);
  current = await readDevToolsState();
  expectViewBoundsUnchanged(current, initial);

  await sendShortcut('preview', 'I', inspectModifiers);
  await expectDevTools(true, true, true);
  await onlyPreview.assertDisplayRouting();
  current = await readDevToolsState();
  expectViewBoundsUnchanged(current, initial);

  await sendShortcut('shell', 'F12');
  await expectDevTools(false, true, true);
  current = await readDevToolsState();
  expectViewBoundsUnchanged(current, initial);

  await sendShortcut('previewHeader', 'F12');
  await expectDevTools(false, false, true);
  current = await readDevToolsState();
  expectViewBoundsUnchanged(current, initial);

  await sendShortcut('preview', 'I', inspectModifiers);
  await expectDevTools(false, false, false);
  current = await readDevToolsState();
  expectViewBoundsUnchanged(current, initial);
});

test('renders immutable text, selectable PDF, image pixels, and seekable audio/video', async ({
  onlyPreview
}) => {
  const { app, evaluateRenderer, sendInputs } = onlyPreview;
  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.querySelectorAll('[name="onlypreview__treeRow"]').length`,
    6
  );

  await clickTreeFile(onlyPreview, 'copy.txt');
  await waitForRenderer(
    onlyPreview,
    'preview',
    `Boolean(document.querySelector('.monaco-editor'))`,
    true
  );
  const before = await evaluateRenderer<string>(
    'preview',
    `document.querySelector('.view-lines')?.textContent || ''`
  );
  expect(before.replaceAll('\u00a0', ' ')).toContain('OnlyPreview immutable Monaco fixture');
  const modifier = process.platform === 'darwin' ? 'meta' : 'control';
  const focusMonaco = async (): Promise<void> => {
    await app.evaluate(async ({ app, BaseWindow }) => {
      const window = BaseWindow.getAllWindows().find(
        (candidate) => candidate.getTitle() === 'OnlyPreview'
      );
      const view = window?.contentView.children.find((candidate) =>
        /\/preview\//.test(candidate.webContents.getURL())
      );
      if (!window || !view) throw new Error('OnlyPreview preview view unavailable');
      if (process.platform === 'darwin') app.focus({ steal: true });
      window.focus();
      view.webContents.focus();
      await view.webContents.executeJavaScript(
        `(async () => {
          const input = document.querySelector('textarea.inputarea');
          if (!(input instanceof HTMLTextAreaElement)) return false;
          input.focus();
          await new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame(undefined)));
          return true;
        })()`,
        true
      );
    });
    await expect
      .poll(
        async () =>
          await evaluateRenderer<{ active: boolean; hasFocus: boolean }>(
            'preview',
            `(() => {
              const input = document.querySelector('textarea.inputarea');
              return {
                active: input instanceof HTMLTextAreaElement && document.activeElement === input,
                hasFocus: document.hasFocus(),
              };
            })()`
          )
      )
      .toEqual({ active: true, hasFocus: true });
  };
  const settleMonacoInput = async (): Promise<void> => {
    await evaluateRenderer(
      'preview',
      `(async () => {
        await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
        return true;
      })()`
    );
  };
  const selectAllMonaco = async (): Promise<void> => {
    await sendInputs('preview', [
      { type: 'rawKeyDown', keyCode: 'A', modifiers: [modifier] },
      { type: 'keyUp', keyCode: 'A', modifiers: [modifier] }
    ]);
    await settleMonacoInput();
    await expect
      .poll(
        async () =>
          await evaluateRenderer<number>(
            'preview',
            `document.querySelectorAll('.monaco-editor .selected-text').length`
          )
      )
      .toBeGreaterThan(0);
  };
  const copyMonacoToNativeClipboard = async (): Promise<void> => {
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText('OnlyPreview E2E clipboard sentinel');
    });
    await selectAllMonaco();
    // sendInputEvent reaches Monaco, but it cannot exercise retained application-menu accelerators.
    await app.evaluate(({ BaseWindow }) => {
      const window = BaseWindow.getAllWindows().find(
        (candidate) => candidate.getTitle() === 'OnlyPreview'
      );
      const view = window?.contentView.children.find((candidate) =>
        /\/preview\//.test(candidate.webContents.getURL())
      );
      if (!view) throw new Error('OnlyPreview preview view unavailable');
      view.webContents.focus();
      view.webContents.copy();
    });
    await expect
      .poll(async () => await app.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain('OnlyPreview immutable Monaco fixture');
  };

  await focusMonaco();
  await copyMonacoToNativeClipboard();
  await app.evaluate(({ BaseWindow, clipboard }) => {
    const window = BaseWindow.getAllWindows().find(
      (candidate) => candidate.getTitle() === 'OnlyPreview'
    );
    const view = window?.contentView.children.find((candidate) =>
      /\/preview\//.test(candidate.webContents.getURL())
    );
    if (!view) throw new Error('OnlyPreview preview view unavailable');
    view.webContents.focus();
    view.webContents.insertText('TYPED MUTATION');
    clipboard.writeText('PASTED MUTATION');
    view.webContents.paste();
  });
  await settleMonacoInput();
  await expect
    .poll(
      async () =>
        await evaluateRenderer<string>(
          'preview',
          `document.querySelector('.view-lines')?.textContent || ''`
        )
    )
    .toBe(before);
  await focusMonaco();
  await copyMonacoToNativeClipboard();
  const after = await evaluateRenderer<string>(
    'preview',
    `document.querySelector('.view-lines')?.textContent || ''`
  );
  expect(after).toBe(before);

  await clickTreeFile(onlyPreview, 'document.pdf');
  await waitForRenderer(
    onlyPreview,
    'preview',
    `document.querySelectorAll('[name="onlypreview__pdfPage"] canvas').length`,
    1
  );
  const pdf = await evaluateRenderer<{ darkPixels: number; selectedText: string }>(
    'preview',
    `(() => {
    const canvas = document.querySelector('[name="onlypreview__pdfPage"] canvas');
    const layer = document.querySelector('[name="onlypreview__pdfTextLayer"]');
    if (!(canvas instanceof HTMLCanvasElement) || !(layer instanceof HTMLElement)) {
      return { darkPixels: 0, selectedText: '' };
    }
    const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    let darkPixels = 0;
    if (data) {
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] > 0 && data[index] + data[index + 1] + data[index + 2] < 690) darkPixels += 1;
      }
    }
    const range = document.createRange();
    range.selectNodeContents(layer);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return { darkPixels, selectedText: selection?.toString().trim() || '' };
  })()`
  );
  expect(pdf.darkPixels).toBeGreaterThan(100);
  expect(pdf.selectedText).toContain('OnlyPreview selectable PDF text');

  await clickTreeFile(onlyPreview, 'pixel.png');
  await expect
    .poll(
      async () =>
        await evaluateRenderer<{
          complete: boolean;
          naturalWidth: number;
          naturalHeight: number;
        }>(
          'preview',
          `(() => {
            const image = document.querySelector('[name="onlypreview__imagePreview"] img');
            return image instanceof HTMLImageElement
              ? { complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight }
              : { complete: false, naturalWidth: 0, naturalHeight: 0 };
          })()`
        )
    )
    .toEqual({ complete: true, naturalWidth: 1, naturalHeight: 1 });

  await clickTreeFile(onlyPreview, 'tone.wav');
  await waitForRenderer(onlyPreview, 'preview', `Boolean(document.querySelector('audio'))`, true);
  await expectMediaMetadataAndSeek(onlyPreview, 'audio');
  const range = await evaluateRenderer<{
    status: number;
    contentRange: string | null;
    length: number;
  }>(
    'preview',
    `(async () => {
      const url = document.querySelector('audio')?.src;
      if (!url) return { status: 0, contentRange: null, length: 0 };
      const response = await fetch(url, { headers: { Range: 'bytes=0-15' } });
      return {
        status: response.status,
        contentRange: response.headers.get('content-range'),
        length: (await response.arrayBuffer()).byteLength,
      };
    })()`
  );
  expect(range).toMatchObject({ status: 206, length: 16 });
  expect(range.contentRange).toMatch(/^bytes 0-15\/\d+$/);

  await clickTreeFile(onlyPreview, 'video.webm');
  await waitForRenderer(onlyPreview, 'preview', `Boolean(document.querySelector('video'))`, true);
  await expectMediaMetadataAndSeek(onlyPreview, 'video');
});

test('opens one secure Settings BrowserWindow and applies persisted editor settings', async ({
  onlyPreview
}) => {
  const { app, evaluateRenderer } = onlyPreview;
  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.querySelectorAll('[name="onlypreview__treeRow"]').length`,
    6
  );
  await clickTreeFile(onlyPreview, 'copy.txt');
  await waitForRenderer(
    onlyPreview,
    'preview',
    `Boolean(document.querySelector('.monaco-editor'))`,
    true
  );

  const shellToken = await evaluateRenderer<string>('shell', `window.onlyPreviewEnv.hostToken`);
  const openSettings = async (): Promise<Page> => {
    const clicked = await evaluateRenderer<boolean>(
      'shell',
      `(() => {
        const button = document.querySelector('[name="onlypreview__settings"]');
        if (!(button instanceof HTMLButtonElement)) return false;
        button.click();
        return true;
      })()`
    );
    expect(clicked).toBe(true);
    const page = await waitForPage(
      app,
      /\/onlypreview\/settings\/index\.html(?:$|[?#])/,
      'OnlyPreview settings'
    );
    await expect(page.locator('[name="onlypreview__settingsApp"]')).toBeVisible();
    return page;
  };
  const selectSettingsCategory = async (
    page: Page,
    category: 'Preview' | 'Project' | 'Appearance'
  ): Promise<void> => {
    const categoryButton = page.locator(`[name="onlypreview__settingsCategory${category}"]`);
    await categoryButton.click();
    await expect(categoryButton).toHaveAttribute('aria-current', 'page');
    const visiblePanels = await page
      .locator(
        '[name="onlypreview__settingsPreview"], [name="onlypreview__settingsProject"], [name="onlypreview__settingsAppearance"]'
      )
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('name')));
    expect(visiblePanels).toEqual([`onlypreview__settings${category}`]);
  };

  const firstSettingsPage = await openSettings();
  await expect(
    firstSettingsPage.locator('[name="onlypreview__hiddenFiles"], #onlypreview-hidden-files')
  ).toHaveCount(0);
  const firstSettingsToken = await firstSettingsPage.evaluate(
    () => (window as unknown as { onlyPreviewEnv: { hostToken: string } }).onlyPreviewEnv.hostToken
  );
  expect(firstSettingsToken).not.toBe(shellToken);
  const settingsWindow = await app.evaluate(({ BaseWindow, BrowserWindow, screen }) => {
    const windows = BrowserWindow.getAllWindows().filter((window) =>
      /\/onlypreview\/settings\/index\.html(?:$|[?#])/.test(window.webContents.getURL())
    );
    const window = windows[0];
    const parent = BaseWindow.getAllWindows().find(
      (candidate) => candidate.getTitle() === 'OnlyPreview'
    );
    const parentBounds = parent?.getBounds();
    return {
      count: windows.length,
      minimumSize: window?.getMinimumSize(),
      bounds: window?.getBounds(),
      parentBounds,
      parentMatches: window?.getParentWindow() === parent,
      workArea: parentBounds ? screen.getDisplayMatching(parentBounds).workArea : null,
      preferences: window?.webContents.getLastWebPreferences()
    };
  });
  expect(settingsWindow.count).toBe(1);
  expect(settingsWindow.minimumSize).toEqual([800, 600]);
  expect(settingsWindow.bounds).toMatchObject({ width: 800, height: 600 });
  expect(settingsWindow.parentMatches).toBe(true);
  if (!settingsWindow.bounds || !settingsWindow.parentBounds || !settingsWindow.workArea) {
    throw new Error('OnlyPreview Settings placement data unavailable');
  }
  const expectedSettingsX = Math.min(
    settingsWindow.workArea.x +
      Math.max(0, settingsWindow.workArea.width - settingsWindow.bounds.width),
    Math.max(
      settingsWindow.workArea.x,
      Math.round(
        settingsWindow.parentBounds.x +
          (settingsWindow.parentBounds.width - settingsWindow.bounds.width) / 2
      )
    )
  );
  const expectedSettingsY = Math.min(
    settingsWindow.workArea.y +
      Math.max(0, settingsWindow.workArea.height - settingsWindow.bounds.height),
    Math.max(
      settingsWindow.workArea.y,
      Math.round(
        settingsWindow.parentBounds.y +
          (settingsWindow.parentBounds.height - settingsWindow.bounds.height) / 2
      )
    )
  );
  expect(settingsWindow.bounds).toMatchObject({ x: expectedSettingsX, y: expectedSettingsY });
  expect(settingsWindow.preferences).toMatchObject({
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true
  });
  const settingsLayout = await firstSettingsPage.evaluate(() => {
    const rect = (element: Element | null) => {
      const bounds = element?.getBoundingClientRect();
      return bounds
        ? {
            top: bounds.top,
            bottom: bounds.bottom,
            left: bounds.left,
            right: bounds.right,
            width: bounds.width,
            height: bounds.height
          }
        : null;
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      categories: rect(document.querySelector('[name="onlypreview__settingsCategories"]')),
      content: rect(document.querySelector('[name="onlypreview__settingsContent"]')),
      footer: rect(document.querySelector('[name="onlypreview__settingsActions"]')),
      categoryButtons: Array.from(
        document.querySelectorAll('[name^="onlypreview__settingsCategory"]')
      ).map((element) => ({
        name: element.getAttribute('name'),
        current: element.getAttribute('aria-current')
      })),
      visiblePanels: Array.from(
        document.querySelectorAll(
          '[name="onlypreview__settingsPreview"], [name="onlypreview__settingsProject"], [name="onlypreview__settingsAppearance"]'
        )
      ).map((element) => element.getAttribute('name')),
      buttons: Array.from(
        document.querySelectorAll('[name="onlypreview__settingsActions"] button')
      ).map(rect)
    };
  });
  expect(settingsLayout.viewport.width).toBeGreaterThanOrEqual(780);
  expect(settingsLayout.viewport.height).toBeGreaterThanOrEqual(540);
  expect(settingsLayout.categories).not.toBeNull();
  expect(settingsLayout.content).not.toBeNull();
  expect(settingsLayout.categories!.right).toBeLessThanOrEqual(settingsLayout.content!.left + 1);
  expect(settingsLayout.categories!.top).toBe(settingsLayout.content!.top);
  expect(settingsLayout.categoryButtons).toEqual([
    { name: 'onlypreview__settingsCategoryPreview', current: 'page' },
    { name: 'onlypreview__settingsCategoryProject', current: null },
    { name: 'onlypreview__settingsCategoryAppearance', current: null }
  ]);
  expect(settingsLayout.visiblePanels).toEqual(['onlypreview__settingsPreview']);
  expect(settingsLayout.footer).not.toBeNull();
  expect(settingsLayout.footer!.top).toBeGreaterThanOrEqual(0);
  expect(settingsLayout.footer!.bottom).toBeLessThanOrEqual(settingsLayout.viewport.height + 1);
  expect(settingsLayout.buttons).toHaveLength(2);
  for (const button of settingsLayout.buttons) {
    expect(button).not.toBeNull();
    expect(button!.width).toBeGreaterThan(0);
    expect(button!.height).toBeGreaterThan(0);
    expect(button!.top).toBeGreaterThanOrEqual(0);
    expect(button!.bottom).toBeLessThanOrEqual(settingsLayout.viewport.height + 1);
  }
  await app.evaluate(({ BrowserWindow }) => {
    const settingsWindow = BrowserWindow.getAllWindows().find((window) =>
      /\/onlypreview\/settings\/index\.html(?:$|[?#])/.test(window.webContents.getURL())
    );
    if (!settingsWindow) throw new Error('OnlyPreview settings window unavailable');
    settingsWindow.setSize(900, 650);
  });
  await expect
    .poll(
      async () =>
        await app.evaluate(({ BrowserWindow }) => {
          const settingsWindow = BrowserWindow.getAllWindows().find((window) =>
            /\/onlypreview\/settings\/index\.html(?:$|[?#])/.test(window.webContents.getURL())
          );
          return settingsWindow?.getSize();
        })
    )
    .toEqual([900, 650]);

  const fontSizeInput = firstSettingsPage
    .locator(
      '[name="onlypreview__fontSize"] input, input[name="onlypreview__fontSize"], #onlypreview-font-size input, input#onlypreview-font-size'
    )
    .first();
  await expect(fontSizeInput).toHaveValue('13');
  await fontSizeInput.fill('18');
  await fontSizeInput.press('Tab');
  const wordWrap = firstSettingsPage.locator('[name="onlypreview__wordWrap"]');
  await expect(wordWrap).toHaveAttribute('aria-checked', 'false');
  await wordWrap.click();
  await expect(wordWrap).toHaveAttribute('aria-checked', 'true');
  await selectSettingsCategory(firstSettingsPage, 'Project');
  await expect(fontSizeInput).toHaveCount(0);
  const singleClick = firstSettingsPage.locator('[name="onlypreview__singleClick"]');
  await expect(singleClick).toHaveAttribute('aria-checked', 'true');
  await singleClick.click();
  await expect(singleClick).toHaveAttribute('aria-checked', 'false');
  await selectSettingsCategory(firstSettingsPage, 'Appearance');
  const lightTheme = firstSettingsPage.locator('[name="onlypreview__themeLight"]');
  await expect(lightTheme).toHaveCount(1);
  await expect(lightTheme).toBeDisabled();
  await expect(singleClick).toHaveCount(0);
  await selectSettingsCategory(firstSettingsPage, 'Preview');
  await expect(fontSizeInput).toHaveValue('18');
  await expect(wordWrap).toHaveAttribute('aria-checked', 'true');
  await Promise.all([
    firstSettingsPage.waitForEvent('close'),
    firstSettingsPage.locator('.onlypreview-settings__actions .arco-btn-primary').click()
  ]);
  await expect
    .poll(
      async () =>
        await evaluateRenderer<string[]>(
          'preview',
          `Array.from(document.querySelectorAll('.monaco-editor, .view-lines, .view-line'))
            .map((element) => getComputedStyle(element).fontSize)`
        )
    )
    .toContain('18px');
  await expect
    .poll(
      async () =>
        await app.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().filter((window) =>
              /\/onlypreview\/settings\/index\.html(?:$|[?#])/.test(window.webContents.getURL())
            ).length
        )
    )
    .toBe(0);

  await resetSelectionBroadcastProbe(app);
  await clickTreeFile(onlyPreview, 'pixel.png');
  await waitForRenderer(
    onlyPreview,
    'preview',
    `Boolean(document.querySelector('[name="onlypreview__imagePreview"] img'))`,
    true
  );
  await expect.poll(async () => await selectionBroadcastCount(app)).toBe(1);

  await resetSelectionBroadcastProbe(app);
  await dispatchTreeDoubleClick(onlyPreview, 'document.pdf');
  await waitForRenderer(
    onlyPreview,
    'preview',
    `document.querySelectorAll('[name="onlypreview__pdfPage"] canvas').length`,
    1
  );
  await expect.poll(async () => await selectionBroadcastCount(app)).toBe(1);

  await app.evaluate(({ BaseWindow, screen }) => {
    const parent = BaseWindow.getAllWindows().find((window) => window.getTitle() === 'OnlyPreview');
    if (!parent) throw new Error('OnlyPreview BaseWindow unavailable');
    const bounds = parent.getBounds();
    const workArea = screen.getDisplayMatching(bounds).workArea;
    parent.setBounds({
      x: workArea.x + workArea.width - Math.round(bounds.width / 3),
      y: workArea.y + workArea.height - Math.round(bounds.height / 3),
      width: bounds.width,
      height: bounds.height
    });
  });
  await app.evaluate(({ BaseWindow, screen }) => {
    const state = globalThis as typeof globalThis & {
      __onlyPreviewOriginalDisplayMatching?: typeof screen.getDisplayMatching;
    };
    const parent = BaseWindow.getAllWindows().find((window) => window.getTitle() === 'OnlyPreview');
    if (!parent) throw new Error('OnlyPreview BaseWindow unavailable');
    state.__onlyPreviewOriginalDisplayMatching = screen.getDisplayMatching.bind(screen);
    screen.getDisplayMatching = (bounds) => {
      const display = state.__onlyPreviewOriginalDisplayMatching!(bounds);
      const workArea = {
        x: display.workArea.x,
        y: display.workArea.y,
        width: 800,
        height: 600
      };
      return {
        ...display,
        workArea,
        workAreaSize: { width: workArea.width, height: workArea.height }
      };
    };
  });
  const secondSettingsPage = await openSettings();
  const secondSettingsToken = await secondSettingsPage.evaluate(
    () => (window as unknown as { onlyPreviewEnv: { hostToken: string } }).onlyPreviewEnv.hostToken
  );
  expect(secondSettingsToken).not.toBe(firstSettingsToken);
  await expect
    .poll(
      async () =>
        await app.evaluate(({ BaseWindow, BrowserWindow, screen }) => {
          const parent = BaseWindow.getAllWindows().find(
            (window) => window.getTitle() === 'OnlyPreview'
          );
          const settings = BrowserWindow.getAllWindows().find((window) =>
            /\/onlypreview\/settings\/index\.html(?:$|[?#])/.test(window.webContents.getURL())
          );
          if (!parent || !settings) return null;
          const parentBounds = parent.getBounds();
          const bounds = settings.getBounds();
          const workArea = screen.getDisplayMatching(parentBounds).workArea;
          const expectedX = Math.min(
            workArea.x + Math.max(0, workArea.width - bounds.width),
            Math.max(
              workArea.x,
              Math.round(parentBounds.x + (parentBounds.width - bounds.width) / 2)
            )
          );
          const expectedY = Math.min(
            workArea.y + Math.max(0, workArea.height - bounds.height),
            Math.max(
              workArea.y,
              Math.round(parentBounds.y + (parentBounds.height - bounds.height) / 2)
            )
          );
          return {
            size: settings.getSize(),
            parentMatches: settings.getParentWindow() === parent,
            centeredAndClamped: bounds.x === expectedX && bounds.y === expectedY,
            insideWorkArea:
              bounds.x >= workArea.x &&
              bounds.y >= workArea.y &&
              bounds.x + bounds.width <= workArea.x + workArea.width &&
              bounds.y + bounds.height <= workArea.y + workArea.height
          };
        })
    )
    .toEqual({
      size: [800, 600],
      parentMatches: true,
      centeredAndClamped: true,
      insideWorkArea: true
    });
  await app.evaluate(({ screen }) => {
    const state = globalThis as typeof globalThis & {
      __onlyPreviewOriginalDisplayMatching?: typeof screen.getDisplayMatching;
    };
    if (state.__onlyPreviewOriginalDisplayMatching) {
      screen.getDisplayMatching = state.__onlyPreviewOriginalDisplayMatching;
      delete state.__onlyPreviewOriginalDisplayMatching;
    }
  });
  const persistedFontSizeInput = secondSettingsPage
    .locator(
      '[name="onlypreview__fontSize"] input, input[name="onlypreview__fontSize"], #onlypreview-font-size input, input#onlypreview-font-size'
    )
    .first();
  await expect(persistedFontSizeInput).toHaveValue('18');
  await expect(secondSettingsPage.locator('[name="onlypreview__wordWrap"]')).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await selectSettingsCategory(secondSettingsPage, 'Project');
  await expect(secondSettingsPage.locator('[name="onlypreview__singleClick"]')).toHaveAttribute(
    'aria-checked',
    'false'
  );
  await selectSettingsCategory(secondSettingsPage, 'Preview');
  await persistedFontSizeInput.fill('17');
  await persistedFontSizeInput.press('Tab');
  await secondSettingsPage.locator('[name="onlypreview__wordWrap"]').click();
  await selectSettingsCategory(secondSettingsPage, 'Project');
  await secondSettingsPage.locator('[name="onlypreview__singleClick"]').click();
  await selectSettingsCategory(secondSettingsPage, 'Preview');
  await expect(secondSettingsPage.locator('[name="onlypreview__wordWrap"]')).toHaveAttribute(
    'aria-checked',
    'false'
  );
  await expect(persistedFontSizeInput).toHaveValue('17');
  await selectSettingsCategory(secondSettingsPage, 'Project');
  await expect(secondSettingsPage.locator('[name="onlypreview__singleClick"]')).toHaveAttribute(
    'aria-checked',
    'true'
  );
  const activeElementAfterBlur = await secondSettingsPage.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    return document.activeElement?.tagName ?? '';
  });
  expect(activeElementAfterBlur).toBe('BODY');
  await Promise.all([
    secondSettingsPage.waitForEvent('close'),
    app.evaluate(({ BrowserWindow }) => {
      const settingsWindow = BrowserWindow.getAllWindows().find((window) =>
        /\/onlypreview\/settings\/index\.html(?:$|[?#])/.test(window.webContents.getURL())
      );
      if (!settingsWindow) throw new Error('OnlyPreview settings window unavailable');
      settingsWindow.webContents.focus();
      settingsWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    })
  ]);

  const thirdSettingsPage = await openSettings();
  const unchangedFontSizeInput = thirdSettingsPage
    .locator(
      '[name="onlypreview__fontSize"] input, input[name="onlypreview__fontSize"], #onlypreview-font-size input, input#onlypreview-font-size'
    )
    .first();
  await expect(unchangedFontSizeInput).toHaveValue('18');
  await expect(thirdSettingsPage.locator('[name="onlypreview__wordWrap"]')).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await selectSettingsCategory(thirdSettingsPage, 'Project');
  await expect(thirdSettingsPage.locator('[name="onlypreview__singleClick"]')).toHaveAttribute(
    'aria-checked',
    'false'
  );
  await Promise.all([
    thirdSettingsPage.waitForEvent('close'),
    thirdSettingsPage.locator('.onlypreview-settings__actions button').first().click()
  ]);
});
