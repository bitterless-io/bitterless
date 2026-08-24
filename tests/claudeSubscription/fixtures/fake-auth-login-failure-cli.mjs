#!/usr/bin/env node

import { join } from 'node:path';

const profile = process.env.CLAUDE_CONFIG_DIR;
const valid =
  process.argv[2] === 'auth' &&
  process.argv[3] === 'login' &&
  process.argv[4] === '--claudeai' &&
  profile &&
  process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR === profile &&
  process.env.ANTHROPIC_CONFIG_DIR === join(profile, 'anthropic');
if (!valid) process.exit(2);
process.stdout.write('https://claude.com/oauth/authorize?client_id=fake\n');
process.stdout.write('sk-ant-oat01-token-shaped-output-is-never-captured\n');
process.exit(23);
