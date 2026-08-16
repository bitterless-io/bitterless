import { xpcMain } from 'electron-xpc/main';
import { trenchIoClientService } from '@main/trench/trenchIoClient.service';
import type {
  TrenchIndexResult,
} from '@shared/trench/trenchIndex.type';
import {
  TRENCH_PERSON_CHANGED_EVENT,
  type TrenchPersonImportInput,
  type TrenchPersonImportReceipt,
} from '@shared/trench/trenchPerson.type';
import {
  parseTrenchPersonImportInput,
  TrenchPersonValidationError,
} from '@shared/trench/trenchPerson.validation';

export const importTrenchPersonWallets = async (
  params: unknown,
): Promise<TrenchIndexResult<TrenchPersonImportReceipt>> => {
  try {
    const result = await trenchIoClientService.importPersonWallets(
      parseTrenchPersonImportInput(params),
    );
    if (result.ok && result.value.completed && !result.value.replayed) {
      xpcMain.broadcast(TRENCH_PERSON_CHANGED_EVENT, {
        schema: 'bl-trench-person-changed-v1',
        revision: result.value.revision,
      });
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof TrenchPersonValidationError
        ? { code: 'INVALID_INPUT', message: error.message }
        : { code: 'STORAGE_UNAVAILABLE', message: 'Trench person storage is unavailable.' },
    };
  }
};
