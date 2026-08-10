#!/usr/bin/env node

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMcpSourceHooks } from './fixtures/mcp-source-hooks.mjs';
import {
  MCP_LOCAL_RPC_MAX_BYTES,
  getMcpBridgeEndpoint
} from '../../src/shared/mcp/mcpBridge.shared.ts';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDirectory, '..', '..');
const helperFixture = join(scriptDirectory, 'fixtures', 'mcp-production-stdio.fixture.mjs');
const tempDirectory = mkdtempSync(join(tmpdir(), 'bitterless-trench-mcp-'));
const broadcasts = [];
const EVM_CA = `0x${'a'.repeat(40)}`;
const INDEX_WALLET = `0x${'1'.repeat(40)}`;
const NEGATIVE_WALLET = `0x${'2'.repeat(40)}`;

installMcpSourceHooks({
  projectRoot,
  userDataPath: tempDirectory,
  broadcasts,
  todoRepository: {},
  normalizeUndefinedXpcResultsToNull: true
});

const { McpBridgeServer } = await import('../../src/main/mcp/mcpBridge.server.ts');

class PublicMcpClient {
  constructor(bridgePath) {
    this.child = spawn(process.execPath, [helperFixture, tempDirectory, bridgePath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.stderr = '';
    this.child.stdout.on('data', (chunk) => this.handleStdout(chunk));
    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk;
    });
  }

  handleStdout(chunk) {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) {
        const response = JSON.parse(line);
        const pending = this.pending.get(response.id);
        assert.ok(pending, `Unexpected MCP response id: ${String(response.id)}`);
        this.pending.delete(response.id);
        clearTimeout(pending.timer);
        if (response.error) {
          pending.reject(Object.assign(new Error(response.error.message), response.error));
        } else {
          pending.resolve(response.result);
        }
      }
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  request(method, params) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 8000);
      this.pending.set(id, { reject, resolve, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async callTool(name, args) {
    const result = await this.request('tools/call', { name, arguments: args });
    return result.structuredContent;
  }

  async close() {
    this.child.stdin.end();
    let timeout;
    const status = await Promise.race([
      new Promise((resolve) =>
        this.child.once('exit', (code, signal) => resolve({ code, signal }))
      ),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(null), 3000);
      })
    ]);
    clearTimeout(timeout);
    if (!status) this.child.kill('SIGKILL');
    assert.deepEqual(status, { code: 0, signal: null }, this.stderr);
  }
}

const makeAnalysis = (id = 'mcp-analysis-1', generatedAt = '2026-08-08T10:00:00.000Z') => ({
  schema: 'bl-trench-ca-analysis-v1',
  analysisId: id,
  contractAddress: EVM_CA,
  generatedAt,
  source: {
    kind: 'agent',
    agent: 'mcp-contract-test',
    skill: 'bitterless-trench',
    providers: ['gmgn-token']
  },
  chains: [
    {
      chain: 'bsc',
      token: { name: 'Fixture BSC', symbol: 'FIX' },
      topProfitWallets: [
        {
          address: INDEX_WALLET,
          rank: 1,
          profitUsd: 12,
          winRate: 0.5,
          evidence: { provider: 'fixture' }
        }
      ],
      indexWalletExposure: [{ address: INDEX_WALLET, holding: true, balance: '5', valueUsd: 10 }],
      result: { status: 'fixture' }
    },
    {
      chain: 'robinhood',
      token: { name: 'Fixture Robinhood', symbol: 'FIX' },
      topProfitWallets: [],
      result: { status: 'fixture' }
    }
  ]
});

const server = new McpBridgeServer();
const bridgeEndpoint = getMcpBridgeEndpoint(tempDirectory);
const client = new PublicMcpClient(bridgeEndpoint.path);

try {
  await server.start(bridgeEndpoint);
  const initialized = await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'trench-contract-test', version: '0.1.0' }
  });
  assert.deepEqual(initialized.serverInfo, { name: 'bitterless', version: '0.2.0' });

  const listed = await client.request('tools/list', {});
  const trenchTools = listed.tools.filter((tool) => tool.name.startsWith('trench.'));
  assert.deepEqual(
    trenchTools.map((tool) => tool.name),
    [
      'trench.analysis.put',
      'trench.analysis.list',
      'trench.analysis.get',
      'trench.analysis.archive',
      'trench.index_wallet.list',
      'trench.index_wallet.get',
      'trench.negative_wallet.put',
      'trench.negative_wallet.list',
      'trench.negative_wallet.get',
      'trench.negative_wallet_holdings.put',
      'trench.negative_wallet_holdings.get',
      'trench.negative_wallet.archive'
    ]
  );
  for (const tool of trenchTools) {
    assert.equal(
      tool.inputSchema.additionalProperties,
      false,
      `${tool.name} must reject paths/extras`
    );
  }
  const negativePutTool = trenchTools.find((tool) => tool.name === 'trench.negative_wallet.put');
  assert.equal(negativePutTool.inputSchema.properties.explanation.maxLength, 2000);

  for (const toolName of [
    'trench.analysis.list',
    'trench.index_wallet.list',
    'trench.negative_wallet.list'
  ]) {
    for (const invalidArgs of [null, [], 'invalid', 1]) {
      await assert.rejects(client.callTool(toolName, invalidArgs), /params must be an object/);
    }
    const omittedArgs = await client.request('tools/call', { name: toolName });
    assert.equal(omittedArgs.structuredContent.total, 0);
  }

  const analysisPut = await client.callTool('trench.analysis.put', { record: makeAnalysis() });
  assert.equal(analysisPut.changed, true);
  assert.match(analysisPut.contentHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(analysisPut.record.chains.length, 2);
  assert.equal(readdirSync(join(tempDirectory, 'trench', 'analyses')).length, 1);

  const retry = await client.callTool('trench.analysis.put', { record: makeAnalysis() });
  assert.equal(retry.changed, false);
  assert.equal(retry.revision, analysisPut.revision);
  await assert.rejects(
    client.callTool('trench.analysis.put', {
      record: {
        ...makeAnalysis(),
        chains: [{ ...makeAnalysis().chains[0], result: { changed: true } }]
      }
    }),
    /IDEMPOTENCY_CONFLICT/
  );
  await assert.rejects(
    client.callTool('trench.analysis.get', { contractAddress: EVM_CA, path: '/tmp/foreign' }),
    /unknown argument: path/
  );

  const analysisList = await client.callTool('trench.analysis.list', {
    query: 'fixture',
    limit: 1
  });
  assert.equal(analysisList.items.length, 1);
  assert.equal(Object.hasOwn(analysisList.items[0], 'document'), false);
  const analysisGet = await client.callTool('trench.analysis.get', { contractAddress: EVM_CA });
  assert.equal(analysisGet.document, analysisPut.document);
  assert.equal(analysisGet.contentHash, analysisPut.contentHash);

  const indexList = await client.callTool('trench.index_wallet.list', { query: INDEX_WALLET });
  assert.equal(indexList.items.length, 1);
  assert.equal(Object.hasOwn(indexList.items[0], 'sources'), false);
  const indexGet = await client.callTool('trench.index_wallet.get', {
    chain: 'bsc',
    address: INDEX_WALLET,
    limit: 1
  });
  assert.equal(indexGet.items.length, 1);
  assert.equal(indexGet.items[0].analysisContentHash, analysisPut.contentHash);
  assert.equal(indexGet.items[0].evidenceAvailable, true);
  assert.equal(Object.hasOwn(indexGet.items[0], 'evidence'), false);

  const negativePut = await client.callTool('trench.negative_wallet.put', {
    requestId: 'negative-request-1',
    chain: 'bsc',
    address: NEGATIVE_WALLET,
    explanation: 'Human supplied\nnegative evidence.'
  });
  assert.equal(negativePut.changed, true);
  assert.equal(negativePut.tag.tagId, 'negative-request-1');
  const negativeList = await client.callTool('trench.negative_wallet.list', { query: 'negative' });
  assert.equal(negativeList.items.length, 1);
  const negativeGetBeforeHoldings = await client.callTool('trench.negative_wallet.get', {
    chain: 'bsc',
    address: NEGATIVE_WALLET
  });
  assert.equal(negativeGetBeforeHoldings.holdings, null);

  const holdingsPut = await client.callTool('trench.negative_wallet_holdings.put', {
    record: {
      schema: 'bl-trench-negative-wallet-holdings-v1',
      analysisId: 'negative-holdings-1',
      chain: 'bsc',
      address: NEGATIVE_WALLET,
      generatedAt: '2026-08-08T10:30:00.000Z',
      holdings: [{ contractAddress: EVM_CA, symbol: 'FIX', balance: '2', valueUsd: 4 }],
      result: { status: 'fixture' }
    }
  });
  assert.equal(holdingsPut.changed, true);
  const holdingsGet = await client.callTool('trench.negative_wallet_holdings.get', {
    chain: 'bsc',
    address: NEGATIVE_WALLET
  });
  assert.equal(holdingsGet.document, holdingsPut.document);
  const negativeGet = await client.callTool('trench.negative_wallet.get', {
    chain: 'bsc',
    address: NEGATIVE_WALLET
  });
  assert.equal(negativeGet.holdings.analysisId, 'negative-holdings-1');
  assert.equal(negativeGet.contentHash, holdingsPut.compositeContentHash);

  await assert.rejects(
    client.callTool('trench.negative_wallet.archive', {
      chain: 'bsc',
      address: NEGATIVE_WALLET,
      expectedTagId: negativePut.tag.tagId,
      expectedContentHash: negativeGetBeforeHoldings.contentHash
    }),
    /CONFLICT/
  );
  const negativeArchive = await client.callTool('trench.negative_wallet.archive', {
    chain: 'bsc',
    address: NEGATIVE_WALLET,
    expectedTagId: negativePut.tag.tagId,
    expectedContentHash: negativeGet.contentHash
  });
  assert.equal(negativeArchive.archived, true);
  await assert.rejects(
    client.callTool('trench.negative_wallet.get', { chain: 'bsc', address: NEGATIVE_WALLET }),
    /NOT_FOUND/
  );

  const analysisArchive = await client.callTool('trench.analysis.archive', {
    contractAddress: EVM_CA,
    expectedAnalysisId: analysisGet.record.analysisId,
    expectedContentHash: analysisGet.contentHash
  });
  assert.equal(analysisArchive.archived, true);
  assert.equal((await client.callTool('trench.analysis.list', {})).total, 0);
  assert.equal((await client.callTool('trench.index_wallet.list', {})).total, 0);

  assert.deepEqual(
    broadcasts.map((event) => event.name),
    [
      'trench/data-changed',
      'trench/data-changed',
      'trench/data-changed',
      'trench/data-changed',
      'trench/data-changed'
    ]
  );
  assert.deepEqual(
    broadcasts.map((event) => event.payload.operation),
    ['put', 'put', 'put', 'archive', 'archive']
  );

  const highEscapeResult = Object.fromEntries(
    Array.from({ length: 17 }, (_, index) => [`padding${index}`, '\\'.repeat(60_000)])
  );
  const largeAnalysis = makeAnalysis('mcp-analysis-near-transport-limit');
  largeAnalysis.chains = [
    {
      ...largeAnalysis.chains[0],
      result: highEscapeResult
    }
  ];
  const largePut = await client.callTool('trench.analysis.put', { record: largeAnalysis });
  const stdioResponseProbe = {
    jsonrpc: '2.0',
    id: 999,
    result: {
      content: [{ type: 'text', text: 'Stored Trench analysis.' }],
      structuredContent: largePut
    }
  };
  const transportBytes = Buffer.byteLength(JSON.stringify(stdioResponseProbe), 'utf8');
  assert(transportBytes > 5 * 1024 * 1024);
  assert(transportBytes < MCP_LOCAL_RPC_MAX_BYTES);
  assert(Buffer.byteLength(largePut.document, 'utf8') > 1_900_000);

  const helperSource = readFileSync(join(projectRoot, 'src/main/mcp/mcpStdio.helper.ts'), 'utf8');
  assert.doesNotMatch(helperSource, /from ['"](?:node:)?fs['"]/);
  assert.doesNotMatch(helperSource, /userData[^\n]*(?:trench|analyses|negative-wallets)/i);
  assert.doesNotMatch(helperSource, /TrenchRepository|trenchRepository/);
} finally {
  await client.close();
  await server.stop();
  rmSync(tempDirectory, { recursive: true, force: true });
}
