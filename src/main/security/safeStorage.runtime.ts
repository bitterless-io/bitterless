import { app, safeStorage } from 'electron';
import {
  assertSafeStorageOperationAllowed,
  resolveSafeStorageIsolationMode,
  type SafeStorageCaller,
} from './safeStoragePolicy.service';

const assertOperationAllowed = (
  operation: 'availability' | 'encrypt' | 'decrypt',
  caller: SafeStorageCaller,
): void => {
  try {
    assertSafeStorageOperationAllowed({
      mode: resolveSafeStorageIsolationMode({
        e2e: process.env.BITTERLESS_E2E === '1',
        viteMode: import.meta.env.VITE_MODE,
      }),
      operation,
      caller,
      packaged: app.isPackaged,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : '[safeStorage] tripwire blocked an operation');
    throw error;
  }
};

export const mainSafeStorage = {
  isEncryptionAvailable(caller: SafeStorageCaller): boolean {
    assertOperationAllowed('availability', caller);
    return safeStorage.isEncryptionAvailable();
  },
  encryptString(value: string, caller: SafeStorageCaller): Buffer {
    assertOperationAllowed('encrypt', caller);
    return safeStorage.encryptString(value);
  },
  decryptString(value: Buffer, caller: SafeStorageCaller): string {
    assertOperationAllowed('decrypt', caller);
    return safeStorage.decryptString(value);
  },
};
