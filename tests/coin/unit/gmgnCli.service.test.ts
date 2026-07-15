import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GmgnCliService,
  GmgnReadError,
  GMGN_READ_ONLY_PROBE_ARGS,
  buildGmgnReadArgs,
  buildSanitizedGmgnEnv,
  resolveGmgnOfficialUrl,
} from '../../../src/main/coin/resources/gmgnCli.service';
import {
  CoinProcessError,
  type CoinProcessRequest,
  type CoinProcessRunner,
} from '../../../src/main/coin/resources/coinProcess.runner';

const makeFixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-gmgn-test-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const executable = join(bin, 'gmgn-cli');
  writeFileSync(executable, '#!/bin/sh\n', 'utf8');
  chmodSync(executable, 0o700);
  return { root, home, bin, executable };
};

const serviceFor = (
  fixture: ReturnType<typeof makeFixture>,
  runProcess: CoinProcessRunner,
  overrides: Partial<ConstructorParameters<typeof GmgnCliService>[0]> = {},
) =>
  new GmgnCliService({
    homeDir: () => fixture.home,
    processEnv: () => ({
      PATH: fixture.bin,
      LANG: 'en_US.UTF-8',
      GMGN_API_KEY: 'must-not-be-inherited',
      GMGN_PRIVATE_KEY: 'must-not-be-inherited',
      UNRELATED_SECRET: 'must-not-be-inherited',
    }),
    platform: process.platform,
    runProcess,
    openExternal: async () => undefined,
    now: (() => {
      let now = 1_000;
      return () => ++now;
    })(),
    ...overrides,
  });

test('reports a missing executable without spawning a shell or fallback command', async () => {
  const fixture = makeFixture();
  try {
    rmSync(fixture.executable);
    let calls = 0;
    const service = serviceFor(fixture, async () => {
      calls += 1;
      return { stdout: '', stderr: '' };
    });
    const status = await service.detect();
    assert.equal(status.installed, false);
    assert.equal(status.displayPath, null);
    assert.equal(calls, 0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('detects a fixed executable/version and writes only GMGN_API_KEY with private modes', async () => {
  const fixture = makeFixture();
  const requests: CoinProcessRequest[] = [];
  try {
    const service = serviceFor(fixture, async (request) => {
      requests.push(request);
      return { stdout: 'gmgn-cli 1.5.2\n', stderr: '' };
    });
    const initial = await service.detect();
    assert.equal(initial.installed, true);
    assert.equal(initial.version, '1.5.2');
    assert.equal(initial.displayPath, fixture.executable);
    assert.deepEqual(requests[0]?.args, ['--version']);
    assert.equal((requests[0] as CoinProcessRequest & { shell?: unknown }).shell, undefined);

    mkdirSync(join(fixture.home, '.config', 'gmgn'), { recursive: true });
    writeFileSync(
      service.credentialPath,
      'GMGN_PRIVATE_KEY=forbidden-fixture\nOTHER=value\n',
      'utf8',
    );
    const key = 'gmgn_test_api_key_123456';
    const receipt = await service.saveApiKey({ apiKey: key });
    assert.equal(receipt.ok, true);
    assert.equal(readFileSync(service.credentialPath, 'utf8'), `GMGN_API_KEY=${key}\n`);
    if (process.platform !== 'win32') {
      assert.equal(statSync(join(fixture.home, '.config', 'gmgn')).mode & 0o777, 0o700);
      assert.equal(statSync(service.credentialPath).mode & 0o777, 0o600);
    }
    const status = await service.detect();
    assert.equal(status.apiKeyConfigured, true);
    assert.equal(status.privateKeyDetected, false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('runs only the fixed read-only probe with an allowlisted environment and redacted receipt', async () => {
  const fixture = makeFixture();
  const requests: CoinProcessRequest[] = [];
  const key = 'gmgn_test_api_key_no_leak_98765';
  try {
    const service = serviceFor(fixture, async (request) => {
      requests.push(request);
      if (request.args.includes('--version')) return { stdout: '1.5.2', stderr: '' };
      return { stdout: '{"data":[{"symbol":"TEST"}]}', stderr: '' };
    });
    assert.equal((await service.saveApiKey({ apiKey: key })).ok, true);
    const receipt = await service.verify();
    assert.deepEqual(receipt, {
      ok: true,
      code: 'verified',
      startedAt: 1_002,
      completedAt: 1_004,
      summary: 'read-only-response',
      recordCount: 1,
    });
    const probe = requests.at(-1)!;
    assert.deepEqual(probe.args, [...GMGN_READ_ONLY_PROBE_ARGS]);
    assert.equal(probe.command, fixture.executable);
    assert.equal(probe.env.GMGN_API_KEY, undefined);
    assert.equal(probe.env.GMGN_PRIVATE_KEY, undefined);
    assert.equal(probe.env.UNRELATED_SECRET, undefined);
    assert.equal(probe.env.HOME, fixture.home);
    assert.doesNotMatch(JSON.stringify(receipt), new RegExp(key));
    assert.equal(probe.args.some((arg) => /swap|order|cooking|private/i.test(arg)), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('refuses a private-key-bearing file before the probe process starts', async () => {
  const fixture = makeFixture();
  let probeCalls = 0;
  try {
    const service = serviceFor(fixture, async (request) => {
      if (request.args.includes('--version')) return { stdout: '1.5.2', stderr: '' };
      probeCalls += 1;
      return { stdout: '{}', stderr: '' };
    });
    mkdirSync(join(fixture.home, '.config', 'gmgn'), { recursive: true });
    writeFileSync(
      service.credentialPath,
      'GMGN_API_KEY=fixture-api-key\nGMGN_PRIVATE_KEY=fixture-private-key\n',
      'utf8',
    );
    const receipt = await service.verify();
    assert.equal(receipt.code, 'private-key-detected');
    assert.equal(probeCalls, 0);
    assert.doesNotMatch(JSON.stringify(receipt), /fixture-private-key/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('classifies timeout and authorization failures without returning process output', async () => {
  const fixture = makeFixture();
  const key = 'gmgn_redaction_fixture_12345';
  try {
    let failure: 'timeout' | 'unauthorized' = 'timeout';
    const service = serviceFor(fixture, async (request) => {
      if (request.args.includes('--version')) return { stdout: '1.5.2', stderr: '' };
      if (failure === 'timeout') {
        throw new CoinProcessError('timeout', `timed out with ${key}`, key);
      }
      throw new CoinProcessError('process-failed', 'failed', `Unauthorized ${key}`);
    });
    await service.saveApiKey({ apiKey: key });
    const timeout = await service.verify();
    assert.equal(timeout.code, 'timeout');
    failure = 'unauthorized';
    const unauthorized = await service.verify();
    assert.equal(unauthorized.code, 'unauthorized');
    assert.doesNotMatch(JSON.stringify([timeout, unauthorized]), new RegExp(key));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('deduplicates and cancels an active fixed probe', async () => {
  const fixture = makeFixture();
  let probeCalls = 0;
  try {
    const service = serviceFor(fixture, async (request) => {
      if (request.args.includes('--version')) return { stdout: '1.5.2', stderr: '' };
      probeCalls += 1;
      return await new Promise((_resolve, reject) => {
        request.signal?.addEventListener(
          'abort',
          () => reject(new CoinProcessError('aborted', 'cancelled')),
          { once: true },
        );
      });
    });
    await service.saveApiKey({ apiKey: 'gmgn_cancel_fixture_12345' });
    const first = service.verify();
    const second = service.verify();
    assert.equal(first, second);
    while (probeCalls === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(service.cancelVerify(), true);
    const receipt = await first;
    assert.equal(receipt.code, 'cancelled');
    assert.equal(probeCalls, 1);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('sanitizes inherited environment and allowlists only fixed official links', () => {
  const env = buildSanitizedGmgnEnv(
    {
      PATH: '/bin',
      LANG: 'en_US.UTF-8',
      GMGN_PRIVATE_KEY: 'forbidden',
      GMGN_API_KEY: 'forbidden',
      TOKEN: 'forbidden',
    },
    '/home/fixture',
    '/bin',
  );
  assert.equal(env.GMGN_PRIVATE_KEY, undefined);
  assert.equal(env.GMGN_API_KEY, undefined);
  assert.equal(env.TOKEN, undefined);
  assert.equal(resolveGmgnOfficialUrl('repository'), 'https://github.com/GMGNAI/gmgn-skills');
  assert.equal(resolveGmgnOfficialUrl('apiKey'), 'https://gmgn.ai/ai');
  assert.throws(() => resolveGmgnOfficialUrl('https://evil.example'));

  const runnerSource = readFileSync(
    join(process.cwd(), 'src/main/coin/resources/coinProcess.runner.ts'),
    'utf8',
  );
  assert.match(runnerSource, /shell: false/);
});

test('builds only allowlisted typed read commands and rejects arbitrary addresses or limits', () => {
  assert.deepEqual(buildGmgnReadArgs({
    operation: 'trenches',
    chain: 'bsc',
    types: ['near_completion', 'completed'],
    limit: 20,
  }), [
    'market', 'trenches', '--chain', 'bsc',
    '--type', 'near_completion', '--type', 'completed',
    '--limit', '20', '--raw',
  ]);
  assert.deepEqual(buildGmgnReadArgs({
    operation: 'token-holders',
    chain: 'solana',
    address: '11111111111111111111111111111111',
    limit: 100,
  }), [
    'token', 'holders', '--chain', 'sol',
    '--address', '11111111111111111111111111111111',
    '--limit', '100', '--raw',
  ]);
  assert.throws(
    () => buildGmgnReadArgs({ operation: 'token-info', chain: 'bsc', address: '; rm -rf /' }),
    (error) => error instanceof GmgnReadError && error.code === 'invalid-input',
  );
  assert.throws(
    () => buildGmgnReadArgs({ operation: 'trending', chain: 'bsc', interval: '1h', limit: 101 }),
    (error) => error instanceof GmgnReadError && error.code === 'invalid-input',
  );
});

test('serializes bounded local reads and keeps diagnostics out of typed results', async () => {
  const fixture = makeFixture();
  const requests: CoinProcessRequest[] = [];
  try {
    const service = serviceFor(fixture, async (request) => {
      requests.push(request);
      if (request.args.includes('--version')) return { stdout: '1.5.2', stderr: '' };
      return { stdout: '{"data":[{"symbol":"FIX"}]}', stderr: 'private diagnostic' };
    });
    await service.saveApiKey({ apiKey: 'gmgn_read_fixture_12345' });
    const first = service.read({ operation: 'trending', chain: 'bsc', interval: '1h', limit: 3 });
    const second = service.read({ operation: 'hot-searches', chain: 'bsc', interval: '1h', limit: 3 });
    const results = await Promise.all([first, second]);
    assert.deepEqual(results.map(({ operation }) => operation), ['trending', 'hot-searches']);
    assert.equal(requests.filter((request) => !request.args.includes('--version')).length, 2);
    assert.doesNotMatch(JSON.stringify(results), /private diagnostic|gmgn_read_fixture/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
