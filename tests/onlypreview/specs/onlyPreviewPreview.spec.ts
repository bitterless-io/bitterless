import { expect, test } from '../fixtures/onlyPreviewApp.fixture';
import {
  clickTreeFile,
  dispatchTreeDoubleClick,
  expectMediaMetadataAndSeek,
  resetSelectionBroadcastProbe,
  selectionBroadcastCount,
  waitForPage,
  waitForRawPreview,
  waitForRenderer
} from './onlyPreviewTest.helper';

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
  const pdf = await waitForRawPreview(app, 'asset');
  expect(pdf.childCount).toBe(2);
  expect(pdf.preferences).toMatchObject({
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    plugins: true
  });
  expect(pdf.preferences.preload).toBeUndefined();
  expect(pdf.preferences.additionalArguments).toBeUndefined();

  const expandedForHtml = await evaluateRenderer<boolean>(
    'shell',
    `(() => {
      const nested = document.querySelector('[name="onlypreview__treeRow"][data-relative-path="nested"]');
      if (!(nested instanceof HTMLButtonElement)) return false;
      if (nested.getAttribute('aria-expanded') !== 'true') nested.click();
      return true;
    })()`
  );
  expect(expandedForHtml).toBe(true);
  await waitForRenderer(
    onlyPreview,
    'shell',
    `Boolean(document.querySelector('[name="onlypreview__treeRow"][data-relative-path="nested/raw-page.html"]'))`,
    true
  );
  await clickTreeFile(onlyPreview, 'raw-page.html');
  const rawHtml = await waitForRawPreview(app, 'document');
  expect(rawHtml.childCount).toBe(2);
  expect(rawHtml.preferences.preload).toBeUndefined();
  expect(rawHtml.preferences.additionalArguments).toBeUndefined();
  const containedHtml = await evaluateRenderer<{
    inlineScript: string;
    relativeScript: string;
    headingColor: string;
    imageComplete: boolean;
    imageWidth: number;
  }>(
    'preview',
    `(() => {
      const image = document.querySelector('#onlypreview-contained-image');
      const heading = document.querySelector('#onlypreview-contained-style');
      return {
        inlineScript: document.body.dataset.inlineScript || '',
        relativeScript: document.body.dataset.relativeScript || '',
        headingColor: heading ? getComputedStyle(heading).color : '',
        imageComplete: image instanceof HTMLImageElement && image.complete,
        imageWidth: image instanceof HTMLImageElement ? image.naturalWidth : 0,
      };
    })()`
  );
  expect(containedHtml).toEqual({
    inlineScript: 'ready',
    relativeScript: 'ready',
    headingColor: 'rgb(12, 34, 56)',
    imageComplete: true,
    imageWidth: 1
  });
  const rawHtmlDenied = await evaluateRenderer<{
    remoteFetchDenied: boolean;
    popupDenied: boolean;
    permissionState: PermissionState;
    stayedOnDocument: boolean;
  }>(
    'preview',
    `(async () => {
      const originalUrl = location.href;
      const popupDenied = window.open('https://example.invalid/blocked-popup', '_blank') === null;
      const remoteFetchDenied = await fetch('https://example.invalid/blocked-fetch')
        .then(() => false)
        .catch(() => true);
      const permissionState = (await navigator.permissions.query({ name: 'geolocation' })).state;
      const anchor = document.createElement('a');
      anchor.href = 'https://example.invalid/blocked-navigation';
      document.body.append(anchor);
      anchor.click();
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      return { remoteFetchDenied, popupDenied, permissionState, stayedOnDocument: location.href === originalUrl };
    })()`
  );
  expect(rawHtmlDenied).toEqual({
    remoteFetchDenied: true,
    popupDenied: true,
    permissionState: 'denied',
    stayedOnDocument: true
  });

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
  const doubleClickPdf = await waitForRawPreview(app, 'asset');
  expect(doubleClickPdf.childCount).toBe(2);
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
