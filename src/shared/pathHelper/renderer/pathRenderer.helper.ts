import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { PathMainHelperContract } from '../shared/pathHelper.type';

// 名字字符串仍是 `'PathMainHelper'`(electron-xpc 按**类名**注册频道),只有类型改从 shared 取。
export const pathHelper = createXpcRendererEmitter<PathMainHelperContract>('PathMainHelper');
export type { PathName, PathHelperApi } from '../shared/pathHelper.type';
