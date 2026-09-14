/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native Node test fixtures. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { buildSync } from 'esbuild';

// Compile the production methods themselves, not copies of their logic. The surrounding fixture
// replaces unrelated window startup, persistence and Electron so these tests never launch an app.
const sourceFile = 'src/main/windows/omniWindow.helper.ts';
const source = ts.createSourceFile(
  sourceFile,
  readFileSync(sourceFile, 'utf8'),
  ts.ScriptTarget.Latest,
  true
);
const names = [
  'loadMiniAppCellContent',
  'cellRefresh',
  'closeCell',
  'syncZellijControlOverlay',
  'broadcastMiniAppLoadState',
  'reportMiniAppLoadFailure',
  'removeCellViews',
  'closeZellijCellSession'
];
const methods = new Map();
for (const declaration of source.statements.filter(ts.isClassDeclaration)) {
  for (const member of declaration.members) {
    const name = member.name?.getText(source);
    if (names.includes(name)) methods.set(name, member.getText(source));
  }
}
assert.equal(methods.size, names.length, 'every tested method must come from production source');
const folder = mkdtempSync(join(tmpdir(), 'zellij-omni-test-'));
const outfile = join(folder, 'omni.cjs');
buildSync({
  stdin: {
    contents: `
      import { zellijErrorCode } from '${process.cwd()}/src/main/zellij/zellijProcess.service.ts';
      import { OMNI_MINI_APP_LOAD_STATE_EVENT } from '${process.cwd()}/src/shared/omni/omni.types.ts';
      export const calls={prepare:[],close:[],blur:[],broadcasts:[]};
      const zellijOrigin=()=>'http://127.0.0.1:12902';
      let prepare=async id=>zellijOrigin()+'/'+id;
      const prepareZellijTerminal=async id=>{calls.prepare.push(id);return prepare(id);};
      const closeZellijTerminal=async id=>{calls.close.push(id);};
      const blurZellijTerminal=id=>calls.blur.push(id);
      const xpcMain={broadcast:(event,params)=>calls.broadcasts.push({event,params})};
      export const setPreparation=fn=>{prepare=fn;};
      export const reset=()=>{for(const list of Object.values(calls))list.length=0;prepare=async id=>zellijOrigin()+'/'+id;};
      export class Fixture {
        constructor(makeView){
          this.cells=[];this.zellijLoadStates=new Map();this.miniAppLoadFailures=new Map();this.zellijLoadGeneration=new Map();
          this.activeCellId=null;this.controlVisible=false;this.controlView=makeView('control');this.boundsUpdates=0;
          const children=[];this.baseWindow={isDestroyed:()=>false,contentView:{children,
            removeChildView(view){const index=children.indexOf(view);if(index>=0)children.splice(index,1);},
            addChildView(view){this.removeChildView(view);children.push(view);}}};
        }
        updateControlBounds(){this.boundsUpdates++;}
        isWebContentsAlive(contents){return !contents.isDestroyed();}
        disposeWebContentsView(view){if(!view)return;this.baseWindow.contentView.removeChildView(view);view.webContents.close();}
        clearActiveCellIfMatching(id){if(this.activeCellId===id)this.activeCellId=null;}
        broadcastActiveCell(id){this.activeCellId=id;}
        ${names.map((name) => methods.get(name)).join('\n')}
      }
    `,
    resolveDir: process.cwd(),
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  alias: { '@shared': join(process.cwd(), 'src/shared') }
});
const { Fixture, calls, setPreparation, reset } = createRequire(import.meta.url)(outfile);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const makeView = (name) => {
  const view = {
    name,
    visible: true,
    urls: [],
    files: [],
    reloads: 0,
    closed: false,
    loadGate: null,
    setVisible(visible) {
      this.visible = visible;
    }
  };
  view.webContents = {
    isDestroyed: () => view.closed,
    close: () => {
      view.closed = true;
    },
    loadURL: async (url) => {
      view.urls.push(url);
      await view.loadGate?.promise;
    },
    loadFile: async (file) => {
      view.files.push(file);
    },
    reload: () => {
      view.reloads++;
    }
  };
  return view;
};
const fixture = () => new Fixture(makeView);
const addCell = (helper, id, miniAppId = 'zellij', contentMode = 'miniapp') => {
  const cell = {
    id,
    miniAppId,
    contentMode,
    content: makeView(`${id}-content`),
    menubar: contentMode === 'browser' ? makeView(`${id}-menubar`) : null
  };
  helper.cells.push(cell);
  for (const view of [cell.menubar, cell.content])
    if (view) helper.baseWindow.contentView.addChildView(view);
  return cell;
};
const load = (helper, cell) =>
  helper.loadMiniAppCellContent(cell.content, {
    cellId: cell.id,
    miniAppId: cell.miniAppId,
    target: { filePath: null, url: 'http://127.0.0.1:12902' }
  });
const states = (id) =>
  calls.broadcasts
    .filter(({ event, params }) => event === 'omniControl/miniAppLoadState' && params.cellId === id)
    .map(({ params }) => params);
test.beforeEach(reset);
test.after(() => rmSync(folder, { recursive: true, force: true }));

test('Omni prepares its stable named session before navigation and shows loading until the view loads', async () => {
  const helper = fixture(),
    cell = addCell(helper, 'pane-a');
  const preparation = deferred(),
    navigation = deferred();
  cell.content.loadGate = navigation;
  setPreparation(async (id) => {
    await preparation.promise;
    return `http://127.0.0.1:12902/${id}`;
  });
  load(helper, cell);
  assert.deepEqual(calls.prepare, ['omni-pane-a']);
  assert.deepEqual(cell.content.urls, []);
  assert.equal(cell.content.visible, false);
  assert.equal(helper.controlView.visible, true);
  assert.deepEqual(
    states('pane-a').map((state) => state.status),
    ['starting']
  );
  preparation.resolve();
  await flush();
  assert.deepEqual(cell.content.urls, ['http://127.0.0.1:12902/omni-pane-a']);
  assert.equal(cell.content.visible, false, 'native content stays hidden until loadURL resolves');
  navigation.resolve();
  await flush();
  assert.equal(helper.zellijLoadStates.size, 0);
  assert.equal(helper.controlView.visible, false);
  assert.equal(cell.content.visible, true);
  assert.deepEqual(
    states('pane-a').map((state) => state.status),
    ['starting', 'ready']
  );
});

test('a removed or replaced cell cannot receive a late prepared terminal or stale readiness', async () => {
  for (const replacement of [false, true]) {
    reset();
    const helper = fixture(),
      original = addCell(helper, 'same-id');
    const gate = deferred();
    setPreparation(() => gate.promise);
    load(helper, original);
    helper.cells = [];
    helper.removeCellViews(original);
    const next = replacement ? addCell(helper, 'same-id') : null;
    gate.resolve('http://127.0.0.1:12902/old');
    await flush();
    assert.deepEqual(original.content.urls, []);
    if (next) assert.deepEqual(next.content.urls, []);
    assert.deepEqual(
      states('same-id').map((state) => state.status),
      ['starting']
    );
    assert.deepEqual(
      calls.close,
      [],
      'replacement disposal itself does not request a native session close'
    );
  }
});

test('failed preparation retains its cell and Retry prepares it again with the same identity', async () => {
  const helper = fixture(),
    cell = addCell(helper, 'retry');
  setPreparation(async () => {
    throw Error('web-sharing-disabled');
  });
  load(helper, cell);
  await flush();
  assert.equal(helper.cells[0], cell);
  assert.equal(cell.content.closed, false);
  assert.equal(cell.content.visible, false);
  assert.equal(helper.controlView.visible, true);
  assert.equal(helper.miniAppLoadFailures.get('retry'), 'zellij');
  assert.equal(states('retry').at(-1).error, 'web-sharing-disabled');
  setPreparation(async (id) => `http://127.0.0.1:12902/${id}`);
  helper.cellRefresh('retry');
  await flush();
  assert.deepEqual(calls.prepare, ['omni-retry', 'omni-retry']);
  assert.deepEqual(cell.content.urls, ['http://127.0.0.1:12902/omni-retry']);
  assert.equal(
    cell.content.reloads,
    0,
    'retry reruns preparation instead of reloading a failed target'
  );
  assert.equal(helper.miniAppLoadFailures.size, 0);
  assert.equal(helper.zellijLoadStates.size, 0);
  assert.equal(helper.cells[0], cell);
  assert.deepEqual(calls.close, []);
});

test('explicit close targets only that Omni session, including while preparation is pending', async () => {
  const helper = fixture(),
    closing = addCell(helper, 'closing'),
    sibling = addCell(helper, 'sibling');
  const gate = deferred();
  setPreparation(() => gate.promise);
  load(helper, closing);
  helper.activeCellId = 'closing';
  helper.closeCell('closing');
  assert.deepEqual(calls.close, ['omni-closing']);
  assert.deepEqual(helper.cells, [sibling]);
  assert.equal(sibling.content.closed, false);
  assert.equal(helper.activeCellId, null);
  assert.equal(helper.zellijLoadStates.size, 0);
  gate.resolve('http://127.0.0.1:12902/closing');
  await flush();
  assert.deepEqual(closing.content.urls, []);
  helper.closeCell('closing');
  helper.removeCellViews(sibling);
  assert.deepEqual(
    calls.close,
    ['omni-closing'],
    'generic disposal retains the sibling native session'
  );
  const browser = addCell(helper, 'browser', 'zellij', 'browser');
  helper.closeCell(browser.id);
  assert.deepEqual(
    calls.close,
    ['omni-closing'],
    'a browser cell does not close a similarly named session'
  );
});

test('ready cells remain above normal-mode loading controls and edit mode can raise its controls', () => {
  const helper = fixture(),
    pending = addCell(helper, 'pending'),
    ready = addCell(helper, 'ready');
  const browser = addCell(helper, 'browser', 'todo', 'browser');
  helper.broadcastMiniAppLoadState({ cellId: 'pending', miniAppId: 'zellij', status: 'starting' });
  const layers = helper.baseWindow.contentView.children;
  const controlIndex = layers.indexOf(helper.controlView);
  assert.equal(pending.content.visible, false);
  assert.equal(ready.content.visible, true);
  assert.ok(layers.indexOf(ready.content) > controlIndex);
  assert.ok(layers.indexOf(browser.menubar) > controlIndex);
  assert.ok(layers.indexOf(browser.content) > controlIndex);
  assert.ok(helper.boundsUpdates > 0);
  helper.controlVisible = true;
  helper.syncZellijControlOverlay();
  assert.equal(layers.at(-1), helper.controlView);
  helper.controlVisible = false;
  helper.broadcastMiniAppLoadState({ cellId: 'pending', miniAppId: 'zellij', status: 'ready' });
  assert.equal(helper.controlView.visible, false);
  assert.equal(pending.content.visible, true);
});

test('late navigation failure from a replaced content view cannot fail the replacement cell', async () => {
  const helper = fixture(),
    original = addCell(helper, 'replaced');
  const gate = deferred();
  original.content.loadGate = gate;
  load(helper, original);
  await flush();
  assert.equal(original.content.urls.length, 1);
  helper.cells = [];
  helper.removeCellViews(original);
  const next = addCell(helper, 'replaced');
  gate.reject(Error('start-failed'));
  await flush();
  assert.equal(helper.cells[0], next);
  assert.equal(helper.miniAppLoadFailures.size, 0);
  assert.deepEqual(
    states('replaced').map((state) => state.status),
    ['starting']
  );
});
