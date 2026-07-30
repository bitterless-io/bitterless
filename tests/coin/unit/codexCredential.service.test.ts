import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { join } from 'node:path';
import {
  CodexCredentialError,
  CodexCredentialService,
  type PiAuthModule,
  type PiAuthStorage,
} from '../../../src/main/codex/codexCredential.service';
import {
  CodexFileCredentialStore,
  CodexMemoryCredentialStore,
  type CodexCredentialStore,
} from '../../../src/main/codex/codexCredential.store';
import type { CodexBrowserCallbackCapture } from '../../../src/main/codex/codexCallbackCapture';
import { codexAuthPath, codexModelsPath } from '../../../src/main/codex/codexPaths';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

interface FakePiOptions {
  connected?: boolean;
  login?: (
    callbacks: Parameters<NonNullable<PiAuthStorage['login']>>[1],
    loginIndex: number,
  ) => Promise<void>;
}

const createFakePi = (options: FakePiOptions = {}) => {
  let connected = options.connected ?? false;
  let persistedCredential: unknown | undefined = connected
    ? { type: 'oauth', refresh: 'persisted', access: 'persisted', expires: 1 }
    : undefined;
  let loginCount = 0;
  let logoutCount = 0;
  const authPaths: string[] = [];
  const modelPaths: string[] = [];
  const createAuthStorage = (persistent: boolean) => {
    let credential = persistent ? persistedCredential : undefined;
    return {
      login: async (
        _provider: string,
        callbacks: Parameters<NonNullable<PiAuthStorage['login']>>[1],
      ) => {
        loginCount += 1;
        if (options.login) await options.login(callbacks, loginCount);
        credential = {
          type: 'oauth',
          refresh: `refresh-${loginCount}`,
          access: `access-${loginCount}`,
          expires: loginCount,
        };
        if (persistent) {
          persistedCredential = credential;
          connected = true;
        }
      },
      logout: () => {
        logoutCount += 1;
        credential = undefined;
        if (persistent) {
          persistedCredential = undefined;
          connected = false;
        }
      },
      read: async () => credential,
      modify: async (
        _provider: string,
        update: (current: unknown | undefined) => Promise<unknown | undefined>,
      ) => {
        const next = await update(credential);
        if (next !== undefined) credential = next;
        if (persistent) {
          persistedCredential = credential;
          connected = credential !== undefined;
        }
        return credential;
      },
      delete: async () => {
        credential = undefined;
        if (persistent) {
          persistedCredential = undefined;
          connected = false;
        }
      },
      list: async () =>
        credential
          ? [{ providerId: 'openai-codex', type: 'oauth' }]
          : [],
    };
  };
  const module = {
    ModelRegistry: {
      create: (_auth: unknown, modelsPath: string) => {
        modelPaths.push(modelsPath);
        return {
          find: (provider: string, model: string) =>
            provider === 'openai-codex' && model === 'gpt-5.5' ? {} : undefined,
          hasConfiguredAuth: () => connected,
        };
      },
    },
  } as unknown as PiAuthModule;
  return {
    module,
    createPersistentCredentialStore: (path: string) => {
      authPaths.push(path);
      return createAuthStorage(true);
    },
    createAttemptCredentialStore: () => createAuthStorage(false),
    authPaths,
    modelPaths,
    get loginCount() {
      return loginCount;
    },
    get logoutCount() {
      return logoutCount;
    },
    get credentialAccess() {
      return (persistedCredential as { access?: string } | undefined)?.access;
    },
  };
};

const createCapture = (): CodexBrowserCallbackCapture => {
  const redirect = deferred<string>();
  redirect.promise.catch(() => undefined);
  return {
    waitForRedirect: async () => await redirect.promise,
    cancel: (error) => redirect.reject(error),
    close: async () => undefined,
  };
};

const createService = (
  pi: ReturnType<typeof createFakePi>,
  overrides: Partial<ConstructorParameters<typeof CodexCredentialService>[0]> = {},
) =>
  new CodexCredentialService({
    authPath: () => '/profile/cowork/pi/auth.json',
    modelsPath: () => '/profile/cowork/pi/models.json',
    loadPiAuthModule: async () => pi.module,
    openExternal: async () => undefined,
    createBrowserCallbackCapture: async () => createCapture(),
    createPersistentCredentialStore: pi.createPersistentCredentialStore,
    createAttemptCredentialStore: pi.createAttemptCredentialStore,
    ensurePrivateDirectory: () => undefined,
    ...overrides,
  });

test('keeps the compatibility auth and model paths under userData/cowork/pi', async () => {
  assert.equal(codexAuthPath('/profile'), join('/profile', 'cowork', 'pi', 'auth.json'));
  assert.equal(codexModelsPath('/profile'), join('/profile', 'cowork', 'pi', 'models.json'));

  const pi = createFakePi({ connected: true });
  const status = await createService(pi).getStatus();
  assert.equal(status.connected, true);
  assert.equal(pi.authPaths[0], '/profile/cowork/pi/auth.json');
  assert.equal(pi.modelPaths[0], '/profile/cowork/pi/models.json');
});

test('app-owned credential stores preserve the Pi auth file contract', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-codex-credential-'));
  const authPath = join(root, 'cowork', 'pi', 'auth.json');
  const credential = {
    type: 'oauth',
    refresh: 'refresh',
    access: 'access',
    expires: 1,
  };
  try {
    const memory = new CodexMemoryCredentialStore();
    await memory.modify('openai-codex', async () => credential);
    assert.deepEqual(await memory.read('openai-codex'), credential);
    assert.deepEqual(await memory.list(), [
      { providerId: 'openai-codex', type: 'oauth' },
    ]);

    const file = new CodexFileCredentialStore(authPath);
    await file.modify('openai-codex', async () => await memory.read('openai-codex'));
    assert.deepEqual(JSON.parse(readFileSync(authPath, 'utf8')), {
      'openai-codex': credential,
    });
    if (process.platform !== 'win32') {
      assert.equal(statSync(authPath).mode & 0o777, 0o600);
    }
    await file.delete('openai-codex');
    assert.deepEqual(JSON.parse(readFileSync(authPath, 'utf8')), {});

    const promotionStarted = deferred<void>();
    const releasePromotion = deferred<void>();
    const promotion = file.modify('openai-codex', async () => {
      promotionStarted.resolve();
      await releasePromotion.promise;
      return credential;
    });
    await promotionStarted.promise;
    const cancellationCleanup = file.delete('openai-codex');
    releasePromotion.resolve();
    await Promise.all([promotion, cancellationCleanup]);
    assert.deepEqual(JSON.parse(readFileSync(authPath, 'utf8')), {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('shares one login mutex and notifies every concurrent device-code observer', async () => {
  const gate = deferred<void>();
  const pi = createFakePi({
    login: async (callbacks) => {
      assert.equal(await callbacks.onSelect(), 'device_code');
      callbacks.onDeviceCode({
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://auth.openai.com/codex/device',
        expiresInSeconds: 900,
      });
      await gate.promise;
    },
  });
  const notices: string[] = [];
  const opened: string[] = [];
  const service = createService(pi, {
    now: () => 1_000,
    openExternal: async (url) => {
      opened.push(url);
    },
  });

  const first = service.connect({
    method: 'device_code',
    onDeviceCode: (notice) => notices.push(`first:${notice.userCode}:${notice.verificationHost}`),
  });
  const second = service.connect({
    method: 'browser',
    onDeviceCode: (notice) => notices.push(`second:${notice.userCode}:${notice.verificationHost}`),
  });
  try {
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(pi.loginCount, 1);
    assert.deepEqual(notices.sort(), [
      'first:ABCD-EFGH:auth.openai.com',
      'second:ABCD-EFGH:auth.openai.com',
    ]);
    assert.deepEqual(opened, ['https://auth.openai.com/codex/device']);
  } finally {
    gate.resolve();
  }
  const [firstStatus, secondStatus] = await Promise.all([first, second]);
  assert.equal(firstStatus.connected, true);
  assert.equal(secondStatus.connected, true);
});

test('completes browser login through the companion callback and closes it', async () => {
  let closeCount = 0;
  const opened: string[] = [];
  const pi = createFakePi({
    login: async (callbacks) => {
      assert.equal(await callbacks.onSelect(), 'browser');
      callbacks.onAuth({
        url: 'https://auth.openai.com/oauth/authorize?client_id=fixture',
      });
      assert.equal(
        await callbacks.onManualCodeInput(),
        'http://localhost:1455/auth/callback?code=fixture&state=test',
      );
    },
  });
  const service = createService(pi, {
    openExternal: async (url) => {
      opened.push(url);
    },
    createBrowserCallbackCapture: async () => ({
      waitForRedirect: async () =>
        'http://localhost:1455/auth/callback?code=fixture&state=test',
      cancel: () => undefined,
      close: async () => {
        closeCount += 1;
      },
    }),
  });

  const status = await service.connect({ method: 'browser' });
  assert.equal(status.connected, true);
  assert.deepEqual(opened, [
    'https://auth.openai.com/oauth/authorize?client_id=fixture',
  ]);
  assert.equal(closeCount, 1);
});

test('modern browser login owns its callback and replaces the old credential without model network', async () => {
  type FakeAuthStorage = CodexCredentialStore;
  type FakeModelRuntime = Awaited<
    ReturnType<NonNullable<PiAuthModule['ModelRuntime']>['create']>
  >;
  type FakeModelRuntimeOptions = {
    authPath?: string;
    modelsPath?: string | null;
    credentials?: FakeAuthStorage;
    allowModelNetwork?: boolean;
  };

  let persistedCredential: unknown | undefined = {
    type: 'oauth',
    refresh: 'old-refresh',
    access: 'old-access',
    expires: 1,
  };
  let captureCount = 0;
  const events: string[] = [];
  const createOptions: FakeModelRuntimeOptions[] = [];
  const createStorage = (persistent: boolean): FakeAuthStorage => {
    let credential = persistent ? persistedCredential : undefined;
    return {
      login: async () => undefined,
      read: async () => credential,
      modify: async (_provider, update) => {
        credential = await update(credential);
        if (persistent) persistedCredential = credential;
        return credential;
      },
      delete: async () => {
        events.push(persistent ? 'persistent-delete' : 'attempt-delete');
        credential = undefined;
        if (persistent) persistedCredential = undefined;
      },
      list: async () =>
        credential
          ? [{ providerId: 'openai-codex', type: 'oauth' }]
          : [],
    };
  };
  const pi = {
    ModelRuntime: {
      create: async (options: FakeModelRuntimeOptions = {}) => {
        createOptions.push(options);
        events.push(options.credentials ? 'attempt-runtime-create' : 'status-runtime-create');
        return {
          getModel: (provider: string, model: string) =>
            provider === 'openai-codex' && model === 'gpt-5.5' ? {} : undefined,
          hasConfiguredAuth: () => persistedCredential !== undefined,
          login: async (
            _provider: string,
            _type: 'oauth',
            interaction: Parameters<FakeModelRuntime['login']>[2],
          ) => {
            events.push('runtime-login');
            assert.equal(persistedCredential, undefined);
            assert.equal(await options.credentials?.read('openai-codex'), undefined);
            interaction.notify({
              type: 'auth_url',
              url: 'https://auth.openai.com/oauth/authorize?client_id=modern',
            });
            await options.credentials?.modify('openai-codex', async () => ({
              type: 'oauth',
              refresh: 'new-refresh',
              access: 'new-access',
              expires: 2,
            }));
            return {};
          },
          logout: async () => {
            persistedCredential = undefined;
          },
        };
      },
    },
    ModelRegistry: {
      create: () => {
        throw new Error('legacy registry must not be used');
      },
    },
  } as unknown as PiAuthModule;
  const service = new CodexCredentialService({
    authPath: () => '/profile/cowork/pi/auth.json',
    modelsPath: () => '/profile/cowork/pi/models.json',
    loadPiAuthModule: async () => pi,
    openExternal: async () => {
      events.push('auth-url-opened');
    },
    createBrowserCallbackCapture: async () => {
      captureCount += 1;
      throw new Error('modern runtime must own the browser callback');
    },
    createPersistentCredentialStore: () => createStorage(true),
    createAttemptCredentialStore: () => createStorage(false),
    ensurePrivateDirectory: () => undefined,
  });

  const status = await service.connect({ method: 'browser' });

  assert.equal(status.connected, true);
  assert.equal(captureCount, 0);
  assert.deepEqual(
    createOptions.map(({ allowModelNetwork }) => allowModelNetwork),
    [false, false],
  );
  assert.ok(events.indexOf('persistent-delete') < events.indexOf('runtime-login'));
  assert.ok(events.indexOf('runtime-login') < events.indexOf('auth-url-opened'));
  assert.deepEqual(persistedCredential, {
    type: 'oauth',
    refresh: 'new-refresh',
    access: 'new-access',
    expires: 2,
  });
});

test('aborts browser login on timeout and closes callback capture', async () => {
  let closeCount = 0;
  const redirect = deferred<string>();
  redirect.promise.catch(() => undefined);
  const pi = createFakePi({
    login: async (callbacks) => {
      await callbacks.onManualCodeInput();
    },
  });
  const service = createService(pi, {
    browserTimeoutMs: 10,
    createBrowserCallbackCapture: async () => ({
      waitForRedirect: async () => await redirect.promise,
      cancel: (error) => redirect.reject(error),
      close: async () => {
        closeCount += 1;
      },
    }),
  });

  await assert.rejects(
    service.connect({ method: 'browser' }),
    (error: unknown) => error instanceof CodexCredentialError && error.code === 'timeout',
  );
  assert.equal(closeCount, 1);
  assert.equal((await service.getStatus()).loginInProgress, false);
});

test('cancel resolves before an uncooperative login and late completion cannot overwrite a retry', async () => {
  const firstLogin = deferred<void>();
  const firstLoginStarted = deferred<void>();
  const pi = createFakePi({
    login: async (_callbacks, loginIndex) => {
      if (loginIndex !== 1) return;
      firstLoginStarted.resolve();
      await firstLogin.promise;
    },
  });
  const service = createService(pi);

  const first = service.connect({ method: 'device_code' });
  await firstLoginStarted.promise;
  await service.cancelConnect();
  await assert.rejects(
    first,
    (error: unknown) => error instanceof CodexCredentialError && error.code === 'cancelled',
  );

  const retry = await service.connect({ method: 'device_code' });
  assert.equal(retry.connected, true);
  assert.equal(pi.credentialAccess, 'access-2');

  firstLogin.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pi.credentialAccess, 'access-2');
  assert.equal((await service.getStatus()).connected, true);
});

test('logs out only the openai-codex credential', async () => {
  const pi = createFakePi({ connected: true });
  const status = await createService(pi).disconnect();
  assert.equal(status.connected, false);
  assert.equal(pi.logoutCount, 1);
});
