#!/usr/bin/env node

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMcpSourceHooks } from './mcp-source-hooks.mjs';

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(fixtureDirectory, '..', '..', '..');
const userDataPath = process.argv[2];
const explicitBridgePath = process.argv[3];

if (!userDataPath) {
  throw new Error('The MCP production stdio fixture requires a userData path');
}

installMcpSourceHooks({ projectRoot, userDataPath });

const { startBitterlessMcpStdioServer } = await import('../../../src/main/mcp/mcpStdio.helper.ts');
await startBitterlessMcpStdioServer(
  explicitBridgePath ? { transport: 'unix', path: explicitBridgePath } : undefined
);
