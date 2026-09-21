import { createXpcPreloadEmitter } from 'electron-xpc/preload';
import type { PathMainHelperContract } from '../shared/pathHelper.type';

// 同 renderer 侧:频道名仍按类名,类型改从 shared 取,preload 于是不再拖进主进程模块。
export const pathHelper = createXpcPreloadEmitter<PathMainHelperContract>('PathMainHelper');
