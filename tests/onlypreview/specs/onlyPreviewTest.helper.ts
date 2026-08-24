import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import sharp from 'sharp';
import {
  expect,
  type OnlyPreviewE2ESession,
  type OnlyPreviewRendererMode
} from '../fixtures/onlyPreviewApp.fixture';

const screenshotRoot = resolve('out/playwright/onlypreview/screenshots');
const ONLY_PREVIEW_ROYAL_BLUE = [0x4e, 0x58, 0x82] as const;
const NATIVE_MENU_BAR_RGB_TOLERANCE = 12;
export const NATIVE_MENU_BAR_REQUIRED_MATCH_RATIO = 0.75;

const matchesOnlyPreviewRoyalBlue = (red: number, green: number, blue: number): boolean =>
  Math.abs(red - ONLY_PREVIEW_ROYAL_BLUE[0]) <= NATIVE_MENU_BAR_RGB_TOLERANCE &&
  Math.abs(green - ONLY_PREVIEW_ROYAL_BLUE[1]) <= NATIVE_MENU_BAR_RGB_TOLERANCE &&
  Math.abs(blue - ONLY_PREVIEW_ROYAL_BLUE[2]) <= NATIVE_MENU_BAR_RGB_TOLERANCE;

const execFileAsync = async (file: string, args: string[]): Promise<void> => {
  await new Promise<void>((resolveExec, rejectExec) => {
    execFile(file, args, (error) => (error ? rejectExec(error) : resolveExec()));
  });
};

export const clickTreeFile = async (
  session: OnlyPreviewE2ESession,
  name: string
): Promise<void> => {
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

export const dispatchTreeDoubleClick = async (
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

export const resetSelectionBroadcastProbe = async (app: ElectronApplication): Promise<void> => {
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

export const selectionBroadcastCount = async (app: ElectronApplication): Promise<number> =>
  await app.evaluate(() => {
    const probe = globalThis as typeof globalThis & {
      __onlyPreviewSelectionBroadcastIds?: Set<string>;
    };
    return probe.__onlyPreviewSelectionBroadcastIds?.size ?? 0;
  });

export const waitForRenderer = async <T>(
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

export const waitForRawPreview = async (
  app: ElectronApplication,
  authority: 'asset' | 'document'
): Promise<{
  url: string;
  childCount: number;
  preferences: Electron.WebPreferences;
}> => {
  let current = {
    url: '',
    childCount: 0,
    preferences: {} as Electron.WebPreferences
  };
  await expect
    .poll(async () => {
      current = await app.evaluate(({ BaseWindow }, expectedAuthority) => {
        const window = BaseWindow.getAllWindows().find(
          (candidate) => candidate.getTitle() === 'OnlyPreview'
        );
        const view = window?.contentView.children.find((candidate) =>
          new RegExp(`^bitterless-preview://${expectedAuthority}/`).test(
            candidate.webContents.getURL()
          )
        );
        return {
          url: view?.webContents.getURL() ?? '',
          childCount: window?.contentView.children.length ?? 0,
          preferences: view?.webContents.getLastWebPreferences() ?? {}
        };
      }, authority);
      return current.url;
    })
    .toMatch(new RegExp(`^bitterless-preview://${authority}/`));
  return current;
};

export const waitForPage = async (
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

export const captureNativeOnlyPreview = async (
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

export const sampleNativeMenuBar = async (
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

export const expectMediaMetadataAndSeek = async (
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
