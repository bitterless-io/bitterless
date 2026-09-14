/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native Node test fixtures. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = mkdtempSync(join(tmpdir(), 'zellij-window-test-'));
const output = join(root, 'window.cjs');
const modules = {
  electron: `const {EventEmitter}=require('node:events');
    const windows=[],views=[],chromeGates=new Map();
    class Contents extends EventEmitter {
      constructor(){super();this.closed=false;this.loads=0;}
      setWindowOpenHandler(handler){this.openHandler=handler;}
      setIgnoreMenuShortcuts(value){this.ignore=value;}
      focus(){this.focused=true;this.emit('focus');}
      async loadURL(url){this.url=url;this.loads++;}
      async loadFile(file,options){this.file=file;this.query=options&&options.query;await chromeGates.get(this.query?.surface)?.promise;}
      isDevToolsOpened(){return false;} openDevTools(){} isDestroyed(){return this.closed;} close(){this.closed=true;}
    }
    class View {
      constructor(){this.children=[];this.visible=true;}
      addChildView(v){this.children=this.children.filter(x=>x!==v);this.children.push(v);}
      removeChildView(v){this.children=this.children.filter(x=>x!==v);}
      setBounds(b){this.bounds=b;} setVisible(v){this.visible=v;}
    }
    class BrowserWindow extends EventEmitter {
      constructor(options){super();this.options=options;this.dead=false;this.visible=false;this.contentView=new View();windows.push(this);}
      getContentSize(){return [1000,700];} isDestroyed(){return this.dead;} isMinimized(){return false;}
      show(){this.visible=true;} focus(){} close(){this.dead=true;this.emit('closed');} destroy(){this.close();}
    }
    class WebContentsView extends View {constructor(options){super();this.options=options;this.webContents=new Contents();views.push(this);}}
    module.exports={BrowserWindow,WebContentsView,View,app:{getAppPath:()=>'/fixture'},windows,views,chromeGates};`,
  'electron-xpc/main': `const broadcasts=[];exports.broadcasts=broadcasts;exports.xpcMain={broadcast:(event,params)=>broadcasts.push({event,params})};`,
  '@electron-toolkit/utils': `exports.is={dev:false};`,
  './zellijDevTools.helper': `exports.bindZellijDevTools=()=>{};exports.autoOpenZellijDevTools=()=>{};`,
  './zellijKeyBridge': `exports.bindZellijKeyBridge=()=>{};`,
  '@maestro-main/common/shortcutsHelper/shortcuts.helper': `exports.setTerminalKeyboardOwner=()=>{};`,
  '@main/windows/windowState.service': `exports.windowStateService={resolve:()=>null,register:()=>({show(){},flushAndDispose(){}})};`,
  './zellijRuntime.service': `const listeners=new Set(),failures=new Set(),gates=new Map();
    const calls={prepare:[],close:[],focus:[],blur:[],stop:0};
    const initial=()=>({status:'idle',error:null,shortcuts:{splitDown:'Super d',splitRight:'Super Shift d',closePane:'Super w'},configExists:true,configFile:'/fixture/config.kdl',configDirectory:'/fixture',configRevision:'fixture'});
    let state=initial();const session={setPermissionRequestHandler(fn){this.request=fn;},setPermissionCheckHandler(fn){this.check=fn;}};
    exports.zellijOrigin=()=>'http://127.0.0.1:12902';exports.zellijTerminalSession=()=>session;
    exports.prepareZellijTerminal=async id=>{calls.prepare.push(id);await gates.get(id)?.promise;state={...state,status:'ready',error:null};return 'http://127.0.0.1:12902/bitterless-'+id;};
    exports.closeZellijTerminal=async id=>{calls.close.push(id);};
    exports.focusZellijTerminal=id=>calls.focus.push(id);exports.blurZellijTerminal=id=>calls.blur.push(id);
    exports.stopZellijRuntime=async()=>{calls.stop++;};
    exports.subscribeZellijState=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};exports.listenerCount=()=>listeners.size;
    exports.subscribeZellijTerminalFailure=fn=>{failures.add(fn);return()=>failures.delete(fn);};exports.fail=id=>{for(const fn of failures)fn(id);};
    exports.getZellijRuntime=()=>({snapshot:()=>state});
    exports.change=next=>{state={...state,...next};for(const listener of [...listeners])listener(state);};
    exports.reset=()=>{state=initial();gates.clear();for(const key of ['prepare','close','focus','blur'])calls[key].length=0;calls.stop=0;};
    exports.calls=calls;exports.gates=gates;`
};
await build({
  stdin: {
    contents: `export {zellijWindowService,isZellijNavigationAllowed} from '${process.cwd()}/src/main/zellij/zellijWindow.service.ts';export {BrowserWindow,windows,views,chromeGates} from 'electron';export {broadcasts} from 'electron-xpc/main';export {change,calls,gates,reset,listenerCount,fail} from './zellijRuntime.service';`,
    resolveDir: process.cwd(),
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: output,
  alias: { '@shared': join(process.cwd(), 'src/shared') },
  plugins: [
    {
      name: 'fixtures',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) =>
          args.path in modules ? { path: args.path, namespace: 'fixture' } : undefined
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: modules[args.path],
          loader: 'js'
        }));
      }
    }
  ]
});
const {
  zellijWindowService: service,
  isZellijNavigationAllowed,
  BrowserWindow,
  windows,
  views,
  chromeGates,
  broadcasts,
  change,
  calls,
  gates,
  reset,
  fail,
  listenerCount
} = createRequire(import.meta.url)(output);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const terminalOf = (id) =>
  views.find(
    (view) => !view.webContents.closed && view.webContents.url?.endsWith(`/bitterless-${id}`)
  );
const tabHost = (instanceId) => {
  const state = { open: true, attached: false };
  const window = new BrowserWindow({});
  const host = {
    instanceId,
    window: () => window,
    contentRect: () => ({ x: 0, y: 0, width: 900, height: 600 }),
    attach: (view) => {
      state.attached = true;
      state.view = view;
    },
    detach: () => {
      state.attached = false;
    },
    activate: () => {},
    close: () => {
      state.open = false;
    },
    setTitle: () => {},
    setDisplayUrl: () => {},
    isOpen: () => state.open
  };
  return { host, state };
};
test.beforeEach(async () => {
  await service.destroy();
  reset();
  windows.length = 0;
  views.length = 0;
  broadcasts.length = 0;
  chromeGates.clear();
});
test.after(async () => {
  await service.destroy();
  rmSync(root, { recursive: true, force: true });
});

test('standalone opening automatically prepares once and attaches only after its session is ready', async () => {
  const gate = deferred();
  gates.set('window', gate);
  await Promise.all([service.open(), service.open()]);
  assert.equal(windows.length, 1);
  assert.deepEqual(calls.prepare, ['window']);
  assert.equal(views.length, 1, 'only trusted chrome exists while native preparation waits');
  assert.equal(service.snapshot('window').status, 'starting');
  const controls = views[0];
  assert.match(controls.options.webPreferences.preload, /zellij\.js$/);
  assert.equal(controls.webContents.query.surface, 'window');
  gate.resolve();
  await flush();
  const terminal = terminalOf('window');
  assert.ok(terminal);
  assert.equal(
    terminal.bounds.y,
    48,
    'native fallback matches the 48px header before renderer measurement'
  );
  assert.equal(service.snapshot('window').status, 'ready');
  assert.equal(terminal.options.webPreferences.preload, undefined);
  assert.equal(terminal.options.webPreferences.sandbox, true);
  assert.equal(terminal.options.webPreferences.nodeIntegration, false);
  assert.equal(terminal.options.webPreferences.webSecurity, true);
  assert.equal(terminal.webContents.ignore, true);
  assert.deepEqual(terminal.webContents.openHandler(), { action: 'deny' });
  const unchanged = { ...terminal.bounds };
  service.setContentBounds('unknown', { x: 0, y: 5, width: 5, height: 5 });
  assert.deepEqual(terminal.bounds, unchanged);
  service.setContentBounds('window', { x: 0, y: 170, width: 4000, height: 2000 });
  assert.deepEqual(terminal.bounds, { x: 0, y: 170, width: 1000, height: 530 });
  let prevented = false;
  terminal.webContents.emit(
    'will-navigate',
    {
      preventDefault: () => {
        prevented = true;
      }
    },
    'https://example.test'
  );
  assert.equal(prevented, true);
  assert.equal(isZellijNavigationAllowed('http://127.0.0.1:12902/session/work'), true);
  assert.equal(isZellijNavigationAllowed('http://localhost:12902'), false);
  assert.equal(isZellijNavigationAllowed('file:///etc/passwd'), false);
  assert.ok(
    broadcasts.some(
      ({ event, params }) =>
        event === 'zellij/surface-state' &&
        params.surfaceId === 'window' &&
        params.snapshot.status === 'ready'
    )
  );
});

test('two Maestro tabs auto-open independent sessions and ready-state refreshes keep their views', async () => {
  const a = tabHost('tab-a'),
    b = tabHost('tab-b');
  await Promise.all([service.openOnTab(a.host), service.openOnTab(b.host)]);
  await flush();
  assert.deepEqual(calls.prepare.sort(), ['tab-a', 'tab-b']);
  const first = terminalOf('tab-a'),
    second = terminalOf('tab-b');
  assert.ok(first && second);
  assert.notEqual(a.state.view, b.state.view);
  const before = views.length;
  await Promise.all([service.initializeSurface('tab-a'), service.initializeSurface('tab-b')]);
  change({ status: 'ready', error: null });
  await flush();
  assert.equal(views.length, before);
  assert.equal(terminalOf('tab-a'), first);
  assert.equal(terminalOf('tab-b'), second);
  assert.equal(first.webContents.loads, 1);
  assert.equal(second.webContents.loads, 1);
  service.setTabActive(a.host, false);
  assert.ok(calls.blur.includes('tab-a'));
  assert.equal(first.visible, false);
  service.setTabActive(a.host, true);
  assert.equal(first.visible, true);
  service.closeTab(b.host);
  await flush();
  assert.deepEqual(calls.close, ['tab-b']);
  assert.equal(second.webContents.closed, true);
  assert.equal(first.webContents.closed, false);
  assert.equal(a.state.attached, true);
  assert.equal(calls.stop, 0);
});

test('a failed native bridge affects only its surface and Retry replaces its terminal view', async () => {
  await Promise.all([
    service.openOnTab(tabHost('healthy').host),
    service.openOnTab(tabHost('failed').host)
  ]);
  await flush();
  const healthy = terminalOf('healthy');
  const failed = terminalOf('failed');
  fail('failed');
  assert.equal(failed.webContents.closed, true);
  assert.equal(healthy.webContents.closed, false);
  assert.equal(service.snapshot('failed').status, 'error');
  assert.equal(service.snapshot('healthy').status, 'ready');
  await service.initializeSurface('failed');
  assert.equal(service.snapshot('failed').status, 'ready');
  assert.notEqual(terminalOf('failed'), failed);
  assert.equal(terminalOf('healthy'), healthy);
});

test('surface preparation failures remain local and Retry leaves connected siblings untouched', async () => {
  const a = tabHost('stable'),
    b = tabHost('retry');
  await service.openOnTab(a.host);
  await flush();
  const stable = terminalOf('stable');
  const gate = deferred();
  gates.set('retry', gate);
  await service.openOnTab(b.host);
  gate.reject(Error('config-invalid'));
  await flush();
  assert.equal(service.snapshot('retry').error, 'config-invalid');
  assert.equal(service.snapshot('stable').status, 'ready');
  assert.equal(stable.webContents.closed, false);
  assert.equal(terminalOf('retry'), undefined);
  gates.delete('retry');
  await service.initializeSurface('retry');
  assert.equal(service.snapshot('retry').status, 'ready');
  assert.equal(terminalOf('stable'), stable);
  assert.equal(stable.webContents.loads, 1);
});

test('closing a tab during session preparation closes only that identity and prevents late attachment', async () => {
  const tab = tabHost('pending-session');
  const gate = deferred();
  gates.set('pending-session', gate);
  await service.openOnTab(tab.host);
  service.closeTab(tab.host);
  assert.deepEqual(calls.close, ['pending-session']);
  assert.equal(tab.state.attached, false);
  gate.resolve();
  await flush();
  assert.equal(terminalOf('pending-session'), undefined);
  assert.equal(views.length, 1, 'late native readiness cannot create a terminal view');
  assert.equal(listenerCount(), 0);
});

test('closing before chrome readiness preserves close intent and never docks the stale surface', async () => {
  const tab = tabHost('pending-chrome');
  const gate = deferred();
  chromeGates.set('pending-chrome', gate);
  const opening = service.openOnTab(tab.host);
  service.closeTab(tab.host);
  const rejected = assert.rejects(opening, /no longer available/);
  gate.resolve();
  await rejected;
  await flush();
  assert.deepEqual(calls.close, ['pending-chrome']);
  assert.equal(tab.state.attached, false);
  assert.equal(terminalOf('pending-chrome'), undefined);
  assert.deepEqual(calls.prepare, [], 'closed chrome must never start a late native session');
  assert.equal(listenerCount(), 0);
});

test('Workbench cover keeps a pending terminal hidden and restores its focus without recreating the view', async () => {
  const tab = tabHost('covered');
  const gate = deferred();
  gates.set('covered', gate);
  await service.openOnTab(tab.host);
  service.setTabActive(tab.host, false);
  gate.resolve();
  await flush();
  const terminal = terminalOf('covered');
  assert.ok(terminal);
  assert.equal(terminal.visible, false);
  service.setContentBounds('covered', { x: 0, y: 48, width: 900, height: 552 });
  assert.equal(terminal.visible, false);
  terminal.webContents.emit('focus');
  assert.deepEqual(calls.focus, [], 'hidden terminals cannot become the remembered active cwd');
  service.setTabActive(tab.host, true);
  assert.equal(terminal.visible, true);
  assert.equal(terminalOf('covered'), terminal);
  assert.equal(terminal.webContents.loads, 1);
  assert.deepEqual(terminal.bounds, { x: 0, y: 48, width: 900, height: 552 });
  assert.deepEqual(
    calls.focus,
    ['covered'],
    'returning from Workbench restores native keyboard and cwd focus'
  );
});

test('application teardown stops the shared runtime without closing named sessions or attaching late views', async () => {
  const tab = tabHost('shutdown-pending');
  const gate = deferred();
  gates.set('shutdown-pending', gate);
  await service.openOnTab(tab.host);
  await service.destroy();
  assert.equal(calls.stop, 1);
  assert.deepEqual(calls.close, []);
  assert.equal(listenerCount(), 0);
  gate.resolve();
  await flush();
  assert.equal(views.length, 1);
  assert.equal(views[0].webContents.closed, true);
});

test('explicit standalone close closes its session while generic destroy retains reopened sessions', async () => {
  await service.open();
  await flush();
  assert.equal(listenerCount(), 1);
  service.close();
  await flush();
  assert.deepEqual(calls.close, ['window']);
  assert.equal(calls.stop, 0);
  assert.equal(listenerCount(), 0);
  await service.open();
  await flush();
  await service.destroy();
  assert.deepEqual(
    calls.close,
    ['window'],
    'destroy does not reinterpret carrier destruction as user close'
  );
  assert.equal(calls.stop, 1);
  assert.equal(listenerCount(), 0);
});
