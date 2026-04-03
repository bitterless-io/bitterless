import { createXpcPreloadEmitter } from 'electron-xpc/preload';
import type { PathMainHelper } from '../main/pathMain.helper';

export const pathHelper = createXpcPreloadEmitter<PathMainHelper>('PathMainHelper');
