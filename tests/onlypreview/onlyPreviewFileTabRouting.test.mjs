import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const nodeRequire = createRequire(import.meta.url);
const harness = () => {
  const calls = [];
  let opener;
  let inspected = { rootRealPath: '/outside', selectedRelativePath: 'report.md' };
  const stubs = {
    '@maestro-main/windows/main/previewOpener.registry': {
      registerMaestroPreviewOpener: (value) => {
        opener = value;
      }
    },
    '@main/miniapps/onlypreview/onlyPreviewWorkspace.registry': {
      onlyPreviewWorkspaceRegistry: {}
    },
    '@main/miniapps/onlypreview/onlyPreviewDisplayUrl.registry': {
      registerOnlyPreviewDisplayUrlSink() {}
    },
    '@maestro-main/windows/main/maestroWindow.controller': {
      maestroWindowHelper: {
        openFilePreviewTab: async (params) => calls.push(['tab', params.path, ...(params.tabId ? [params.tabId] : [])])
      }
    },
    '@main/windows/onlyPreviewWindow.helper': { onlyPreviewWindowHelper: {} },
    '@main/windows/onlyPreviewLocalPathTarget': { resolveLocalPathTarget() {} },
    '@main/miniapps/onlypreview/onlyPreviewHostMount.service': {},
    '@main/miniapps/onlypreview/onlyPreviewExplicitTarget.registry': {
      openRegisteredOnlyPreviewExplicitTarget: async (path) => calls.push(['project', path])
    },
    '@main/fileSearch/fileSearchWindow.service': {
      fileSearchWindowService: { inspectTarget: async () => inspected }
    },
    '@main/windows/onlyPreviewFileTab.service': {
      OnlyPreviewFileTabSurface: class {
        constructor(owner) {
          this.owner = owner;
          calls.push(['construct', owner.path]);
        }
        async open() {
          this.owner.attach({ path: this.owner.path });
        }
        dispose() {
          calls.push(['dispose', this.owner.path]);
        }
        setActive(value) {
          calls.push(['active', this.owner.path, value]);
        }
        refresh() {}
      }
    }
  };
  const compiled = ts.transpileModule(read('src/main/windows/onlyPreviewMaestroOpener.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    (name) =>
      name.startsWith('node:')
        ? nodeRequire(name)
        : (stubs[name] ??
          (() => {
            throw new Error(name);
          })()),
    module,
    module.exports
  );
  module.exports.registerOnlyPreviewMaestroOpener();
  return {
    calls,
    opener,
    open: module.exports.openOnlyPreviewOsTarget,
    setTarget: (value) => {
      inspected = value;
    }
  };
};

test('each OS regular file uses a new main-window tab and a directory retains the Project route', async () => {
  const h = harness();
  await h.open('/outside/a.md');
  await h.open('/outside/b.docx');
  assert.deepEqual(h.calls, [
    ['tab', '/outside/a.md'],
    ['tab', '/outside/b.docx']
  ]);
  h.setTarget({ rootRealPath: '/project', selectedRelativePath: null });
  await h.open('/project');
  assert.deepEqual(h.calls.at(-1), ['project', '/project']);
});

test('address-bar component previews share the file-tab route and each surface has independent teardown', async () => {
  const h = harness();
  await h.opener.openInTab('/outside/a.md');
  assert.deepEqual(h.calls, [['tab', '/outside/a.md']]);
  const a = h.opener.createFileTabSpec('/outside/a.md');
  const b = h.opener.createFileTabSpec('/outside/b.docx');
  const attached = [];
  const host = {
    window: () => ({}),
    contentRect: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    isOpen: () => true,
    attach: (surface) => attached.push(surface),
    close() {}
  };
  await a.open(host);
  await b.open(host);
  a.close(host);
  b.setActive(host, true);
  assert.deepEqual(
    attached.map((value) => value.path),
    ['/outside/a.md', '/outside/b.docx']
  );
  assert.deepEqual(h.calls.slice(-2), [
    ['dispose', '/outside/a.md'],
    ['active', '/outside/b.docx', true]
  ]);
  assert.equal(a.restorable, undefined);
});

test('address routing retains the initiating tab id while OS opens leave it absent', async () => {
  const h = harness();
  await h.opener.openInTab('/outside/a.md', { tabId: 'tab-7' });
  await h.open('/outside/a.md');
  assert.deepEqual(h.calls, [['tab', '/outside/a.md', 'tab-7'], ['tab', '/outside/a.md']]);
});

test('OS and MCP are split; file surfaces do not acquire Project or history side effects', () => {
  const main = read('src/main/app.main.ts');
  assert.match(main, /new OnlyPreviewOpenQueue\(openOnlyPreviewOsTarget\)/);
  assert.match(
    main,
    /configurePreviewOpener\(\(target\) =>\s*openOnlyPreviewAbsoluteTarget\(target, \{ preserveTreeSelection: true \}\)/
  );
  const surface = read('src/main/windows/onlyPreviewFileTab.service.ts');
  assert.match(surface, /new OnlyPreviewPreviewRegionService/);
  assert.match(surface, /registerExternalPreview/);
  assert.doesNotMatch(
    surface,
    /recordOnlyPreviewRecentFile|openOnlyPreviewAbsoluteTarget|bindProject|openExplicitTarget/
  );
  const explicit = read('src/main/miniapps/onlypreview/onlyPreviewExplicitOpen.service.ts');
  const lastOpen = explicit.slice(
    explicit.indexOf('const accepted = await presentOnlyPreviewExplicitFile')
  );
  assert.ok(
    lastOpen.indexOf('.restoreWorkspace(') < lastOpen.indexOf('await recordOnlyPreviewRecentFile(')
  );
  assert.match(lastOpen, /presentRestoredSelection: false/);
});
