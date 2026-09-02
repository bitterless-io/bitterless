import { contextBridge } from 'electron';
import 'electron-xpc/preload';
import '../../shared/pathHelper/preload/pathPreload.helper';
import './omniCellActiveFrame.sdk';
import type { OmniContentMode } from '@shared/omni/omni.types';

export interface OmniCellEnvApi {
  cellId: string | null;
  initialUrl: string | null;
  contentMode: OmniContentMode;
  readyToken: string | null;
  readyGeneration: number | null;
  readyRole: 'window' | 'browser-cell' | null;
}

const readArgument = (name: string): string | null => {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  if (!argument) return null;
  try {
    return decodeURIComponent(argument.slice(prefix.length));
  } catch {
    return null;
  }
};

const cellIdArg = process.argv.find((a) => a.startsWith('--cellId='));
const cellId = cellIdArg ? cellIdArg.split('=')[1] : null;

const initialUrlArg = process.argv.find((a) => a.startsWith('--initialUrl='));
const initialUrl = initialUrlArg ? initialUrlArg.slice('--initialUrl='.length) : null;

const contentModeArg = process.argv.find((a) => a.startsWith('--contentMode='));
const contentModeValue = contentModeArg?.slice('--contentMode='.length);
const contentMode: OmniContentMode = contentModeValue === 'miniapp' ? 'miniapp' : 'browser';

const readyToken = readArgument('omni-ready-token');
const readyGenerationValue = Number(readArgument('omni-ready-generation'));
const readyGeneration = Number.isSafeInteger(readyGenerationValue) && readyGenerationValue > 0
  ? readyGenerationValue
  : null;
const readyRoleValue = readArgument('omni-ready-role');
const readyRole = readyRoleValue === 'window' || readyRoleValue === 'browser-cell'
  ? readyRoleValue
  : null;

const omniCellEnvApi: OmniCellEnvApi = {
  cellId,
  initialUrl,
  contentMode,
  readyToken,
  readyGeneration,
  readyRole,
};

contextBridge.exposeInMainWorld('omniCellEnv', omniCellEnvApi);
