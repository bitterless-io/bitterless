import {
  chmodSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const GMGN_CLI_FIXTURE_ADDRESSES = {
  solana: 'So11111111111111111111111111111111111111112',
  bsc: '0x1111111111111111111111111111111111111111',
  robinhood: '0x2222222222222222222222222222222222222222',
  dual: '0x3333333333333333333333333333333333333333',
} as const;

export const GMGN_CLI_FIXTURE_BSC_BATCH = [
  '0x82ec31d69b3c289e541b50e30681fd1acad24444',
  '0x924fa68a0fc644485b8df8abfa0a41c2e7744444',
  '0x444416a582466fdae0f2fcdf0a859675f8ff6e9f',
  '0xd0bc8ab397851ecfa58009d03bbc1a41fc764444',
] as const;

export const GMGN_CLI_FIXTURE_AVATAR_URL =
  'https://bl-test-api.terncloud.com/auth/me';

export interface GmgnCliFixtureCall {
  args: string[];
}

export interface GmgnCliFixture {
  calls: () => GmgnCliFixtureCall[];
}

export const GMGN_CLI_FIXTURE_DESKTOP_PATH = process.platform === 'win32'
  ? process.env.PATH || ''
  : '/usr/bin:/bin:/usr/sbin:/sbin';

const executableSource = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const { join } = require('node:path');
const { Command } = require('commander');

const args = process.argv.slice(2);
appendFileSync(join(process.env.HOME, 'gmgn-calls.ndjson'), JSON.stringify({ args }) + '\\n');

const addresses = ${JSON.stringify(GMGN_CLI_FIXTURE_ADDRESSES)};
const bscBatch = ${JSON.stringify(GMGN_CLI_FIXTURE_BSC_BATCH)};
const emit = (value) => process.stdout.write(JSON.stringify(value));
const tokenIdentity = (options) => {
  const fixtureChain = options.chain === 'sol' ? 'solana' : options.chain;
  const expectedAddress = addresses[fixtureChain];
  const address = options.address;
  return {
    address,
    expectedAddress,
    fixtureChain,
    identityMatched: Boolean(
      expectedAddress &&
      (address === expectedAddress ||
        (fixtureChain === 'bsc' && bscBatch.includes(address.toLowerCase())) ||
        (address === addresses.dual && (fixtureChain === 'bsc' || fixtureChain === 'robinhood')))
    ),
  };
};
const emitTokenInfo = (options) => {
  const { address, expectedAddress, fixtureChain, identityMatched } = tokenIdentity(options);
  if (identityMatched) {
    const names = {
      solana: ['SOLE2E', 'Solana Fixture'],
      bsc: ['BSCE2E', 'BSC Fixture'],
      robinhood: ['RHE2E', 'Robinhood Fixture'],
    };
    const [symbol, name] = names[fixtureChain];
    emit({
      address,
      symbol,
      name,
      price_usd: 0.0123,
      market_cap_usd: 1230000,
      liquidity_usd: 456000,
    });
  } else {
    emit({ address: expectedAddress });
  }
};
const emitTokenSecurity = () => {
  emit({ is_honeypot: false, buy_tax: 0, sell_tax: 0 });
};
const emitTokenHolders = () => {
  emit({
    holder_count: 2,
    holders: [
      { address: 'fixture-holder-1', amount: 600, percentage: 6, addr_type: 0 },
      { address: 'fixture-holder-2', amount: 400, percentage: 4, addr_type: 0 },
    ],
  });
};
const emitTokenTraders = (options) => {
  const { fixtureChain } = tokenIdentity(options);
  const traders = fixtureChain === 'bsc' ? [
    {
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      rank: 1,
      profit: 18250.75,
      realized_profit: 17000,
      unrealized_profit: 1250.75,
      addr_type: 0,
      name: 'Fixture Alpha',
      avatar_url: ${JSON.stringify(GMGN_CLI_FIXTURE_AVATAR_URL)},
      twitter_username: 'fixture_alpha',
      wallet_score: 88,
    },
    {
      address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      rank: 2,
      profit: 9100,
      addr_type: 0,
      tags: ['market maker'],
    },
  ] : fixtureChain === 'solana' ? [
    {
      address: '7YWHMfk9JZe1LM1g1ZauHuiSxhJ7UsCb7vVxez2Mvwy',
      rank: 1,
      profit: 9500,
      realized_profit: 9000,
      unrealized_profit: 500,
      addr_type: 0,
      name: 'Fixture Sol Alpha',
    },
  ] : [];
  emit({ traders, list: traders });
};
const emitMarketList = () => {
  emit([]);
};
const collect = (value, previous) => previous.concat(value);
const addMarketReadOptions = (command) => command
  .requiredOption('--chain <chain>')
  .requiredOption('--limit <limit>')
  .option('--interval <interval>')
  .option('--type <type>', 'market type', collect, [])
  .option('--raw');
const addTokenReadOptions = (command) => command
  .requiredOption('--chain <chain>')
  .requiredOption('--address <address>')
  .option('--limit <limit>')
  .option('--order-by <order>')
  .option('--direction <direction>')
  .option('--raw');

const program = new Command().name('gmgn-cli').version('gmgn-cli 1.5.2');
const market = program.command('market');
addMarketReadOptions(market.command('trending')).action(emitMarketList);
addMarketReadOptions(market.command('hot-searches')).action(emitMarketList);
addMarketReadOptions(market.command('trenches')).action(emitMarketList);
const token = program.command('token');
addTokenReadOptions(token.command('info')).action(emitTokenInfo);
addTokenReadOptions(token.command('security')).action(emitTokenSecurity);
addTokenReadOptions(token.command('holders')).action(emitTokenHolders);
addTokenReadOptions(token.command('traders')).action(emitTokenTraders);
program.parseAsync();
`;

export const installGmgnCliFixture = (homeDir: string): GmgnCliFixture => {
  const yarnBinDir = process.platform === 'win32'
    ? join(homeDir, 'AppData', 'Local', 'Yarn', 'bin')
    : join(homeDir, '.yarn', 'bin');
  const globalModulesDir = process.platform === 'win32'
    ? join(homeDir, 'AppData', 'Local', 'Yarn', 'Data', 'global', 'node_modules')
    : join(homeDir, '.config', 'yarn', 'global', 'node_modules');
  const globalBinDir = join(globalModulesDir, '.bin');
  const packageRoot = join(globalModulesDir, 'gmgn-cli');
  const packageEntry = join(packageRoot, 'dist', 'index.js');
  const callsPath = join(homeDir, 'gmgn-calls.ndjson');
  const credentialDir = join(homeDir, '.config', 'gmgn');
  mkdirSync(yarnBinDir, { recursive: true, mode: 0o700 });
  mkdirSync(globalBinDir, { recursive: true, mode: 0o700 });
  mkdirSync(join(packageRoot, 'dist'), { recursive: true, mode: 0o700 });
  mkdirSync(join(packageRoot, 'node_modules'), { recursive: true, mode: 0o700 });
  mkdirSync(credentialDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: 'gmgn-cli',
      version: '1.5.2',
      bin: { 'gmgn-cli': './dist/index.js' },
    }),
    { mode: 0o600 },
  );
  writeFileSync(packageEntry, executableSource, { mode: 0o700 });
  symlinkSync(
    join(process.cwd(), 'node_modules', 'commander'),
    join(packageRoot, 'node_modules', 'commander'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  if (process.platform !== 'win32') {
    symlinkSync('../gmgn-cli/dist/index.js', join(globalBinDir, 'gmgn-cli'));
    symlinkSync(
      '../../.config/yarn/global/node_modules/.bin/gmgn-cli',
      join(yarnBinDir, 'gmgn-cli'),
    );
  } else {
    writeFileSync(
      join(yarnBinDir, 'gmgn-cli.cmd'),
      '@echo off\r\nnode "%~dp0\\..\\Data\\global\\node_modules\\gmgn-cli\\dist\\index.js" %*\r\n',
      { mode: 0o700 },
    );
  }
  writeFileSync(
    join(credentialDir, '.env'),
    'GMGN_API_KEY=gmgn_e2e_dummy_read_only_not_a_secret\n',
    { mode: 0o600 },
  );
  if (process.platform !== 'win32') {
    chmodSync(yarnBinDir, 0o700);
    chmodSync(globalBinDir, 0o700);
    chmodSync(packageRoot, 0o700);
    chmodSync(join(packageRoot, 'package.json'), 0o600);
    chmodSync(packageEntry, 0o700);
    chmodSync(credentialDir, 0o700);
    chmodSync(join(credentialDir, '.env'), 0o600);
  }
  return {
    calls: () => {
      try {
        return readFileSync(callsPath, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as GmgnCliFixtureCall);
      } catch {
        return [];
      }
    },
  };
};
