import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const aliases = [['@maestro-shared/', 'src/shared/maestro/'], ['@maestro-main/', 'src/main/maestro/'], ['@main/', 'src/main/']];
const broadcasts = [];
class CommonService { setState(state) { this._state = state; } }
const stubs = {
  electron: {},
  '@electron-toolkit/utils': { is: { dev: false } },
  'electron-xpc/main': { xpcMain: { broadcast: (event, data) => broadcasts.push({ event, data }) } },
  inversify: { injectable: () => (target) => target },
  '@maestro-shared/iocHelper/ioc.helper': { CommonService },
  '@maestro-main/data/maestroDataRoot': { MAESTRO_PARTITION: 'test' },
  '@maestro-main/windows/devtoolsGate': { shouldOpenDevTools: () => false },
  './viewBounds': { createBoundsApplier: () => () => {} }
};
const cache = new Map();
const load = (relative) => {
  const file = resolve(root, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const native = createRequire(file);
  const requireFrom = (name) => {
    if (stubs[name]) return stubs[name];
    if (name.startsWith('.')) return load(resolve(dirname(file), `${name}.ts`));
    for (const [prefix, dir] of aliases) if (name.startsWith(prefix)) return load(`${dir}${name.slice(prefix.length)}.ts`);
    return native(name);
  };
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true }
  });
  new Function('require', 'module', 'exports', outputText)(requireFrom, module, module.exports);
  return module.exports;
};

const { buildSettingsTools } = load('src/main/agent/tools/settingsTools.ts');
const { SETTINGS_TABS, workbenchPanes, SETTINGS_PANE_REQUEST_EVENT } = load('src/shared/maestro/settingsNavigation.ts');
const { MaestroWorkbenchViewService } = load('src/main/maestro/windows/main/maestroWorkbenchView.service.ts');
const { HostToolRegistry } = load('src/main/agent/runtime/hostToolRegistry.ts');
const { MENU_BUILTIN_SKILL, MANUAL_BUILTIN_SKILL } = load('src/main/agent/settings.skill.ts');

const createHost = () => {
  const service = new MaestroWorkbenchViewService();
  service.setState({ layout() {}, setOperationContentCovered() {}, browserWindow: null, operationView: null });
  const tools = buildSettingsTools({ openPane: async (pane) => { service.openPane(pane); } });
  return { service, menu: tools[0], manual: tools[1] };
};

test('menu lists exactly the rendered tab order, with General directly before Capture', async () => {
  const { service, menu } = createHost();
  const result = JSON.parse(await menu.execute({}));
  assert.deepEqual(result.tabs.map(({ tab }) => tab), SETTINGS_TABS.map(({ tab }) => tab));
  assert.deepEqual(workbenchPanes.slice(0, 2), ['settings', 'recording']);
  assert.deepEqual(service.getState(), { open: false, visible: false });
  assert.equal(service.consumePaneRequest(), null);
});

test('native host keeps a first-open request until mount, and reopens closed/backgrounded Settings', async () => {
  const { service, menu } = createHost();
  broadcasts.length = 0;
  assert.equal(JSON.parse(await menu.execute({ tab: 'General' })).tab, 'general');
  assert.deepEqual(service.getState(), { open: true, visible: true });
  assert.equal(broadcasts.at(-1).event, SETTINGS_PANE_REQUEST_EVENT);
  // The renderer was not mounted for the broadcast. Its initial IPC read still gets the target.
  assert.equal(service.consumePaneRequest(), 'settings');
  assert.equal(service.consumePaneRequest(), null);
  service.backgroundTab();
  await menu.execute({ tab: 'capture' });
  assert.equal(service.getState().visible, true);
  assert.equal(service.consumePaneRequest(), 'recording');
  service.closeTab();
  await menu.execute({ tab: '模型' });
  assert.deepEqual(service.getState(), { open: true, visible: true });
  assert.equal(service.consumePaneRequest(), 'models');
  await menu.execute({ tab: 'skills' });
  await menu.execute({ tab: 'apps' });
  assert.equal(service.consumePaneRequest(), 'apps', 'latest request wins before a renderer consumes it');
});

test('invalid tab input cannot open Settings, alter a pending destination, or leak a sibling product tab', async () => {
  const { service, menu } = createHost();
  for (const tab of ['crms', 'profile', '', '   ', null, 3, {}, ['skills']]) {
    const result = JSON.parse(await menu.execute({ tab }));
    assert.equal(result.ok, false);
    assert.deepEqual(result.tabs.map(({ tab }) => tab), SETTINGS_TABS.map(({ tab }) => tab));
    assert.deepEqual(service.getState(), { open: false, visible: false });
  }
  service.openPane('skills');
  assert.throws(() => service.openPane('crms'), /Unknown Settings tab/);
  assert.equal(service.consumePaneRequest(), 'skills');
  service.openPane('models');
  service.reset();
  assert.equal(service.consumePaneRequest(), null);
});

test('manual is bundled, product-specific, topic-selectable, and never navigates', async () => {
  const { service, manual } = createHost();
  const complete = JSON.parse(await manual.execute({}));
  assert.equal(complete.product, 'Bitterless');
  for (const term of ['Maestro', 'OnlyPreview', 'Eyes on Agents', 'Omni Browser', 'Zellij', '/reload-skills', '/menu models']) assert.ok(complete.content.includes(term));
  assert.doesNotMatch(complete.content, /CRMS|institution|customer-profile/i);
  for (const topic of ['settings', 'capture', '技能', 'general']) assert.equal(JSON.parse(await manual.execute({ topic })).ok, true);
  const capture = JSON.parse(await manual.execute({ topic: 'capture' }));
  assert.match(capture.content, /Start and stop recording/);
  assert.doesNotMatch(capture.content, /## Apps/);
  const invalid = JSON.parse(await manual.execute({ topic: 'crms' }));
  assert.equal(invalid.ok, false);
  assert.ok(invalid.topics.includes('overview'));
  assert.deepEqual(service.getState(), { open: false, visible: false });
});

test('built-ins and tool metadata are registered in normal and session catalog paths', () => {
  const warnings = [];
  const tools = new HostToolRegistry({ scope: 'cowork', onWarning: (...args) => warnings.push(args) })
    .add(...buildSettingsTools({ openPane: async () => {} })).toRuntimeTools();
  assert.deepEqual(tools.map(({ name }) => name), ['menu', 'manual']);
  assert.deepEqual(warnings, []);
  for (const [brief, trigger] of [[MENU_BUILTIN_SKILL, '/menu'], [MANUAL_BUILTIN_SKILL, '/manual']]) {
    assert.ok(brief.triggers.includes(trigger));
    assert.match(brief.description, /No get_skill_contract/);
  }
  const agent = read('src/main/agent/maestroAgent.service.ts');
  for (const brief of ['MENU_BUILTIN_SKILL', 'MANUAL_BUILTIN_SKILL']) {
    assert.ok(agent.slice(agent.indexOf('private agentSkillBriefs('), agent.indexOf('private sessionSkillGuidance(')).includes(brief));
    assert.ok(agent.slice(agent.indexOf('private sessionSkillGuidance('), agent.indexOf('private buildMessagePrompt(')).includes(brief));
  }
  assert.match(read('src/main/maestro/windows/main/maestroWindow.controller.ts'), /buildSettingsTools\(\{ openPane: async \(pane\) => \{ await this\.openWorkbenchPane\(\{ pane \}\)/);
});

test('renderer consumes pending navigation on mount and event while keeping legacy routes and preferences', () => {
  const app = read('src/renderer/maestro/workbench/src/WorkbenchApp.vue');
  assert.match(app, /const pane = await coach\.consumeWorkbenchPaneRequest\(\)/);
  assert.match(app, /if \(isWorkbenchPane\(pane\)\) await router\.push\(\{ name: pane \}\)/);
  assert.match(app, /subscribe\(SETTINGS_PANE_REQUEST_EVENT, \(\) => void openRequestedPane\(\)\)\s+void openRequestedPane\(\)/);
  assert.match(app, /subscribe\('coach\/workbench-pane'/);
  assert.match(read('src/renderer/maestro/workbench/src/workbench.router.ts'), /path: '\/settings',\s+alias: '\/general',\s+name: 'settings'/);
  assert.match(read('src/renderer/maestro/workbench/src/workbench.store.ts'), /coach\.workbench\.prefs/);
  const en = read('src/renderer/common/i18n/en.ts');
  const zh = read('src/renderer/common/i18n/zh.ts');
  assert.match(en, /workbenchTab: 'Settings'/);
  assert.match(en, /maestroWorkbench: \{\s+title: 'Settings'/);
  assert.match(en, /settings: 'General'/);
  assert.match(zh, /workbenchTab: '设置'/);
  assert.match(zh, /settings: '通用'/);
});
