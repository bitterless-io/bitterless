#!/usr/bin/env node

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { installMcpSourceHooks } from './fixtures/mcp-source-hooks.mjs';
import {
  MCP_LOCAL_RPC_MAX_BYTES,
  getMcpBridgeEndpoint
} from '../../src/shared/mcp/mcpBridge.shared.ts';
import { ONLY_PREVIEW_MAX_ABSOLUTE_PATH_LENGTH } from '../../src/shared/onlypreview/onlyPreview.types.ts';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDirectory, '..', '..');
const helperFixture = join(scriptDirectory, 'fixtures', 'mcp-production-stdio.fixture.mjs');
const tempDirectory = mkdtempSync(join(tmpdir(), 'bitterless-preview-mcp-'));

installMcpSourceHooks({
  projectRoot,
  userDataPath: tempDirectory,
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
    if (Buffer.byteLength(this.buffer, 'utf8') > MCP_LOCAL_RPC_MAX_BYTES) {
      throw new Error('MCP fixture response exceeded the bridge byte limit');
    }
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

  callTool(name, args) {
    return this.request('tools/call', { name, arguments: args });
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

test('preview.open is one strict read-only MCP dispatch to the injected opener', async () => {
  const server = new McpBridgeServer();
  const endpoint = getMcpBridgeEndpoint(tempDirectory);
  const client = new PublicMcpClient(endpoint.path);
  const openedTargets = [];

  try {
    await server.start(endpoint);
    const listed = await client.request('tools/list', {});
    const previewTools = listed.tools.filter((tool) => tool.name.startsWith('preview.'));
    assert.equal(previewTools.length, 1);
    assert.equal(previewTools[0].name, 'preview.open');
    assert.deepEqual(previewTools[0].inputSchema.required, ['path']);
    assert.equal(previewTools[0].inputSchema.additionalProperties, false);
    assert.deepEqual(previewTools[0].inputSchema.properties.path, {
      type: 'string',
      minLength: 1,
      maxLength: ONLY_PREVIEW_MAX_ABSOLUTE_PATH_LENGTH
    });

    await assert.rejects(
      client.callTool('preview.open', { path: join(tempDirectory, 'before-injection') }),
      /Preview opener is unavailable/
    );

    server.configurePreviewOpener(async (target) => {
      openedTargets.push(target);
    });

    const overlongPath = `${parse(tempDirectory).root}${'x'.repeat(
      ONLY_PREVIEW_MAX_ABSOLUTE_PATH_LENGTH
    )}`;
    const invalidArguments = [
      undefined,
      null,
      [],
      {},
      { path: 7 },
      { path: '' },
      { path: '   ' },
      { path: 'relative/file.md' },
      { path: `${tempDirectory}\nfile.md` },
      { path: `${tempDirectory}\rfile.md` },
      { path: `${tempDirectory}\0file.md` },
      { path: overlongPath },
      { path: join(tempDirectory, 'file.md'), extra: true }
    ];
    for (const args of invalidArguments) {
      await assert.rejects(client.callTool('preview.open', args));
    }
    assert.deepEqual(openedTargets, []);

    const fileTarget = join(tempDirectory, 'artifact.md');
    const fileResult = await client.callTool('preview.open', { path: fileTarget });
    assert.deepEqual(fileResult.structuredContent, { opened: true });
    assert.equal(fileResult.content.length, 1);
    assert.doesNotMatch(JSON.stringify(fileResult), new RegExp(fileTarget.replaceAll('/', '\\/')));
    assert.deepEqual(openedTargets, [fileTarget]);

    const folderResult = await client.callTool('preview.open', { path: tempDirectory });
    assert.deepEqual(folderResult.structuredContent, { opened: true });
    assert.deepEqual(openedTargets, [fileTarget, tempDirectory]);

    server.configurePreviewOpener(async () => {
      throw new Error('fixture opener rejected');
    });
    await assert.rejects(
      client.callTool('preview.open', { path: join(tempDirectory, 'rejected') }),
      /fixture opener rejected/
    );
  } finally {
    await client.close();
    await server.stop();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
