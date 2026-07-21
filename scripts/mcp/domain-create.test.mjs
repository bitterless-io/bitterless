#!/usr/bin/env node

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMcpSourceHooks } from './fixtures/mcp-source-hooks.mjs';
import { getMcpBridgeEndpoint } from '../../src/shared/mcp/mcpBridge.shared.ts';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDirectory, '..', '..');
const helperFixture = join(scriptDirectory, 'fixtures', 'mcp-production-stdio.fixture.mjs');
const tempDirectory = mkdtempSync(join(tmpdir(), 'bitterless-domain-create-'));
const broadcasts = [];
const state = {
  createCalls: [],
  domains: [],
  getAllRaceProbe: null,
  nextId: 1
};

const releaseGetAllRaceProbe = (probe) => {
  if (probe.released) return;
  probe.released = true;
  clearTimeout(probe.timer);
  for (const resolve of probe.waiters) resolve();
  probe.waiters = [];
};

const getDomains = async () => {
  const snapshot = [...state.domains];
  const probe = state.getAllRaceProbe;
  if (probe && !probe.released) {
    probe.captureCount += 1;
    if (probe.captureCount >= 2) {
      releaseGetAllRaceProbe(probe);
    } else {
      await new Promise((resolve) => {
        probe.waiters.push(resolve);
        probe.timer = setTimeout(() => releaseGetAllRaceProbe(probe), 500);
      });
    }
  }
  return snapshot;
};

const createDomain = async (params) => {
  state.createCalls.push(params);
  const now = Date.now();
  const domain = {
    id: String(state.nextId).padStart(20, '0'),
    customer_id: '1',
    title: params.title,
    description: params.description,
    is_deleted: 0,
    archived: 0,
    position: state.domains.length,
    created_at: now,
    updated_at: now
  };
  state.nextId += 1;
  state.domains.push(domain);
  return domain;
};

installMcpSourceHooks({
  projectRoot,
  userDataPath: tempDirectory,
  broadcasts,
  todoRepository: {
    createDomain,
    getDomains
  }
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
        if (response.error)
          pending.reject(Object.assign(new Error(response.error.message), response.error));
        else pending.resolve(response.result);
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
      }, 5000);
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

const expectToolError = async (client, args, pattern) => {
  const beforeCreateCount = state.createCalls.length;
  const beforeBroadcastCount = broadcasts.length;
  await assert.rejects(client.callTool('domain.create', args), pattern);
  assert.equal(state.createCalls.length, beforeCreateCount);
  assert.equal(broadcasts.length, beforeBroadcastCount);
};

const activeDomain = (id) => {
  const now = Date.now();
  return {
    id: String(id).padStart(20, '0'),
    customer_id: '1',
    title: `Domain ${id}`,
    description: '',
    is_deleted: 0,
    archived: 0,
    position: id,
    created_at: now,
    updated_at: now
  };
};

const server = new McpBridgeServer();
const bridgeEndpoint = getMcpBridgeEndpoint(tempDirectory);
const client = new PublicMcpClient(bridgeEndpoint.path);

try {
  await server.start(bridgeEndpoint);
  await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'domain-create-contract-test', version: '0.1.0' }
  });

  const listed = await client.request('tools/list', {});
  const domainCreateTools = listed.tools.filter((tool) => tool.name === 'domain.create');
  assert.equal(domainCreateTools.length, 1);
  assert.deepEqual(domainCreateTools[0].inputSchema, {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string', maxLength: 500 }
    },
    additionalProperties: false
  });

  await expectToolError(client, { title: '   ' }, /title must be a non-empty string/);
  await expectToolError(client, { title: 7 }, /title must be a string/);
  await expectToolError(client, { title: 'x'.repeat(201) }, /at most 200 characters/);
  await expectToolError(
    client,
    { title: 'Others', description: 7 },
    /description must be a string/
  );
  await expectToolError(
    client,
    { title: 'Others', description: 'x'.repeat(501) },
    /at most 500 characters/
  );

  const created = await client.callTool('domain.create', {
    title: '  Others  ',
    description: '  General uncategorized work  '
  });
  assert.equal(created.domain.title, 'Others');
  assert.equal(created.domain.description, 'General uncategorized work');
  assert.equal(created.domain.archived, 0);
  assert.equal(created.domain.is_deleted, 0);
  assert.deepEqual(state.createCalls, [
    { title: 'Others', description: 'General uncategorized work' }
  ]);
  assert.deepEqual(broadcasts, []);

  state.domains = [
    ...Array.from({ length: 16 }, (_, index) => activeDomain(index + 1)),
    { ...activeDomain(17), archived: 1 },
    { ...activeDomain(18), is_deleted: 1 }
  ];
  state.nextId = 19;
  state.createCalls = [];
  broadcasts.length = 0;
  state.getAllRaceProbe = {
    captureCount: 0,
    released: false,
    timer: null,
    waiters: []
  };

  const concurrentCreates = await Promise.allSettled([
    client.callTool('domain.create', { title: 'Concurrent A' }),
    client.callTool('domain.create', { title: 'Concurrent B' })
  ]);
  const successfulCreates = concurrentCreates.filter((result) => result.status === 'fulfilled');
  const failedCreates = concurrentCreates.filter((result) => result.status === 'rejected');
  assert.equal(successfulCreates.length, 1);
  assert.equal(failedCreates.length, 1);
  assert.match(failedCreates[0].reason.message, /active domain limit is 17/);
  assert.equal(state.getAllRaceProbe.captureCount, 1);
  state.getAllRaceProbe = null;
  assert.equal(state.createCalls.length, 1);
  assert.equal(broadcasts.length, 0);
  assert.equal(state.domains.filter((domain) => domain.archived === 0 && domain.is_deleted === 0).length, 17);

  const domainToArchive = state.domains.find(
    (domain) => domain.archived === 0 && domain.is_deleted === 0
  );
  domainToArchive.archived = 1;
  await client.callTool('domain.create', { title: 'After rejected create' });
  assert.equal(state.domains.filter((domain) => domain.archived === 0 && domain.is_deleted === 0).length, 17);

  console.log(
    '[domain-create-test] public schema, validation, serialized active limit, and recovery passed'
  );
} finally {
  await client.close();
  await server.stop();
  rmSync(tempDirectory, { force: true, recursive: true });
}
