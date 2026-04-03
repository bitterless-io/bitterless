import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { WindowControlHandler } from '@main/xpc/windowControl.handler';

export const windowControlEmitter = createXpcRendererEmitter<WindowControlHandler>('WindowControlHandler');
