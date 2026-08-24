#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const profile = process.env.CLAUDE_CONFIG_DIR;
const valid =
  process.argv[2] === 'auth' &&
  process.argv[3] === 'login' &&
  process.argv[4] === '--claudeai' &&
  profile &&
  process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR === profile &&
  process.env.ANTHROPIC_CONFIG_DIR === join(profile, 'anthropic') &&
  process.env.CLAUDE_CODE_OAUTH_TOKEN === undefined &&
  process.env.BROWSER === '/usr/bin/true';
if (!valid) process.exit(2);
writeFileSync(join(profile, 'fake-auth-login.pid'), String(process.pid), { mode: 0o600 });
process.stdout.write('fake auth login ready\n');
setInterval(() => undefined, 1_000);
