import { app } from 'electron';
import { xpcMain } from 'electron-xpc/main';
import { TRENCH_DATA_CHANGED_EVENT } from '@shared/trench/trench.type';
import { TrenchRepository } from '@main/trench/trenchRepository.service';

export const trenchRepository = new TrenchRepository({
  userDataRoot: () => app.getPath('userData'),
  onChanged: (event) => xpcMain.broadcast(TRENCH_DATA_CHANGED_EVENT, event)
});
