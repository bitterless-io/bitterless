import { xpcMain } from 'electron-xpc/main';
import { coinGmgnCliService } from '../resources/coinResource.runtime';
import { trenchIoClientService } from '@main/trench/trenchIoClient.service';
import { TrenchIndexOrchestrator } from './trenchIndex.orchestrator';

export const trenchIndexOrchestrator = new TrenchIndexOrchestrator({
  storage: trenchIoClientService,
  gmgn: coinGmgnCliService,
  broadcast: (eventName, value) => xpcMain.broadcast(eventName, value),
});
