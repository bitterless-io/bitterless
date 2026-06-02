import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { AuthInvalidationPayload } from '@shared/auth/auth.type';

interface AuthHandlerEmitter {
  activateSession(): Promise<void>;
  invalidateSession(params?: AuthInvalidationPayload): Promise<void>;
}

export const authEmitter = createXpcRendererEmitter<AuthHandlerEmitter>('AuthHandler');
