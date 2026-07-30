import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import {
  CodexCredentialError,
  CodexCredentialService,
  type PiAuthModule,
} from '../../../src/main/codex/codexCredential.service';
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
    callbacks: Parameters<ReturnType<PiAuthModule['AuthStorage']['create']>['login']>[1],
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
        callbacks: Parameters<ReturnType<PiAuthModule['AuthStorage']['create']>['login']>[1],
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
    };
  };
  const module = {
    AuthStorage: {
      create: (path: string) => {
        authPaths.push(path);
        return createAuthStorage(true);
      },
      inMemory: () => createAuthStorage(false),
    },
    ModelRegistry: {
      create: (_auth: unknown, modelsPath: string) => {
        modelPaths.push(modelsPath);
        return {
          find: (provider: string, model: string) =>
            provider === 'openai-codex' && model === 'gpt-5.6-sol' ? {} : undefined,
          hasConfiguredAuth: () => connected,
        };
      },
    },
  } as unknown as PiAuthModule;
  return {
    module,
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
