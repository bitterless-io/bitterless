import { xpcCenter } from 'electron-xpc/main';
import { initTestHandler } from './test.handler';
import { initTestSubscriber } from './test.subscriber';
import { initLanguageSubscriber } from './language.subscriber';
import { initUpdateHandler } from './update.handler';
import './pluginTest.handler';
import './todoWindow.handler';
import './omniWindow.handler';
import './shell.handler';
import './sqlitePassword.handler';
import './mainWindow.handler';
import './auth.handler';
import './mcp.handler';
// import { ptyManager } from '../ptyHelper/ptyManager';
// import { PtyService } from '../ptyHelper/ptyXpc';

export const initXpc = (): void => {
  xpcCenter.init();
  initTestHandler();
  initTestSubscriber();
  initLanguageSubscriber();
  initUpdateHandler();

  // ptyManager.init().catch((err) => {
  //   console.error('[xpc] ptyManager init failed:', err);
  // });
  //
  // new PtyService();
};
