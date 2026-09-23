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
  let scope = 'outside';
  let mount = 'tab';
  const stubs = {
    '@maestro-main/windows/main/previewOpener.registry': { registerMaestroPreviewOpener: value => { opener = value; } },
    '@main/miniapps/onlypreview/onlyPreviewWorkspace.registry': { onlyPreviewWorkspaceRegistry: {} },
    '@main/miniapps/onlypreview/onlyPreviewDisplayUrl.registry': { registerOnlyPreviewDisplayUrlSink() {} },
    '@main/miniapps/onlypreview/onlyPreviewClearWorkspace.service': { clearOnlyPreviewWorkspace() {} },
    '@maestro-main/windows/main/maestroWindow.controller': {
      maestroWindowHelper: { openWorkspaceInPreview: async params => { calls.push(['workspace-tab', params]); return { ok: true }; } }
    },
    '@main/windows/onlyPreviewWindow.helper': { onlyPreviewWindowHelper: { getStandaloneHost: () => null } },
    '@main/windows/onlyPreviewLocalPathTarget': { resolveLocalPathTarget() {} },
    '@main/miniapps/onlypreview/onlyPreviewHostMount.service': { peekOnlyPreviewHostMount: () => mount },
    '@main/miniapps/onlypreview/onlyPreviewExplicitTarget.registry': { openRegisteredOnlyPreviewExplicitTarget: async (path, options) => calls.push(['explicit', path, options]) },
    '@main/fileSearch/fileSearchWindow.service': { fileSearchWindowService: { inspectTarget: async () => ({}) } },
    '@main/miniapps/onlypreview/onlyPreviewWorkspaceScope.service': { resolveOnlyPreviewTargetScope: async () => ({ kind: scope }) },
    '@main/windows/indiPreviewWindow.service': { openIndiPreviewFile: async (path, options) => calls.push(['independent', path, options]) }
  };
  const compiled = ts.transpileModule(read('src/main/windows/onlyPreviewMaestroOpener.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => name.startsWith('node:') ? nodeRequire(name) : stubs[name] ?? (() => { throw new Error(name); })(), module, module.exports);
  module.exports.registerOnlyPreviewMaestroOpener();
  return { calls, opener, osOpen: module.exports.openOnlyPreviewOsTarget, setScope: value => { scope = value; }, setMount: value => { mount = value; } };
};

test('outside local files go directly to IndiPreview without constructing Workspace or browser tabs', async () => {
  const h = harness();
  await h.opener.open('/outside/a.md', { line: 12, fragment: 'intro' });
  await h.opener.open('/outside/b.pdf');
  assert.deepEqual(h.calls, [['independent', '/outside/a.md', { line: 12, fragment: 'intro' }], ['independent', '/outside/b.pdf', undefined]]);
  assert.equal(h.opener.openInTab, undefined);
  assert.equal(h.opener.createFileTabSpec, undefined);
});

test('inside files and directories preserve the Workspace mount preference and location hints', async () => {
  const h = harness();
  h.setScope('inside');
  await h.opener.open('/work/a.md', { line: 4, fragment: 'intro' });
  assert.deepEqual(h.calls.pop(), ['workspace-tab', { path: '/work/a.md', line: 4, fragment: 'intro' }]);
  h.setMount('window'); h.setScope('directory');
  await h.opener.open('/work');
  assert.deepEqual(h.calls.pop(), ['explicit', '/work', undefined]);
});

test('OS targets use the same explicit router as MCP with line and fragment intact', async () => {
  const h = harness();
  await h.osOpen('/outside/a.md', { line: 7, fragment: 'part' });
  assert.deepEqual(h.calls, [['explicit', '/outside/a.md', { line: 7, fragment: 'part' }]]);
});

test('independent surface owns file authority and shared renderers, without Workspace history writes', () => {
  const surface = read('src/main/windows/onlyPreviewSingleFileSurface.service.ts');
  assert.match(surface, /new OnlyPreviewPreviewRegionService/);
  assert.match(surface, /createOnlyPreviewVueView/);
  assert.match(surface, /registerExternalPreview/);
  assert.doesNotMatch(surface, /recordOnlyPreviewRecentFile|openOnlyPreviewAbsoluteTarget|bindProject|openExplicitTarget/);
  assert.match(read('src/main/app.main.ts'), /new OnlyPreviewOpenQueue\(openOnlyPreviewOsTarget\)/);
});
