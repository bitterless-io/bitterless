/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const runtime = { current: null };
const require = createRequire(import.meta.url);
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
class MockWebContents extends EventEmitter {
  destroyed = false; focusCalls = 0; loads = [];
  isDestroyed() { return this.destroyed; }
  focus() { this.focusCalls++; runtime.current.focused = this; }
  setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
  loadFile(...args) { this.loads.push({ type: 'file', args }); return runtime.current.load.promise; }
  loadURL(...args) { this.loads.push({ type: 'url', args }); return runtime.current.load.promise; }
  close() { this.destroyed = true; this.emit('destroyed'); }
}
class MockWebContentsView {
  webContents = new MockWebContents(); bounds = null; visible = false;
  constructor(options) { this.options = options; runtime.current.views.push(this); }
  setBounds(bounds) { this.bounds = { ...bounds }; }
  setBackgroundColor(color) { this.backgroundColor = color; }
  setVisible(visible) { this.visible = visible; }
}
class MockBrowserWindow extends EventEmitter {
  destroyed = false; focused = true; size = [1000, 700]; webContents = new MockWebContents();
  children = [{ name: 'page' }, { name: 'chat' }];
  contentView = {
    addChildView: view => { this.children = this.children.filter(item => item !== view); this.children.push(view); },
    removeChildView: view => { this.children = this.children.filter(item => item !== view); },
  };
  isDestroyed() { return this.destroyed; } isFocused() { return this.focused; } getContentSize() { return this.size; }
}
runtime.WebContentsView = MockWebContentsView;
const mocks = {
  electron: `const runtime=globalThis.runtime; export const WebContentsView=runtime.WebContentsView; export const webContents={getFocusedWebContents:()=>runtime.current.focused};`,
  '@electron-toolkit/utils': 'export const is={dev:false};',
  '@maestro-main/data/maestroDataRoot': "export const MAESTRO_PARTITION='persist:history-test';",
  vue: 'export const reactive=value=>value; export const nextTick=()=>Promise.resolve();',
  'electron-xpc/main': 'export const xpcMain={broadcast:(event,params)=>globalThis.runtime.current.broadcast(event,params)};',
  'electron-xpc/renderer': `export const createXpcRendererEmitter=name=>globalThis.runtime.current.emitters[name]; export const xpcRenderer={subscribe:(name,cb)=>{ const map=globalThis.runtime.current.subscriptions; map.set(name,cb); }};`,
};
const bundle = await build({
  stdin: { contents: `
    export { MaestroHistoryViewService } from './src/main/maestro/windows/main/maestroHistoryView.service.ts';
    export { browserHistoryStore } from './src/renderer/maestro/home/src/components/MenuBar/browserHistory.store.ts';
    export { historyStore } from './src/renderer/maestro/history/src/history.store.ts';
  `, resolveDir: root },
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', write: false,
  define: { __dirname: JSON.stringify(resolve(root, 'out/main')) }, tsconfig: resolve(root, 'tsconfig.node.json'),
  plugins: [{ name: 'history-boundary', setup(context) {
    context.onResolve({ filter: /.*/ }, ({ path }) => Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined);
    context.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: mocks[path], loader: 'js' }));
  } }],
});
const entry = name => ({ url: `https://history.invalid/${name}`, title: name, favicon: '', visitCount: 1, lastVisitedAt: 1 });
const fixture = (context) => {
  const win = new MockBrowserWindow();
  const state = { views: [], broadcasts: [], subscriptions: new Map(), focused: win.webContents, load: deferred(), logs: [], calls: [], timers: new Map(), timerId: 0, clock: 1000 };
  state.broadcast = (event, params) => { state.broadcasts.push({ event, params }); state.subscriptions.get(event)?.({ params }); };
  state.emitters = {
    BrowserHistoryPopupHandler: { update: async value => state.service.update(value), hide: async ({session}) => state.service.hide(session), blur: async () => state.service.blur(), snapshot: async () => state.service.snapshot(), action: async value => state.service.action(value) },
    BrowserHistoryDao: { search: async () => [entry('first'), entry('second')], remove: async value => { state.calls.push(['remove',value]); } },
    CoachXpcHandler: { backgroundWorkbenchTab: async () => {}, getTabs: async () => [{ active:true,kind:'browser' }], navigate: async value => {state.calls.push(['navigate',value]);}, openTab: async value => {state.calls.push(['openTab',value]);} },
  };
  class Element { closest(){return null;} }
  const input = Object.assign(new Element(), { value:'first',disabled:false,getBoundingClientRect:()=>({x:160,y:50,width:500,height:32}),focus:()=>win.webContents.focus() });
  const module = { exports:{} };
  runtime.current=state;
  runInNewContext(bundle.outputFiles[0].text, { module,exports:module.exports,require,runtime,Element,
    console:{info:(...args)=>state.logs.push(args)}, Date:class extends Date { static now(){return state.clock;} },
    document:{addEventListener(){},removeEventListener(){}},window:{addEventListener(){},removeEventListener(){}},ResizeObserver:class {observe(){}disconnect(){}},
    setTimeout:(fn,ms)=>{state.timers.set(++state.timerId,{fn,ms});return state.timerId;},clearTimeout:id=>state.timers.delete(id),
  });
  const {MaestroHistoryViewService,browserHistoryStore,historyStore}=module.exports;
  const host={browserWindow:win,activeTabId:'tab-one'};
  const service=new MaestroHistoryViewService(host);state.service=service;service.create(win);
  const request=(overrides={})=>({session:1001,revision:1,tabId:'tab-one',query:'first',anchor:{x:160,y:50,width:500,height:32},entries:[entry('first'),entry('second')],selectedIndex:-1,loading:false,error:false,...overrides});
  const load=async()=>{state.load.resolve();await settle();};
  const tick=async()=>{for(const[id,timer]of [...state.timers]){state.timers.delete(id);timer.fn();}await settle();};
  context.after(()=>{browserHistoryStore.dispose();service.reset();});
  return {state,win,host,service,request,load,tick,input,home:browserHistoryStore,popup:historyStore};
};

test('eager view loads without token/mounted handshake and presents accepted data above page/chat',async context=>{
  const f=fixture(context);const [view]=f.state.views;assert.equal(view.visible,false);assert.equal(view.webContents.loads[0].args.length,1);
  assert.equal(f.service.update(f.request()),true);assert.equal(f.win.children.includes(view),false);
  await f.load();assert.equal(f.win.children.at(-1),view);assert.equal(view.visible,true);assert.equal(f.win.webContents.focusCalls,0);
  assert.equal(f.service.update(f.request({revision:2})),true);assert.equal(f.win.children.filter(item=>item===view).length,1);
});

test('new home session revision one opens after earlier revision 50 and full home navigation',async context=>{
  const f=fixture(context);await f.load();f.service.update(f.request({revision:50}));
  f.win.webContents.emit('did-start-navigation',{},'private-url',false,true);assert.equal(f.service.snapshot(),null);
  assert.equal(f.service.update(f.request({session:1002,revision:1})),true);
  assert.equal(f.service.update(f.request({revision:51})),false);assert.equal(f.service.snapshot().session,1002);
});

test('dismissed sessions/stale revisions and stale action identities cannot reopen or navigate',async context=>{
  const f=fixture(context);await f.load();f.service.update(f.request({revision:2}));
  assert.equal(f.service.update(f.request()),false);f.service.hide(1001);
  assert.equal(f.service.update(f.request({revision:3})),false);assert.equal(f.service.update(f.request({session:1002})),true);
  f.service.hide(1001);assert.equal(f.service.snapshot().session,1002);
  f.service.action({session:1001,revision:2,action:'accept',url:entry('first').url});
  assert.equal(f.state.broadcasts.some(item=>item.event==='coach/history-action'),false);
});

test('window focus, tab, anchor and popup process/load failures reject updates with bounded reasons',async context=>{
  const f=fixture(context);f.win.focused=false;assert.equal(f.service.update(f.request()),false);f.win.focused=true;
  assert.equal(f.service.update(f.request({tabId:'wrong'})),false);
  assert.equal(f.service.update(f.request({anchor:{x:NaN,y:0,width:10,height:10}})),false);
  assert.equal(f.service.update(f.request()),true);
  f.state.load.reject(Object.assign(new Error('private-load-url'),{code:'ERR_FILE_NOT_FOUND'}));await settle();
  assert.equal(f.service.update(f.request()),false);
  for(const reason of ['window-unfocused','tab-mismatch','invalid-anchor','closed-session'])assert.ok(f.state.logs.some(([line])=>line.includes(reason)));
  assert.equal(JSON.stringify(f.state.logs).includes('private-load-url'),false);
});

test('popup crash/destruction keeps old session blocked and lets a fresh session recreate without late old readiness',async context=>{
  for(const event of ['render-process-gone','destroyed']){
    const f=fixture(context);f.service.update(f.request());
    const oldView=f.state.views[0],oldLoad=f.state.load;
    if(event==='destroyed')oldView.webContents.destroyed=true;
    oldView.webContents.emit(event,{}, {reason:'crashed',exitCode:1});
    assert.equal(f.service.snapshot(),null);
    assert.equal(f.service.update(f.request({revision:2})),false);
    f.state.load=deferred();assert.equal(f.service.update(f.request({session:1002})),true);
    const replacement=f.state.views.at(-1);assert.notEqual(replacement,oldView);
    oldLoad.resolve();await settle();assert.equal(replacement.visible,false);
    await f.load();assert.equal(replacement.visible,true);assert.equal(f.win.children.at(-1),replacement);
    oldView.webContents.emit('render-process-gone',{}, {reason:'crashed',exitCode:1});
    assert.equal(f.service.snapshot().session,1002);
  }
});

test('native blur preserves both Home and popup focus; outside focus dismisses',async context=>{
  const f=fixture(context);await f.load();f.service.update(f.request());
  for(const focused of [f.win.webContents,f.state.views[0].webContents]){f.state.focused=focused;f.service.blur();await f.tick();assert.ok(f.service.snapshot());}
  f.state.focused=new MockWebContents();f.service.blur();await f.tick();assert.equal(f.service.snapshot(),null);
  f.service.update(f.request({session:1002}));f.win.emit('blur');assert.equal(f.service.snapshot(),null);
});

test('same-document navigation dismisses; subframe navigation does not; old loads cannot attach replacement',async context=>{
  const f=fixture(context);f.service.update(f.request());
  f.win.webContents.emit('did-start-navigation',{},'private-url',false,false);assert.ok(f.service.snapshot());
  f.win.webContents.emit('did-start-navigation',{},'private-url',true,true);assert.equal(f.service.snapshot(),null);
  const oldLoad=f.state.load;f.service.reset();f.state.load=deferred();f.service.create(f.win);
  f.service.update(f.request({session:1002}));oldLoad.resolve();await settle();assert.equal(f.state.views.at(-1).visible,false);
  await f.load();assert.equal(f.state.views.at(-1).visible,true);
});

test('window teardown releases renderer/listeners without touching native view after window destruction',async context=>{
  const f=fixture(context);await f.load();f.service.update(f.request());const view=f.state.views[0],contents=view.webContents;
  f.win.destroyed=true;Object.defineProperty(view,'webContents',{get(){throw new Error('destroyed view');}});view.setVisible=()=>{throw new Error('destroyed view');};
  f.win.emit('closed');assert.equal(contents.isDestroyed(),true);assert.equal(f.win.listenerCount('resize'),0);assert.equal(f.service.snapshot(),null);
});

test('bounds stay clipped and no vertical space dismisses',async context=>{
  const f=fixture(context);await f.load();f.service.update(f.request());f.win.size=[180,90];f.win.emit('resize');
  const {x,y,width,height}=f.state.views[0].bounds;assert.ok(x>=0&&y>=0&&width>0&&height>0&&x+width<=180&&y+height<=90);
  f.win.size=[180,20];f.win.emit('resize');assert.equal(f.service.snapshot(),null);
});

test('linked real Home → main → popup → click navigates exactly once with original Google query',async context=>{
  const f=fixture(context);f.home.bind(f.input);f.home.setActiveTab('tab-one');await f.popup.init();await f.load();
  f.input.value=' 搜索 & 100% #? ';f.home.focus();await settle();
  assert.equal(f.popup.snapshot.entries.length,2);assert.equal(f.state.views[0].visible,true);
  await f.popup.action('accept',f.popup.googleUrl);await settle();
  assert.equal(f.state.calls.filter(([name])=>name==='navigate').length,1);assert.equal(new URL(f.state.calls[0][1].url).searchParams.get('q'),f.input.value);
  assert.equal(f.home.open,false);assert.equal(f.service.snapshot(),null);
});

test('linked remove/retry first clicks consume identity before restoring focus and stale clicks are rejected',async context=>{
  const f=fixture(context);f.home.bind(f.input);f.home.setActiveTab('tab-one');await f.popup.init();await f.load();f.home.toggle();await settle();
  const old={...f.popup.snapshot};f.state.emitters.BrowserHistoryDao.search=async()=>[entry('second')];
  await f.popup.action('remove',entry('first').url);await settle();assert.equal(f.state.calls.filter(([name])=>name==='remove').length,1);assert.equal(f.popup.snapshot.entries[0].title,'second');
  f.service.action({session:old.session,revision:old.revision,action:'accept',url:entry('first').url});await settle();assert.equal(f.state.calls.some(([name])=>name==='navigate'),false);
  f.state.emitters.BrowserHistoryDao.search=async()=>null;await f.popup.action('retry');await settle();assert.equal(f.popup.snapshot.error,true);
  f.state.emitters.BrowserHistoryDao.search=async()=>[];await f.popup.action('retry');await settle();assert.equal(f.popup.snapshot.error,false);assert.equal(f.home.open,true);
});

test('linked removal refresh stays closed when dismissed during its pending SQL search',async context=>{
  const f=fixture(context);f.home.bind(f.input);f.home.setActiveTab('tab-one');await f.popup.init();await f.load();f.home.toggle();await settle();
  const pending=deferred();f.state.emitters.BrowserHistoryDao.search=()=>pending.promise;
  await f.popup.action('remove',entry('first').url);await settle();assert.equal(f.home.loading,true);
  f.service.hide();pending.resolve([entry('second')]);await settle();
  assert.equal(f.home.open,false);assert.equal(f.service.snapshot(),null);assert.equal(f.state.views[0].visible,false);
});

test('Google cannot be removed and unrelated URLs cannot be accepted through the linked action path',async context=>{
  const f=fixture(context);f.home.bind(f.input);f.home.setActiveTab('tab-one');await f.popup.init();await f.load();f.home.focus();await settle();
  await f.popup.action('remove',f.popup.googleUrl);await f.popup.action('accept','https://unrelated.invalid');await settle();
  assert.equal(f.state.calls.length,0);assert.equal(f.home.open,true);
});

test('popup snapshot refresh sequence discards late old state and logs exclude all browsing/token payloads',async context=>{
  const f=fixture(context);const old=deferred();let count=0;f.state.emitters.BrowserHistoryPopupHandler.snapshot=()=>++count===1?old.promise:Promise.resolve(f.request({revision:2,query:'private-query',entries:[entry('private-title')]}));
  const init=f.popup.init();f.state.broadcast('coach/history-state',{});await settle();old.resolve(f.request());await init;assert.equal(f.popup.snapshot.revision,2);
  f.service.update(f.request({query:'private-query',entries:[entry('private-title')]}));await f.load();
  f.state.views[0].webContents.emit('preload-error',{},'/private/path',Object.assign(new Error('private-message'),{name:'private-name',code:'private-code'}));
  f.state.views[0].webContents.emit('render-process-gone',{}, {reason:'crashed',exitCode:1});
  const logs=JSON.stringify(f.state.logs);for(const value of ['private-query','private-title','private-message','private-name','private-code','/private/path','https://'])assert.equal(logs.includes(value),false);
  for(const args of f.state.logs)assert.equal(args.length,1);
  assert.ok(logs.includes('native.attached'));assert.ok(logs.includes('native.preload.failure'));
});
