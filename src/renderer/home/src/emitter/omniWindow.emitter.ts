import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { OmniWindowHandler } from '@main/xpc/omniWindow.handler';

export const omniWindowEmitter = createXpcRendererEmitter<OmniWindowHandler>('OmniWindowHandler');
