import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { PathMainHelper } from '../main/pathMain.helper';

export const pathHelper = createXpcRendererEmitter<PathMainHelper>('PathMainHelper');
export type { PathName, PathHelperApi } from '../shared/pathHelper.type';
