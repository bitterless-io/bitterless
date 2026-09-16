/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const root = resolve(import.meta.dirname, '../..');
const require = createRequire(join(root, 'package.json'));
const { build, transformSync } = require('esbuild');
const ts = require('typescript');
const shell = 'src/renderer/onlypreview/shell/src/';
const main = 'src/main/miniapps/onlypreview/';
const read = (path) => readFileSync(join(root, path), 'utf8');
const evaluate = (code, bindings = {}) => {
  const module = { exports: {} };
  new Function('module', 'exports', 'require', ...Object.keys(bindings), code)(
    module,
    module.exports,
    require,
    ...Object.values(bindings)
  );
  return module.exports;
};
const search = {
  browseDirectory: async () => {
    throw Error('unexpected browse');
  }
};
const bundle = await build({
  stdin: {
    contents: [
      'src/shared/onlypreview/onlyPreview.contract.ts',
      'src/shared/onlypreview/onlyPreview.types.ts',
      'src/preload/fileSearch/fileSearchProjectAuthority.service.ts',
      'src/preload/fileSearch/fileSearchProjectPaste.service.ts',
      main + 'onlyPreviewClipboard.service.ts',
      main + 'onlyPreviewClipboardRead.service.ts',
      shell + 'onlyPreviewProjectPaste.service.ts',
      shell + 'onlyPreviewBrowseProjection.service.ts',
      shell + 'onlyPreviewTree.service.ts'
    ]
      .map((path) => `export * from './${path}';`)
      .join('\n'),
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  tsconfig: join(root, 'tsconfig.node.json'),
  plugins: [
    {
      name: 'isolated-ports',
      setup(builder) {
        builder.onResolve({ filter: /onlyPreviewSearch\.client$/ }, () => ({
          path: 'search',
          namespace: 'stub'
        }));
        builder.onResolve({ filter: /^electron$/ }, () => ({
          path: 'electron',
          namespace: 'stub'
        }));
        builder.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({
          contents:
            path === 'search'
              ? 'export const onlyPreviewSearchClient = globalThis.__pasteTestSearch;'
              : 'export const clipboard = { writeText() { throw Error("Do not change user clipboard"); } };'
        }));
      }
    }
  ]
});
globalThis.__pasteTestSearch = search;
const runtime = evaluate(bundle.outputFiles[0].text);
delete globalThis.__pasteTestSearch;
const authoringText = read(shell + 'onlyPreviewProjectAuthoring.store.ts');
const ast = ts.createSourceFile('authoring.ts', authoringText, ts.ScriptTarget.Latest, true);
const authoringSource = ast.statements
  .filter((node) => !ts.isImportDeclaration(node))
  .map((node) => node.getText(ast))
  .join('\n');
const { OnlyPreviewProjectAuthoringController } = evaluate(
  transformSync(authoringSource, { loader: 'ts', format: 'cjs' }).code,
  {
    reactive: (value) => value,
    onlyPreviewShellStore: {},
    ...runtime,
    describeOnlyPreviewError: (error) => error.message
  }
);
const withFiles = async (run) => {
  const dir = mkdtempSync(join(tmpdir(), 'onlypreview-paste-'));
  try {
    mkdirSync(join(dir, 'source'));
    mkdirSync(join(dir, 'target'));
    writeFileSync(join(dir, 'source', '中文 文档.md'), 'hello');
    mkdirSync(join(dir, 'source', 'folder'));
    writeFileSync(join(dir, 'source', 'folder', 'inside.txt'), 'nested');
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const success = (value) => ({ ok: true, value });
const deferred = () => {
  let finish;
  const promise = new Promise((r) => {
    finish = r;
  });
  return { promise, finish };
};

test('private authority pastes a file and recursive directory into selected folder', async () =>
  withFiles(async (dir) => {
    const authority = new runtime.FileSearchProjectAuthority();
    const binding = await authority.bindWorkspace('instance', 'workspace', dir);
    const result = await authority.pasteItems(
      'instance',
      'workspace',
      binding.workspaceGeneration,
      'target',
      [join(dir, 'source', '中文 文档.md'), join(dir, 'source', 'folder')]
    );
    assert.deepEqual(
      result.map((entry) => entry.relativePath),
      ['target/中文 文档.md', 'target/folder']
    );
    assert.equal(readFileSync(join(dir, 'target', '中文 文档.md'), 'utf8'), 'hello');
    assert.equal(readFileSync(join(dir, 'target', 'folder', 'inside.txt'), 'utf8'), 'nested');
  }));

test('preflight catches any collision before copying the first item', async () =>
  withFiles(async (dir) => {
    mkdirSync(join(dir, 'target', 'folder'));
    await assert.rejects(
      runtime.pasteOnlyPreviewProjectFiles(
        [join(dir, 'source', '中文 文档.md'), join(dir, 'source', 'folder')],
        join(dir, 'target'),
        async () => {}
      ),
      { code: 'NAME_EXISTS' }
    );
    assert.equal(existsSync(join(dir, 'target', '中文 文档.md')), false);
  }));

test('self/descendant paste is refused and source remains intact', async () =>
  withFiles(async (dir) => {
    await assert.rejects(
      runtime.pasteOnlyPreviewProjectFiles(
        [join(dir, 'source')],
        join(dir, 'source', 'folder'),
        async () => {}
      ),
      { code: 'INVALID_INPUT' }
    );
    assert.equal(readFileSync(join(dir, 'source', 'folder', 'inside.txt'), 'utf8'), 'nested');
  }));

test('a workspace fence failure rolls back only newly copied entries', async () =>
  withFiles(async (dir) => {
    let checks = 0;
    await assert.rejects(
      runtime.pasteOnlyPreviewProjectFiles(
        [join(dir, 'source', 'folder')],
        join(dir, 'target'),
        async () => {
          if (++checks === 2) throw Error('workspace changed');
        }
      ),
      /workspace changed/
    );
    assert.equal(existsSync(join(dir, 'target', 'folder')), false);
  }));

test('authority rejects an old workspace generation and file destination', async () =>
  withFiles(async (dir) => {
    const authority = new runtime.FileSearchProjectAuthority();
    const binding = await authority.bindWorkspace('instance', 'workspace', dir);
    await assert.rejects(
      authority.pasteItems('instance', 'workspace', binding.workspaceGeneration + 1, 'target', [
        join(dir, 'source', 'folder')
      ])
    );
    await assert.rejects(
      authority.pasteItems(
        'instance',
        'workspace',
        binding.workspaceGeneration,
        'source/中文 文档.md',
        [join(dir, 'source', 'folder')]
      )
    );
    assert.equal(existsSync(join(dir, 'target', 'folder')), false);
  }));

test('renderer paste request never accepts clipboard paths or arbitrary fields', () => {
  const request = {
    hostToken: 'host'.repeat(8),
    workspaceId: 'workspace'.repeat(4),
    parentRelativePath: ''
  };
  assert.deepEqual(runtime.parseOnlyPreviewPasteProjectItemsRequest(request), request);
  assert.throws(() =>
    runtime.parseOnlyPreviewPasteProjectItemsRequest({ ...request, sourcePaths: ['/secret'] })
  );
  assert.throws(() =>
    runtime.parseOnlyPreviewPasteProjectItemsRequest({
      ...request,
      parentRelativePath: '../outside'
    })
  );
});

test('clipboard parser preserves all paths, deduplicates and rejects malformed data', () => {
  assert.deepEqual(
    runtime.parseOnlyPreviewClipboardFiles('["/a b/中文.md","/two","/two"]', 'darwin'),
    ['/a b/中文.md', '/two']
  );
  assert.deepEqual(runtime.parseOnlyPreviewClipboardFiles('[]', 'darwin'), []);
  for (const value of [
    '"/path"',
    '["relative"]',
    '[null]',
    JSON.stringify(Array(201).fill('/a'))
  ]) {
    assert.throws(() => runtime.parseOnlyPreviewClipboardFiles(value, 'darwin'));
  }
});

test(
  'macOS real file URL write/read roundtrip uses a private pasteboard',
  { skip: process.platform !== 'darwin' },
  async () =>
    withFiles(async (dir) => {
      const paths = [join(dir, 'source', '中文 文档.md'), join(dir, 'source', 'folder')];
      const write = runtime
        .createOnlyPreviewClipboardCommand('darwin', paths)
        .args[3].replaceAll('$.NSPasteboard.generalPasteboard', 'privateBoard')
        .replace('function run(argv)', 'function writeFiles(argv)');
      const read = runtime
        .createOnlyPreviewClipboardReadCommand('darwin')
        .args[3].replaceAll('$.NSPasteboard.generalPasteboard', 'privateBoard')
        .replace('function run()', 'function readFiles()');
      const script = `${write}\n${read}\nfunction run(argv) { return roundtrip(argv); }\nvar privateBoard; function roundtrip(argv) { privateBoard = $.NSPasteboard.pasteboardWithUniqueName; try { writeFiles(argv); return readFiles(); } finally { privateBoard.releaseGlobally; } }`;
      const output = execFileSync(
        '/usr/bin/osascript',
        ['-l', 'JavaScript', '-e', script, '--', ...paths],
        { encoding: 'utf8', timeout: 5000 }
      );
      assert.deepEqual(runtime.parseOnlyPreviewClipboardFiles(output, 'darwin'), paths);
    })
);

const event = (patch = {}) => ({
  key: 'v',
  code: 'KeyV',
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  defaultPrevented: false,
  ...patch
});
const context = { active: true, isMac: true, editing: false, targetIsEditable: false };
test('paste shortcut is scoped and leaves text editing alone', () => {
  assert.equal(runtime.resolveOnlyPreviewPasteShortcut(event(), context), true);
  assert.equal(
    runtime.resolveOnlyPreviewPasteShortcut(event({ metaKey: false, ctrlKey: true }), {
      ...context,
      isMac: false
    }),
    true
  );
  for (const patch of [{ active: false }, { editing: true }, { targetIsEditable: true }])
    assert.equal(runtime.resolveOnlyPreviewPasteShortcut(event(), { ...context, ...patch }), false);
  for (const patch of [
    { shiftKey: true },
    { altKey: true },
    { repeat: true },
    { isComposing: true },
    { defaultPrevented: true },
    { metaKey: false }
  ])
    assert.equal(runtime.resolveOnlyPreviewPasteShortcut(event(patch), context), false);
});

const entry = (relativePath, nodeKind = 'directory') => ({
  relativePath,
  name: relativePath.split('/').at(-1),
  nodeKind
});
test('paste controller uses selected directory, parent of file, and project root', async () => {
  for (const [selected, parentRelativePath] of [
    ['folder', 'folder'],
    ['folder/file.md', 'folder'],
    ['', '']
  ]) {
    const host = {
      workspace: { workspaceId: 'ws' },
      treeSelectedRelativePath: selected,
      index: { entries: [entry('folder'), entry('folder/file.md', 'file')] },
      errorMessage: ''
    };
    const requests = [],
      revealed = [];
    const controller = new runtime.OnlyPreviewProjectPasteController(
      host,
      {
        pasteProjectItems: async (request) => {
          requests.push(request);
          return success([entry('folder/new')]);
        }
      },
      'host',
      async (...args) => revealed.push(args),
      String
    );
    await controller.paste();
    assert.deepEqual(requests, [{ hostToken: 'host', workspaceId: 'ws', parentRelativePath }]);
    assert.equal(revealed.length, 1);
  }
});

test('paste controller ignores repeats and results after a workspace switch', async () => {
  const gate = deferred();
  let requests = 0;
  let reveals = 0;
  const host = {
    workspace: { workspaceId: 'ws' },
    treeSelectedRelativePath: '',
    index: null,
    errorMessage: ''
  };
  const controller = new runtime.OnlyPreviewProjectPasteController(
    host,
    {
      pasteProjectItems: async () => {
        requests++;
        return gate.promise;
      }
    },
    'host',
    async () => reveals++,
    String
  );
  const pending = controller.paste();
  await controller.paste();
  host.workspace = { workspaceId: 'other' };
  gate.finish(success([entry('new')]));
  await pending;
  assert.equal(requests, 1);
  assert.equal(reveals, 0);
  assert.equal(controller.busy, false);
});

const browseEntry = (path, nodeKind = 'directory') => ({
  ...entry(path, nodeKind),
  parentRelativePath: runtime.getOnlyPreviewParentPath(path),
  directoryToken: nodeKind === 'directory' ? 'token:' + path : null,
  size: 0,
  modifiedAt: 0,
  previewHint: 'unsupported',
  mediaType: 'unknown',
  isText: false,
  searchExcluded: false
});
const listing = (path, entries) => ({
  workspaceId: 'ws',
  generation: 1,
  relativePath: path,
  directoryToken: 'token:' + path,
  entries
});
const browseContext = { workspaceId: 'ws', generation: 1, hostToken: 'host' };
const authoringHarness = () => {
  const projection = new runtime.OnlyPreviewBrowseProjectionService();
  const expandedPaths = new Set();
  const initial = projection.applyListing(
    listing('', [browseEntry('docs')]),
    browseContext,
    expandedPaths
  );
  projection.applyListing(listing('docs', []), browseContext, expandedPaths);
  const host = {
    workspace: { workspaceId: 'ws' },
    index: initial.index,
    expandedPaths,
    selectedRelativePath: '',
    focusedRelativePath: '',
    treeSelectedRelativePath: null,
    errorMessage: '',
    collapseTreeSelection() {
      return undefined;
    },
    browseProjection: projection,
    refreshIndex: () => {
      throw Error('Must not wait for global index');
    }
  };
  return { host, projection, authoring: new OnlyPreviewProjectAuthoringController(host) };
};
test('created folder bypasses parent cache and search queue, including while rename is busy', async () => {
  const { host, authoring } = authoringHarness();
  const requests = [];
  search.browseDirectory = async (request) => {
    requests.push(request);
    return success(listing('docs', [browseEntry('docs/V1')]));
  };
  authoring.busy = true;
  await authoring.revealCreatedFolder('docs/V1', 'ws');
  assert.equal(host.treeSelectedRelativePath, 'docs/V1');
  assert.equal(
    host.index.entries.some((item) => item.relativePath === 'docs/V1'),
    true
  );
  assert.equal(host.expandedPaths.has('docs'), true);
  assert.equal(requests.length, 1);
});

test('consecutive creates cannot let an older response overwrite the latest listing', async () => {
  const { host, authoring } = authoringHarness();
  const first = deferred(),
    second = deferred();
  let calls = 0;
  search.browseDirectory = () => (++calls === 1 ? first.promise : second.promise);
  const a = authoring.revealCreatedFolder('docs/V1', 'ws');
  const b = authoring.revealCreatedFolder('docs/V2', 'ws');
  await new Promise((r) => setImmediate(r));
  second.finish(success(listing('docs', [browseEntry('docs/V1'), browseEntry('docs/V2')])));
  await b;
  first.finish(success(listing('docs', [browseEntry('docs/V1')])));
  await a;
  assert.equal(host.treeSelectedRelativePath, 'docs/V2');
  assert.equal(
    host.index.entries.some((item) => item.relativePath === 'docs/V2'),
    true
  );
});

test('new-folder results are ignored when the workspace changes mid-read', async () => {
  const { host, authoring, projection } = authoringHarness();
  const gate = deferred();
  search.browseDirectory = () => gate.promise;
  const pending = authoring.revealCreatedFolder('docs/V1', 'ws');
  await new Promise((r) => setImmediate(r));
  host.workspace = { workspaceId: 'other' };
  projection.clear(host.expandedPaths);
  host.index = null;
  gate.finish(success(listing('docs', [browseEntry('docs/V1')])));
  await pending;
  assert.equal(host.index, null);
  assert.equal(host.treeSelectedRelativePath, null);
});

test('authority can paste at the project root', async () =>
  withFiles(async (dir) => {
    const authority = new runtime.FileSearchProjectAuthority();
    const binding = await authority.bindWorkspace('instance', 'workspace', dir);
    const result = await authority.pasteItems(
      'instance',
      'workspace',
      binding.workspaceGeneration,
      '',
      [join(dir, 'source', '中文 文档.md')]
    );
    assert.equal(result[0].relativePath, '中文 文档.md');
    assert.equal(readFileSync(join(dir, '中文 文档.md'), 'utf8'), 'hello');
  }));

const classMethod = (file, method) => {
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  const owner = ast.statements.find(ts.isClassDeclaration);
  const found = owner.members.find((member) => member.name?.getText(ast) === method);
  assert.ok(found, method);
  return found.getText(ast);
};
test('Main reads the OS clipboard and fences workspace before dispatching private paste', async () => {
  const authority = { workspaceId: 'workspace', workspaceGeneration: 4, relativePath: 'target' };
  const requests = [];
  let valid = true;
  let reads = 0;
  const nativeSource = `export class NativeActions { ${classMethod(main + 'onlyPreviewProjectNativeAction.service.ts', 'pasteProjectItems')} }`;
  const { NativeActions } = evaluate(
    transformSync(nativeSource, { loader: 'ts', format: 'cjs' }).code,
    {
      onlyPreviewWorkspaceRegistry: { getProjectAuthorityItemRef: () => authority },
      readOnlyPreviewClipboardFiles: async () => {
        reads++;
        return ['/source/a', '/source/b'];
      },
      fileSearchWindowService: {
        pasteProjectItems: async (request) => {
          requests.push(request);
          return [entry('target/a', 'file'), entry('target/b')];
        }
      }
    }
  );
  const actions = new NativeActions();
  actions.requireCurrentAuthority = (value) => {
    assert.equal(value, authority);
    if (!valid) throw Error('workspace changed');
  };
  assert.deepEqual(
    await actions.pasteProjectItems({
      hostToken: 'host',
      workspaceId: 'workspace',
      parentRelativePath: 'target'
    }),
    [entry('target/a', 'file'), entry('target/b')]
  );
  assert.deepEqual(requests, [
    {
      workspaceId: 'workspace',
      workspaceGeneration: 4,
      parentRelativePath: 'target',
      sourcePaths: ['/source/a', '/source/b']
    }
  ]);
  valid = false;
  await assert.rejects(
    actions.pasteProjectItems({
      hostToken: 'host',
      workspaceId: 'workspace',
      parentRelativePath: 'target'
    }),
    /workspace changed/
  );
  assert.equal(reads, 1);
  assert.equal(requests.length, 1);
});
