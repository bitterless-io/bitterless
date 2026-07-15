import { createXpcRendererEmitter } from 'electron-xpc/renderer';

interface MaestroWindowApi {
  openMaestroWindow(): Promise<void>;
}

export const maestroWindowEmitter = createXpcRendererEmitter<MaestroWindowApi>('MaestroWindowHandler');
