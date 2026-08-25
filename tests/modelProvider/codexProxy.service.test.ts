import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Dispatcher, type Dispatcher as DispatcherType } from 'undici';
import { codexSettingsPath } from '../../src/main/codex/codexPaths';
import {
  CodexProxyConfigurationError,
  CodexProxyService,
  parseCodexProxySettings,
  type CodexProxyDispatcherOptions
} from '../../src/main/codex/codexProxy.service';
import {
  OutboundHttpDispatcherCoordinator,
  isCodexProxyDestination
} from '../../src/main/networking/outboundHttpDispatcher.service';

class RecordingDispatcher extends Dispatcher {
  readonly origins: string[] = [];
  closeCalls = 0;
  destroyCalls = 0;

  dispatch(
    options: DispatcherType.DispatchOptions,
    _handler: DispatcherType.DispatchHandler
  ): boolean {
    this.origins.push(String(options.origin));
    return true;
  }

  close(): Promise<void>;
  close(callback: () => void): void;
  close(callback?: () => void): Promise<void> | void {
    this.closeCalls += 1;
    if (callback) {
      callback();
      return;
    }
    return Promise.resolve();
  }

  destroy(): Promise<void>;
  destroy(_error: Error | null): Promise<void>;
  destroy(callback: () => void): void;
  destroy(_error: Error | null, callback: () => void): void;
  destroy(
    errorOrCallback?: Error | null | (() => void),
    callback?: () => void
  ): Promise<void> | void {
    this.destroyCalls += 1;
    const completionCallback =
      typeof errorOrCallback === 'function' ? errorOrCallback : callback;
    if (completionCallback) {
      completionCallback();
      return;
    }
    return Promise.resolve();
  }
}

const dispatch = (dispatcher: DispatcherType, origin: string): void => {
  dispatcher.dispatch(
    { origin, path: '/', method: 'GET' },
    {} as DispatcherType.DispatchHandler
  );
};

test('accepts only the exact versioned loopback proxy schema', () => {
  assert.equal(
    codexSettingsPath('/profile'),
    join('/profile', 'cowork', 'pi', 'settings.json')
  );
  assert.deepEqual(
    parseCodexProxySettings({
      schemaVersion: 1,
      httpProxy: 'http://127.0.0.1:7897'
    }),
    {
      httpProxy: 'http://127.0.0.1:7897',
      scheme: 'http',
      hostClass: 'ipv4-loopback',
      port: 7897
    }
  );
  assert.equal(
    parseCodexProxySettings({
      schemaVersion: 1,
      httpProxy: 'https://LOCALHOST:443'
    }).hostClass,
    'localhost'
  );
  assert.equal(
    parseCodexProxySettings({
      schemaVersion: 1,
      httpProxy: 'http://[::1]:65535'
    }).hostClass,
    'ipv6-loopback'
  );

  const rejected = [
    null,
    [],
    {},
    { schemaVersion: 2, httpProxy: 'http://127.0.0.1:7897' },
    { schemaVersion: 1, httpProxy: 'http://127.0.0.1:7897', extra: true },
    { schemaVersion: 1, httpProxy: 'socks5://127.0.0.1:7897' },
    { schemaVersion: 1, httpProxy: 'http://proxy.example:7897' },
    { schemaVersion: 1, httpProxy: 'http://user:secret@127.0.0.1:7897' },
    { schemaVersion: 1, httpProxy: 'http://127.0.0.1' },
    { schemaVersion: 1, httpProxy: 'http://127.0.0.1:0' },
    { schemaVersion: 1, httpProxy: 'http://127.0.0.1:65536' },
    { schemaVersion: 1, httpProxy: 'http://127.0.0.1:7897/' },
    { schemaVersion: 1, httpProxy: 'http://127.0.0.1:7897?secret=value' },
    { schemaVersion: 1, httpProxy: 'http://127.0.0.1:7897#secret' }
  ];
  for (const value of rejected) {
    assert.throws(() => parseCodexProxySettings(value), CodexProxyConfigurationError);
  }
});

test('unreadable and malformed present settings fail closed with fixed diagnostics', async () => {
  const cases = [
    {
      readSettings: async (): Promise<string> => {
        throw Object.assign(new Error('private filesystem detail'), { code: 'EACCES' });
      },
      expectedCode: 'settings-unreadable'
    },
    {
      readSettings: async (): Promise<string> => '{"httpProxy":"raw-secret',
      expectedCode: 'settings-malformed'
    }
  ] as const;

  for (const testCase of cases) {
    const logs: string[] = [];
    const service = new CodexProxyService({
      readSettings: testCase.readSettings,
      logger: {
        info: (message) => logs.push(String(message)),
        error: (message) => logs.push(String(message))
      }
    });
    await assert.rejects(
      service.ensure('/profile/cowork/pi/settings.json'),
      (error: unknown) =>
        error instanceof CodexProxyConfigurationError && error.code === testCase.expectedCode
    );
    assert.equal(logs.length, 1);
    assert.match(logs[0], new RegExp(`reason=${testCase.expectedCode}`));
    assert.doesNotMatch(logs[0], /private|filesystem detail|raw-secret/);
  }
});

test('missing settings preserve fallback routing without changing proxy environment', async () => {
  const before = {
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    ALL_PROXY: process.env.ALL_PROXY,
    NO_PROXY: process.env.NO_PROXY
  };
  let dispatcherCreations = 0;
  let configurations = 0;
  const logs: string[] = [];
  const service = new CodexProxyService({
    readSettings: async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
    createDispatcher: () => {
      dispatcherCreations += 1;
      return new RecordingDispatcher();
    },
    configureDispatcher: () => {
      configurations += 1;
    },
    logger: {
      info: (message) => logs.push(String(message)),
      error: (message) => logs.push(String(message))
    }
  });

  await service.ensure('/profile/cowork/pi/settings.json');

  assert.equal(dispatcherCreations, 0);
  assert.equal(configurations, 0);
  assert.deepEqual(
    {
      HTTP_PROXY: process.env.HTTP_PROXY,
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      ALL_PROXY: process.env.ALL_PROXY,
      NO_PROXY: process.env.NO_PROXY
    },
    before
  );
  assert.deepEqual(logs, ['[codex-proxy] stage=not-configured source=file']);
});

test('present invalid settings fail closed and cache the rejection without leaking values', async () => {
  let reads = 0;
  let configurations = 0;
  const logs: string[] = [];
  const rawProxy = 'http://user:secret@127.0.0.1:7897?token=hidden';
  const service = new CodexProxyService({
    readSettings: async () => {
      reads += 1;
      return JSON.stringify({ schemaVersion: 1, httpProxy: rawProxy });
    },
    configureDispatcher: () => {
      configurations += 1;
    },
    logger: {
      info: (message) => logs.push(String(message)),
      error: (message) => logs.push(String(message))
    }
  });

  const first = service.ensure('/profile/cowork/pi/settings.json');
  const second = service.ensure('/profile/cowork/pi/settings.json');
  assert.strictEqual(first, second);
  await assert.rejects(first, CodexProxyConfigurationError);
  await assert.rejects(second, CodexProxyConfigurationError);

  assert.equal(reads, 1);
  assert.equal(configurations, 0);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /user|secret|token|127\.0\.0\.1|7897/);
});

test('valid settings install one callback-safe dispatcher and log only safe fields', async () => {
  const created: CodexProxyDispatcherOptions[] = [];
  const configured: DispatcherType[] = [];
  const logs: string[] = [];
  const proxyDispatcher = new RecordingDispatcher();
  const service = new CodexProxyService({
    readSettings: async () =>
      JSON.stringify({ schemaVersion: 1, httpProxy: 'http://127.0.0.1:7897' }),
    createDispatcher: (options) => {
      created.push(options);
      return proxyDispatcher;
    },
    configureDispatcher: (dispatcher) => configured.push(dispatcher),
    logger: {
      info: (message) => logs.push(String(message)),
      error: (message) => logs.push(String(message))
    }
  });

  await service.ensure('/profile/cowork/pi/settings.json');
  await service.ensure('/ignored-after-first-load.json');

  assert.deepEqual(created, [
    {
      httpProxy: 'http://127.0.0.1:7897',
      httpsProxy: 'http://127.0.0.1:7897',
      noProxy: '127.0.0.1,localhost,[::1]'
    }
  ]);
  assert.deepEqual(configured, [proxyDispatcher]);
  assert.deepEqual(logs, [
    '[codex-proxy] stage=configured source=file scheme=http host=ipv4-loopback port=7897'
  ]);
  assert.doesNotMatch(logs[0], /127\.0\.0\.1|http:\/\//);
});

test('strict destination matching cannot be extended by a hostile suffix', () => {
  for (const origin of [
    'https://openai.com',
    'https://auth.openai.com/oauth/token',
    'https://chatgpt.com/backend-api/codex/responses',
    'https://cdn.oaistatic.com',
    'https://files.oaiusercontent.com',
    'https://events.oaistatsig.com',
    'https://api.openaimerge.com'
  ]) {
    assert.equal(isCodexProxyDestination(origin), true, origin);
  }
  for (const origin of [
    'https://evilopenai.com',
    'https://openai.com.example.org',
    'https://chatgpt.com.evil.test',
    'https://oaistatic.com.attacker.test',
    'https://localhost:1455',
    'ftp://auth.openai.com/file'
  ]) {
    assert.equal(isCodexProxyDestination(origin), false, origin);
  }
});

test('a Maestro lease is the network fallback when no Codex proxy is configured', () => {
  const fallback = new RecordingDispatcher();
  const maestro = new RecordingDispatcher();
  let globalDispatcher: DispatcherType = fallback;
  const coordinator = new OutboundHttpDispatcherCoordinator({
    getGlobalDispatcher: () => globalDispatcher,
    setGlobalDispatcher: (dispatcher) => {
      globalDispatcher = dispatcher;
    }
  });

  coordinator.acquireMaestroProxy(maestro);
  dispatch(globalDispatcher, 'https://auth.openai.com/oauth/token');
  dispatch(globalDispatcher, 'https://example.com/data');
  dispatch(globalDispatcher, 'http://[::1]:1455/auth/callback');

  assert.equal(maestro.origins.length, 2);
  assert.equal(fallback.origins.length, 1);
});

test('Maestro-first and Codex-first lease orders keep one routing dispatcher', () => {
  const exercise = (codexFirst: boolean): void => {
    const fallback = new RecordingDispatcher();
    const codex = new RecordingDispatcher();
    const maestro = new RecordingDispatcher();
    let globalDispatcher: DispatcherType = fallback;
    let installations = 0;
    const coordinator = new OutboundHttpDispatcherCoordinator({
      getGlobalDispatcher: () => globalDispatcher,
      setGlobalDispatcher: (dispatcher) => {
        installations += 1;
        globalDispatcher = dispatcher;
      }
    });

    let releaseFirst: (() => void) | null = null;
    if (codexFirst) coordinator.configureCodexProxy(codex);
    else releaseFirst = coordinator.acquireMaestroProxy(maestro);
    const stableDispatcher = globalDispatcher;

    if (!codexFirst) coordinator.configureCodexProxy(codex);
    else releaseFirst = coordinator.acquireMaestroProxy(maestro);
    const releaseSecond = coordinator.acquireMaestroProxy(maestro);

    dispatch(globalDispatcher, 'https://auth.openai.com/oauth/token');
    dispatch(globalDispatcher, 'https://example.com/data');
    dispatch(globalDispatcher, 'http://localhost:1455/auth/callback');
    assert.equal(codex.origins.length, 1);
    assert.equal(maestro.origins.length, 1);
    assert.equal(fallback.origins.length, 1);

    releaseFirst();
    releaseFirst();
    dispatch(globalDispatcher, 'https://example.net/one-lease-left');
    assert.equal(maestro.origins.length, 2);

    releaseSecond();
    dispatch(globalDispatcher, 'https://api.openai.com/v1/responses');
    dispatch(globalDispatcher, 'https://example.org/fallback');
    assert.equal(codex.origins.length, 2);
    assert.equal(fallback.origins.length, 2);
    assert.equal(installations, 1);
    assert.strictEqual(globalDispatcher, stableDispatcher);
  };

  exercise(false);
  exercise(true);
});

test('the routing dispatcher safely closes and destroys every unique delegate once', async () => {
  const fallback = new RecordingDispatcher();
  const codex = new RecordingDispatcher();
  const maestro = new RecordingDispatcher();
  let globalDispatcher: DispatcherType = fallback;
  const coordinator = new OutboundHttpDispatcherCoordinator({
    getGlobalDispatcher: () => globalDispatcher,
    setGlobalDispatcher: (dispatcher) => {
      globalDispatcher = dispatcher;
    }
  });

  coordinator.configureCodexProxy(codex);
  coordinator.acquireMaestroProxy(maestro);
  coordinator.acquireMaestroProxy(maestro);
  await globalDispatcher.close();
  await globalDispatcher.destroy();

  for (const dispatcher of [fallback, codex, maestro]) {
    assert.equal(dispatcher.closeCalls, 1);
    assert.equal(dispatcher.destroyCalls, 1);
  }
});

test('both embedded Pi imports await proxy setup first', () => {
  const credentialRuntime = readFileSync(
    'src/main/codex/codexCredential.runtime.ts',
    'utf8'
  );
  const modelRuntime = readFileSync(
    'src/main/codex/codexRuntime.runtime.ts',
    'utf8'
  );
  for (const source of [credentialRuntime, modelRuntime]) {
    assert.match(
      source,
      /await ensureCodexProxyDispatcher\([\s\S]*?await import\('@earendil-works\/pi-coding-agent'\)/
    );
  }

  const codexProxy = readFileSync('src/main/codex/codexProxy.service.ts', 'utf8');
  const maestroProxy = readFileSync('src/main/maestro/net/proxy.ts', 'utf8');
  assert.doesNotMatch(codexProxy, /\bsetGlobalDispatcher\b/);
  assert.doesNotMatch(maestroProxy, /\bsetGlobalDispatcher\b/);
});
