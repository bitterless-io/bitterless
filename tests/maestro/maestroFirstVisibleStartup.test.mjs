import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Maestro first-visible waits only for the primary Shell and Home host mount', () => {
  const controller = read('src/main/maestro/windows/main/maestroWindow.controller.ts');
  const handler = read('src/main/xpc/maestroWindow.handler.ts');
  const workbench = read('src/main/maestro/windows/main/maestroWorkbenchView.service.ts');
  const create = controller.slice(
    controller.indexOf('create(): BrowserWindow {'),
    controller.indexOf('async getSettings()')
  );
  const boot = handler.slice(
    handler.indexOf('private async boot()'),
    handler.indexOf('private observeBackgroundBoot(')
  );
  const observer = handler.slice(
    handler.indexOf('private observeBackgroundBoot('),
    handler.indexOf('private ensureMaestroSqliteReady(')
  );

  const primaryReady = create.indexOf('this.initialReady = homeReady');
  const backgroundReady = create.indexOf('this.backgroundReady = this.traceOpenStage');
  assert.ok(primaryReady >= 0 && primaryReady < backgroundReady);
  assert.match(create, /Promise\.allSettled\(\[controlReady, workbenchReady, operationReady, spareReady\]\)/);
  assert.match(
    create,
    /results\.some\(\(result\) => result\.status === 'rejected'\)[\s\S]*throw new Error\('\[maestro\] background window startup failed'\)/
  );
  assert.match(create, /void this\.backgroundReady\.catch\(\(\) => undefined\)/);
  assert.match(create, /async whenReady\(\): Promise<void> \{[\s\S]*await this\.initialReady/);
  assert.match(create, /async whenBackgroundReady\(\): Promise<void> \{[\s\S]*await this\.backgroundReady/);

  assert.match(boot, /await withTimeout\([\s\S]*maestroWindowHelper\.whenReady\(\)/);
  assert.doesNotMatch(boot, /whenBackgroundReady/);
  assert.match(handler, /maestroWindowHelper\.show\(\)[\s\S]*observeBackgroundBoot\(requestBootDiagnostics\)/);
  assert.match(observer, /maestroWindowHelper\.whenBackgroundReady\(\)/);
  assert.match(observer, /\.then\(\(\) => \{[\s\S]*diagnostics\.terminal\('success', 'ready'\)/);
  assert.match(observer, /\.catch\(\(error: unknown\) => \{[\s\S]*diagnostics\.terminal\('failure', classifyMaestroOpenFailure\(error\)\)/);
  assert.doesNotMatch(observer, /destroyMaestroRuntime|maestroWindowHelper\.destroy/);
  assert.match(workbench, /view\.setVisible\(this\.visible\)/);
  assert.ok(
    workbench.indexOf('win.contentView.addChildView(view)') <
      workbench.indexOf('this._state.layout()')
  );
});

test('Maestro Settings and Monaco stay out of fixed Home and Workbench startup chunks', () => {
  const localHomeRouter = read('src/renderer/maestro/localHome/src/localHome.router.ts');
  const workbenchRouter = read('src/renderer/maestro/workbench/src/workbench.router.ts');
  const setting = read('src/renderer/home/src/views/setting/Setting.vue');
  const systemPrompt = read(
    'src/renderer/home/src/views/setting/components/SystemPromptSetting/SystemPromptSetting.vue'
  );

  assert.doesNotMatch(localHomeRouter, /import Setting from/);
  assert.match(
    localHomeRouter,
    /component: \(\) => import\('@\/views\/setting\/Setting\.vue'\)/
  );
  assert.doesNotMatch(workbenchRouter, /import WorkbenchSettingsView from/);
  assert.match(
    workbenchRouter,
    /component: \(\) => import\('\.\/views\/WorkbenchSettingsView\.vue'\)/
  );
  assert.match(setting, /defineAsyncComponent/);
  assert.match(
    setting,
    /defineAsyncComponent\([\s\S]*import\('\.\/components\/SystemPromptSetting\/SystemPromptSetting\.vue'\)/
  );
  assert.doesNotMatch(setting, /import \* as monaco|from 'monaco-editor'/);
  assert.match(systemPrompt, /import \* as monaco from 'monaco-editor'/);
});
