import { createXpcPreloadEmitter, XpcPreloadHandler } from 'electron-xpc/preload';
import type {
  TrenchIndexCompletedBatch,
  TrenchIndexStorageAddTargetsAndBeginRunInput,
  TrenchIndexStorageBeginRunInput,
  TrenchIndexStorageFailRunInput,
  TrenchIndexResult,
  TrenchIoRuntimeApi,
  TrenchIoRuntimeReadyInput,
  TrenchIoRuntimeRequest,
  TrenchIoSystemApi,
} from '@shared/trench/trenchIndex.type';
import { trenchIoRuntimeHandlerName } from '@shared/trench/trenchIndex.type';
import {
  parseTrenchPersonAttachWalletInput,
  parseTrenchPersonGetInput,
  parseTrenchPersonImportInput,
  parseTrenchPersonListInput,
  parseTrenchPersonUpdateProfileInput,
} from '@shared/trench/trenchPerson.validation';
import { TrenchIoDatabase, resolveTrenchIoPaths } from './trenchIo.database';
import {
  getOrCreateTrenchIoPassword,
  TRENCH_IO_TEST_PASSWORD,
} from './trenchIoPassword.service';
import {
  asTrenchIndexError,
  TrenchIoRepository,
} from './trenchIo.repository';

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INSTANCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const argumentValue = (name: string): string => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? '';
};

const capability = argumentValue('trench-io-capability');
const instanceId = argumentValue('trench-io-instance');
const system = createXpcPreloadEmitter<TrenchIoSystemApi>('TrenchIoSystemHandler');
let database: TrenchIoDatabase | null = null;
let repository: TrenchIoRepository | null = null;
let boot: Promise<TrenchIoRepository> | null = null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length &&
    keys.every((key) => typeof key === 'string' && expected.includes(key));
};

const requireCapability = (input: unknown): void => {
  if (!isRecord(input) || !exactKeys(input, ['capability', 'instanceId']) ||
    input.capability !== capability || input.instanceId !== instanceId ||
    !CAPABILITY_PATTERN.test(capability) || !INSTANCE_PATTERN.test(instanceId)) {
    throw new TypeError('[trench-io] runtime capability is invalid.');
  }
};

const requireRequest = <T>(input: unknown): T => {
  if (!isRecord(input) || !exactKeys(input, ['capability', 'instanceId', 'request'])) {
    throw new TypeError('[trench-io] runtime request is invalid.');
  }
  requireCapability({ capability: input.capability, instanceId: input.instanceId });
  return input.request as T;
};

const readyRepository = async (): Promise<TrenchIoRepository> => {
  if (repository) return repository;
  if (!boot) {
    boot = (async () => {
      const userDataPath = await system.getUserDataPath({ capability, instanceId });
      const paths = resolveTrenchIoPaths(userDataPath);
      const isolated = import.meta.env.VITE_MODE === 'debug' || process.env.BITTERLESS_E2E === '1';
      const password = isolated
        ? TRENCH_IO_TEST_PASSWORD
        : await getOrCreateTrenchIoPassword(paths, {
            encryptString: async (value) => Buffer.from(await system.encryptKey({
              capability,
              instanceId,
              plaintext: value,
            }), 'base64'),
            decryptString: async (value) => await system.decryptKey({
              capability,
              instanceId,
              ciphertext: value.toString('base64'),
            }),
          });
      const opened = new TrenchIoDatabase(
        paths.databasePath,
        password,
        __BITTERLESS_VERSION_CODE__,
      );
      try {
        const created = new TrenchIoRepository(opened);
        created.initialize();
        database = opened;
        repository = created;
        return created;
      } catch (error) {
        opened.close();
        throw error;
      }
    })();
  }
  return await boot;
};

const result = async <T>(operation: (repo: TrenchIoRepository) => T): Promise<TrenchIndexResult<T>> => {
  try {
    return { ok: true, value: operation(await readyRepository()) };
  } catch (error) {
    return { ok: false, error: asTrenchIndexError(error) };
  }
};

export class TrenchIoRuntime extends XpcPreloadHandler implements TrenchIoRuntimeApi {
  async ready(input: TrenchIoRuntimeReadyInput) {
    try {
      requireCapability(input);
      const repo = await readyRepository();
      return { ok: true as const, value: { revision: repo.getWorkspace().revision } };
    } catch (error) {
      return { ok: false as const, error: asTrenchIndexError(error) };
    }
  }

  async getWorkspace(input: TrenchIoRuntimeRequest<Record<string, never>>) {
    requireRequest<Record<string, never>>(input);
    return await result((repo) => repo.getWorkspace());
  }

  async addTargetsAndBeginRun(
    input: TrenchIoRuntimeRequest<TrenchIndexStorageAddTargetsAndBeginRunInput>,
  ) {
    const request = requireRequest<TrenchIndexStorageAddTargetsAndBeginRunInput>(input);
    return await result((repo) => repo.addTargetsAndBeginRun(request));
  }

  async beginRun(input: TrenchIoRuntimeRequest<TrenchIndexStorageBeginRunInput>) {
    const request = requireRequest<TrenchIndexStorageBeginRunInput>(input);
    return await result((repo) => repo.beginRun(request));
  }

  async completeRun(input: TrenchIoRuntimeRequest<TrenchIndexCompletedBatch>) {
    const request = requireRequest<TrenchIndexCompletedBatch>(input);
    return await result((repo) => repo.completeRun(request));
  }

  async failRun(input: TrenchIoRuntimeRequest<TrenchIndexStorageFailRunInput>) {
    const request = requireRequest<TrenchIndexStorageFailRunInput>(input);
    return await result((repo) => repo.failRun(request));
  }

  async listPersons(input: Parameters<TrenchIoRuntimeApi['listPersons']>[0]) {
    return await result((repo) => repo.listPersons(
      parseTrenchPersonListInput(requireRequest(input)),
    ));
  }

  async getPerson(input: Parameters<TrenchIoRuntimeApi['getPerson']>[0]) {
    return await result((repo) => repo.getPerson(
      parseTrenchPersonGetInput(requireRequest(input)).personId,
    ));
  }

  async updatePersonProfile(input: Parameters<TrenchIoRuntimeApi['updatePersonProfile']>[0]) {
    return await result((repo) => repo.updatePersonProfile(
      parseTrenchPersonUpdateProfileInput(requireRequest(input)),
    ));
  }

  async attachWalletToPerson(input: Parameters<TrenchIoRuntimeApi['attachWalletToPerson']>[0]) {
    return await result((repo) => repo.attachWalletToPerson(
      parseTrenchPersonAttachWalletInput(requireRequest(input)),
    ));
  }

  async importPersonWallets(input: Parameters<TrenchIoRuntimeApi['importPersonWallets']>[0]) {
    return await result((repo) => repo.importPersonWallets(
      parseTrenchPersonImportInput(requireRequest(input)),
    ));
  }
}

if (!CAPABILITY_PATTERN.test(capability) || !INSTANCE_PATTERN.test(instanceId)) {
  throw new Error('[trench-io] runtime arguments are invalid.');
}
Object.defineProperty(TrenchIoRuntime, 'name', {
  value: trenchIoRuntimeHandlerName(capability),
});
export const trenchIoRuntime = new TrenchIoRuntime();

globalThis.addEventListener?.('unload', () => {
  repository = null;
  boot = null;
  database?.close();
  database = null;
});
