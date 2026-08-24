import { expect, test } from '../fixtures/onlyPreviewApp.fixture';
import { waitForRenderer } from './onlyPreviewTest.helper';

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
      ids: [
        'onlypreview-preview',
        'onlypreview-open-externally',
        'onlypreview-reveal-in-folder',
        'onlypreview-copy-item',
        'onlypreview-copy-path',
        'onlypreview-copy-relative-path',
        'onlypreview-copy-name',
        'onlypreview-delete'
      ],
      labels: [
        'Preview',
        'Open in system app',
        'Reveal in folder',
        'Copy File',
        'Copy Path',
        'Copy Relative Path',
        'Copy Name',
        'Delete…'
      ],
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
