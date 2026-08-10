import { renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import {
  expect,
  test,
  type OnlyPreviewE2ESession,
  type OnlyPreviewRendererMode
} from '../fixtures/onlyPreviewApp.fixture';
import { createOnlyPreviewSearchFixtures } from '../fixtures/createOnlyPreviewFixtures';

interface ProjectSearchRow {
  relativePath: string;
  fileName: string;
  directory: string;
  snippet: string;
  highlight: string;
}

const withPollDiagnostics = async (
  session: OnlyPreviewE2ESession,
  message: string,
  assertion: () => Promise<void>
): Promise<void> => {
  try {
    await assertion();
  } catch (error) {
    let shellState: unknown;
    try {
      shellState = await session.evaluateRenderer(
        'shell',
        `JSON.stringify({
          url: location.href,
          readyState: document.readyState,
          indexError: document.querySelector('[name="onlypreview__indexError"]')?.textContent?.trim() || '',
          searchError: document.querySelector('.onlypreview-project-search__state--error')?.textContent?.trim() || '',
          bodyText: document.body?.innerText?.slice(0, 4000) || '',
        })`
      );
    } catch (diagnosticError) {
      shellState = `unavailable: ${String(diagnosticError)}`;
    }
    const original = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}\nOriginal assertion: ${original}\nShell state: ${String(shellState)}\nProcess output:\n${session.output.join('')}`,
      error instanceof Error ? { cause: error } : undefined
    );
  }
};

const waitForTreePath = async (
  session: OnlyPreviewE2ESession,
  relativePath: string
): Promise<void> => {
  await withPollDiagnostics(
    session,
    `OnlyPreview tree never exposed ${relativePath}.`,
    async () => {
      await expect
        .poll(
          async () =>
            await session.evaluateRenderer<boolean>(
              'shell',
              `Boolean(document.querySelector('[name="onlypreview__treeRow"][data-relative-path=${JSON.stringify(relativePath)}]'))`
            ),
          { message: `OnlyPreview tree never exposed ${relativePath}.` }
        )
        .toBe(true);
    }
  );
};

const sendShortcut = async (
  session: OnlyPreviewE2ESession,
  mode: OnlyPreviewRendererMode,
  keyCode: string,
  modifiers: Electron.InputEvent['modifiers'] = []
): Promise<void> => {
  await session.sendInputs(mode, [
    { type: 'keyDown', keyCode, modifiers },
    { type: 'keyUp', keyCode, modifiers }
  ]);
};

const openProjectSearch = async (
  session: OnlyPreviewE2ESession,
  expectedDirectory: string
): Promise<void> => {
  const modifier = process.platform === 'darwin' ? 'meta' : 'control';
  await sendShortcut(session, 'preview', 'F', [modifier, 'shift']);
  await withPollDiagnostics(
    session,
    'Project Search did not open from PreviewContent.',
    async () => {
      await expect
        .poll(
          async () =>
            await session.evaluateRenderer(
              'shell',
              `({
                title: document.querySelector('[name="onlypreview__projectTitle"]')?.textContent?.trim() || '',
                focused: document.activeElement?.matches('[name="onlypreview__search"] input') || false,
                scope: document.querySelector('[name="onlypreview__projectSearchScopeSelect"]')?.value || '',
                target: document.querySelector('[name="onlypreview__projectSearchScopeTarget"]')?.textContent?.trim() || '',
              })`
            ),
          { message: 'Project Search did not open from PreviewContent.' }
        )
        .toEqual({
          title: 'Project Search',
          focused: true,
          scope: 'directory',
          target: expectedDirectory
        });
    }
  );
};

const setSearchQuery = async (session: OnlyPreviewE2ESession, query: string): Promise<void> => {
  const changed = await session.evaluateRenderer<boolean>(
    'shell',
    `(() => {
      const input = document.querySelector('[name="onlypreview__search"] input');
      if (!(input instanceof HTMLInputElement)) return false;
      input.focus();
      input.value = ${JSON.stringify(query)};
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(query)} }));
      return true;
    })()`
  );
  expect(changed).toBe(true);
};

const setSearchScope = async (
  session: OnlyPreviewE2ESession,
  scope: 'directory' | 'project'
): Promise<void> => {
  const changed = await session.evaluateRenderer<boolean>(
    'shell',
    `(() => {
      const select = document.querySelector('[name="onlypreview__projectSearchScopeSelect"]');
      if (!(select instanceof HTMLSelectElement)) return false;
      select.value = ${JSON.stringify(scope)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`
  );
  expect(changed).toBe(true);
};

const readSearchRows = async (session: OnlyPreviewE2ESession): Promise<ProjectSearchRow[]> =>
  await session.evaluateRenderer<ProjectSearchRow[]>(
    'shell',
    `Array.from(document.querySelectorAll('[name="onlypreview__projectSearchResult"]')).map((row) => ({
      relativePath: row.getAttribute('title') || '',
      fileName: row.querySelector('[name="onlypreview__projectSearchFileName"]')?.textContent?.trim() || '',
      directory: row.querySelector('[name="onlypreview__projectSearchDirectory"]')?.textContent?.trim() || '',
      snippet: row.querySelector('[name="onlypreview__projectSearchSnippet"]')?.textContent || '',
      highlight: row.querySelector('[name="onlypreview__projectSearchHighlight"]')?.textContent || '',
    }))`
  );

const waitForSearchPaths = async (
  session: OnlyPreviewE2ESession,
  expectedPaths: string[]
): Promise<ProjectSearchRow[]> => {
  await withPollDiagnostics(session, 'Project Search did not settle.', async () => {
    await expect
      .poll(
        async () => ({
          pending: await session.evaluateRenderer<boolean>(
            'shell',
            `Boolean(document.querySelector('[name="onlypreview__projectSearchPending"]'))`
          ),
          paths: (await readSearchRows(session)).map(({ relativePath }) => relativePath).sort()
        }),
        { message: 'Project Search did not settle.' }
      )
      .toEqual({ pending: false, paths: [...expectedPaths].sort() });
  });
  return await readSearchRows(session);
};

const focusTreePath = async (
  session: OnlyPreviewE2ESession,
  relativePath: string,
  activate: boolean
): Promise<void> => {
  const focused = await session.evaluateRenderer<boolean>(
    'shell',
    `(() => {
      const row = document.querySelector('[name="onlypreview__treeRow"][data-relative-path=${JSON.stringify(relativePath)}]');
      if (!(row instanceof HTMLButtonElement)) return false;
      row.focus();
      if (${activate}) row.click();
      return true;
    })()`
  );
  expect(focused).toBe(true);
};

const resetReloadProbe = async (app: ElectronApplication): Promise<void> => {
  await app.evaluate(({ webContents }) => {
    const probe = globalThis as typeof globalThis & {
      __onlyPreviewReloadBroadcastIds?: Set<string>;
      __onlyPreviewReloadPatchedWebContents?: Set<number>;
    };
    probe.__onlyPreviewReloadBroadcastIds = new Set<string>();
    probe.__onlyPreviewReloadPatchedWebContents ??= new Set<number>();
    for (const contents of webContents.getAllWebContents()) {
      if (probe.__onlyPreviewReloadPatchedWebContents.has(contents.id)) continue;
      probe.__onlyPreviewReloadPatchedWebContents.add(contents.id);
      const send = contents.send.bind(contents);
      contents.send = (channel: string, ...args: unknown[]): void => {
        const payload = args[0] as
          | {
              id?: unknown;
              handleName?: unknown;
              params?: { action?: unknown };
            }
          | undefined;
        if (
          channel === '__xpc_broadcast_dispatch__' &&
          payload?.handleName === 'onlypreview/previewControl' &&
          payload.params?.action === 'reload' &&
          typeof payload.id === 'string'
        ) {
          probe.__onlyPreviewReloadBroadcastIds?.add(payload.id);
        }
        send(channel, ...args);
      };
    }
  });
};

const reloadBroadcastCount = async (app: ElectronApplication): Promise<number> =>
  await app.evaluate(() => {
    const probe = globalThis as typeof globalThis & {
      __onlyPreviewReloadBroadcastIds?: Set<string>;
    };
    return probe.__onlyPreviewReloadBroadcastIds?.size ?? 0;
  });

const previewText = async (session: OnlyPreviewE2ESession): Promise<string> =>
  await session.evaluateRenderer<string>(
    'preview',
    `(document.querySelector('[name="onlypreview__monaco"] .view-lines')?.textContent || '').replaceAll('\u00a0', ' ')`
  );

const expectSearchUtilityProcess = async (app: ElectronApplication): Promise<void> => {
  await expect
    .poll(
      async () =>
        await app.evaluate(({ app }) =>
          app
            .getAppMetrics()
            .filter(
              ({ serviceName, type }) =>
                type === 'Utility' && serviceName === 'node.mojom.NodeService'
            )
            .map(({ pid, serviceName, type }) => ({ pid, serviceName, type }))
        )
    )
    .toEqual([
      {
        pid: expect.any(Number),
        serviceName: 'node.mojom.NodeService',
        type: 'Utility'
      }
    ]);
};

test('Project Search keeps a separate tree-name tier and a hidden-pruned file/content index', async ({
  onlyPreview
}) => {
  await waitForTreePath(onlyPreview, 'copy.txt');
  createOnlyPreviewSearchFixtures(onlyPreview.fixtures.root);
  await sendShortcut(onlyPreview, 'preview', 'F5');
  await waitForTreePath(onlyPreview, 'project-scope.txt');
  await waitForTreePath(onlyPreview, '.bitterless');
  await waitForTreePath(onlyPreview, 'node_modules');
  await waitForTreePath(onlyPreview, 'dist');
  await waitForTreePath(onlyPreview, 'output');
  await expectSearchUtilityProcess(onlyPreview.app);

  await focusTreePath(onlyPreview, 'nested/inside.txt', true);
  await expect
    .poll(
      async () =>
        await onlyPreview.evaluateRenderer(
          'previewHeader',
          `document.body.textContent?.includes('nested/inside.txt') || false`
        )
    )
    .toBe(true);
  await openProjectSearch(onlyPreview, 'nested');

  await setSearchQuery(onlyPreview, 'scope-token');
  await waitForSearchPaths(onlyPreview, ['nested/directory-scope.txt']);
  await setSearchScope(onlyPreview, 'project');
  await waitForSearchPaths(onlyPreview, ['nested/directory-scope.txt', 'project-scope.txt']);

  await setSearchQuery(onlyPreview, 'SearchNeedle');
  const filenameAndContentRows = await waitForSearchPaths(onlyPreview, [
    'nested/SearchNeedle-title.txt',
    'nested/content.txt'
  ]);
  expect(filenameAndContentRows.every(({ fileName }) => Boolean(fileName))).toBe(true);
  expect(
    filenameAndContentRows.some(({ relativePath }) => relativePath.includes('SearchNeedle-folder'))
  ).toBe(false);
  expect(
    filenameAndContentRows.find(({ relativePath }) => relativePath === 'nested/content.txt')
  ).toMatchObject({
    fileName: 'content.txt',
    directory: 'nested',
    highlight: 'SearchNeedle'
  });
  const contentSnippet = filenameAndContentRows.find(
    ({ relativePath }) => relativePath === 'nested/content.txt'
  )?.snippet;
  expect(contentSnippet).toBe('0123456789abcdefSearchNeedleabcdefghijklmnop');

  await setSearchQuery(onlyPreview, '中文关键字');
  const cjkRows = await waitForSearchPaths(onlyPreview, ['nested/cjk.txt']);
  expect(cjkRows[0]).toMatchObject({ highlight: '中文关键字' });

  await setSearchQuery(onlyPreview, 'root-hidden-match');
  await waitForSearchPaths(onlyPreview, ['.root-hidden-match.txt']);

  await setSearchQuery(onlyPreview, 'exclusion-proof');
  await waitForSearchPaths(onlyPreview, ['allowed.txt', 'generated/keep/config-reincluded.txt']);

  await setSearchQuery(onlyPreview, 'hard-excluded');
  await waitForSearchPaths(onlyPreview, []);

  await setSearchQuery(onlyPreview, 'SearchNeedle-folder');
  await waitForSearchPaths(onlyPreview, []);

  await sendShortcut(onlyPreview, 'shell', 'Escape');
  await waitForTreePath(onlyPreview, '.hidden');
  await focusTreePath(onlyPreview, '.hidden', false);
  await openProjectSearch(onlyPreview, '.hidden');
  await setSearchQuery(onlyPreview, 'exclusion-proof');
  await waitForSearchPaths(onlyPreview, []);

  await sendShortcut(onlyPreview, 'shell', 'Escape');
  await setSearchQuery(onlyPreview, 'node_modules');
  await waitForTreePath(onlyPreview, 'node_modules');
  expect(await readSearchRows(onlyPreview)).toEqual([]);
  await sendShortcut(onlyPreview, 'shell', 'Escape');
});

test('Project Search watch converges create, update, rename, and delete', async ({
  onlyPreview
}) => {
  await waitForTreePath(onlyPreview, 'copy.txt');
  createOnlyPreviewSearchFixtures(onlyPreview.fixtures.root);
  await sendShortcut(onlyPreview, 'preview', 'F5');
  await waitForTreePath(onlyPreview, 'project-scope.txt');
  await openProjectSearch(onlyPreview, basename(onlyPreview.fixtures.root));
  await setSearchScope(onlyPreview, 'project');

  const createdPath = `${onlyPreview.fixtures.root}/watch-created.txt`;
  const renamedPath = `${onlyPreview.fixtures.root}/watch-renamed.txt`;
  writeFileSync(createdPath, 'crud-created-token\n', 'utf8');
  await setSearchQuery(onlyPreview, 'crud-created-token');
  await waitForSearchPaths(onlyPreview, ['watch-created.txt']);

  writeFileSync(createdPath, 'crud-updated-token\n', 'utf8');
  await setSearchQuery(onlyPreview, 'crud-updated-token');
  await waitForSearchPaths(onlyPreview, ['watch-created.txt']);
  await setSearchQuery(onlyPreview, 'crud-created-token');
  await waitForSearchPaths(onlyPreview, []);

  renameSync(createdPath, renamedPath);
  await setSearchQuery(onlyPreview, 'crud-updated-token');
  await waitForSearchPaths(onlyPreview, ['watch-renamed.txt']);

  unlinkSync(renamedPath);
  await waitForSearchPaths(onlyPreview, []);
});

test('selected-file watch reload is 400ms trailing and ignores nonselected changes', async ({
  onlyPreview
}) => {
  await waitForTreePath(onlyPreview, 'copy.txt');
  const searchFixtures = createOnlyPreviewSearchFixtures(onlyPreview.fixtures.root);
  await sendShortcut(onlyPreview, 'preview', 'F5');
  await waitForTreePath(onlyPreview, 'project-scope.txt');
  await focusTreePath(onlyPreview, 'copy.txt', true);
  await expect.poll(async () => await previewText(onlyPreview)).toContain('OnlyPreview immutable');
  await resetReloadProbe(onlyPreview.app);

  writeFileSync(searchFixtures.selectedWatchPath, 'watch intermediate content\n', 'utf8');
  await new Promise((resolveWait) => setTimeout(resolveWait, 180));
  writeFileSync(searchFixtures.selectedWatchPath, 'watch final visible content\n', 'utf8');
  await new Promise((resolveWait) => setTimeout(resolveWait, 125));
  expect(await reloadBroadcastCount(onlyPreview.app)).toBe(0);
  expect(await previewText(onlyPreview)).not.toContain('watch intermediate content');

  await expect
    .poll(async () => await previewText(onlyPreview))
    .toContain('watch final visible content');
  await expect.poll(async () => await reloadBroadcastCount(onlyPreview.app)).toBe(1);

  writeFileSync(searchFixtures.nonSelectedWatchPath, 'nonselected watch update\n', 'utf8');
  await new Promise((resolveWait) => setTimeout(resolveWait, 850));
  expect(await reloadBroadcastCount(onlyPreview.app)).toBe(1);
  expect(await previewText(onlyPreview)).toContain('watch final visible content');
});
