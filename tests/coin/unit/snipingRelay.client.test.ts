import assert from 'node:assert/strict';
import test from 'node:test';
import { SnipingRelayClient, type SnipingFetch } from '../../../src/main/sniping/snipingRelay.client';
import { SnipingSessionService } from '../../../src/main/sniping/snipingSession.service';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

const response = (
  value: string,
  options: { status?: number; contentLength?: string | null; chunks?: Uint8Array[] } = {},
) => {
  const bytes = options.chunks ?? [new TextEncoder().encode(value)];
  let index = 0;
  let cancelled = false;
  return {
    response: {
      ok: (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
      status: options.status ?? 200,
      headers: {
        get: (name: string) => name.toLowerCase() === 'content-length'
          ? options.contentLength ?? null
          : null,
      },
      body: {
        getReader: () => ({
          read: async () => index < bytes.length
            ? { done: false, value: bytes[index++] }
            : { done: true },
          cancel: async () => { cancelled = true; },
        }),
      },
    },
    get cancelled() { return cancelled; },
  };
};

const activeSession = (): SnipingSessionService => {
  const session = new SnipingSessionService();
  session.activate({ coreToken: 'core-token-secret', sessionId: 'session-a' });
  return session;
};

test('relay owns the fixed HTTPS endpoint, token header, redirect policy, and bounded body', async () => {
  const seen: Array<{ url: string; init: Parameters<SnipingFetch>[1] }> = [];
  const fixture = response('{"answer":42}', { contentLength: '13' });
  const fetchImpl: SnipingFetch = async (url, init) => {
    seen.push({ url, init });
    return fixture.response;
  };
  const relay = new SnipingRelayClient({
    session: activeSession(),
    fetchImpl,
    baseUrl: 'https://core.example',
  });

  const result = await relay.request({
    method: 'POST',
    path: '/sniping/config/list',
    body: { page: 1 },
    parse: (value) => value as { answer: number },
  });
  assert.deepEqual(result, { ok: true, value: { answer: 42 } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://core.example/sniping/config/list');
  assert.equal(seen[0].init.redirect, 'error');
  assert.equal(seen[0].init.headers['-x-bl-token'], 'core-token-secret');
  assert.equal(seen[0].init.body, '{"page":1}');
});

test('relay rejects declared and streamed bodies above one MiB before parsing', async () => {
  const declared = response('{}', { contentLength: '1048577' });
  let relay = new SnipingRelayClient({
    session: activeSession(),
    fetchImpl: async () => declared.response,
    baseUrl: 'https://core.example',
  });
  assert.deepEqual(await relay.request({
    method: 'GET', path: '/sniping/components', parse: (value) => value,
  }), {
    ok: false,
    error: {
      code: 'SNIPING_RESPONSE_INVALID',
      message: 'Sniping returned an invalid response.',
      status: null,
      retryable: false,
    },
  });

  const streamed = response('', {
    chunks: [new Uint8Array(1_048_576), new Uint8Array([1])],
  });
  relay = new SnipingRelayClient({
    session: activeSession(),
    fetchImpl: async () => streamed.response,
    baseUrl: 'https://core.example',
  });
  const streamedResult = await relay.request({
    method: 'GET', path: '/sniping/components', parse: (value) => value,
  });
  assert.equal(streamedResult.ok, false);
  if (!streamedResult.ok) assert.equal(streamedResult.error.code, 'SNIPING_RESPONSE_INVALID');
  assert.equal(streamed.cancelled, true);
});

test('relay never forwards a backend error message that may echo credentials', async () => {
  const relay = new SnipingRelayClient({
    session: activeSession(),
    fetchImpl: async () => response(JSON.stringify({
      code: 'CONFIG_INVALID',
      message: 'providerApiKey=gmgn-secret rpcUrl=https://secret.example',
      issues: [{ path: '/quote_token_address', keyword: 'pattern' }],
    }), { status: 400 }).response,
    baseUrl: 'https://core.example',
  });
  const result = await relay.request({
    method: 'POST', path: '/sniping/config/validate', body: {}, parse: (value) => value,
  });
  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'CONFIG_INVALID',
      message: 'The Sniping request could not be completed.',
      status: 400,
      retryable: false,
      issues: [{ path: '/quote_token_address', keyword: 'pattern' }],
    },
  });
  assert.doesNotMatch(JSON.stringify(result), /gmgn-secret|secret\.example/);
});

test('relay never forwards sensitive issue path aliases from an untrusted Core error', async () => {
  for (const path of [
    '/credentialRef/gmgn-secret', '/accessToken', '/refresh_token', '/providerAccessToken',
    '/privateKey', '/session-id', '/rpcUri', '/endpoint_url', '/headers', '/token',
    '/authToken', '/authentication_token', '/customerToken', '/providerToken', '/bearer_token',
    '/apiToken', '/jwt', '/customerJwt', '/customer_jwt', '/customer-jwt', '/customerjwt',
    '/prefixCustomerJwtSuffix', '/sessionToken', '/csrf-token', '/idToken', '/opaqueToken',
    '/someTokenValue', '/auth_token_address', '/url', '/uri',
  ]) {
    const relay = new SnipingRelayClient({
      session: activeSession(),
      fetchImpl: async () => response(JSON.stringify({
        code: 'CONFIG_INVALID', message: 'invalid', issues: [{ path, keyword: 'pattern' }],
      }), { status: 400 }).response,
      baseUrl: 'https://core.example',
    });
    const result = await relay.request({
      method: 'POST', path: '/sniping/config/validate', body: {}, parse: (value) => value,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.issues, undefined, path);
  }

  const relay = new SnipingRelayClient({
    session: activeSession(),
    fetchImpl: async () => response(JSON.stringify({
      code: 'CONFIG_INVALID', message: 'invalid',
      issues: [{ path: '/quote_token_address', keyword: 'pattern' }],
    }), { status: 400 }).response,
    baseUrl: 'https://core.example',
  });
  const legitimate = await relay.request({
    method: 'POST', path: '/sniping/config/validate', body: {}, parse: (value) => value,
  });
  assert.equal(legitimate.ok, false);
  if (!legitimate.ok) assert.deepEqual(legitimate.error.issues, [
    { path: '/quote_token_address', keyword: 'pattern' },
  ]);

  const tokenAddressRelay = new SnipingRelayClient({
    session: activeSession(),
    fetchImpl: async () => response(JSON.stringify({
      code: 'CONFIG_INVALID', message: 'invalid',
      issues: [{ path: '/token_address', keyword: 'pattern' }],
    }), { status: 400 }).response,
    baseUrl: 'https://core.example',
  });
  const tokenAddress = await tokenAddressRelay.request({
    method: 'POST', path: '/sniping/config/validate', body: {}, parse: (value) => value,
  });
  assert.equal(tokenAddress.ok, false);
  if (!tokenAddress.ok) assert.deepEqual(tokenAddress.error.issues, [
    { path: '/token_address', keyword: 'pattern' },
  ]);

  for (const path of [
    '/token_symbol', '/token_decimals', '/quote_token_code_ready',
    '/quote_token_decimals_ready', '/declared_quote_token_decimals',
  ]) {
    const domainPathRelay = new SnipingRelayClient({
      session: activeSession(),
      fetchImpl: async () => response(JSON.stringify({
        code: 'CONFIG_INVALID', message: 'invalid', issues: [{ path, keyword: 'type' }],
      }), { status: 400 }).response,
      baseUrl: 'https://core.example',
    });
    const domainPath = await domainPathRelay.request({
      method: 'POST', path: '/sniping/config/validate', body: {}, parse: (value) => value,
    });
    assert.equal(domainPath.ok, false);
    if (!domainPath.ok) assert.deepEqual(domainPath.error.issues, [{ path, keyword: 'type' }]);
  }
});

test('only current-generation 401 clears and invalidates the Home session', async () => {
  const session = activeSession();
  const unauthorized = deferred<ReturnType<typeof response>['response']>();
  const invalidated: string[] = [];
  const relay = new SnipingRelayClient({
    session,
    fetchImpl: async () => await unauthorized.promise,
    baseUrl: 'https://core.example',
    onCurrentUnauthorized: (sessionId) => (invalidated as string[]).push(sessionId),
  });
  const pending = relay.request({
    method: 'GET', path: '/sniping/components', parse: (value) => value,
  });
  session.activate({ coreToken: 'token-b', sessionId: 'session-b' });
  unauthorized.resolve(response('not-json', {
    status: 401,
    contentLength: '1048577',
  }).response);

  const stale = await pending;
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.error.code, 'SNIPING_SESSION_REPLACED');
  assert.deepEqual(invalidated, []);
  assert.equal(session.capture().sessionId, 'session-b');

  const currentUnauthorized = response('not-json', {
    status: 401,
    contentLength: '1048577',
  });
  const currentRelay = new SnipingRelayClient({
    session,
    fetchImpl: async () => currentUnauthorized.response,
    baseUrl: 'https://core.example',
    onCurrentUnauthorized: (sessionId) => (invalidated as string[]).push(sessionId),
  });
  const current = await currentRelay.request({
    method: 'GET', path: '/sniping/components', parse: (value) => value,
  });
  assert.equal(current.ok, false);
  if (!current.ok) assert.equal(current.error.code, 'SNIPING_SESSION_EXPIRED');
  assert.deepEqual(invalidated, ['session-b']);
  assert.equal(currentUnauthorized.cancelled, true);
  assert.throws(() => session.capture(), /SNIPING_SESSION_REQUIRED/);
});
