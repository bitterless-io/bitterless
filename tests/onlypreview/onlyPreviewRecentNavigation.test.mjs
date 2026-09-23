/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const env = {
  rows: new Map(),
  calls: [],
  writes: [],
  events: [],
  deleted: new Set(),
  directories: new Set(),
  host: null,
  presentation: null,
  inspectHook: null,
  runtimeToken: 'a'.repeat(64),
  regions: new Map()
};
let runtime;
const requireHost = (token) => runtime.onlyPreviewHostRegistry.require(token, ['content']);
const inspected = (path) => {
  if (env.deleted.has(path))
    throw new runtime.OnlyPreviewContractError('PATH_NOT_FOUND', 'File no longer exists.');
  const directory = env.directories.has(path) ? path : dirname(path);
  return {
    rootRealPath: directory,
    rootName: basename(directory),
    displayPath: directory,
    ...(directory === path ? {} : { selectedRelativePath: basename(path) })
  };
};
const present = async (token, fileRef, _traceTag, fragment) => {
  requireHost(token);
  env.calls.push({ method: 'present', fileRef: { ...fileRef }, fragment });
  env.presentation = {
    hostId: env.host.hostId,
    selectionRevision: (env.presentation?.selectionRevision ?? 0) + 1,
    surface: 'vue',
    fileRef,
    selectedTextAvailable: true,
    adapterId: fileRef.relativePath.endsWith('.md') ? 'markdown-dom' : 'text'
  };
};
env.preview = {
  snapshot: (token) => {
    requireHost(token);
    return env.presentation;
  },
  snapshotForVue: (token, runtimeToken) => {
    requireHost(token);
    env.calls.push({ method: 'source-snapshot' });
    if (runtimeToken !== env.runtimeToken)
      throw new runtime.OnlyPreviewContractError('INVALID_INPUT', 'Stale runtime.');
    return env.presentation;
  },
  present,
  refresh: async (token) => {
    requireHost(token);
    env.calls.push({ method: 'refresh-preview' });
    env.presentation = {
      ...env.presentation,
      selectionRevision: env.presentation.selectionRevision + 1
    };
  },
  navigateFragment: (token, runtimeToken, selectionRevision, fragment) => {
    requireHost(token);
    assert.equal(runtimeToken, env.runtimeToken);
    assert.equal(selectionRevision, env.presentation.selectionRevision);
    env.calls.push({ method: 'fragment', fragment });
  },
  clearWorkspace: () => {
    throw new Error('File navigation must not clear the Project preview');
  }
};
env.files = {
  acquirePreviewRuntime: async () => () => {},
  inspectTarget: async (path) => {
    env.calls.push({ method: 'inspect', path });
    await env.inspectHook?.(path);
    return inspected(path);
  },
  authorizeProjectItem: async (ref) => {
    env.calls.push({ method: 'authorize', ...ref });
    const authority = runtime.onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(
      env.host.hostToken,
      ref
    );
    const canonicalPath = resolve(authority.workspace.rootRealPath, ref.relativePath);
    if (env.deleted.has(canonicalPath))
      throw new runtime.OnlyPreviewContractError('PATH_NOT_FOUND', 'File no longer exists.');
    return {
      ...ref,
      canonicalPath,
      nodeKind: env.directories.has(canonicalPath) ? 'directory' : 'file'
    };
  }
};
env.window = {
  ensureStandalone: async () => env.host,
  getStandaloneHost: () => env.host,
  show: () => env.calls.push({ method: 'show-window' })
};
globalThis.__recentNavigation = env;
after(() => {
  delete globalThis.__recentNavigation;
});
const stubs = {
  'indiPreviewWindow.service': 'export const openIndiPreviewFile = async (path, options) => globalThis.__recentNavigation.calls.push({ method: \'independent\', path, options });',
  'onlyPreviewWindow.helper':
    'export const onlyPreviewWindowHelper = globalThis.__recentNavigation.window;',
  'onlyPreviewPreviewRegion.service':
    // 预览区**按 host 解析**(不再是进程级单例)。stub 里两者指向同一个假实例 —— 这个用例只有一个
    // host,它要验的是"谁被调用了什么",不是"哪一个实例"。
    'export const onlyPreviewPreviewRegionService = globalThis.__recentNavigation.preview;' +
    'export const resolveOnlyPreviewPreviewRegion = token => globalThis.__recentNavigation.regions.get(token) ?? globalThis.__recentNavigation.preview;',
  'fileSearchWindow.service':
    'export const fileSearchWindowService = globalThis.__recentNavigation.files;',
  'onlyPreviewOpenDiagnostics.runtime':
    'export const onlyPreviewOpenDiagnostics = { trace: () => ({ mark(){}, end(){} }) };',
  'electron-xpc/main':
    'export const xpcMain = { broadcast: (event, payload) => globalThis.__recentNavigation.events.push({ event, payload }) };'
};
const bundled = await build({
  stdin: {
    contents: `
      export * from './src/main/miniapps/onlypreview/onlyPreviewRecentNavigation.service.ts';
      export { resolveOnlyPreviewMarkdownLink } from './src/main/miniapps/onlypreview/onlyPreviewMarkdownLink.service.ts';
      export { openOnlyPreviewAbsoluteTarget, onlyPreviewTargetMutations } from './src/main/miniapps/onlypreview/onlyPreviewExplicitOpen.service.ts';
      export { selectOnlyPreviewFile } from './src/main/miniapps/onlypreview/onlyPreviewSelectFile.service.ts';
      export { onlyPreviewHostRegistry } from './src/main/miniapps/onlypreview/onlyPreviewHost.registry.ts';
      export { onlyPreviewWorkspaceRegistry } from './src/main/miniapps/onlypreview/onlyPreviewWorkspace.registry.ts';
      export { onlyPreviewRecentsService } from './src/main/miniapps/onlypreview/onlyPreviewRecents.runtime.ts';
      export { onlyPreviewRecentDirectoryService } from './src/main/miniapps/onlypreview/onlyPreviewRecentDirectory.service.ts';
      export { OnlyPreviewContractError } from './src/shared/onlypreview/onlyPreview.contract.ts';
    `,
    resolveDir: root
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: resolve(root, 'tsconfig.node.json'),
  plugins: [
    {
      name: 'recent-navigation-native-boundaries',
      setup(context) {
        context.onResolve({ filter: /.*/ }, ({ path }) => {
          const key = Object.keys(stubs).find((name) => path.endsWith(name));
          if (key) return { path: key, namespace: 'recent-navigation-test' };
        });
        context.onLoad({ filter: /.*/, namespace: 'recent-navigation-test' }, ({ path }) => ({
          contents: stubs[path]
        }));
      }
    }
  ]
});
runtime = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
const storageKey = (params) => JSON.stringify([params.key, params.sub_key]);
const storage = {
  getStored: async (params) => {
    const serializedValue = env.rows.get(storageKey(params));
    return {
      exists: serializedValue !== undefined,
      valid: serializedValue !== undefined,
      value: serializedValue === undefined ? null : JSON.parse(serializedValue),
      serializedValue: serializedValue ?? null
    };
  },
  insertIfAbsent: async (params) => {
    if (env.rows.has(storageKey(params))) return false;
    env.writes.push(params);
    env.rows.set(storageKey(params), JSON.stringify(params.value));
    return true;
  },
  compareAndSet: async (params) => {
    if (env.rows.get(storageKey(params)) !== params.expectedSerializedValue) return false;
    env.writes.push(params);
    env.rows.set(storageKey(params), JSON.stringify(params.value));
    return true;
  }
};
runtime.onlyPreviewRecentsService.configureStorage(storage);
runtime.onlyPreviewRecentsService.markStorageReady();
runtime.onlyPreviewRecentDirectoryService.configureStorage(storage);
runtime.onlyPreviewRecentDirectoryService.configureTargetRuntime({
  defaultWorkspace: () => '/navigation-fixture/default',
  inspectTarget: async (path) => inspected(path),
  bindWorkspace: async (token, workspace) => {
    env.calls.push({ method: 'bind-project', workspaceId: workspace.workspaceId });
    runtime.onlyPreviewWorkspaceRegistry.bindProjectAuthority(token, workspace.workspaceId, 1);
  }
});
runtime.onlyPreviewRecentDirectoryService.markStorageReady();
let testNumber = 0;
const reset = async (withProject = true) => {
  await runtime.onlyPreviewTargetMutations.run(async () => undefined);
  await runtime.onlyPreviewRecentsService.flushPendingWrites();
  await runtime.onlyPreviewRecentDirectoryService.flushPendingWrites();
  runtime.onlyPreviewHostRegistry.clear();
  env.calls.length = 0;
  env.writes.length = 0;
  env.events.length = 0;
  env.deleted.clear();
  env.directories.clear();
  env.directories.add('/navigation-fixture/default');
  runtime.onlyPreviewRecentDirectoryService.clearTransientState();
  env.inspectHook = null;
  env.regions.clear();
  env.host = runtime.onlyPreviewHostRegistry.issue('standalone', 'content');
  env.presentation = {
    hostId: env.host.hostId,
    selectionRevision: 0,
    surface: 'none',
    fileRef: null,
    selectedTextAvailable: false
  };
  const projectPath = `/navigation-fixture/project-${++testNumber}`;
  let project;
  if (withProject) {
    env.directories.add(projectPath);
    project = runtime.onlyPreviewWorkspaceRegistry.registerValidatedTarget(
      env.host.hostToken,
      inspected(projectPath)
    );
    runtime.onlyPreviewWorkspaceRegistry.bindProjectAuthority(
      env.host.hostToken,
      project.workspaceId,
      1
    );
  }
  return { host: env.host, project, projectPath };
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise((done) => setImmediate(done));
const recents = () => runtime.onlyPreviewRecentsService.snapshot(env.host.hostToken);
const names = (snapshot) => snapshot.entries.map(({ name }) => name);
const recentWrites = () => env.writes.filter(({ key }) => key === 'onlypreview_recents');
const linkRequest = (href) => ({
  hostToken: env.host.hostToken,
  previewRuntimeToken: env.runtimeToken,
  selectionRevision: env.presentation.selectionRevision,
  href
});
const invalid = (error) => error.code === 'INVALID_INPUT';

test('explicit opens and tree selections promote while Recent activation only moves the cursor', async () => {
  const { host, project, projectPath } = await reset();
  await runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/a.md`);
  await runtime.selectOnlyPreviewFile(host.hostToken, {
    workspaceId: project.workspaceId,
    relativePath: 'b.md'
  });
  await runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/c.md`);
  let snapshot = await recents();
  assert.deepEqual(names(snapshot), ['c.md', 'b.md', 'a.md']);
  const entries = snapshot.entries;
  for (const index of [1, 2, 0]) {
    const target = entries[index];
    await runtime.openOnlyPreviewRecent({
      hostToken: host.hostToken,
      revision: snapshot.revision,
      entryId: target.id
    });
    snapshot = await recents();
    assert.deepEqual(snapshot.entries, entries);
    assert.equal(snapshot.activeEntryId, target.id);
    assert.equal(snapshot.canBack, index + 1 < entries.length);
    assert.equal(snapshot.canForward, index > 0);
    assert.equal(snapshot.canReload, true);
    assert.equal(snapshot.canLocate, true);
    assert.equal(env.presentation.fileRef.relativePath, target.name);
    assert.equal(recentWrites().length, 3);
  }
  assert.equal(recentWrites().length, 3);
  assert.equal(env.calls.filter(({ method }) => method === 'present').length, 6);
  await runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/a.md`);
  assert.deepEqual(names(await recents()), ['a.md', 'c.md', 'b.md']);
  await runtime.selectOnlyPreviewFile(host.hostToken, {
    workspaceId: project.workspaceId,
    relativePath: 'b.md'
  });
  assert.deepEqual(names(await recents()), ['b.md', 'a.md', 'c.md']);
  assert.equal(recentWrites().length, 5);
});

test('Back/Forward preserve order and writes, Reload refreshes only Preview, and same-file tree activation promotes without presenting twice', async () => {
  const { host, project, projectPath } = await reset();
  for (const name of ['a', 'b', 'c'])
    await runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/${name}.md`);
  let snapshot = await recents();
  const writes = recentWrites().length;
  await runtime.navigateOnlyPreviewRecent({
    hostToken: host.hostToken,
    revision: snapshot.revision,
    direction: 'back'
  });
  snapshot = await recents();
  assert.equal(env.presentation.fileRef.relativePath, 'b.md');
  assert.deepEqual(names(snapshot), ['c.md', 'b.md', 'a.md']);
  await runtime.navigateOnlyPreviewRecent({
    hostToken: host.hostToken,
    revision: snapshot.revision,
    direction: 'forward'
  });
  assert.equal(env.presentation.fileRef.relativePath, 'c.md');
  assert.equal(recentWrites().length, writes);
  const calls = env.calls.length;
  await runtime.reloadOnlyPreview({ hostToken: host.hostToken });
  assert.deepEqual(env.calls.slice(calls), [{ method: 'refresh-preview' }]);
  assert.equal(recentWrites().length, writes);
  snapshot = await recents();
  await runtime.navigateOnlyPreviewRecent({
    hostToken: host.hostToken,
    revision: snapshot.revision,
    direction: 'back'
  });
  const presents = env.calls.filter(({ method }) => method === 'present').length;
  await runtime.selectOnlyPreviewFile(host.hostToken, {
    workspaceId: project.workspaceId,
    relativePath: 'b.md'
  });
  assert.equal(env.calls.filter(({ method }) => method === 'present').length, presents);
  assert.deepEqual(names(await recents()), ['b.md', 'c.md', 'a.md']);
  assert.equal(recentWrites().length, writes + 1);
});

test('external explicit files retain Project selection, presentation and history, including cold opens', async () => {
  const { host, projectPath } = await reset();
  await runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/inside.md`);
  const before = runtime.onlyPreviewWorkspaceRegistry.restore(host.hostToken);
  const presentation = env.presentation;
  const history = await recents();
  await runtime.openOnlyPreviewAbsoluteTarget('/navigation-fixture/sibling/outside.md', { line: 9 });
  assert.deepEqual(runtime.onlyPreviewWorkspaceRegistry.restore(host.hostToken), before);
  assert.equal(env.presentation, presentation);
  assert.deepEqual(await recents(), history);
  assert.deepEqual(env.calls.at(-1), { method: 'independent', path: '/navigation-fixture/sibling/outside.md', options: { line: 9, fragment: undefined } });
  const unbound = await reset(false);
  await runtime.openOnlyPreviewAbsoluteTarget('/navigation-fixture/unbound/external.md');
  assert.equal(runtime.onlyPreviewWorkspaceRegistry.restore(unbound.host.hostToken), null);
  assert.equal(env.calls.some(({ method }) => method === 'bind-project' || method === 'authorize' || method === 'present'), false);
  assert.deepEqual(names(await recents()), []);
});

test('a missing Recent remains listed and reports failure without changing presentation or order', async () => {
  const { host, projectPath } = await reset();
  await runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/gone.md`);
  await runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/current.md`);
  const before = await recents();
  const current = env.presentation;
  const writes = recentWrites().length;
  env.deleted.add(`${projectPath}/gone.md`);
  await assert.rejects(
    runtime.openOnlyPreviewRecent({
      hostToken: host.hostToken,
      revision: before.revision,
      entryId: before.entries[1].id
    }),
    (error) => error.code === 'PATH_NOT_FOUND'
  );
  assert.deepEqual(await recents(), before);
  assert.equal(env.presentation, current);
  assert.equal(recentWrites().length, writes);
});

test('Markdown resolver supports local relative, sibling, absolute, file URL, Unicode and anchors while rejecting unsafe links', () => {
  const source = '/navigation-fixture/docs/source.md';
  const cases = [
    ['next.md', { path: '/navigation-fixture/docs/next.md' }],
    [
      '../outside/中文%20name.md#%E7%AB%A0%E8%8A%82',
      { path: '/navigation-fixture/outside/中文 name.md', fragment: '章节' }
    ],
    ['/absolute/report.md#part', { path: '/absolute/report.md', fragment: 'part' }],
    ['file:///absolute/a%20b.md', { path: '/absolute/a b.md' }],
    ['file://localhost/absolute/report.md', { path: '/absolute/report.md' }],
    ['#local-anchor', { path: source, fragment: 'local-anchor' }]
  ];
  for (const [href, expected] of cases)
    assert.deepEqual(runtime.resolveOnlyPreviewMarkdownLink(source, href), expected);
  for (const href of [
    'javascript:alert(1)',
    'https://example.test/file.md',
    'data:text/html,x',
    'file://remote-host/share/a.md',
    '//remote-host/a.md',
    'file://user:pass@localhost/a.md',
    'bad\nname.md',
    'bad%0Aname.md',
    '#bad%00fragment',
    '%ZZ',
    '',
    null
  ]) {
    assert.throws(
      () => runtime.resolveOnlyPreviewMarkdownLink(source, href),
      invalid,
      String(href)
    );
  }
  assert.throws(
    () => runtime.resolveOnlyPreviewMarkdownLink('relative-source.md', 'next.md'),
    invalid
  );
});

test('a source-relative Markdown sibling open uses the explicit external lane and anchor-only links do no inspection or promotion', async () => {
  const { host, projectPath } = await reset();
  await runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/docs/source.md`);
  const before = runtime.onlyPreviewWorkspaceRegistry.restore(host.hostToken);
  const calls = env.calls.length;
  const writes = recentWrites().length;
  await runtime.openOnlyPreviewMarkdownLink(linkRequest('#section'));
  assert.deepEqual(
    env.calls.slice(calls).filter(({ method }) => method !== 'source-snapshot'),
    [{ method: 'fragment', fragment: 'section' }]
  );
  assert.equal(recentWrites().length, writes);
  await runtime.openOnlyPreviewMarkdownLink(linkRequest('../../sibling/target%20中文.md#intro'));
  assert.deepEqual(runtime.onlyPreviewWorkspaceRegistry.restore(host.hostToken), before);
  assert.equal(
    env.calls.filter(({ method }) => method === 'inspect').at(-1).path,
    '/navigation-fixture/sibling/target 中文.md'
  );
  assert.deepEqual(env.calls.filter(({ method }) => method === 'independent').at(-1), { method: 'independent', path: '/navigation-fixture/sibling/target 中文.md', options: { line: undefined, fragment: 'intro' } });
  assert.deepEqual(names(await recents()), ['source.md']);
  assert.equal((await recents()).canLocate, true);
});

test('Markdown source capability, runtime, selection and target-kind checks reject without unauthorized presentation', async () => {
  const { projectPath } = await reset();
  await runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/source.md`);
  const initial = env.calls.filter(({ method }) => method === 'inspect').length;
  await assert.rejects(
    runtime.openOnlyPreviewMarkdownLink({
      ...linkRequest('next.md'),
      previewRuntimeToken: 'b'.repeat(64)
    }),
    invalid
  );
  await assert.rejects(
    runtime.openOnlyPreviewMarkdownLink({ ...linkRequest('next.md'), selectionRevision: 0 }),
    invalid
  );
  env.presentation.adapterId = 'text';
  await assert.rejects(runtime.openOnlyPreviewMarkdownLink(linkRequest('next.md')), invalid);
  env.presentation.adapterId = 'markdown-dom';
  const fileRef = env.presentation.fileRef;
  env.presentation.fileRef = null;
  await assert.rejects(runtime.openOnlyPreviewMarkdownLink(linkRequest('next.md')), invalid);
  env.presentation.fileRef = fileRef;
  assert.equal(env.calls.filter(({ method }) => method === 'inspect').length, initial);
  env.directories.add(`${projectPath}/folder`);
  const before = await recents();
  await assert.rejects(
    runtime.openOnlyPreviewMarkdownLink(linkRequest('folder')),
    (error) => error.code === 'PATH_NOT_REGULAR_FILE'
  );
  assert.deepEqual(await recents(), before);
  assert.equal(env.presentation.fileRef, fileRef);
});

test('queued Markdown requests revalidate their source before inspection and again after inspection', async () => {
  for (const duringInspection of [false, true]) {
    const { projectPath } = await reset();
    await runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/source.md`);
    const entered = deferred();
    const release = deferred();
    const beforeInspections = env.calls.filter(({ method }) => method === 'inspect').length;
    let held;
    if (duringInspection)
      env.inspectHook = async () => {
        entered.resolve();
        await release.promise;
      };
    else
      held = runtime.onlyPreviewTargetMutations.run(async () => {
        entered.resolve();
        await release.promise;
      });
    const opening = runtime.openOnlyPreviewMarkdownLink(linkRequest('target.md'));
    const rejected = assert.rejects(opening, invalid);
    try {
      await entered.promise;
      env.presentation = {
        ...env.presentation,
        selectionRevision: env.presentation.selectionRevision + 1
      };
      release.resolve();
      await held;
      await rejected;
      assert.equal(
        env.calls.filter(({ method }) => method === 'inspect').length,
        beforeInspections + (duringInspection ? 1 : 0)
      );
      assert.deepEqual(names(await recents()), ['source.md']);
      assert.equal(env.presentation.fileRef.relativePath, 'source.md');
    } finally {
      release.resolve();
      await Promise.allSettled([held, opening].filter(Boolean));
    }
  }
});

test('rapid link opens share the actual FIFO; the second old-source link cannot overtake or replace the first', async () => {
  const { projectPath } = await reset();
  await runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/source.md`);
  const entered = deferred();
  const release = deferred();
  env.inspectHook = async (path) => {
    if (path.endsWith('/first.md')) {
      entered.resolve();
      await release.promise;
    }
  };
  const first = runtime.openOnlyPreviewMarkdownLink(linkRequest('first.md'));
  await entered.promise;
  const second = runtime.openOnlyPreviewMarkdownLink(linkRequest('second.md'));
  const rejected = assert.rejects(second, invalid);
  try {
    await tick();
    assert.ok(
      !env.calls.some(({ method, path }) => method === 'inspect' && path.endsWith('/second.md'))
    );
    release.resolve();
    await first;
    await rejected;
    assert.equal(env.presentation.fileRef.relativePath, 'first.md');
    assert.deepEqual(names(await recents()), ['first.md', 'source.md']);
    assert.ok(
      !env.calls.some(({ method, path }) => method === 'inspect' && path.endsWith('/second.md'))
    );
  } finally {
    release.resolve();
    await Promise.allSettled([first, second]);
  }
});

const replaceActiveProject = (path) => {
  env.directories.add(path);
  const project = runtime.onlyPreviewWorkspaceRegistry.registerValidatedTarget(
    env.host.hostToken,
    inspected(path)
  );
  runtime.onlyPreviewWorkspaceRegistry.bindProjectAuthority(
    env.host.hostToken,
    project.workspaceId,
    1
  );
  env.presentation = {
    hostId: env.host.hostId,
    selectionRevision: env.presentation.selectionRevision + 1,
    surface: 'none',
    fileRef: null,
    selectedTextAvailable: false
  };
  return project;
};

test('an explicit external open cannot land in a different Project activated during target inspection', async () => {
  const { host, projectPath } = await reset();
  await runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/current.md`);
  const target = '/navigation-fixture/external/old-intent.md';
  const entered = deferred();
  const release = deferred();
  env.inspectHook = async (path) => {
    if (path === target) {
      entered.resolve();
      await release.promise;
    }
  };
  const presentationCount = env.calls.filter(({ method }) => method === 'present').length;
  const writeCount = recentWrites().length;
  const opening = runtime.openOnlyPreviewAbsoluteTarget(target);
  const outcome = opening.then(
    () => null,
    (error) => error
  );
  try {
    await entered.promise;
    const replacement = replaceActiveProject(`${projectPath}-replacement`);
    release.resolve();
    const error = await outcome;
    assert.ok(
      error === null || error.code === 'INVALID_INPUT',
      'stale intent may be ignored or explicitly rejected'
    );
    assert.equal(
      runtime.onlyPreviewWorkspaceRegistry.restore(host.hostToken).workspaceId,
      replacement.workspaceId
    );
    assert.equal(
      env.presentation.fileRef,
      null,
      'old A intent must not open an external preview in B'
    );
    assert.equal(env.calls.filter(({ method }) => method === 'present').length, presentationCount);
    assert.equal(recentWrites().length, writeCount, 'old A intent must not add to B Recents');
    assert.deepEqual((await recents()).entries, []);
  } finally {
    release.resolve();
    await outcome;
  }
});

test('a Recent selected in A cannot update B after its inspection completes', async () => {
  const { host, projectPath } = await reset();
  await runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/older.md`);
  await runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/current.md`);
  const snapshot = await recents();
  const entered = deferred();
  const release = deferred();
  env.inspectHook = async (path) => {
    if (path === `${projectPath}/older.md`) {
      entered.resolve();
      await release.promise;
    }
  };
  const presentationCount = env.calls.filter(({ method }) => method === 'present').length;
  const writeCount = recentWrites().length;
  const opening = runtime.openOnlyPreviewRecent({
    hostToken: host.hostToken,
    entryId: snapshot.entries[1].id,
    revision: snapshot.revision
  });
  const rejected = assert.rejects(opening, invalid);
  try {
    await entered.promise;
    const replacement = replaceActiveProject(`${projectPath}-replacement`);
    release.resolve();
    await rejected;
    assert.equal(
      runtime.onlyPreviewWorkspaceRegistry.restore(host.hostToken).workspaceId,
      replacement.workspaceId
    );
    assert.equal(env.presentation.fileRef, null);
    assert.equal(env.calls.filter(({ method }) => method === 'present').length, presentationCount);
    assert.equal(recentWrites().length, writeCount);
    assert.deepEqual((await recents()).entries, []);
  } finally {
    release.resolve();
    await Promise.allSettled([opening, rejected]);
  }
});

test('quiet agent opens keep Project authority and persistence but emit no tree selection event, including repeats', async () => {
  const { host, project, projectPath } = await reset();
  await runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/anchor.md`);
  env.events.length = 0;
  const expected = { workspaceId: project.workspaceId, relativePath: 'docs/agent.md' };
  for (let count = 0; count < 2; count += 1) {
    await runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/docs/agent.md`, {
      preserveTreeSelection: true
    });
    assert.deepEqual(env.presentation.fileRef, expected);
    assert.deepEqual(
      runtime.onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(host.hostToken, expected)
        .workspace.rootRealPath,
      projectPath
    );
    const workspace = runtime.onlyPreviewWorkspaceRegistry.restore(host.hostToken);
    assert.equal(workspace.workspaceId, project.workspaceId);
    assert.equal(workspace.selectedRelativePath, 'docs/agent.md');
    assert.deepEqual(names(await recents()), ['agent.md', 'anchor.md']);
    assert.equal(
      env.events.some(({ event }) => event === 'onlypreview/selectionChanged'),
      false
    );
  }
  assert.equal(env.calls.filter(({ method }) => method === 'bind-project').length, 0);
  assert.deepEqual(env.calls.filter(({ method }) => method === 'present').at(-1).fileRef, expected);
  assert.ok(
    env.calls.some(
      ({ method, relativePath }) => method === 'authorize' && relativePath === 'docs/agent.md'
    )
  );
  assert.ok(
    env.events.some(
      ({ event, payload }) =>
        event === 'onlypreview/recentsChanged' && payload.hostId === host.hostId
    )
  );
  await runtime.onlyPreviewRecentDirectoryService.flushPendingWrites();
  assert.deepEqual(
    JSON.parse(env.rows.get(storageKey({ key: 'onlypreview_workspace', sub_key: 'last_file' }))),
    {
      version: 1,
      directoryPath: projectPath,
      relativePath: 'docs/agent.md'
    }
  );
});

test('quiet external and initially unbound files only open IndiPreview', async () => {
  for (const withProject of [true, false]) {
    const { host, projectPath } = await reset(withProject);
    if (withProject) await runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/anchor.md`);
    const before = runtime.onlyPreviewWorkspaceRegistry.restore(host.hostToken);
    const history = await recents();
    const presentation = env.presentation;
    env.events.length = 0;
    await runtime.openOnlyPreviewAbsoluteTarget('/navigation-fixture/agent/quiet-external.md', { preserveTreeSelection: true });
    assert.deepEqual(runtime.onlyPreviewWorkspaceRegistry.restore(host.hostToken), before);
    assert.equal(env.presentation, presentation);
    assert.deepEqual(await recents(), history);
    assert.deepEqual(env.events, []);
    assert.equal(env.calls.some(({ method }) => method === 'bind-project'), false);
    assert.equal(env.calls.filter(({ method }) => method === 'independent').length, 1);
  }
});

test('a queued quiet open does not suppress the next ordinary explicit selection event', async () => {
  const { host, projectPath } = await reset();
  const entered = deferred();
  const release = deferred();
  env.inspectHook = async (path) => {
    if (path.endsWith('/quiet.md')) {
      entered.resolve();
      await release.promise;
    }
  };
  const quiet = runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/quiet.md`, {
    preserveTreeSelection: true
  });
  await entered.promise;
  const ordinary = runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/ordinary.md`);
  try {
    release.resolve();
    await Promise.all([quiet, ordinary]);
    assert.deepEqual(
      env.calls
        .filter(({ method }) => method === 'present')
        .map(({ fileRef }) => fileRef.relativePath),
      ['quiet.md', 'ordinary.md']
    );
    assert.deepEqual(
      env.events.filter(({ event }) => event === 'onlypreview/selectionChanged'),
      [{ event: 'onlypreview/selectionChanged', payload: { hostId: host.hostId } }]
    );
    assert.equal(
      runtime.onlyPreviewWorkspaceRegistry.restore(host.hostToken).selectedRelativePath,
      'ordinary.md'
    );
    assert.deepEqual(names(await recents()), ['ordinary.md', 'quiet.md']);
  } finally {
    release.resolve();
    await Promise.allSettled([quiet, ordinary]);
  }
});

test('quiet options do not change explicit directory switching or its workspace notification', async () => {
  const { host, project, projectPath } = await reset();
  const target = `${projectPath}-directory`;
  env.directories.add(target);
  const clearWorkspace = env.preview.clearWorkspace;
  env.preview.clearWorkspace = (token, workspaceId) => {
    requireHost(token);
    env.calls.push({ method: 'clear-workspace', workspaceId });
  };
  try {
    await runtime.openOnlyPreviewAbsoluteTarget(target, { preserveTreeSelection: true });
    const workspace = runtime.onlyPreviewWorkspaceRegistry.restore(host.hostToken);
    assert.notEqual(workspace.workspaceId, project.workspaceId);
    assert.equal(workspace.displayPath, target);
    assert.ok(
      env.calls.some(
        ({ method, workspaceId }) =>
          method === 'bind-project' && workspaceId === workspace.workspaceId
      )
    );
    assert.ok(
      env.calls.some(
        ({ method, workspaceId }) =>
          method === 'clear-workspace' && workspaceId === workspace.workspaceId
      )
    );
    assert.deepEqual(
      env.events.filter(({ event }) => event === 'onlypreview/workspaceChanged'),
      [{ event: 'onlypreview/workspaceChanged', payload: { hostId: host.hostId } }]
    );
    assert.equal(
      env.calls.some(({ method }) => method === 'present'),
      false
    );
    assert.deepEqual((await recents()).entries, []);
  } finally {
    env.preview.clearWorkspace = clearWorkspace;
  }
});

test('a quiet agent request inspected under A cannot update B after a Project switch', async () => {
  const { host, projectPath } = await reset();
  await runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/anchor.md`);
  env.events.length = 0;
  const entered = deferred();
  const release = deferred();
  env.inspectHook = async () => {
    entered.resolve();
    await release.promise;
  };
  const presentations = env.calls.filter(({ method }) => method === 'present').length;
  const writes = recentWrites().length;
  const opening = runtime.openOnlyPreviewAbsoluteTarget('/navigation-fixture/agent/stale.md', {
    preserveTreeSelection: true
  });
  const rejected = assert.rejects(opening, invalid);
  try {
    await entered.promise;
    const replacement = replaceActiveProject(`${projectPath}-replacement`);
    release.resolve();
    await rejected;
    assert.equal(
      runtime.onlyPreviewWorkspaceRegistry.restore(host.hostToken).workspaceId,
      replacement.workspaceId
    );
    assert.equal(env.presentation.fileRef, null);
    assert.equal(env.calls.filter(({ method }) => method === 'present').length, presentations);
    assert.equal(recentWrites().length, writes);
    assert.deepEqual((await recents()).entries, []);
    assert.equal(
      env.events.some(({ event }) => event === 'onlypreview/selectionChanged'),
      false
    );
  } finally {
    release.resolve();
    await Promise.allSettled([opening, rejected]);
  }
});

test('MCP and OS file opening preserve tree selection without changing the public path-only schema', () => {
  const main = readFileSync(resolve(root, 'src/main/app.main.ts'), 'utf8');
  assert.match(main, /new OnlyPreviewOpenQueue\(openOnlyPreviewOsTarget\)/);
  assert.match(
    main,
    /configurePreviewOpener\(\s*\(?\w+\)?\s*=>\s*openOnlyPreviewAbsoluteTarget\(\w+,\s*\{\s*preserveTreeSelection:\s*true\s*\}\)/
  );
  const bridge = readFileSync(resolve(root, 'src/main/mcp/mcpBridge.server.ts'), 'utf8');
  assert.match(bridge, /assertOnlyKeys\(params,\s*\['path'\],\s*'preview\.open'\)/);
  assert.match(bridge, /await this\.previewOpener\(target\)/);
  assert.doesNotMatch(bridge, /preserveTreeSelection/);
  assert.doesNotMatch(
    readFileSync(resolve(root, 'src/main/mcp/mcpStdio.helper.ts'), 'utf8'),
    /preserveTreeSelection/
  );
});


test('IndiPreview Markdown/reload resolve their own host and links inside the Workspace return there', async () => {
  const { projectPath } = await reset();
  await runtime.openOnlyPreviewAbsoluteTarget(`${projectPath}/current.md`);
  const host = runtime.onlyPreviewHostRegistry.issue('standalone', 'content');
  const fileRef = runtime.onlyPreviewWorkspaceRegistry.registerExternalPreview(host.hostToken, inspected('/outside/independent.md'));
  const ownPresentation = { fileRef, adapterId: 'markdown-dom', selectionRevision: 31 };
  const ownCalls = [];
  env.regions.set(host.hostToken, {
    snapshotForVue: () => ownPresentation,
    navigateFragment: (...args) => ownCalls.push(['fragment', ...args]),
    refresh: async token => ownCalls.push(['reload', token])
  });
  await runtime.reloadOnlyPreview({ hostToken: host.hostToken });
  await runtime.openOnlyPreviewMarkdownLink({ hostToken: host.hostToken, previewRuntimeToken: env.runtimeToken,
    selectionRevision: 31, href: '#section' });
  assert.deepEqual(ownCalls, [['reload', host.hostToken], ['fragment', host.hostToken, env.runtimeToken, 31, 'section']]);
  await runtime.openOnlyPreviewMarkdownLink({ hostToken: host.hostToken, previewRuntimeToken: env.runtimeToken,
    selectionRevision: 31, href: `${projectPath}/inside.md#intro` });
  assert.equal(env.presentation.fileRef.relativePath, 'inside.md');
  assert.deepEqual(env.calls.filter(({ method }) => method === 'present').at(-1).fragment, { fragment: 'intro', line: undefined });
  assert.equal(ownPresentation.fileRef, fileRef);
});
