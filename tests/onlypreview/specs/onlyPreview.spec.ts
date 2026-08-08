import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test, type OnlyPreviewE2ESession } from '../fixtures/onlyPreviewApp.fixture';

const screenshotRoot = resolve('out/playwright/onlypreview/screenshots');

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
  mode: 'shell' | 'preview',
  expression: string,
  expected: T
): Promise<void> => {
  await expect
    .poll(async () => await session.evaluateRenderer<T>(mode, expression), {
      message: () =>
        `OnlyPreview ${mode} did not reach ${JSON.stringify(expected)}.\n${session.output
          .slice(-40)
          .join('')}`
    })
    .toEqual(expected);
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

test('owns two secure views, exact native geometry, shortcuts, and a composite 800x600 capture', async ({
  onlyPreview
}) => {
  const { app, evaluateRenderer, sendInputs } = onlyPreview;
  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.querySelectorAll('[name="onlypreview__treeRow"]').length`,
    7
  );

  const graph = await app.evaluate(({ BaseWindow }) => {
    const windows = BaseWindow.getAllWindows().filter(
      (window) => window.getTitle() === 'OnlyPreview'
    );
    const window = windows[0];
    return {
      count: windows.length,
      minimumSize: window?.getMinimumSize(),
      bounds: window?.getBounds(),
      contentSize: window?.getContentSize(),
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
          preferences: view.webContents.getLastWebPreferences()
        })) ?? []
    };
  });
  expect(graph.count).toBe(1);
  expect(graph.minimumSize).toEqual([800, 600]);
  expect(graph.bounds).toMatchObject({ width: 1180, height: 760 });
  expect(graph.controls).toEqual({ minimizable: true, maximizable: true, closable: true });
  expect(graph.children).toHaveLength(2);
  expect(graph.children.map(({ url }) => url)).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/\/onlypreview\/shell\/index\.html/),
      expect.stringMatching(/\/onlypreview\/preview\/index\.html/)
    ])
  );
  for (const child of graph.children) {
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
      'preview',
      `({ require: typeof globalThis.require, process: typeof globalThis.process })`
    )
  ]);
  expect(globals).toEqual([
    { require: 'undefined', process: 'undefined' },
    { require: 'undefined', process: 'undefined' }
  ]);

  await dispatchTreeDoubleClick(onlyPreview, 'nested');
  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.querySelector('[name="onlypreview__treeRow"][data-relative-path="nested"]')?.getAttribute('aria-expanded')`,
    'false'
  );
  const reopenedDirectory = await evaluateRenderer<boolean>(
    'shell',
    `(() => {
      const row = document.querySelector('[name="onlypreview__treeRow"][data-relative-path="nested"]');
      if (!(row instanceof HTMLButtonElement)) return false;
      row.click();
      return true;
    })()`
  );
  expect(reopenedDirectory).toBe(true);
  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.querySelector('[name="onlypreview__treeRow"][data-relative-path="nested"]')?.getAttribute('aria-expanded')`,
    'true'
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

  expect(graph.contentSize[0]).toBeLessThanOrEqual(1180);
  expect(graph.contentSize[1]).toBeLessThan(760);
  expect(760 - graph.contentSize[1]).toBeGreaterThanOrEqual(20);
  const normalCapture = await captureNativeOnlyPreview(app, 'onlypreview-normal.png', {
    width: 1180,
    height: 760
  });
  expect(normalCapture.width).toBeGreaterThanOrEqual(1180);
  expect(normalCapture.height).toBeGreaterThanOrEqual(760);

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
  const preview = compact.children.find(({ url }) => /\/preview\//.test(url));
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
  expect(preview?.bounds).toEqual(domBounds);
  expect(preview?.bounds.x).toBeGreaterThanOrEqual(185);
  expect(preview?.bounds.y).toBeGreaterThanOrEqual(44);
  expect((preview?.bounds.y ?? 0) + (preview?.bounds.height ?? 0)).toBeLessThanOrEqual(
    compact.contentSize[1] - 25
  );

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

  await sendInputs('preview', [
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
});

test('renders immutable text, selectable PDF, image pixels, and seekable audio/video', async ({
  onlyPreview
}) => {
  const { app, evaluateRenderer, sendInputs } = onlyPreview;
  await waitForRenderer(
    onlyPreview,
    'shell',
    `document.querySelectorAll('[name="onlypreview__treeRow"]').length`,
    7
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
    7
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

  const firstSettingsPage = await openSettings();
  const firstSettingsToken = await firstSettingsPage.evaluate(
    () => (window as unknown as { onlyPreviewEnv: { hostToken: string } }).onlyPreviewEnv.hostToken
  );
  expect(firstSettingsToken).not.toBe(shellToken);
  const settingsWindow = await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows().filter((window) =>
      /\/onlypreview\/settings\/index\.html(?:$|[?#])/.test(window.webContents.getURL())
    );
    const window = windows[0];
    return {
      count: windows.length,
      minimumSize: window?.getMinimumSize(),
      bounds: window?.getBounds(),
      preferences: window?.webContents.getLastWebPreferences()
    };
  });
  expect(settingsWindow.count).toBe(1);
  expect(settingsWindow.minimumSize).toEqual([800, 600]);
  expect(settingsWindow.bounds).toMatchObject({ width: 800, height: 600 });
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
      footer: rect(document.querySelector('[name="onlypreview__settingsActions"]')),
      buttons: Array.from(
        document.querySelectorAll('[name="onlypreview__settingsActions"] button')
      ).map(rect)
    };
  });
  expect(settingsLayout.viewport.width).toBeGreaterThanOrEqual(780);
  expect(settingsLayout.viewport.height).toBeGreaterThanOrEqual(540);
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
  const singleClick = firstSettingsPage.locator('[name="onlypreview__singleClick"]');
  await expect(singleClick).toHaveAttribute('aria-checked', 'true');
  await singleClick.click();
  await expect(singleClick).toHaveAttribute('aria-checked', 'false');
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

  const secondSettingsPage = await openSettings();
  const secondSettingsToken = await secondSettingsPage.evaluate(
    () => (window as unknown as { onlyPreviewEnv: { hostToken: string } }).onlyPreviewEnv.hostToken
  );
  expect(secondSettingsToken).not.toBe(firstSettingsToken);
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
  await expect(secondSettingsPage.locator('[name="onlypreview__singleClick"]')).toHaveAttribute(
    'aria-checked',
    'false'
  );
  await persistedFontSizeInput.fill('17');
  await persistedFontSizeInput.press('Tab');
  await secondSettingsPage.locator('[name="onlypreview__wordWrap"]').click();
  await secondSettingsPage.locator('[name="onlypreview__singleClick"]').click();
  await expect(secondSettingsPage.locator('[name="onlypreview__wordWrap"]')).toHaveAttribute(
    'aria-checked',
    'false'
  );
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
  await expect(thirdSettingsPage.locator('[name="onlypreview__singleClick"]')).toHaveAttribute(
    'aria-checked',
    'false'
  );
  await Promise.all([
    thirdSettingsPage.waitForEvent('close'),
    thirdSettingsPage.locator('.onlypreview-settings__actions button').first().click()
  ]);
});
