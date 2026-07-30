import { xpcCenter } from 'electron-xpc/main';
import { initTestHandler } from './test.handler';
import { initTestSubscriber } from './test.subscriber';
import { initUpdateHandler } from './update.handler';
import './pluginTest.handler';
import './todoWindow.handler';
import './eyesOnAgentsWindow.handler';
import './eyesOnAgents.handler';
import './omniWindow.handler';
import './shell.handler';
import './sqlitePassword.handler';
import './mainWindow.handler';
import './auth.handler';
import './mcp.handler';
import './coinWindow.handler';
import './maestroWindow.handler';
import './applicationLanguage.handler';
import './todoSystem.handler';
import './modelProvider.handler';
import './translator.handler';
import './diagnostics.handler';
import { initMaestroXpc } from '@maestro-main/xpc/xpc.helper';
// import { ptyManager } from '../ptyHelper/ptyManager';
// import { PtyService } from '../ptyHelper/ptyXpc';

export const initXpc = (): void => {
  xpcCenter.init();
  initMaestroXpc();
  initTestHandler();
  initTestSubscriber();
  initUpdateHandler();

  // ptyManager.init().catch((err) => {
  //   console.error('[xpc] ptyManager init failed:', err);
  // });
  //
  // new PtyService();
};
