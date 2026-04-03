import { contextBridge } from 'electron';
import 'electron-xpc/preload';
import '../../shared/pathHelper/preload/pathPreload.helper';

export interface OmniCellEnvApi {
  cellId: string | null;
  initialUrl: string | null;
}

const cellIdArg = process.argv.find((a) => a.startsWith('--cellId='));
const cellId = cellIdArg ? cellIdArg.split('=')[1] : null;

const initialUrlArg = process.argv.find((a) => a.startsWith('--initialUrl='));
const initialUrl = initialUrlArg ? initialUrlArg.slice('--initialUrl='.length) : null;

const omniCellEnvApi: OmniCellEnvApi = {
  cellId,
  initialUrl,
};

contextBridge.exposeInMainWorld('omniCellEnv', omniCellEnvApi);
