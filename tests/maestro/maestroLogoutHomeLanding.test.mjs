/* eslint-disable @typescript-eslint/explicit-function-return-type, no-regex-spaces */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  MAESTRO_FORCE_PINNED_HOME_QUERY,
  MAESTRO_FORCE_PINNED_HOME_QUERY_VALUE
} from '../../src/shared/maestro/coach.api.ts';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

test('auth teardown requests a pinned-Home boot and removes the Workbench overlay', () => {
  const handler = source('src/main/xpc/maestroWindow.handler.ts');
  const controller = source('src/main/maestro/windows/main/maestroWindow.controller.ts');
  const destroyForAuth = handler.match(
    /async _destroyForAuth\(\): Promise<void> \{[\s\S]*?\n  \}/
  )?.[0];
  const prepareForAuthShutdown = controller.match(
    /async prepareForAuthShutdown\(\): Promise<void> \{[\s\S]*?\n  \}/
  )?.[0];

  assert.ok(destroyForAuth);
  assert.ok(prepareForAuthShutdown);
  assert.ok(
    destroyForAuth.indexOf('this.authInvalidated = true') <
      destroyForAuth.indexOf('await maestroWindowHelper.prepareForAuthShutdown()')
  );
  assert.ok(
    destroyForAuth.indexOf('persistAuthInvalidation()') <
      destroyForAuth.indexOf('await maestroWindowHelper.prepareForAuthShutdown()')
  );
  assert.match(prepareForAuthShutdown, /this\.forcePinnedHomeIntentVersion \+= 1/);
  assert.match(prepareForAuthShutdown, /tab\.kind === 'home' && tab\.pinned/);
  assert.ok(
    prepareForAuthShutdown.indexOf('await this.browserView.activateTab') <
      prepareForAuthShutdown.indexOf('this.workbenchView.setVisible({ visible: false })')
  );
});

test('forced replacement boot skips a custom startup URL without weakening normal startup', () => {
  const controller = source('src/main/maestro/windows/main/maestroWindow.controller.ts');
  const browserView = source('src/main/maestro/windows/main/maestroBrowserView.service.ts');

  assert.equal(MAESTRO_FORCE_PINNED_HOME_QUERY, 'maestroForcePinnedHome');
  assert.equal(MAESTRO_FORCE_PINNED_HOME_QUERY_VALUE, '1');
  assert.match(controller, /const forcePinnedHome = forcePinnedHomeIntentVersion > 0/);
  assert.match(
    controller,
    /\[MAESTRO_FORCE_PINNED_HOME_QUERY\]: MAESTRO_FORCE_PINNED_HOME_QUERY_VALUE/
  );
  assert.match(controller, /openStartupTabIfNeeded\(\{ skipForThisBoot: forcePinnedHome \}\)/);
  const startup = browserView.match(/async openStartupTabIfNeeded\([\s\S]*?\n  \}/)?.[0];
  assert.ok(startup);
  assert.ok(
    startup.indexOf('if (params?.skipForThisBoot) return') <
      startup.indexOf('const settings = this._state.readMaestroSettings()')
  );
  assert.match(startup, /if \(!this\._state\.hasCustomStartUrl\(\)\) return/);
  assert.match(startup, /await this\.openTab\(\{ url \}\)/);
});

test('forced boot restores tab entries but cannot reactivate the previous web tab', () => {
  const tabStore = source('src/renderer/maestro/home/src/components/MenuBar/tab.store.ts');
  const init = tabStore.match(/async init\(\): Promise<void> \{[\s\S]*?\n  \}/)?.[0];

  assert.ok(init);
  assert.match(
    tabStore,
    /searchParams\.get\(MAESTRO_FORCE_PINNED_HOME_QUERY\)[\s\S]*MAESTRO_FORCE_PINNED_HOME_QUERY_VALUE/
  );
  assert.match(tabStore, /url\.searchParams\.delete\(MAESTRO_FORCE_PINNED_HOME_QUERY\)/);
  assert.match(
    tabStore,
    /window\.history\.replaceState\(window\.history\.state, '', url\.toString\(\)\)/
  );
  assert.match(
    tabStore,
    /try \{[\s\S]*window\.history\.replaceState[\s\S]*\} catch \{[\s\S]*console\.warn\('[^']+'\)[\s\S]*\}[\s\S]*return true/
  );
  assert.doesNotMatch(tabStore, /searchParams\.delete\(MAESTRO_HOME_READY_TOKEN_QUERY\)/);
  assert.ok(
    init.indexOf("localStorage.setItem(LAST_ACTIVE_KEY, 'home')") <
      init.indexOf('await tabsDao.listAll()')
  );
  assert.ok(init.indexOf('await coach.restoreTabs({ tabs: saved })') >= 0);
  assert.match(init, /tab\.kind === 'home' && tab\.pinned/);
  assert.match(init, /await coach\.activateTab\(\{ id: pinnedHome\.id \}\)/);
  assert.ok(
    init.lastIndexOf("localStorage.setItem(LAST_ACTIVE_KEY, 'home')") <
      init.indexOf('return\n    }')
  );
  assert.ok(init.indexOf('return\n    }') < init.indexOf('await this.restoreLastActive()'));
  assert.match(tabStore, /const target = this\.tabs\.find\(\(t\) => t\.kind === 'browser'/);
});

test('force-Home intent survives shutdown and is consumed only after a successful target boot', () => {
  const controller = source('src/main/maestro/windows/main/maestroWindow.controller.ts');
  const handler = source('src/main/xpc/maestroWindow.handler.ts');
  const shutdown = controller.match(/async shutdown\(\): Promise<void> \{[\s\S]*?\n  \}/)?.[0];
  const markBootSuccessful = controller.match(/markBootSuccessful\(\): void \{[\s\S]*?\n  \}/)?.[0];

  assert.ok(shutdown);
  assert.ok(markBootSuccessful);
  assert.doesNotMatch(shutdown, /this\.forcePinnedHomeIntentVersion = 0/);
  assert.match(shutdown, /this\.activeBootForcePinnedHomeIntentVersion = 0/);
  assert.match(
    markBootSuccessful,
    /this\.forcePinnedHomeIntentVersion === intentVersion[\s\S]*this\.forcePinnedHomeIntentVersion = 0/
  );
  assert.ok(
    handler.indexOf('this.assertAuthReady()\n      maestroWindowHelper.markBootSuccessful()') >= 0
  );
});
