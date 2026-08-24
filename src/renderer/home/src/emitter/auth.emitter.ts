import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { AuthSessionApi } from '@shared/auth/auth.type';

export const authEmitter = createXpcRendererEmitter<AuthSessionApi>('AuthHandler');
