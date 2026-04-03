#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const signingEnvPath = path.join(rootDir, 'local', 'signing.env');

const loadSigningEnv = () => {
  if (!fs.existsSync(signingEnvPath)) {
    console.warn('[signedBuild.js] ⚠️  local/signing.env not found, building without signing credentials');
    return {};
  }
  const content = fs.readFileSync(signingEnvPath, 'utf-8');
  const result = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.*?)\s*$/);
    if (match) result[match[1]] = match[2];
  }
  console.log('[signedBuild.js] ✅ Loaded signing credentials from local/signing.env');
  return result;
};

const signingEnv = loadSigningEnv();
const env = { ...process.env, ...signingEnv };

const args = process.argv.slice(2);
console.log(`[signedBuild.js] Running: electron-builder ${args.join(' ')}`);

const result = spawnSync('electron-builder', args, {
  env,
  stdio: 'inherit',
  cwd: rootDir,
  shell: true,
});

process.exit(result.status ?? 1);
