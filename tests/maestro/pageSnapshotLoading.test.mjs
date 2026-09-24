// snapshot-loading-203 —— docs/issues/page-snapshot-silent-while-loading.md 验收.
// Paired with micromeet-cowork `apps/cowork/tests/unit/agentBrowserSession.test.mjs` (same contract, same line).
//
// Loads the real `RequestExecService` (and through it the real `segmentSnapshot`), so the cases run the shipped
// `toolPageSnapshot`. `maestroAgentBrowserSession.test.mjs` would be the natural home, but its stub table no longer
// matches the imports and the file does not load.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const APP_ROOT = resolve(import.meta.dirname, '../..');
const ALIASES = [
  ['@maestro-main/', 'src/main/maestro/'],
  ['@maestro-shared/', 'src/shared/maestro/'],
  ['@main/', 'src/main/'],
  ['@shared/', 'src/shared/']
];

/** Transpile + alias-resolve one module tree; `stubs` win by specifier. A fresh cache per call. */
const load = (path, stubs = {}) => {
  const cache = new Map();
  const fileFor = (spec, parent) => {
    for (const [prefix, dir] of ALIASES)
      if (spec.startsWith(prefix)) return join(APP_ROOT, dir, `${spec.slice(prefix.length)}.ts`);
    return spec.startsWith('.') ? resolve(dirname(parent), `${spec}.ts`) : null;
  };
  const read = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        experimentalDecorators: true
      }
    });
    const native = createRequire(file);
    new Function('require', 'module', 'exports', outputText)(
      (spec) => {
        if (spec in stubs) return stubs[spec];
        const next = fileFor(spec, file);
        return next ? read(next) : native(spec);
      },
      module,
      module.exports
    );
    return module.exports;
  };
  return read(join(APP_ROOT, path));
};

const LOADING =
  '# LOADING: this tab is still loading, so the tree below may be incomplete. Wait a few seconds, then page_snapshot this tab again before concluding that anything is missing.';
// The pre-change output shape: the 5-line header, a blank line, the body.
const shot = (id, ...body) =>
  [`# tab: ${id}`, `# page: https://${id}.example/start`, `# title: ${id}`, '# elements: 1', '# snapshot: ', '', ...body].join('\n');

const withScratch = async (run) => {
  const scratch = mkdtempSync(join(tmpdir(), 'bl-snapshot-loading-'));
  try {
    await run(scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

const fixture = (scratch, stubs = {}) => {
  const { RequestExecService } = load('src/main/maestro/drive/requestExec.service.ts', {
    electron: { app: { getPath: () => scratch } },
    ...stubs
  });
  const liveView = () => ({ webContents: { isDestroyed: () => false } });
  const makeTab = (id) => ({
    id,
    url: `https://${id}.example/start`,
    loading: false,
    view: liveView(),
    capture: { snapshot: async () => ({ ok: true, title: id, yaml: `snapshot ${id}`, nodeCount: 1 }) }
  });
  const tabs = ['a', 'b', 'c'].map(makeTab);
  const state = {
    tabs,
    activeTabId: 'a',
    get capture() {
      return tabs[0].capture;
    },
    get currentUrl() {
      return tabs[0].url;
    },
    warmAndLoad: async (tab) => {
      tab.view = liveView();
    },
    emitTrace() {},
    broadcastActivity() {}
  };
  const request = new RequestExecService();
  request.setState(state);
  return { request, tabs, state };
};

test('1 a loading tab gets the LOADING line after the 5-line header and its blank line, read before the capture', async () => {
  await withScratch(async (scratch) => {
    const f = fixture(scratch);
    f.tabs[1].loading = true;
    assert.equal(await f.request.toolPageSnapshot('b'), shot('b', LOADING, 'snapshot b'));
    // The spinner stops while the capture runs: the line reports the moment before it.
    f.tabs[1].capture.snapshot = async () => {
      f.tabs[1].loading = false;
      return { ok: true, title: 'b', yaml: 'snapshot b', nodeCount: 1 };
    };
    assert.equal(await f.request.toolPageSnapshot('b'), shot('b', LOADING, 'snapshot b'));
    // A cold tab is warmed first and read after: finished loading → no line.
    f.tabs[2].loading = true;
    f.tabs[2].view = null;
    f.state.warmAndLoad = async (tab) => {
      tab.view = { webContents: { isDestroyed: () => false } };
      tab.loading = false;
    };
    assert.equal(await f.request.toolPageSnapshot('c'), shot('c', 'snapshot c'));
  });
});

test('2 a tab that is not loading gives byte-identical output; no tab → no line', async () => {
  await withScratch(async (scratch) => {
    const f = fixture(scratch);
    assert.equal(await f.request.toolPageSnapshot('b'), shot('b', 'snapshot b'));
    f.tabs[1].capture.snapshot = async () => ({
      ok: true,
      title: 'b',
      yaml: '# INCOMPLETE: 1 line(s) missing\n- button "Go" [ref=e1]',
      nodeCount: 1
    });
    assert.equal(
      await f.request.toolPageSnapshot('b'),
      shot('b', '# INCOMPLETE: 1 line(s) missing', '- button "Go" [ref=e1]')
    );
    // `activeTabId` is the foreground tab, not necessarily the one being snapshotted: without a passed tab, say nothing.
    f.tabs[0].loading = true;
    assert.equal(await f.request.toolPageSnapshot(), shot('a', 'snapshot a'));
  });
});

test('3 with a goal, the LOADING line survives segmentSnapshot verbatim (REDUCED + SEGMENTED)', async () => {
  await withScratch(async (scratch) => {
    const rows = ['- link "Nav" [ref=e1]', '- button "Go" [ref=e2]', '- text: display only'];
    const block = (lines, id, row) => ({
      id,
      label: `${id} — fixture`,
      start: lines.indexOf(row),
      end: lines.indexOf(row) + 1,
      bytes: row.length,
      share: 0.5
    });
    // Real toolPageSnapshot + segmentSnapshot; only pruning, chunking and the decision maker are deterministic stubs,
    // so both reduction steps really happen.
    const f = fixture(scratch, {
      '@maestro-main/drive/snapshotPrune': {
        PRUNE_MIN_BYTES: 0,
        pruneSnapshot: (text) => ({ pruned: true, keptActionable: 2, text: text.replace(`\n${rows[2]}`, '') })
      },
      '@maestro-main/drive/snapshotChunker': {
        chunkSnapshot: (text) => {
          const lines = text.split('\n');
          return { lines, totalBytes: text.length, skip: '', blocks: [block(lines, 'b1', rows[0]), block(lines, 'b2', rows[1])] };
        }
      },
      '@main/decision/decisionHelper': {
        decisionHelper: { choose: async () => ({ decided: true, value: 'b2', confidence: 0.9 }) }
      }
    });
    f.tabs[1].loading = true;
    f.tabs[1].capture.snapshot = async () => ({
      ok: true,
      title: 'b',
      yaml: ['# INCOMPLETE: 1 line(s) missing', ...rows].join('\n'),
      nodeCount: 2
    });
    const out = (await f.request.toolPageSnapshot('b', 'press Go')).split('\n');
    assert.ok(out.some((line) => line.startsWith('# REDUCED:')));
    assert.ok(out.some((line) => line.startsWith('# SEGMENTED:')));
    assert.equal(out.filter((line) => line === LOADING).length, 1);
    assert.ok(out.indexOf(LOADING) > out.findIndex((line) => line.startsWith('# snapshot:')));
    assert.ok(out.indexOf(LOADING) < out.indexOf(''));
    assert.deepEqual(out.slice(out.indexOf('') + 1), [rows[1]]);
  });
});
