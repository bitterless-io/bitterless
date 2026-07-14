import { createXpcRendererEmitter } from 'electron-xpc/renderer';

interface CoworkWindowApi {
  openCoworkWindow(): Promise<void>;
}

export const coworkWindowEmitter = createXpcRendererEmitter<CoworkWindowApi>('CoworkWindowHandler');
