import { contextBridge } from 'electron';
import 'electron-xpc/preload';
import '../../shared/pathHelper/preload/pathPreload.helper';
import './omniCellActiveFrame.sdk';
import type { OmniContentMode } from '@shared/omni/omni.types';

export interface OmniCellEnvApi {
  cellId: string | null;
  initialUrl: string | null;
  contentMode: OmniContentMode;
}

const cellIdArg = process.argv.find((a) => a.startsWith('--cellId='));
const cellId = cellIdArg ? cellIdArg.split('=')[1] : null;

const initialUrlArg = process.argv.find((a) => a.startsWith('--initialUrl='));
const initialUrl = initialUrlArg ? initialUrlArg.slice('--initialUrl='.length) : null;

const contentModeArg = process.argv.find((a) => a.startsWith('--contentMode='));
const contentModeValue = contentModeArg?.slice('--contentMode='.length);
const contentMode: OmniContentMode = contentModeValue === 'miniapp' ? 'miniapp' : 'browser';

const omniCellEnvApi: OmniCellEnvApi = {
  cellId,
  initialUrl,
  contentMode,
};

contextBridge.exposeInMainWorld('omniCellEnv', omniCellEnvApi);
