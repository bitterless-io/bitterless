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
const tempDirectory = mkdtempSync(join(tmpdir(), 'bitterless-domain-catalog-'));

const ACTIVE_ID = '00000000000000000101';
const ARCHIVED_ID = '00000000000000000102';
const DELETED_ACTIVE_ID = '00000000000000000103';
const DELETED_ARCHIVED_ID = '00000000000000000104';
const MISSING_ID = '00000000000000000999';
const FIXED_TIME = 1784764800000;

const createDomain = ({
  id,
  title,
  description,
  archived,
  isDeleted,
  position
}) => {
  return {
    id,
    customer_id: 'customer-1',
    title,
    description,
    is_deleted: isDeleted,
    archived,
    position,
    created_at: FIXED_TIME + position,
    updated_at: FIXED_TIME + position + 100
  };
};

const state = {
  domains: [
    createDomain({
      id: ACTIVE_ID,
      title: 'MCU',
      description: 'Micromeet MCU product follow-ups',
      archived: 0,
      isDeleted: 0,
      position: 1
    }),
    createDomain({
      id: ARCHIVED_ID,
      title: 'Past work',
      description: 'Historical context only',
      archived: 1,
      isDeleted: 0,
      position: 2
    }),
    createDomain({
      id: DELETED_ACTIVE_ID,
      title: 'Deleted active',
      description: 'Must not be listed',
      archived: 0,
      isDeleted: 1,
      position: 3
    }),
    createDomain({
      id: DELETED_ARCHIVED_ID,
      title: 'Deleted archive',
      description: 'Must not be listed',
      archived: 1,
      isDeleted: 1,
      position: 4
    })
  ],
  persistDescriptionUpdate: true,
  updateCalls: []
};

const getDomains = async () => {
  return state.domains.map((domain) => ({ ...domain }));
};

const getDomainById = async ({ id }) => {
  const domain = state.domains.find((candidate) => candidate.id === id);
  return domain ? { ...domain } : undefined;
};

const updateDomainDescription = async ({ id, description }) => {
  state.updateCalls.push({ id, description });
  if (!state.persistDescriptionUpdate) return;
  const domain = state.domains.find((candidate) => candidate.id === id);
  if (!domain) return;
  domain.description = description;
  domain.updated_at += 1;
};

installMcpSourceHooks({
  projectRoot,
  userDataPath: tempDirectory,
  todoRepository: {
    getDomainById,
    getDomains,
    updateDomainDescription
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
      }, 5000);
      this.pending.set(id, { reject, resolve, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  callTool(name, args) {
    return this.request('tools/call', { name, arguments: args });
  }

  async close() {
    this.child.stdin.end();
    let timeout;
    const status = await Promise.race([
      new Promise((resolve) => {
        this.child.once('exit', (code, signal) => resolve({ code, signal }));
      }),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(null), 3000);
      })
    ]);
    clearTimeout(timeout);
    if (!status) this.child.kill('SIGKILL');
    assert.deepEqual(status, { code: 0, signal: null }, this.stderr);
  }
}

const assertDomainFields = (domain) => {
  const requiredFields = [
    'id',
    'customer_id',
    'title',
    'description',
    'is_deleted',
    'archived',
    'position',
    'created_at',
    'updated_at'
  ];
  for (const field of requiredFields) {
    assert.ok(Object.hasOwn(domain, field), `Domain result omitted ${field}`);
  }
  assert.match(domain.id, /^\d{20}$/);
  assert.equal(typeof domain.title, 'string');
  assert.equal(typeof domain.description, 'string');
};

const assertToolEnvelope = (result, toolName, verb) => {
  assert.deepEqual(result.content, [
    {
      type: 'text',
      text: `Bitterless ${toolName} ${verb}.`
    }
  ]);
  assert.ok(Object.hasOwn(result, 'structuredContent'));
};

const expectUpdateError = async (client, args, pattern, expectedUpdateDelta = 0) => {
  const before = state.updateCalls.length;
  await assert.rejects(client.callTool('domain.description.update', args), pattern);
  assert.equal(state.updateCalls.length, before + expectedUpdateDelta);
};

const server = new McpBridgeServer();
const bridgeEndpoint = getMcpBridgeEndpoint(tempDirectory);
const client = new PublicMcpClient(bridgeEndpoint.path);

try {
  await server.start(bridgeEndpoint);
  await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'domain-catalog-contract-test', version: '0.1.0' }
  });

  const listed = await client.request('tools/list', {});
  const domainListTool = listed.tools.find((tool) => tool.name === 'domain.list');
  const archivedListTool = listed.tools.find((tool) => tool.name === 'domain.archived.list');
  const updateDescriptionTool = listed.tools.find(
    (tool) => tool.name === 'domain.description.update'
  );
  assert.ok(domainListTool);
  assert.ok(archivedListTool);
  assert.ok(updateDescriptionTool);
  assert.deepEqual(domainListTool.inputSchema, {
    type: 'object',
    properties: {},
    additionalProperties: false
  });
  assert.deepEqual(archivedListTool.inputSchema, {
    type: 'object',
    properties: {},
    additionalProperties: false
  });
  assert.deepEqual(updateDescriptionTool.inputSchema, {
    type: 'object',
    required: ['id', 'description'],
    properties: {
      id: { type: 'string', pattern: '^\\d{20}$' },
      description: {
        type: 'string',
        maxLength: 500,
        description: 'Trimmed domain purpose and placement guidance. Use an empty string to clear it.'
      }
    },
    additionalProperties: false
  });
  assert.match(domainListTool.description, /default catalog/);
  assert.match(archivedListTool.description, /read-only historical context/);
  assert.match(updateDescriptionTool.description, /active, non-deleted/);

  const activeResult = await client.callTool('domain.list', {});
  assertToolEnvelope(activeResult, 'domain.list', 'completed');
  assert.deepEqual(activeResult.structuredContent.domains.map((domain) => domain.id), [ACTIVE_ID]);
  assertDomainFields(activeResult.structuredContent.domains[0]);
  assert.equal(
    activeResult.structuredContent.domains[0].description,
    'Micromeet MCU product follow-ups'
  );
  assert.equal(activeResult.structuredContent.focus.id, 'focus');
  assert.equal(typeof activeResult.structuredContent.focus.description, 'string');

  const archivedResult = await client.callTool('domain.archived.list', {});
  assertToolEnvelope(archivedResult, 'domain.archived.list', 'completed');
  assert.deepEqual(
    archivedResult.structuredContent.domains.map((domain) => domain.id),
    [ARCHIVED_ID]
  );
  assertDomainFields(archivedResult.structuredContent.domains[0]);
  assert.equal(archivedResult.structuredContent.domains[0].description, 'Historical context only');
  assert.equal(Object.hasOwn(archivedResult.structuredContent, 'focus'), false);

  await expectUpdateError(
    client,
    { id: '101', description: 'Invalid ID' },
    /id must be a 20-character decimal Snowflake string/
  );
  await expectUpdateError(
    client,
    { id: ACTIVE_ID },
    /description must be a string/
  );
  await expectUpdateError(
    client,
    { id: ARCHIVED_ID, description: 'Not allowed' },
    new RegExp(`Active domain not found: ${ARCHIVED_ID}`)
  );
  await expectUpdateError(
    client,
    { id: DELETED_ACTIVE_ID, description: 'Not allowed' },
    new RegExp(`Active domain not found: ${DELETED_ACTIVE_ID}`)
  );
  await expectUpdateError(
    client,
    { id: MISSING_ID, description: 'Not allowed' },
    new RegExp(`Active domain not found: ${MISSING_ID}`)
  );

  const trimmedResult = await client.callTool('domain.description.update', {
    id: ACTIVE_ID,
    description: '  MCU hardware and app integration work  '
  });
  assertToolEnvelope(trimmedResult, 'domain.description.update', 'succeeded');
  assert.equal(trimmedResult.structuredContent.domain.id, ACTIVE_ID);
  assert.equal(
    trimmedResult.structuredContent.domain.description,
    'MCU hardware and app integration work'
  );
  assertDomainFields(trimmedResult.structuredContent.domain);
  assert.deepEqual(state.updateCalls.at(-1), {
    id: ACTIVE_ID,
    description: 'MCU hardware and app integration work'
  });

  const maxDescription = 'x'.repeat(500);
  const maxResult = await client.callTool('domain.description.update', {
    id: ACTIVE_ID,
    description: maxDescription
  });
  assert.equal(maxResult.structuredContent.domain.description, maxDescription);
  await expectUpdateError(
    client,
    { id: ACTIVE_ID, description: 'x'.repeat(501) },
    /description can contain at most 500 characters/
  );

  const clearedResult = await client.callTool('domain.description.update', {
    id: ACTIVE_ID,
    description: '   '
  });
  assert.equal(clearedResult.structuredContent.domain.description, '');
  assert.deepEqual(state.updateCalls.at(-1), { id: ACTIVE_ID, description: '' });

  const activeDomain = state.domains.find((domain) => domain.id === ACTIVE_ID);
  activeDomain.description = 'Persisted before mismatch';
  state.persistDescriptionUpdate = false;
  await expectUpdateError(
    client,
    { id: ACTIVE_ID, description: 'Bridge must detect ignored writes' },
    /did not persist the requested active domain description/,
    1
  );
  assert.equal(activeDomain.description, 'Persisted before mismatch');

  console.log(
    '[domain-catalog-test] public schemas, catalog separation, description update, and reread validation passed'
  );
} finally {
  await client.close();
  await server.stop();
  rmSync(tempDirectory, { force: true, recursive: true });
}
