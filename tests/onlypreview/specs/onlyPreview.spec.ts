import { expect, test } from '../fixtures/onlyPreviewApp.fixture';
import {
  NATIVE_MENU_BAR_REQUIRED_MATCH_RATIO,
  captureNativeOnlyPreview,
  clickTreeFile,
  dispatchTreeDoubleClick,
  resetSelectionBroadcastProbe,
  sampleNativeMenuBar,
  selectionBroadcastCount,
  waitForRawPreview,
  waitForRenderer
} from './onlyPreviewTest.helper';

test('owns two secure views, exact native geometry, shortcuts, and a composite 800x600 capture', async ({
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
  expect(graph.children).toHaveLength(2);
  expect(graph.children.map(({ url }) => url)).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/\/onlypreview\/shell\/index\.html/),
      expect.stringMatching(/\/onlypreview\/preview\/index\.html/)
    ])
  );
  expect(graph.children.some(({ url }) => url.includes('/onlypreview/previewHeader/'))).toBe(false);
  expect(new Set(graph.children.map(({ webContentsId }) => webContentsId)).size).toBe(2);
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
      'preview',
      `({ require: typeof globalThis.require, process: typeof globalThis.process })`
    )
  ]);
  expect(globals).toEqual([
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
  const previewContent = compact.children.find(
    ({ url }) => /\/onlypreview\/preview\//.test(url) || /^bitterless-preview:\/\//.test(url)
  );
  expect(compact.children).toHaveLength(2);
  expect(shell?.bounds).toEqual({
    x: 0,
    y: 0,
    width: compact.contentSize[0],
    height: compact.contentSize[1]
  });
  const domBounds = await evaluateRenderer<{ x: number; y: number; width: number; height: number }>(
    'shell',
    `(() => { const bounds = document.querySelector('[name="onlypreview__previewContentHost"]')?.getBoundingClientRect();
      return bounds ? { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) } : null; })()`
  );
  expect(previewContent?.bounds).toEqual({
    x: domBounds.x,
    y: domBounds.y,
    width: domBounds.width,
    height: domBounds.height
  });
  expect(previewContent?.bounds.x).toBeGreaterThanOrEqual(185);
  expect(previewContent?.bounds.y).toBe(75);
  const previewHeaderStrip = await evaluateRenderer<{ height: number; hasHost: boolean }>(
    'shell',
    `(() => { const header = document.querySelector('[name="onlypreview__previewToolbar"]');
      return { height: header ? Math.round(header.getBoundingClientRect().height) : 0, hasHost: !!header }; })()`
  );
  expect(previewHeaderStrip).toEqual({ height: 43, hasHost: true });
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
    11
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
  const keyboardPdf = await waitForRawPreview(app, 'asset');
  expect(keyboardPdf.childCount).toBe(2);

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

test('toggles detached Shell and Preview DevTools independently without changing view bounds', async ({
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
        (['shell', 'preview'] as const).map((mode) => {
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
  const expectDevTools = async (shellOpen: boolean, previewOpen: boolean): Promise<void> => {
    await expect
      .poll(async () => {
        const state = await readDevToolsState();
        return {
          shell: { open: state.shell.open, scheme: state.shell.url.split(':', 1)[0] },
          preview: { open: state.preview.open, scheme: state.preview.url.split(':', 1)[0] }
        };
      })
      .toEqual({
        shell: { open: shellOpen, scheme: shellOpen ? 'devtools' : '' },
        preview: { open: previewOpen, scheme: previewOpen ? 'devtools' : '' }
      });
  };
  const expectViewBoundsUnchanged = (state: DevToolsState, baseline: DevToolsState): void => {
    for (const mode of ['shell', 'preview'] as const) {
      expect(state[mode].bounds).toEqual(baseline[mode].bounds);
    }
  };

  const initial = await readDevToolsState();
  expect(initial.shell.open).toBe(false);
  expect(initial.preview.open).toBe(false);

  await sendShortcut('shell', 'F12');
  await expectDevTools(true, false);
  let current = await readDevToolsState();
  expectViewBoundsUnchanged(current, initial);

  const inspectModifiers: InputModifiers =
    process.platform === 'darwin' ? ['meta', 'alt'] : ['control', 'shift'];
  await sendShortcut('preview', 'I', inspectModifiers);
  await expectDevTools(true, true);
  await onlyPreview.assertDisplayRouting();
  current = await readDevToolsState();
  expectViewBoundsUnchanged(current, initial);

  await sendShortcut('shell', 'F12');
  await expectDevTools(false, true);
  current = await readDevToolsState();
  expectViewBoundsUnchanged(current, initial);

  await sendShortcut('preview', 'F12');
  await expectDevTools(false, false);
  current = await readDevToolsState();
  expectViewBoundsUnchanged(current, initial);
});
