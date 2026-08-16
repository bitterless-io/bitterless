import { app } from 'electron';
import { XpcMainHandler } from 'electron-xpc/main';
import { mainSafeStorage } from '@main/security/safeStorage.runtime';
import { trenchIoCapabilityRegistry } from '@main/trench/trenchIoCapability.registry';
import type {
  TrenchIoSystemApi,
  TrenchIoSystemRequest,
} from '@shared/trench/trenchIndex.type';

export class TrenchIoSystemHandler extends XpcMainHandler implements TrenchIoSystemApi {
  async getUserDataPath(input: TrenchIoSystemRequest): Promise<string> {
    trenchIoCapabilityRegistry.assert(input);
    return app.getPath('userData');
  }

  async encryptKey(input: TrenchIoSystemRequest & { plaintext: string }): Promise<string> {
    trenchIoCapabilityRegistry.assert(input);
    if (typeof input.plaintext !== 'string' || !/^[0-9a-f]{64}$/.test(input.plaintext)) {
      throw new TypeError('[trench-io] plaintext key is invalid.');
    }
    if (!mainSafeStorage.isEncryptionAvailable('trench-io')) {
      throw new Error('[trench-io] key protection is unavailable.');
    }
    return mainSafeStorage.encryptString(input.plaintext, 'trench-io').toString('base64');
  }

  async decryptKey(input: TrenchIoSystemRequest & { ciphertext: string }): Promise<string> {
    trenchIoCapabilityRegistry.assert(input);
    if (typeof input.ciphertext !== 'string' || input.ciphertext.length > 16 * 1024) {
      throw new TypeError('[trench-io] protected key is invalid.');
    }
    if (!mainSafeStorage.isEncryptionAvailable('trench-io')) {
      throw new Error('[trench-io] key protection is unavailable.');
    }
    return mainSafeStorage.decryptString(Buffer.from(input.ciphertext, 'base64'), 'trench-io');
  }
}

export const trenchIoSystemHandler = new TrenchIoSystemHandler();
