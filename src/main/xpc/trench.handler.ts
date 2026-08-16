import { XpcMainHandler, xpcMain } from 'electron-xpc/main';
import { TrenchRepositoryError } from '@main/trench/trenchRepository.service';
import { trenchRepository } from '@main/trench/trench.runtime';
import { trenchIndexOrchestrator } from '@main/coin/index/trenchIndex.runtime';
import {
  parseTrenchAnalysisGetParams,
  parseTrenchIndexWalletGetParams,
  parseTrenchListParams,
  parseTrenchNegativeWalletGetParams,
  TrenchXpcValidationError,
} from '@shared/trench/trenchXpc.validation';
import type {
  TrenchAnalysisDetail,
  TrenchAnalysisGetParams,
  TrenchIndexWalletGetParams,
  TrenchListParams,
  TrenchNegativeWalletGetParams,
  TrenchNegativeWalletReadDetail,
  TrenchReadApi,
  TrenchReadError,
  TrenchReadResult,
} from '@shared/trench/trenchXpc.type';
import type {
  TrenchAnalysisListResult,
  TrenchIndexWalletDetail,
  TrenchIndexWalletListResult,
  TrenchNegativeWalletListResult,
} from '@shared/trench/trench.type';
import type {
  TrenchIndexAddTargetInput,
  TrenchIndexApi,
  TrenchIndexCommandReceipt,
  TrenchIndexReanalyzeInput,
  TrenchIndexResult,
  TrenchIndexWorkspaceSnapshot,
} from '@shared/trench/trenchIndex.type';
import {
  parseTrenchIndexAddTargetInput,
  parseTrenchIndexReanalyzeInput,
  TrenchIndexValidationError,
} from '@shared/trench/trenchIndex.validation';
import { trenchIoClientService } from '@main/trench/trenchIoClient.service';
import { importTrenchPersonWallets } from '@main/trench/trenchPersonImport.service';
import type {
  TrenchPersonApi,
  TrenchPersonAttachWalletInput,
  TrenchPersonDetail,
  TrenchPersonGetInput,
  TrenchPersonImportInput,
  TrenchPersonImportReceipt,
  TrenchPersonListInput,
  TrenchPersonListPage,
  TrenchPersonMutationReceipt,
  TrenchPersonUpdateProfileInput,
} from '@shared/trench/trenchPerson.type';
import { TRENCH_PERSON_CHANGED_EVENT } from '@shared/trench/trenchPerson.type';
import {
  parseTrenchPersonAttachWalletInput,
  parseTrenchPersonGetInput,
  parseTrenchPersonListInput,
  parseTrenchPersonUpdateProfileInput,
  TrenchPersonValidationError,
} from '@shared/trench/trenchPerson.validation';

const repositoryErrorMessages: Record<string, string> = {
  CURSOR_INVALID: 'This page cursor is invalid. Restart the current search.',
  CURSOR_STALE: 'Records changed while paging. Restart the current search.',
  INVALID_INPUT: 'The read request is invalid.',
  INVALID_STORED_RECORD: 'The selected stored record is invalid.',
  NOT_FOUND: 'The selected record no longer exists.',
};

const isRepositoryUnavailable = (error: unknown): boolean => {
  const code = error && typeof error === 'object' ? Reflect.get(error, 'code') : undefined;
  return typeof code === 'string' && [
    'EACCES',
    'EBUSY',
    'EIO',
    'EMFILE',
    'ENFILE',
    'ENOENT',
    'ENOSPC',
    'ENOTDIR',
    'EROFS',
  ].includes(code);
};

const toReadError = (error: unknown): TrenchReadError => {
  if (error instanceof TrenchXpcValidationError) {
    return { code: 'INVALID_INPUT', message: error.message };
  }
  if (error instanceof TrenchRepositoryError) {
    const code = error.code;
    if (code in repositoryErrorMessages) {
      return {
        code: code as TrenchReadError['code'],
        message: repositoryErrorMessages[code],
      };
    }
  }
  if (isRepositoryUnavailable(error)) {
    return {
      code: 'REPOSITORY_UNAVAILABLE',
      message: 'The local Trench repository is unavailable.',
    };
  }
  console.error('[TrenchHandler] Unexpected repository read failure:', error);
  return { code: 'INTERNAL', message: 'Trench could not complete this local read.' };
};

const read = async <T>(operation: () => T): Promise<TrenchReadResult<T>> => {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    return { ok: false, error: toReadError(error) };
  }
};

const personFailure = <T>(error: unknown): TrenchIndexResult<T> => ({
  ok: false,
  error: error instanceof TrenchPersonValidationError
    ? { code: 'INVALID_INPUT', message: error.message }
    : { code: 'STORAGE_UNAVAILABLE', message: 'Trench person storage is unavailable.' },
});

const broadcastPersonChanged = (revision: number): void => {
  xpcMain.broadcast(TRENCH_PERSON_CHANGED_EVENT, {
    schema: 'bl-trench-person-changed-v1',
    revision,
  });
};

export class TrenchHandler extends XpcMainHandler implements TrenchReadApi, TrenchIndexApi, TrenchPersonApi {
  async listAnalyses(
    params?: TrenchListParams,
  ): Promise<TrenchReadResult<TrenchAnalysisListResult>> {
    return await read(() => trenchRepository.listAnalyses(parseTrenchListParams(params)));
  }

  async getAnalysis(
    params: TrenchAnalysisGetParams,
  ): Promise<TrenchReadResult<TrenchAnalysisDetail>> {
    return await read(() => {
      const input = parseTrenchAnalysisGetParams(params);
      return trenchRepository.getAnalysis(input.contractAddress);
    });
  }

  async listIndexWallets(
    params?: TrenchListParams,
  ): Promise<TrenchReadResult<TrenchIndexWalletListResult>> {
    return await read(() => trenchRepository.listIndexWallets(parseTrenchListParams(params)));
  }

  async getIndexWallet(
    params: TrenchIndexWalletGetParams,
  ): Promise<TrenchReadResult<TrenchIndexWalletDetail>> {
    return await read(() => trenchRepository.getIndexWallet(parseTrenchIndexWalletGetParams(params)));
  }

  async listNegativeWallets(
    params?: TrenchListParams,
  ): Promise<TrenchReadResult<TrenchNegativeWalletListResult>> {
    return await read(() => trenchRepository.listNegativeWallets(parseTrenchListParams(params)));
  }

  async getNegativeWallet(
    params: TrenchNegativeWalletGetParams,
  ): Promise<TrenchReadResult<TrenchNegativeWalletReadDetail>> {
    return await read(() => {
      const input = parseTrenchNegativeWalletGetParams(params);
      return trenchRepository.getNegativeWalletForBrowser(input.chain, input.address);
    });
  }

  async getIndexWorkspace(): Promise<TrenchIndexResult<TrenchIndexWorkspaceSnapshot>> {
    return await trenchIndexOrchestrator.getWorkspace();
  }

  async addIndexTargets(
    params: TrenchIndexAddTargetInput,
  ): Promise<TrenchIndexResult<TrenchIndexCommandReceipt>> {
    try {
      return await trenchIndexOrchestrator.addTargets(parseTrenchIndexAddTargetInput(params));
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'INVALID_INPUT',
          message: error instanceof TrenchIndexValidationError
            ? error.message
            : 'The Add CA request is invalid.',
        },
      };
    }
  }

  async reanalyzeIndex(
    params: TrenchIndexReanalyzeInput,
  ): Promise<TrenchIndexResult<TrenchIndexCommandReceipt>> {
    try {
      return await trenchIndexOrchestrator.reanalyze(parseTrenchIndexReanalyzeInput(params));
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'INVALID_INPUT',
          message: error instanceof TrenchIndexValidationError
            ? error.message
            : 'The Reanalyze request is invalid.',
        },
      };
    }
  }

  async listPersons(
    params?: TrenchPersonListInput,
  ): Promise<TrenchIndexResult<TrenchPersonListPage>> {
    try {
      return await trenchIoClientService.listPersons(parseTrenchPersonListInput(params));
    } catch (error) {
      return personFailure(error);
    }
  }

  async getPerson(
    params: TrenchPersonGetInput,
  ): Promise<TrenchIndexResult<TrenchPersonDetail>> {
    try {
      return await trenchIoClientService.getPerson(parseTrenchPersonGetInput(params));
    } catch (error) {
      return personFailure(error);
    }
  }

  async updatePersonProfile(
    params: TrenchPersonUpdateProfileInput,
  ): Promise<TrenchIndexResult<TrenchPersonMutationReceipt>> {
    try {
      const result = await trenchIoClientService.updatePersonProfile(
        parseTrenchPersonUpdateProfileInput(params),
      );
      if (result.ok) broadcastPersonChanged(result.value.revision);
      return result;
    } catch (error) {
      return personFailure(error);
    }
  }

  async attachWalletToPerson(
    params: TrenchPersonAttachWalletInput,
  ): Promise<TrenchIndexResult<TrenchPersonMutationReceipt>> {
    try {
      const result = await trenchIoClientService.attachWalletToPerson(
        parseTrenchPersonAttachWalletInput(params),
      );
      if (result.ok) broadcastPersonChanged(result.value.revision);
      return result;
    } catch (error) {
      return personFailure(error);
    }
  }


  async importPersonWallets(
    params: TrenchPersonImportInput,
  ): Promise<TrenchIndexResult<TrenchPersonImportReceipt>> {
    return await importTrenchPersonWallets(params);
  }
}

export const trenchHandler = new TrenchHandler();
