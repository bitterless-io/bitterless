import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GmgnCliService,
  GmgnReadError,
  GMGN_ELECTRON_NODE_BOOTSTRAP,
  GMGN_READ_ONLY_PROBE_ARGS,
  buildGmgnReadArgs,
  buildSanitizedGmgnEnv,
  resolveGmgnOfficialUrl,
} from '../../../src/main/coin/resources/gmgnCli.service';
import {
  CoinProcessError,
  runCoinProcess,
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

const installYarnNodeFixture = (fixture: ReturnType<typeof makeFixture>) => {
  const yarnBin = join(fixture.home, '.yarn', 'bin');
  const globalModules = join(
    fixture.home,
    '.config',
    'yarn',
    'global',
    'node_modules',
  );
  const packageRoot = join(globalModules, 'gmgn-cli');
  const entry = join(packageRoot, 'dist', 'index.js');
  const callsPath = join(fixture.home, 'gmgn-unit-calls.ndjson');
  mkdirSync(yarnBin, { recursive: true });
  mkdirSync(join(globalModules, '.bin'), { recursive: true });
  mkdirSync(join(packageRoot, 'dist'), { recursive: true });
  mkdirSync(join(packageRoot, 'node_modules'), { recursive: true });
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name: 'gmgn-cli', version: '1.5.2', bin: { 'gmgn-cli': './dist/index.js' } }),
    'utf8',
  );
  writeFileSync(
    entry,
    '#!/usr/bin/env node\n' +
      "const { appendFileSync } = require('node:fs');\n" +
      "const { join } = require('node:path');\n" +
      "const { Command } = require('commander');\n" +
      "const args = process.argv.slice(2);\n" +
      "appendFileSync(join(process.env.HOME, 'gmgn-unit-calls.ndjson'), JSON.stringify({ args }) + '\\n');\n" +
      "const program = new Command().name('gmgn-cli').version('gmgn-cli 1.5.2');\n" +
      "const market = program.command('market');\n" +
      "market.command('trending').requiredOption('--chain <chain>').requiredOption('--interval <interval>').requiredOption('--limit <limit>').option('--raw').action(() => process.stdout.write(JSON.stringify({ code: 0, data: [{ symbol: 'UNIT' }] })));\n" +
      "const token = program.command('token');\n" +
      "token.command('info').requiredOption('--chain <chain>').requiredOption('--address <address>').option('--raw').action(() => process.stdout.write(JSON.stringify({ code: 0, data: { symbol: 'UNIT' } })));\n" +
      "token.command('traders').requiredOption('--chain <chain>').requiredOption('--address <address>').requiredOption('--order-by <order>').requiredOption('--direction <direction>').requiredOption('--limit <limit>').option('--raw').action(() => process.stdout.write(JSON.stringify({ code: 0, data: { list: [] } })));\n" +
      "program.parseAsync();\n",
    'utf8',
  );
  chmodSync(entry, 0o700);
  symlinkSync(
    join(process.cwd(), 'node_modules', 'commander'),
    join(packageRoot, 'node_modules', 'commander'),
    'dir',
  );
  symlinkSync('../gmgn-cli/dist/index.js', join(globalModules, '.bin', 'gmgn-cli'));
  symlinkSync(
    '../../.config/yarn/global/node_modules/.bin/gmgn-cli',
    join(yarnBin, 'gmgn-cli'),
  );
  return {
    calls: () => existsSync(callsPath)
      ? readFileSync(callsPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { args: string[] })
      : [],
    entry,
    executable: join(yarnBin, 'gmgn-cli'),
  };
};

const electronExecutable = (): string => process.platform === 'darwin'
  ? join(
      process.cwd(),
      'node_modules',
      'electron',
      'dist',
      'Electron.app',
      'Contents',
      'MacOS',
      'Electron',
    )
  : join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron');

const installWindowsYarnFixture = (
  fixture: ReturnType<typeof makeFixture>,
  options: { launcher?: string; entryTarget?: string } = {},
) => {
  const localAppData = join(fixture.root, 'Local App Data');
  const yarnBin = join(localAppData, 'Yarn', 'bin');
  const packageRoot = join(
    localAppData,
    'Yarn',
    'Data',
    'global',
    'node_modules',
    'gmgn-cli',
  );
  const entry = join(packageRoot, 'dist', 'index.js');
  const candidate = join(yarnBin, 'gmgn-cli.cmd');
  mkdirSync(yarnBin, { recursive: true });
  mkdirSync(join(packageRoot, 'dist'), { recursive: true });
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name: 'gmgn-cli', bin: { 'gmgn-cli': './dist/index.js' } }),
    'utf8',
  );
  writeFileSync(entry, '#!/usr/bin/env node\n', 'utf8');
  const relativeEntry = options.entryTarget ??
    '..\\Data\\global\\node_modules\\gmgn-cli\\dist\\index.js';
  const launcherEntry = relativeEntry.replaceAll('\\', '/');
  writeFileSync(
    candidate,
    options.launcher ?? `@echo off\r\nnode "${launcherEntry}" %*\r\n`,
    'utf8',
  );
  return {
    candidate,
    entry,
    localAppData,
    packageContainerRoot: join(
      localAppData,
      'Yarn',
      'Data',
      'global',
      'node_modules',
    ),
    packageRoot,
    yarnBin,
  };
};

const windowsServiceFor = (
  fixture: ReturnType<typeof makeFixture>,
  localAppData: string,
  pathValue: string,
  runProcess: CoinProcessRunner = async () => ({ stdout: '', stderr: '' }),
) => serviceFor(fixture, async () => ({ stdout: '', stderr: '' }), {
  platform: 'win32',
  processEnv: () => ({
    PATH: pathValue,
    LOCALAPPDATA: localAppData,
    LANG: 'en_US.UTF-8',
  }),
  nodeExecutable: 'C:\\Bitterless\\Electron.exe',
  runProcess,
});

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

test('finds an executable in the exact Yarn global bin when GUI PATH omits it', async () => {
  const fixture = makeFixture();
  const yarnBin = join(fixture.home, '.yarn', 'bin');
  const yarnExecutable = join(yarnBin, 'gmgn-cli');
  mkdirSync(yarnBin, { recursive: true });
  writeFileSync(yarnExecutable, '#!/bin/sh\n', 'utf8');
  chmodSync(yarnExecutable, 0o700);
  const requests: CoinProcessRequest[] = [];
  try {
    rmSync(fixture.executable);
    const service = serviceFor(
      fixture,
      async (request) => {
        requests.push(request);
        return { stdout: 'gmgn-cli 1.5.2\n', stderr: '' };
      },
      { processEnv: () => ({ PATH: fixture.bin, LANG: 'en_US.UTF-8' }) },
    );
    const status = await service.detect();
    assert.equal(status.installed, true);
    assert.equal(status.displayPath, '~/.yarn/bin/gmgn-cli');
    assert.equal(requests[0]?.command, yarnExecutable);
    assert.equal(requests[0]?.env.PATH, fixture.bin);
    assert.equal(requests[0]?.env.ELECTRON_RUN_AS_NODE, undefined);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('bootstraps a verified Commander Yarn entry under Electron without rewriting GMGN args', async (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX Yarn launcher contract');
    return;
  }
  const fixture = makeFixture();
  try {
    rmSync(fixture.executable);
    const yarnFixture = installYarnNodeFixture(fixture);
    const guiPath = '/usr/bin:/bin:/usr/sbin:/sbin';
    const appElectron = electronExecutable();
    assert.equal(existsSync(appElectron), true);
    const processRequests: CoinProcessRequest[] = [];
    const oldEnvironment = buildSanitizedGmgnEnv({}, fixture.home, guiPath);
    oldEnvironment.ELECTRON_RUN_AS_NODE = '1';
    await assert.rejects(
      runCoinProcess({
        command: appElectron,
        args: [realpathSync(yarnFixture.entry), ...GMGN_READ_ONLY_PROBE_ARGS],
        env: oldEnvironment,
        timeoutMs: 5_000,
        maxOutputBytes: 64 * 1024,
      }),
      (error) => error instanceof CoinProcessError && error.code === 'process-failed',
    );
    const service = serviceFor(fixture, async (nextRequest) => {
      processRequests.push(nextRequest);
      return await runCoinProcess(nextRequest);
    }, {
      processEnv: () => ({ PATH: guiPath, LANG: 'en_US.UTF-8' }),
      nodeExecutable: appElectron,
      now: Date.now,
    });

    const status = await service.detect();
    assert.equal(status.installed, true);
    assert.equal(status.version, '1.5.2');
    assert.equal(status.displayPath, '~/.yarn/bin/gmgn-cli');
    assert.equal((await service.saveApiKey({ apiKey: 'gmgn_unit_commander_fixture' })).ok, true);
    assert.equal((await service.verify()).code, 'verified');
    await service.read({
      operation: 'token-info',
      chain: 'bsc',
      address: '0x1111111111111111111111111111111111111111',
    });
    await service.read({
      operation: 'token-traders',
      chain: 'bsc',
      address: '0x1111111111111111111111111111111111111111',
      orderBy: 'profit',
      direction: 'desc',
      limit: 100,
    });

    const entry = realpathSync(yarnFixture.entry);
    const originalArguments = [
      ['--version'],
      ['--version'],
      [...GMGN_READ_ONLY_PROBE_ARGS],
      ['token', 'info', '--chain', 'bsc', '--address',
        '0x1111111111111111111111111111111111111111', '--raw'],
      ['token', 'traders', '--chain', 'bsc', '--address',
        '0x1111111111111111111111111111111111111111', '--order-by', 'profit',
        '--direction', 'desc', '--limit', '100', '--raw'],
    ];
    assert.deepEqual(
      processRequests.map(({ args }) => args),
      originalArguments.map((args) => [
        '--eval',
        GMGN_ELECTRON_NODE_BOOTSTRAP,
        entry,
        ...args,
      ]),
    );
    assert.deepEqual(yarnFixture.calls().slice(-5).map(({ args }) => args), originalArguments);
    assert.equal(processRequests.every(({ command }) => command === appElectron), true);
    const expectedEnvironment = buildSanitizedGmgnEnv(
      { PATH: guiPath, LANG: 'en_US.UTF-8' },
      fixture.home,
      guiPath,
    );
    expectedEnvironment.ELECTRON_RUN_AS_NODE = '1';
    assert.equal(processRequests.every(({ env }) => env.PATH === guiPath), true);
    assert.deepEqual(
      processRequests.map(({ env }) => env),
      processRequests.map(() => expectedEnvironment),
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('does not delegate an unverified Yarn env-node script to the app runtime', async (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX Yarn launcher contract');
    return;
  }
  const fixture = makeFixture();
  const yarnBin = join(fixture.home, '.yarn', 'bin');
  const yarnExecutable = join(yarnBin, 'gmgn-cli');
  mkdirSync(yarnBin, { recursive: true });
  writeFileSync(yarnExecutable, '#!/usr/bin/env node\nprocess.stdout.write("1.5.2")\n', 'utf8');
  chmodSync(yarnExecutable, 0o700);
  let calls = 0;
  try {
    rmSync(fixture.executable);
    const service = serviceFor(fixture, async () => {
      calls += 1;
      return { stdout: '1.5.2', stderr: '' };
    }, {
      processEnv: () => ({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }),
      nodeExecutable: process.execPath,
    });

    const status = await service.detect();

    assert.equal(status.installed, false);
    assert.equal(calls, 0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('maps only an exact Windows Yarn launcher to its contained declared entry', async () => {
  const fixture = makeFixture();
  try {
    rmSync(fixture.executable);
    const windowsFixture = installWindowsYarnFixture(fixture);
    const pathValue = `${windowsFixture.yarnBin};C:\\Windows\\System32`;
    const requests: CoinProcessRequest[] = [];
    const service = windowsServiceFor(
      fixture,
      windowsFixture.localAppData,
      pathValue,
      async (request) => {
        requests.push(request);
        return { stdout: 'gmgn-cli 1.5.2\n', stderr: '' };
      },
    );

    const status = await service.detect();
    const resolved = requests[0];

    assert.ok(resolved);
    assert.equal(status.installed, true);
    assert.equal(status.displayPath, windowsFixture.candidate);
    assert.equal(resolved.command, 'C:\\Bitterless\\Electron.exe');
    assert.deepEqual(resolved.args, [
      '--eval',
      GMGN_ELECTRON_NODE_BOOTSTRAP,
      realpathSync(windowsFixture.entry),
      '--version',
    ]);
    const expectedEnvironment = buildSanitizedGmgnEnv(
      { PATH: pathValue, LOCALAPPDATA: windowsFixture.localAppData, LANG: 'en_US.UTF-8' },
      fixture.home,
      pathValue,
    );
    expectedEnvironment.ELECTRON_RUN_AS_NODE = '1';
    assert.deepEqual(resolved.env, expectedEnvironment);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects blank, malicious, unrelated, and missing Windows cmd/package mappings', async () => {
  const cases: Array<{ name: string; mutate: (
    fixture: ReturnType<typeof makeFixture>,
    windowsFixture: ReturnType<typeof installWindowsYarnFixture>,
  ) => void }> = [
    {
      name: 'blank launcher',
      mutate: (_fixture, { candidate }) => writeFileSync(candidate, '@echo off\r\n', 'utf8'),
    },
    {
      name: 'malicious command',
      mutate: (_fixture, { candidate }) => writeFileSync(
        candidate,
        '@echo off\r\nnode "../Data/global/node_modules/gmgn-cli/dist/index.js" %*\r\ncalc.exe\r\n',
        'utf8',
      ),
    },
    {
      name: 'duplicate exact invocation',
      mutate: (_fixture, { candidate }) => writeFileSync(
        candidate,
        '@echo off\r\n' +
          'node "../Data/global/node_modules/gmgn-cli/dist/index.js" %*\r\n' +
          'node "../Data/global/node_modules/gmgn-cli/dist/index.js" %*\r\n',
        'utf8',
      ),
    },
    {
      name: 'unrelated entry',
      mutate: (fixture, { candidate }) => {
        const unrelated = join(fixture.root, 'unrelated.js');
        writeFileSync(unrelated, '#!/usr/bin/env node\n', 'utf8');
        writeFileSync(candidate, `@echo off\r\nnode "${unrelated}" %*\r\n`, 'utf8');
      },
    },
    {
      name: 'missing package',
      mutate: (_fixture, { entry }) => rmSync(entry),
    },
  ];

  for (const fixtureCase of cases) {
    const fixture = makeFixture();
    try {
      rmSync(fixture.executable);
      const windowsFixture = installWindowsYarnFixture(fixture);
      fixtureCase.mutate(fixture, windowsFixture);
      const service = windowsServiceFor(
        fixture,
        windowsFixture.localAppData,
        windowsFixture.yarnBin,
      );
      assert.equal((await service.detect()).installed, false, fixtureCase.name);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test('rejects a Windows package entry whose real path escapes its expected root', async () => {
  const fixture = makeFixture();
  try {
    rmSync(fixture.executable);
    const windowsFixture = installWindowsYarnFixture(fixture);
    const outsideEntry = join(fixture.root, 'outside-entry.js');
    writeFileSync(outsideEntry, '#!/usr/bin/env node\n', 'utf8');
    rmSync(windowsFixture.entry);
    symlinkSync(outsideEntry, windowsFixture.entry);
    const service = windowsServiceFor(
      fixture,
      windowsFixture.localAppData,
      windowsFixture.yarnBin,
    );

    assert.equal((await service.detect()).installed, false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects a whole Windows package root symlink that escapes the allowed container', async () => {
  const fixture = makeFixture();
  try {
    rmSync(fixture.executable);
    const windowsFixture = installWindowsYarnFixture(fixture);
    const outsidePackageRoot = join(fixture.root, 'outside-package-root');
    renameSync(windowsFixture.packageRoot, outsidePackageRoot);
    symlinkSync(outsidePackageRoot, windowsFixture.packageRoot, 'dir');
    const service = windowsServiceFor(
      fixture,
      windowsFixture.localAppData,
      windowsFixture.yarnBin,
    );

    assert.equal((await service.detect()).installed, false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('allows the exact Windows package container root to be relocated as one unit', async () => {
  const fixture = makeFixture();
  try {
    rmSync(fixture.executable);
    const windowsFixture = installWindowsYarnFixture(fixture);
    const relocatedContainerRoot = join(fixture.root, 'relocated-node-modules');
    renameSync(windowsFixture.packageContainerRoot, relocatedContainerRoot);
    symlinkSync(relocatedContainerRoot, windowsFixture.packageContainerRoot, 'dir');
    const requests: CoinProcessRequest[] = [];
    const service = windowsServiceFor(
      fixture,
      windowsFixture.localAppData,
      windowsFixture.yarnBin,
      async (request) => {
        requests.push(request);
        return { stdout: 'gmgn-cli 1.5.2\n', stderr: '' };
      },
    );

    const status = await service.detect();

    assert.equal(status.installed, true);
    assert.deepEqual(requests[0]?.args, [
      '--eval',
      GMGN_ELECTRON_NODE_BOOTSTRAP,
      realpathSync(windowsFixture.entry),
      '--version',
    ]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects a non-executable candidate in the exact Yarn global bin', async () => {
  const fixture = makeFixture();
  const yarnBin = join(fixture.home, '.yarn', 'bin');
  mkdirSync(yarnBin, { recursive: true });
  writeFileSync(join(yarnBin, 'gmgn-cli'), '#!/bin/sh\n', 'utf8');
  chmodSync(join(yarnBin, 'gmgn-cli'), 0o600);
  let calls = 0;
  try {
    rmSync(fixture.executable);
    const service = serviceFor(
      fixture,
      async () => {
        calls += 1;
        return { stdout: 'gmgn-cli 1.5.2\n', stderr: '' };
      },
      { processEnv: () => ({ PATH: fixture.bin, LANG: 'en_US.UTF-8' }) },
    );
    const status = await service.detect();
    assert.equal(status.installed, false);
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
  assert.deepEqual(buildGmgnReadArgs({
    operation: 'token-traders',
    chain: 'bsc',
    address: '0x1111111111111111111111111111111111111111',
    orderBy: 'profit',
    direction: 'desc',
    limit: 100,
  }), [
    'token', 'traders', '--chain', 'bsc',
    '--address', '0x1111111111111111111111111111111111111111',
    '--order-by', 'profit', '--direction', 'desc',
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
