/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import * as vue from 'vue';

const root = resolve(import.meta.dirname, '../..');
const panelFile = 'src/renderer/maestro/control/src/ChatPanel.vue';
const source = readFileSync(resolve(root, panelFile), 'utf8');
const { descriptor } = parse(source, { filename: panelFile });
const script = compileScript(descriptor, { id: 'history', genDefaultAs: 'component' });
const activeTurn = vue.ref(null);
const fixture = {
  mounts: [], unmounts: [], listeners: new Map(), calls: [], confirmations: [], notices: [], focused: true,
  copyContext: async () => ({ ok: true, chars: 123, entries: 4 }),
  copySessionPath: async () => ({ ok: true, path: '/tmp/session-io' }),
  readContextGraph: async () => ({ ok: true, graph: { sessionId: 'b', systemChars: 10, systemPreview: 'S', blocks: [], turns: 0, totalChars: 10, byType: [], pending: { chars: 0 }, noHistory: true } }),
  messageStore: vue.reactive({
    sessionListItems: [],
    refreshHistory: async () => undefined,
    turnService: {
      activeTurn: () => fixture.activeTurn,
      send: async () => { fixture.calls.push('send'); return { text: 'ok' }; }
    },
    stopUsingWorkspace: async (id) => fixture.calls.push(['clear', id]),
    buildAgentContext: (session, _messageId, attachedPaths) => ({ workspace: session.detail.workspace, attachedPaths })
  }),
  get activeTurn() { return activeTurn.value; },
  set activeTurn(value) { activeTurn.value = value; }
};
fixture.sessionActions = vue.reactive({ historyVisible: false, searchVisible: false, closeSearch() { this.searchVisible = false; }, toggleHistory() { this.historyVisible = !this.historyVisible; } });
globalThis.__historyFixture = fixture;
globalThis.__historyVue = vue;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { platform: 'MacIntel' } });
Object.defineProperty(globalThis, 'document', { configurable: true, value: { hasFocus: () => fixture.focused } });
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  addEventListener: (name, callback, capture) => fixture.listeners.set(name, { callback, capture }),
  removeEventListener: (name, callback, capture) => {
    assert.deepEqual(fixture.listeners.get(name), { callback, capture });
    fixture.listeners.delete(name);
  }
} });
after(() => {
  for (const [name, original] of [['window', originalWindow], ['document', originalDocument], ['navigator', originalNavigator]]) {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  }
  delete globalThis.__historyFixture;
  delete globalThis.__historyVue;
});
const icons = /import \{ ([^}]+) \} from '@tabler\/icons-vue'/.exec(source)[1].split(',').map((name) => name.trim());
const mocks = {
  vue: `const v = globalThis.__historyVue; export const ${['ref', 'computed', 'nextTick', 'defineComponent', 'reactive', 'watch'].map((name) => `${name} = v.${name}`).join(', ')};
    export const onMounted = (callback) => globalThis.__historyFixture.mounts.push(callback);
    export const onBeforeUnmount = (callback) => globalThis.__historyFixture.unmounts.push(callback);`,
  '@tabler/icons-vue': `export const ${icons.map((name) => `${name} = {}`).join(', ')};`,
  '@arco-design/web-vue': `export const Button = {}, Drawer = {}, Tooltip = {};
    export const Message = Object.fromEntries(['success', 'warning', 'error'].map(kind => [kind, text => globalThis.__historyFixture.notices.push({kind, text})]));
    export const Modal = { confirm: (params) => globalThis.__historyFixture.confirmations.push(params) };`,
  'electron-xpc/renderer': `export const createXpcRendererEmitter = () => ({ copyNextTurnContext: params => {
    globalThis.__historyFixture.calls.push(['copy', params]); return globalThis.__historyFixture.copyContext(params);
  }, copySessionIoPath: params => {
    globalThis.__historyFixture.calls.push(['path', params]); return globalThis.__historyFixture.copySessionPath(params);
  }, readContextGraph: params => {
    globalThis.__historyFixture.calls.push(['graph', params]); return globalThis.__historyFixture.readContextGraph(params);
  } });`,
  '@renderer/common/i18n/i18n.helper': `export const i18nHelper = { maestroControl: { chat: {
    stopUsingWorkspaceTitle: 'Clear?', stopUsingWorkspaceContent: 'Clear {name}?', stopUsingWorkspace: 'Clear', keepWorkspace: 'Keep',
    slashClear: 'Start a fresh chat; keep this conversation', slashViewContext: 'Copy model context and pending input',
    slashCopied: 'Copied {chars} / {entries}', newChatUnavailable: 'The source chat is inactive or archived.',
    slashCopySessionPath: 'Copy the model I/O jsonl folder for this session', slashPathCopied: 'Session jsonl path copied',
    slashViewContextGraph: 'Show the structure of the context the next send would give the model'
  }, contextGraph: { readFailed: 'Could not read the context' } } };`,
  './store/sessionActions.store': 'export const sessionActions = globalThis.__historyFixture.sessionActions;',
  './store/message.store': 'export const messageStore = globalThis.__historyFixture.messageStore;',
  './store/channel.store': `export const channelStore = {
    startNewMaestroSession: (id) => globalThis.__historyFixture.startNewSession(id),
    selectMaestroHistorySession: async (id) => globalThis.__historyFixture.calls.push(['history', id])
  };`,
  './store/turn.service': 'export const isRejection = () => false;',
  // 面板现在从这里**取值**(不只是取类型):`CONTEXT_GRAPH_MATCH_HEAD_CHARS`。
  // 类型导入会被 esbuild 直接擦掉,值导入必须能解析 —— 而这个 harness 没有 `@maestro-*` 别名,
  // 所以这条 mock 就是那个别名的替身。数必须与 `src/shared/maestro/coach.api.ts` 里的一致。
  '@maestro-shared/coach.api': 'export const CONTEXT_GRAPH_MATCH_HEAD_CHARS = 200;'
};
const output = await build({
  stdin: { contents: `${script.content}\nexport default component;`, resolveDir: resolve(root, 'src/renderer/maestro/control/src'), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm',
  tsconfig: resolve(root, 'tsconfig.web.json'),
  plugins: [{ name: 'history-boundaries', setup(context) {
    context.onResolve({ filter: /.*/ }, ({ path }) =>
      Object.hasOwn(mocks, path) || /\.(vue|less)$/.test(path) ? { path, namespace: 'history-mock' } : undefined);
    context.onLoad({ filter: /.*/, namespace: 'history-mock' }, ({ path }) => ({ contents: mocks[path] ?? 'export default {};' }));
  } }]
});
const { default: component } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const tick = () => new Promise((done) => setImmediate(done));
const harness = (t, archivedAt) => {
  fixture.mounts.length = 0;
  fixture.unmounts.length = 0;
  fixture.calls.length = 0;
  fixture.confirmations.length = 0;
  fixture.notices.length = 0;
  fixture.copyContext = async () => ({ ok: true, chars: 123, entries: 4 });
  fixture.copySessionPath = async () => ({ ok: true, path: '/tmp/session-io' });
  fixture.readContextGraph = async () => ({ ok: true, graph: { sessionId: 'b', systemChars: 10, systemPreview: 'S', blocks: [], turns: 0, totalChars: 10, byType: [], pending: { chars: 0 }, noHistory: true } });
  fixture.listeners.clear();
  fixture.focused = true;
  fixture.sessionActions.historyVisible = false;
  fixture.sessionActions.searchVisible = false;
  fixture.activeTurn = null;
  fixture.startNewSession = async (id) => { fixture.calls.push(['new', id]); return true; };
  fixture.messageStore.sessionListItems = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const props = vue.reactive({ session: { id: 'b', archivedAt, messages: [], detail: { workspace: { name: 'Project' } } } });
  const ui = component.setup(props, { expose: () => undefined, emit: () => undefined });
  let focused = 0;
  ui.composerRef.value = { focus: () => focused++, style: {}, selectionStart: 0, scrollHeight: 44, setSelectionRange: () => undefined };
  for (const mount of fixture.mounts) mount();
  t.after(() => { for (const unmount of fixture.unmounts) unmount(); });
  const key = (key, options = {}) => {
    const event = { key, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...options };
    fixture.listeners.get('keydown').callback(event);
    return event;
  };
  return { ui, key, props, focused: () => focused };
};

test('SFC compiles and footer uses workspace-before-attachment with mutually exclusive Stop/Send', () => {
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: panelFile, id: 'history', compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
  assert.ok(source.indexOf('name="maestro__composer__workspace"') < source.indexOf('name="maestro__composer__attach"'));
  assert.match(source, /<IconBtn\s+v-else\s+name="maestro__composer__send"/);
  assert.doesNotMatch(source, /context-meter|contextTooltipLines|IconRefresh/);
  const newButton = source.match(/<Button\s+name="maestro__new_chat"[\s\S]*?>/)[0];
  assert.doesNotMatch(newButton, /turnLocked/);
  assert.match(newButton, /session\.archivedAt/);
});

test('composer mount exposes focus and pairs its New chat listener cleanup', async (t) => {
  const { ui, focused } = harness(t);
  await tick();
  assert.equal(focused(), 1);
  assert.equal(fixture.listeners.get('keydown').capture, true);
  ui.focusComposer();
  assert.equal(focused(), 2);
});

test('New chat shortcuts work while busy and still respect focus, IME and repeated activation', async (t) => {
  const { ui, key } = harness(t);
  for (const options of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { altKey: true }, { shiftKey: true }]) {
    key('n', { metaKey: true, ...options });
    assert.deepEqual(fixture.calls, []);
  }
  fixture.focused = false;
  key('n', { metaKey: true });
  assert.deepEqual(fixture.calls, []);
  fixture.focused = true;
  fixture.activeTurn = {};
  key('n', { metaKey: true });
  await tick();
  assert.deepEqual(fixture.calls, [['new', 'b']]);
  key('n', { ctrlKey: true, repeat: true });
  key('n', { ctrlKey: true });
  await tick();
  assert.deepEqual(fixture.calls, [['new', 'b'], ['new', 'b']]);
});

test('archived composers are not auto-focused and cannot start New chat', async (t) => {
  const { ui, focused } = harness(t, 1);
  await tick();
  assert.equal(focused(), 0);
  assert.equal(await ui.startNewChat(), false, 'archived chats remain protected');
});

test('workspace clear ignores another session turn and rechecks its own turn after confirmation', async (t) => {
  const { ui, props } = harness(t);
  fixture.activeTurn = {};
  await ui.stopUsingWorkspace();
  assert.deepEqual(fixture.calls, []);
  assert.match(fixture.confirmations[0].content, /Project/);
  props.session.turn = {};
  await fixture.confirmations[0].onOk();
  assert.deepEqual(fixture.calls, []);
  delete props.session.turn;
  await fixture.confirmations[0].onOk();
  assert.deepEqual(fixture.calls, [['clear', 'b']]);
});

const draft = async (ui, text, caret = text.length) => {
  ui.input.value = text;
  ui.composerRef.value.selectionStart = caret;
  ui.updateComposerCaret();
  await vue.nextTick();
};
const composerKey = (ui, key, options = {}) => {
  const event = { key, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...options };
  ui.onComposerKeydown(event);
  return event;
};

test('slash menu triggers only at a line start, filters predictably and wraps its ASCII order', async (t) => {
  const { ui } = harness(t);
  for (const value of ['~/Downloads/a.pdf', '9/1', 'and/or', 'a /view', '/Users/file', '/2026/09/08']) {
    await draft(ui, value);
    assert.equal(ui.slashVisible.value, false, value);
  }
  await draft(ui, '/clear/file', 6);
  assert.equal(ui.slashVisible.value, false);
  await draft(ui, 'Question\n/');
  assert.deepEqual(ui.shortcutStore.matches.map(item => item.name), ['/clear', '/copy_session_path', '/test_show_error', '/view_context', '/view_context_graph']);
  assert.equal(ui.shortcutStore.active.name, '/clear');
  composerKey(ui, 'ArrowUp');
  assert.equal(ui.shortcutStore.active.name, '/view_context_graph');
  composerKey(ui, 'ArrowDown');
  assert.equal(ui.shortcutStore.active.name, '/clear');
  await draft(ui, '/CONTEXT');
  assert.equal(ui.shortcutStore.active.name, '/view_context');
  await draft(ui, '/fresh');
  assert.equal(ui.shortcutStore.active.name, '/clear', 'description participates in filtering');
  await draft(ui, '/nonexistent');
  assert.equal(ui.slashVisible.value, false);
});

test('Tab completes, Escape preserves text, and IME/repeats do not execute a command', async (t) => {
  const { ui } = harness(t);
  await draft(ui, '/vie');
  for (const options of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }]) composerKey(ui, 'Enter', options);
  assert.deepEqual(fixture.calls, []);
  const tab = composerKey(ui, 'Tab');
  await vue.nextTick();
  assert.equal(tab.defaultPrevented, true);
  assert.equal(ui.input.value, '/view_context');
  assert.equal(ui.slashVisible.value, true);
  composerKey(ui, 'Escape');
  assert.equal(ui.input.value, '/view_context');
  assert.equal(ui.slashVisible.value, false);
});

test('/clear delegates New chat during a running turn without sending or deleting history', async (t) => {
  const { ui } = harness(t);
  await draft(ui, '/clear');
  fixture.activeTurn = {};
  composerKey(ui, 'Enter');
  await tick();
  assert.deepEqual(fixture.calls, [['new', 'b']]);
  assert.equal(ui.input.value, '');
  assert.deepEqual(fixture.notices, []);
});

test('failed or refused New chat and /clear preserve input and attachments', async (t) => {
  const { ui } = harness(t);
  const files = [{ name: 'keep.txt', path: '/test/keep.txt' }];
  for (const fail of [async () => false, async () => { throw new Error('create failed'); }]) {
    fixture.startNewSession = fail;
    await draft(ui, 'keep this draft'); ui.selectedFiles.value = files;
    assert.equal(await ui.startNewChat(), false);
    assert.equal(ui.input.value, 'keep this draft');
    assert.deepEqual(ui.selectedFiles.value, files);
    await draft(ui, '/clear'); composerKey(ui, 'Enter'); await tick();
    assert.equal(ui.input.value, '/clear');
    assert.deepEqual(ui.selectedFiles.value, files);
  }
});

test('pending New chat creates once and late success preserves edited or switched composers', async (t) => {
  const { ui, props, key } = harness(t);
  for (const switchSession of [false, true]) {
    let finish; let calls = 0;
    fixture.startNewSession = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
    await draft(ui, 'original');
    const pending = ui.startNewChat();
    key('n', { metaKey: true });
    assert.equal(calls, 1);
    if (switchSession) props.session = { ...props.session, id: 'c' };
    await draft(ui, 'newly edited');
    ui.selectedFiles.value = [{ name: 'new.txt', path: '/test/new.txt' }];
    finish(true); assert.equal(await pending, true);
    assert.equal(ui.input.value, 'newly edited');
    assert.equal(ui.selectedFiles.value[0].name, 'new.txt');
  }
});

test('/view_context removes only its slash token and sends references rather than file bytes', async (t) => {
  const { ui } = harness(t);
  ui.selectedFiles.value = [{ name: 'report.pdf', path: '/project/report.pdf' }];
  await draft(ui, 'Question\n/view_context\nKeep this', 'Question\n/view_context'.length);
  composerKey(ui, 'Enter');
  await tick();
  assert.deepEqual(fixture.calls, [['copy', {
    sessionId: 'b', draft: 'Question\n\nKeep this',
    context: { workspace: { name: 'Project' }, attachedPaths: ['/project/report.pdf'] }
  }]]);
  assert.equal(ui.input.value, 'Question\n\nKeep this');
  assert.equal(ui.selectedFiles.value.length, 1);
  assert.equal(fixture.notices.at(-1).kind, 'success');
});

test('one pending command cannot repeat or send; late completion preserves newly typed input', async (t) => {
  const { ui } = harness(t);
  let finish;
  fixture.copyContext = () => new Promise(resolve => { finish = resolve; });
  await draft(ui, '/view_context');
  composerKey(ui, 'Enter');
  composerKey(ui, 'Enter');
  await draft(ui, '/clear');
  composerKey(ui, 'Enter');
  assert.equal(fixture.calls.length, 1);
  finish({ ok: true, chars: 12, entries: 1 });
  await tick();
  assert.equal(ui.input.value, '/clear');
  assert.equal(ui.shortcutStore.pending, false);
});

test('failed export retains retryable draft; switched sessions and unmounts fence late writes', async (t) => {
  const { ui, props } = harness(t);
  fixture.copyContext = async () => ({ ok: false, error: 'runtime unsupported' });
  await draft(ui, '/view_context');
  await ui.commitShortcut();
  assert.equal(ui.input.value, '/view_context');
  assert.equal(ui.slashVisible.value, true);
  assert.match(fixture.notices.at(-1).text, /runtime unsupported/);
  let finish;
  fixture.copyContext = () => new Promise(resolve => { finish = resolve; });
  const pending = ui.commitShortcut();
  props.session = { ...props.session, id: 'new-session' };
  assert.equal(ui.shortcutStore.open, false);
  await draft(ui, 'new session draft');
  finish({ ok: true, chars: 12, entries: 1 });
  await pending;
  assert.equal(ui.input.value, 'new session draft');
  await draft(ui, '/view_context');
  const disposed = ui.commitShortcut();
  for (const unmount of fixture.unmounts.splice(0)) unmount();
  finish({ ok: true, chars: 12, entries: 1 });
  await disposed;
  assert.equal(ui.input.value, '/view_context');
  assert.equal(ui.shortcutStore.open, false);
});

test('an export error remains visible without replacing a newer draft', async (t) => {
  const { ui } = harness(t);
  let finish;
  fixture.copyContext = () => new Promise(resolve => { finish = resolve; });
  await draft(ui, '/view_context');
  const pending = ui.commitShortcut();
  await draft(ui, 'Keep my new draft');
  finish({ ok: false, error: 'Clipboard unavailable' });
  await pending;
  assert.equal(ui.input.value, 'Keep my new draft');
  assert.equal(fixture.notices.at(-1).text, 'Clipboard unavailable');
});
