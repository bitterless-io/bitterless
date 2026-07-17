#!/usr/bin/env node

import { writeFileSync } from 'node:fs';

const outputPath = process.env.BITTERLESS_MCP_CAPTURE_ARGV;
if (!outputPath) throw new Error('BITTERLESS_MCP_CAPTURE_ARGV is required');
if (process.env.ELECTRON_RUN_AS_NODE !== '1') {
  throw new Error('ELECTRON_RUN_AS_NODE=1 is required');
}

writeFileSync(outputPath, JSON.stringify(process.argv.slice(2)), 'utf8');
