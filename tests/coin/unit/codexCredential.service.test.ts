import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { join } from 'node:path';
import {
  CodexCredentialError,
  CodexCredentialService,
  type PiAuthModule,
  type PiAuthStorage
} from '../../../src/main/codex/codexCredential.service';
import {
  CodexFileCredentialStore,
  CodexMemoryCredentialStore,
  type CodexCredentialStore
} from '../../../src/main/codex/codexCredential.store';
import {
  createCodexBrowserCallbackCapture,
  type CodexBrowserCallbackCapture
} from '../../../src/main/codex/codexCallbackCapture';
import { codexAuthPath, codexModelsPath } from '../../../src/main/codex/codexPaths';
import { connect } from 'node:net';

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
    loginIndex: number
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
        callbacks: Parameters<NonNullable<PiAuthStorage['login']>>[1]
      ) => {
        loginCount += 1;
        if (options.login) await options.login(callbacks, loginCount);
        credential = {
          type: 'oauth',
          refresh: `refresh-${loginCount}`,
          access: `access-${loginCount}`,
          expires: loginCount
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
        update: (current: unknown | undefined) => Promise<unknown | undefined>
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
      list: async () => (credential ? [{ providerId: 'openai-codex', type: 'oauth' }] : [])
    };
  };
  const module = {
    ModelRegistry: {
      create: (_auth: unknown, modelsPath: string) => {
        modelPaths.push(modelsPath);
        return {
          find: (provider: string, model: string) =>
            provider === 'openai-codex' && model === 'gpt-5.5' ? {} : undefined,
          hasConfiguredAuth: () => connected
        };
      }
    }
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
    }
  };
};

const createCapture = (): CodexBrowserCallbackCapture => {
  const redirect = deferred<string>();
  redirect.promise.catch(() => undefined);
  return {
    waitForRedirect: async () => await redirect.promise,
    cancel: (error) => redirect.reject(error),
    close: async () => undefined
  };
};

const createService = (
  pi: ReturnType<typeof createFakePi>,
  overrides: Partial<ConstructorParameters<typeof CodexCredentialService>[0]> = {}
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
    ...overrides
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
    expires: 1
  };
  try {
    const memory = new CodexMemoryCredentialStore();
    await memory.modify('openai-codex', async () => credential);
    assert.deepEqual(await memory.read('openai-codex'), credential);
    assert.deepEqual(await memory.list(), [{ providerId: 'openai-codex', type: 'oauth' }]);

    const file = new CodexFileCredentialStore(authPath);
    await file.modify('openai-codex', async () => await memory.read('openai-codex'));
    assert.deepEqual(JSON.parse(readFileSync(authPath, 'utf8')), {
      'openai-codex': credential
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
        expiresInSeconds: 900
      });
      await gate.promise;
    }
  });
  const notices: string[] = [];
  const opened: string[] = [];
  const service = createService(pi, {
    now: () => 1_000,
    openExternal: async (url) => {
      opened.push(url);
    }
  });

  const first = service.connect({
    method: 'device_code',
    onDeviceCode: (notice) => notices.push(`first:${notice.userCode}:${notice.verificationHost}`)
  });
  const second = service.connect({
    method: 'browser',
    onDeviceCode: (notice) => notices.push(`second:${notice.userCode}:${notice.verificationHost}`)
  });
  try {
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(pi.loginCount, 1);
    assert.deepEqual(notices.sort(), [
      'first:ABCD-EFGH:auth.openai.com',
      'second:ABCD-EFGH:auth.openai.com'
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
        url: 'https://auth.openai.com/oauth/authorize?client_id=fixture'
      });
      assert.equal(
        await callbacks.onManualCodeInput(),
        'http://localhost:1455/auth/callback?code=fixture&state=test'
      );
    }
  });
  const service = createService(pi, {
    openExternal: async (url) => {
      opened.push(url);
    },
    createBrowserCallbackCapture: async () => ({
      waitForRedirect: async () => 'http://localhost:1455/auth/callback?code=fixture&state=test',
      cancel: () => undefined,
      close: async () => {
        closeCount += 1;
      }
    })
  });

  const status = await service.connect({ method: 'browser' });
  assert.equal(status.connected, true);
  assert.deepEqual(opened, ['https://auth.openai.com/oauth/authorize?client_id=fixture']);
  assert.equal(closeCount, 1);
});

test('modern browser login keeps Pi as credential owner across the IPv6 companion', async () => {
  type FakeAuthStorage = CodexCredentialStore;
  type FakeModelRuntime = Awaited<ReturnType<NonNullable<PiAuthModule['ModelRuntime']>['create']>>;
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
    expires: 1
  };
  let captureCount = 0;
  let captureCloseCount = 0;
  let loopbackVerificationCount = 0;
  const ipv6Redirect = deferred<string>();
  ipv6Redirect.promise.catch(() => undefined);
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
      list: async () => (credential ? [{ providerId: 'openai-codex', type: 'oauth' }] : [])
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
            interaction: Parameters<FakeModelRuntime['login']>[2]
          ) => {
            events.push('runtime-login');
            assert.equal(persistedCredential, undefined);
            assert.equal(await options.credentials?.read('openai-codex'), undefined);
            interaction.notify({
              type: 'auth_url',
              url: 'https://auth.openai.com/oauth/authorize?client_id=modern'
            });
            assert.equal(
              await interaction.prompt({
                type: 'manual_code',
                signal: interaction.signal
              }),
              'http://localhost:1455/auth/callback?code=modern&state=fixture'
            );
            const tokenRequest = {
              method: 'POST',
              origin: 'https://auth.openai.com',
              path: '/oauth/token'
            };
            channel('undici:request:create').publish({ request: tokenRequest });
            channel('undici:request:headers').publish({
              request: tokenRequest,
              response: { statusCode: 200 }
            });
            await options.credentials?.modify('openai-codex', async () => ({
              type: 'oauth',
              refresh: 'new-refresh',
              access: 'new-access',
              expires: 2
            }));
            return {};
          },
          logout: async () => {
            persistedCredential = undefined;
          }
        };
      }
    },
    ModelRegistry: {
      create: () => {
        throw new Error('legacy registry must not be used');
      }
    }
  } as unknown as PiAuthModule;
  const service = new CodexCredentialService({
    authPath: () => '/profile/cowork/pi/auth.json',
    modelsPath: () => '/profile/cowork/pi/models.json',
    loadPiAuthModule: async () => pi,
    openExternal: async () => {
      events.push('auth-url-opened');
      ipv6Redirect.resolve(
        'http://localhost:1455/auth/callback?code=modern&state=fixture'
      );
    },
    createBrowserCallbackCapture: async () => {
      captureCount += 1;
      return {
        waitForRedirect: async () => await ipv6Redirect.promise,
        cancel: (error) => ipv6Redirect.reject(error),
        close: async () => {
          captureCloseCount += 1;
        }
      };
    },
    createLoopbackObserver: () => ({
      start: () => {
        events.push('loopback-started');
      },
      verifyOwnership: async ({ includeIpv6, signal }) => {
        assert.equal(includeIpv6, true);
        assert.equal(signal.aborted, false);
        loopbackVerificationCount += 1;
        events.push('loopback-verified');
        return [
          { route: 'localhost', family: 'ipv6', statusCode: 404 as const },
          { route: 'ipv4', family: 'ipv4', statusCode: 404 as const },
          { route: 'ipv6', family: 'ipv6', statusCode: 404 as const }
        ];
      },
      stop: () => {
        events.push('loopback-stopped');
      }
    }),
    platform: 'darwin',
    createPersistentCredentialStore: () => createStorage(true),
    createAttemptCredentialStore: () => createStorage(false),
    ensurePrivateDirectory: () => undefined
  });

  const lifecycleLogs: string[] = [];
  const originalConsoleInfo = console.info;
  const status = await (async () => {
    console.info = (...values: unknown[]) => {
      lifecycleLogs.push(values.map((value) => String(value)).join(' '));
    };
    try {
      return await service.connect({ method: 'browser' });
    } finally {
      console.info = originalConsoleInfo;
    }
  })();

  assert.equal(status.connected, true);
  assert.equal(captureCount, 1);
  assert.equal(captureCloseCount, 1);
  assert.equal(loopbackVerificationCount, 1);
  assert.deepEqual(
    createOptions.map(({ allowModelNetwork }) => allowModelNetwork),
    [false, false]
  );
  assert.ok(events.indexOf('persistent-delete') < events.indexOf('runtime-login'));
  assert.ok(events.indexOf('loopback-started') < events.indexOf('loopback-verified'));
  assert.ok(events.indexOf('loopback-verified') < events.indexOf('auth-url-opened'));
  assert.ok(events.indexOf('runtime-login') < events.indexOf('auth-url-opened'));
  const lifecycleIndex = (stage: string): number =>
    lifecycleLogs.findIndex((line) => line.includes(`stage=${stage}`));
  assert.ok(lifecycleIndex('callback-companion-ready') >= 0);
  assert.ok(
    lifecycleIndex('callback-companion-ready') <
      lifecycleIndex('callback-listener-announced')
  );
  assert.ok(
    lifecycleIndex('callback-listener-announced') <
      lifecycleIndex('callback-listener-verification-started')
  );
  assert.ok(
    lifecycleIndex('callback-listener-verification-started') <
      lifecycleIndex('callback-listener-verified')
  );
  assert.ok(
    lifecycleIndex('callback-listener-verified') <
      lifecycleIndex('authorization-url-opening')
  );
  assert.ok(lifecycleIndex('callback-forwarded-to-pi') < lifecycleIndex('token-exchange-started'));
  assert.ok(lifecycleIndex('token-exchange-started') < lifecycleIndex('token-exchange-response'));
  assert.ok(lifecycleIndex('token-exchange-response') < lifecycleIndex('token-credential-stored'));
  assert.deepEqual(persistedCredential, {
    type: 'oauth',
    refresh: 'new-refresh',
    access: 'new-access',
    expires: 2
  });
});

test('aborts browser login on timeout and closes callback capture', async () => {
  let closeCount = 0;
  const redirect = deferred<string>();
  redirect.promise.catch(() => undefined);
  const pi = createFakePi({
    login: async (callbacks) => {
      await callbacks.onManualCodeInput();
    }
  });
  const service = createService(pi, {
    browserTimeoutMs: 10,
    createBrowserCallbackCapture: async () => ({
      waitForRedirect: async () => await redirect.promise,
      cancel: (error) => redirect.reject(error),
      close: async () => {
        closeCount += 1;
      }
    })
  });

  await assert.rejects(
    service.connect({ method: 'browser' }),
    (error: unknown) => error instanceof CodexCredentialError && error.code === 'timeout'
  );
  assert.equal(closeCount, 1);
  assert.equal((await service.getStatus()).loginInProgress, false);
});

test('cancels and closes a callback capture that resolves after the attempt is cancelled', async () => {
  const pi = createFakePi();
  const captureRequested = deferred<void>();
  const lateCapture = deferred<CodexBrowserCallbackCapture>();
  const lateCaptureClosed = deferred<void>();
  let cancelCount = 0;
  let closeCount = 0;
  const service = createService(pi, {
    createBrowserCallbackCapture: async () => {
      captureRequested.resolve();
      return await lateCapture.promise;
    }
  });

  const login = service.connect({ method: 'browser' });
  const rejectedLogin = assert.rejects(
    login,
    (error: unknown) => error instanceof CodexCredentialError && error.code === 'cancelled'
  );
  await captureRequested.promise;
  await service.cancelConnect();
  await rejectedLogin;

  lateCapture.resolve({
    waitForRedirect: async () => await new Promise<string>(() => undefined),
    cancel: () => {
      cancelCount += 1;
    },
    close: async () => {
      closeCount += 1;
      lateCaptureClosed.resolve();
    }
  });
  await lateCaptureClosed.promise;

  assert.equal(cancelCount, 1);
  assert.equal(closeCount, 1);
});

test('cancel resolves before an uncooperative login and late completion cannot overwrite a retry', async () => {
  const firstLogin = deferred<void>();
  const firstLoginStarted = deferred<void>();
  const pi = createFakePi({
    login: async (_callbacks, loginIndex) => {
      if (loginIndex !== 1) return;
      firstLoginStarted.resolve();
      await firstLogin.promise;
    }
  });
  const service = createService(pi);

  const first = service.connect({ method: 'device_code' });
  await firstLoginStarted.promise;
  await service.cancelConnect();
  await assert.rejects(
    first,
    (error: unknown) => error instanceof CodexCredentialError && error.code === 'cancelled'
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

test('the real callback companion closes while a browser still holds its socket', async () => {
  // Regression for the 2026-08-20 production log: `performConnect` reached
  // `cleanup-capture-closing` after `attempt-succeeded` and never reached
  // `cleanup-capture-closed`, so an already-promoted credential never left Main.
  // `server.close()` waits forever on a connection that is mid-request or awaiting a response.
  const port = 14572;
  const unavailable: string[] = [];
  const capture = await createCodexBrowserCallbackCapture({
    port,
    closeTimeoutMs: 4_000,
    onUnavailable: (message) => unavailable.push(message)
  });

  const socket = await new Promise<ReturnType<typeof connect>>((resolve, reject) => {
    const pending = connect({ host: '::1', port, family: 6 }, () => {
      // Headers started, never terminated: the state that wedges `server.close()`.
      pending.write(`GET /auth/callback HTTP/1.1\r\nHost: localhost:${port}\r\n`);
      setTimeout(() => resolve(pending), 50);
    });
    pending.once('error', reject);
  });

  const startedAt = Date.now();
  await capture.close();
  const elapsed = Date.now() - startedAt;
  socket.destroy();

  assert.ok(elapsed < 2_000, `close() must force the socket shut, took ${elapsed}ms`);
  // Forced teardown, not the deadline giving up: the deadline is the last-resort backstop.
  assert.deepEqual(unavailable, []);

  // A second close is idempotent and must not wait on anything.
  await capture.close();
});
