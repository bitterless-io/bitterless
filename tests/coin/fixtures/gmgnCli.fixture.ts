import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const GMGN_CLI_FIXTURE_ADDRESSES = {
  solana: 'So11111111111111111111111111111111111111112',
  bsc: '0x1111111111111111111111111111111111111111',
  robinhood: '0x2222222222222222222222222222222222222222',
  dual: '0x3333333333333333333333333333333333333333',
} as const;

export interface GmgnCliFixtureCall {
  args: string[];
}

export interface GmgnCliFixture {
  binDir: string;
  calls: () => GmgnCliFixtureCall[];
}

const executableSource = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const { join } = require('node:path');

const args = process.argv.slice(2);
appendFileSync(join(process.env.HOME, 'gmgn-calls.ndjson'), JSON.stringify({ args }) + '\\n');

const addresses = ${JSON.stringify(GMGN_CLI_FIXTURE_ADDRESSES)};
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : '';
};
const emit = (value) => process.stdout.write(JSON.stringify(value));

if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('gmgn-cli 1.5.2\\n');
  process.exit(0);
}

const [group, action] = args;
const chain = valueAfter('--chain');
const address = valueAfter('--address');
const fixtureChain = chain === 'sol' ? 'solana' : chain;
const expectedAddress = addresses[fixtureChain];
const identityMatched = Boolean(
  expectedAddress &&
  (address === expectedAddress ||
    (address === addresses.dual && (fixtureChain === 'bsc' || fixtureChain === 'robinhood')))
);

if (group === 'token' && action === 'info') {
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
  process.exit(0);
}

if (group === 'token' && action === 'security') {
  emit({ is_honeypot: false, buy_tax: 0, sell_tax: 0 });
  process.exit(0);
}

if (group === 'token' && action === 'holders') {
  emit({
    holder_count: 2,
    holders: [
      { address: 'fixture-holder-1', amount: 600, percentage: 6, addr_type: 0 },
      { address: 'fixture-holder-2', amount: 400, percentage: 4, addr_type: 0 },
    ],
  });
  process.exit(0);
}

if (group === 'token' && action === 'traders') {
  emit({ traders: [] });
  process.exit(0);
}

if (group === 'market' && (action === 'hot-searches' || action === 'trending')) {
  emit([]);
  process.exit(0);
}

process.stderr.write('Unexpected fixed GMGN fixture invocation.\\n');
process.exit(64);
`;

export const installGmgnCliFixture = (tempRoot: string, homeDir: string): GmgnCliFixture => {
  const binDir = join(tempRoot, 'gmgn-bin');
  const callsPath = join(homeDir, 'gmgn-calls.ndjson');
  const credentialDir = join(homeDir, '.config', 'gmgn');
  mkdirSync(binDir, { recursive: true, mode: 0o700 });
  mkdirSync(credentialDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(binDir, 'gmgn-cli'), executableSource, { mode: 0o700 });
  writeFileSync(
    join(credentialDir, '.env'),
    'GMGN_API_KEY=gmgn_e2e_dummy_read_only_not_a_secret\n',
    { mode: 0o600 },
  );
  if (process.platform !== 'win32') {
    chmodSync(binDir, 0o700);
    chmodSync(join(binDir, 'gmgn-cli'), 0o700);
    chmodSync(credentialDir, 0o700);
    chmodSync(join(credentialDir, '.env'), 0o600);
  }
  return {
    binDir,
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
