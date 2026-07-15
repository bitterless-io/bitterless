import { z } from 'zod';
import type {
  CoinCancelInput,
  CoinDiscoverInput,
  CoinMemeAnalyzeInput,
  CoinMonitorInput,
  CoinScreenerInput,
  CoinScreenerParseInput,
} from '@shared/coin/coinAnalysis.type';

const requestId = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9:_-]+$/);
const chain = z.enum(['robinhood', 'bsc', 'solana']);
const sourceMode = z.enum(['service', 'local_cli_rpc']);
const symbol = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,24}$/);
const launchStage = z.enum([
  'discovered',
  'filling',
  'near_graduation',
  'migration_pending',
  'graduated_recently',
  'dex_live',
  'cooled',
  'rejected',
  'stale',
]);
const filterComparable = z.union([z.string().max(200), z.number().finite()]);
const filterClause = z.object({
  field: z.string().trim().min(1).max(80),
  op: z.enum(['gte', 'lte', 'eq', 'between']),
  value: z.union([
    filterComparable,
    z.tuple([filterComparable, filterComparable]),
  ]),
}).strict();

const monitorSchema = z.object({
  requestId,
  symbols: z.array(symbol).min(1).max(50),
  connectLive: z.boolean(),
}).strict().transform((input) => ({
  ...input,
  symbols: [...new Set(input.symbols)],
}));

const screenerParseSchema = z.object({
  requestId,
  query: z.string().trim().min(1).max(2_000),
}).strict();

const screenerSchema = z.object({
  requestId,
  query: z.string().trim().max(2_000),
  mode: z.enum(['live_public', 'sample']),
  symbols: z.array(symbol).max(100),
  maxSymbols: z.number().int().min(1).max(500),
  limit: z.number().int().min(1).max(100),
  filters: z.array(filterClause).max(64),
}).strict().transform((input) => ({
  ...input,
  symbols: [...new Set(input.symbols)],
}));

const memeAnalyzeSchema = z.object({
  requestId,
  mode: sourceMode,
  chain,
  contractAddress: z.string().trim().min(1).max(160),
  holderLimit: z.number().int().min(10).max(100),
  traderLimit: z.number().int().min(10).max(100),
}).strict().superRefine((input, context) => {
  const valid = input.chain === 'solana'
    ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.contractAddress)
    : /^0x[0-9a-fA-F]{40}$/.test(input.contractAddress);
  if (!valid) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['contractAddress'],
      message: 'Contract address does not match the selected chain.',
    });
  }
});

const discoverSchema = z.object({
  mode: sourceMode,
  chain,
  stages: z.array(launchStage).min(1).max(9),
  windowMinutes: z.union([z.literal(15), z.literal(60), z.literal(360), z.literal(1440)]),
  limit: z.number().int().min(1).max(50),
  intervalSeconds: z.number().int().min(15).max(1800),
}).strict().superRefine((input, context) => {
  if (input.mode === 'local_cli_rpc' && input.intervalSeconds < 60) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['intervalSeconds'],
      message: 'Local CLI polling requires an interval of at least 60 seconds.',
    });
  }
});

const cancelSchema = z.object({ requestId }).strict();

export const parseMonitorInput = (value: unknown): CoinMonitorInput =>
  monitorSchema.parse(value) as CoinMonitorInput;

export const parseScreenerParseInput = (value: unknown): CoinScreenerParseInput =>
  screenerParseSchema.parse(value) as CoinScreenerParseInput;

export const parseScreenerInput = (value: unknown): CoinScreenerInput =>
  screenerSchema.parse(value) as CoinScreenerInput;

export const parseMemeAnalyzeInput = (value: unknown): CoinMemeAnalyzeInput =>
  memeAnalyzeSchema.parse(value) as CoinMemeAnalyzeInput;

export const parseDiscoverInput = (value: unknown): CoinDiscoverInput =>
  discoverSchema.parse(value) as CoinDiscoverInput;

export const parseCancelInput = (value: unknown): CoinCancelInput =>
  cancelSchema.parse(value) as CoinCancelInput;
