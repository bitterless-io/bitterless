import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { AuthHandler } from '@main/xpc/auth.handler';

export const authEmitter = createXpcRendererEmitter<AuthHandler>('AuthHandler');
