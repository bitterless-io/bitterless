import {
  TRENCH_CA_ANALYSIS_SCHEMA,
  TRENCH_CHAINS,
  TRENCH_NEGATIVE_WALLET_HOLDINGS_SCHEMA
} from '@shared/trench/trench.type';
import {
  TRENCH_MAX_ANALYSIS_ID_LENGTH,
  TRENCH_MAX_ARRAY_LENGTH,
  TRENCH_MAX_EXPLANATION_LENGTH,
  TRENCH_MAX_LIST_LIMIT
} from '@shared/trench/trench.validation';

interface TrenchMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const chainSchema = { type: 'string', enum: TRENCH_CHAINS } as const;
const addressSchema = { type: 'string', minLength: 32, maxLength: 44 } as const;
const requestIdSchema = {
  type: 'string',
  minLength: 1,
  maxLength: TRENCH_MAX_ANALYSIS_ID_LENGTH
} as const;
const contentHashSchema = {
  type: 'string',
  pattern: '^sha256:[0-9a-f]{64}$'
} as const;
const evidenceSchema = {
  type: 'object',
  additionalProperties: true
} as const;
const listProperties = {
  query: { type: 'string', maxLength: 200 },
  cursor: { type: 'string', minLength: 1, maxLength: 4096 },
  limit: { type: 'integer', minimum: 1, maximum: TRENCH_MAX_LIST_LIMIT, default: 50 }
} as const;

const sourceSchema = {
  type: 'object',
  required: ['kind', 'providers'],
  properties: {
    kind: { type: 'string', enum: ['agent', 'legacy-coin-state'] },
    agent: { type: 'string', minLength: 1, maxLength: 200 },
    skill: { type: 'string', minLength: 1, maxLength: 200 },
    providers: {
      type: 'array',
      maxItems: 32,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 200 }
    }
  },
  additionalProperties: false
} as const;

const walletExposureSchema = {
  type: 'object',
  required: ['address', 'holding'],
  properties: {
    address: addressSchema,
    holding: { type: ['boolean', 'null'] },
    balance: { type: 'string', minLength: 1, maxLength: 256 },
    sharePercent: { type: 'number', minimum: 0, maximum: 100 },
    valueUsd: { type: 'number', minimum: 0 },
    evidence: evidenceSchema
  },
  additionalProperties: false
} as const;

const topProfitWalletSchema = {
  type: 'object',
  required: ['address', 'rank'],
  properties: {
    address: addressSchema,
    rank: { type: 'integer', minimum: 1, maximum: 100 },
    profitUsd: { type: 'number' },
    winRate: { type: 'number', minimum: 0, maximum: 1 },
    evidence: evidenceSchema
  },
  additionalProperties: false
} as const;

const chainAnalysisSchema = {
  type: 'object',
  required: ['chain', 'topProfitWallets', 'result'],
  properties: {
    chain: chainSchema,
    token: {
      type: 'object',
      properties: {
        name: { type: 'string', maxLength: 200 },
        symbol: { type: 'string', maxLength: 64 }
      },
      additionalProperties: false
    },
    topProfitWallets: {
      type: 'array',
      maxItems: 100,
      items: topProfitWalletSchema
    },
    indexWalletExposure: {
      type: 'array',
      maxItems: TRENCH_MAX_ARRAY_LENGTH,
      items: walletExposureSchema
    },
    negativeWalletExposure: {
      type: 'array',
      maxItems: TRENCH_MAX_ARRAY_LENGTH,
      items: walletExposureSchema
    },
    result: evidenceSchema
  },
  additionalProperties: false
} as const;

const analysisRecordSchema = {
  type: 'object',
  required: ['schema', 'analysisId', 'contractAddress', 'generatedAt', 'source', 'chains'],
  properties: {
    schema: { const: TRENCH_CA_ANALYSIS_SCHEMA },
    analysisId: requestIdSchema,
    contractAddress: addressSchema,
    generatedAt: { type: 'string', minLength: 1, maxLength: 64 },
    source: sourceSchema,
    chains: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: chainAnalysisSchema
    }
  },
  additionalProperties: false
} as const;

const holdingSchema = {
  type: 'object',
  properties: {
    contractAddress: addressSchema,
    symbol: { type: 'string', minLength: 1, maxLength: 200 },
    balance: { type: 'string', minLength: 1, maxLength: 256 },
    valueUsd: { type: 'number', minimum: 0 },
    portfolioPercent: { type: 'number', minimum: 0, maximum: 100 },
    evidence: evidenceSchema
  },
  additionalProperties: false
} as const;

const holdingsRecordSchema = {
  type: 'object',
  required: ['schema', 'analysisId', 'chain', 'address', 'generatedAt', 'holdings', 'result'],
  properties: {
    schema: { const: TRENCH_NEGATIVE_WALLET_HOLDINGS_SCHEMA },
    analysisId: requestIdSchema,
    chain: chainSchema,
    address: addressSchema,
    generatedAt: { type: 'string', minLength: 1, maxLength: 64 },
    holdings: {
      type: 'array',
      maxItems: TRENCH_MAX_ARRAY_LENGTH,
      items: holdingSchema
    },
    result: evidenceSchema
  },
  additionalProperties: false
} as const;

export const TRENCH_MCP_TOOLS: TrenchMcpToolDefinition[] = [
  {
    name: 'trench.analysis.put',
    description:
      'Persist one canonical CA analysis document in Bitterless Main. Exact analysisId/content retries are idempotent; older or equal replacement times require replaceNewer=true.',
    inputSchema: {
      type: 'object',
      required: ['record'],
      properties: {
        record: analysisRecordSchema,
        replaceNewer: { type: 'boolean', default: false }
      },
      additionalProperties: false
    }
  },
  {
    name: 'trench.analysis.list',
    description:
      'List bounded CA analysis metadata from the active Trench vault. Full JSON is available only through trench.analysis.get.',
    inputSchema: { type: 'object', properties: listProperties, additionalProperties: false }
  },
  {
    name: 'trench.analysis.get',
    description:
      'Get one CA analysis by contract address, including its parsed record, exact canonical document, content hash, and current exposure-reference status.',
    inputSchema: {
      type: 'object',
      required: ['contractAddress'],
      properties: { contractAddress: addressSchema },
      additionalProperties: false
    }
  },
  {
    name: 'trench.analysis.archive',
    description:
      'Archive one active CA analysis after an explicit human request and an exact analysisId/contentHash compare-and-swap. V1 has no MCP restore.',
    inputSchema: {
      type: 'object',
      required: ['contractAddress', 'expectedAnalysisId', 'expectedContentHash'],
      properties: {
        contractAddress: addressSchema,
        expectedAnalysisId: requestIdSchema,
        expectedContentHash: contentHashSchema
      },
      additionalProperties: false
    }
  },
  {
    name: 'trench.index_wallet.list',
    description:
      'List bounded summaries from the positive Index Wallet dictionary derived from active CA top-profit wallets.',
    inputSchema: { type: 'object', properties: listProperties, additionalProperties: false }
  },
  {
    name: 'trench.index_wallet.get',
    description:
      'Page bounded source-CA provenance for one derived Index Wallet. Flexible evidence remains in trench.analysis.get.',
    inputSchema: {
      type: 'object',
      required: ['chain', 'address'],
      properties: {
        chain: chainSchema,
        address: addressSchema,
        cursor: listProperties.cursor,
        limit: listProperties.limit
      },
      additionalProperties: false
    }
  },
  {
    name: 'trench.negative_wallet.put',
    description:
      'Create or explicitly correct a human-supplied Negative Wallet tag. requestId is the idempotency key and Bitterless Main owns timestamps.',
    inputSchema: {
      type: 'object',
      required: ['requestId', 'chain', 'address', 'explanation'],
      properties: {
        requestId: requestIdSchema,
        chain: chainSchema,
        address: addressSchema,
        explanation: {
          type: 'string',
          minLength: 1,
          maxLength: TRENCH_MAX_EXPLANATION_LENGTH
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'trench.negative_wallet.list',
    description: 'List bounded active Negative Wallet metadata and holdings availability.',
    inputSchema: { type: 'object', properties: listProperties, additionalProperties: false }
  },
  {
    name: 'trench.negative_wallet.get',
    description:
      'Get one Negative Wallet tag, holdings status, exact tag document, and composite tag-plus-holdings hash.',
    inputSchema: {
      type: 'object',
      required: ['chain', 'address'],
      properties: { chain: chainSchema, address: addressSchema },
      additionalProperties: false
    }
  },
  {
    name: 'trench.negative_wallet_holdings.put',
    description:
      'Persist a separate holdings document for one currently live Negative Wallet tag, with CA-style idempotency and stale-write rules.',
    inputSchema: {
      type: 'object',
      required: ['record'],
      properties: {
        record: holdingsRecordSchema,
        replaceNewer: { type: 'boolean', default: false }
      },
      additionalProperties: false
    }
  },
  {
    name: 'trench.negative_wallet_holdings.get',
    description:
      'Get the separate holdings record, exact canonical document, and byte content hash for one Negative Wallet.',
    inputSchema: {
      type: 'object',
      required: ['chain', 'address'],
      properties: { chain: chainSchema, address: addressSchema },
      additionalProperties: false
    }
  },
  {
    name: 'trench.negative_wallet.archive',
    description:
      'Atomically archive one Negative Wallet directory after an explicit human request and exact tagId/composite-hash compare-and-swap. V1 has no MCP restore.',
    inputSchema: {
      type: 'object',
      required: ['chain', 'address', 'expectedTagId', 'expectedContentHash'],
      properties: {
        chain: chainSchema,
        address: addressSchema,
        expectedTagId: requestIdSchema,
        expectedContentHash: contentHashSchema
      },
      additionalProperties: false
    }
  }
];
