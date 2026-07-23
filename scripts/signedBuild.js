#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const signingEnvPath = path.join(rootDir, 'local', 'signing.env');
const keychainDir = process.env.BITTERLESS_KEYCHAIN_DIR || '/Users/ral/Documents/projects/overmind/areas/keychain/bitterless';
const keychainSigningEnvPath = process.env.BITTERLESS_SIGNING_ENV || path.join(keychainDir, 'signing.env');
const keychainCertificatePath = path.join(keychainDir, 'Certificates.p12');
const electronBuilderBin = path.join(
  rootDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder',
);

const auditCommand = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
console.log('[signedBuild.js] Running SQLite migration release gate');
const audit = spawnSync(auditCommand, ['audit:sqlite-migrations'], {
  stdio: 'inherit',
  cwd: rootDir,
  shell: process.platform === 'win32',
});
if (audit.status !== 0) process.exit(audit.status ?? 1);

console.log('[signedBuild.js] Running desktop application icon release gate');
const iconAudit = spawnSync(auditCommand, ['test:desktop-app-icon'], {
  stdio: 'inherit',
  cwd: rootDir,
  shell: process.platform === 'win32',
});
if (iconAudit.status !== 0) process.exit(iconAudit.status ?? 1);

const unwrapEnvValue = (value) => {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
};

const normalizeFilePath = (value) => {
  if (!value) return value;
  return value.replace(/^file:\/\//, '');
};

const loadSigningEnv = () => {
  const envPath = fs.existsSync(signingEnvPath)
    ? signingEnvPath
    : keychainSigningEnvPath;
  if (!fs.existsSync(envPath)) {
    console.warn('[signedBuild.js] ⚠️  signing env not found, building without signing credentials');
    return {};
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  const result = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.*?)\s*$/);
    if (match) result[match[1]] = unwrapEnvValue(match[2]);
  }
  if (result.CSC_LINK && !fs.existsSync(normalizeFilePath(result.CSC_LINK)) && fs.existsSync(keychainCertificatePath)) {
    console.warn('[signedBuild.js] ⚠️  CSC_LINK target not found, falling back to keychain Certificates.p12');
    result.CSC_LINK = keychainCertificatePath;
  }
  console.log(`[signedBuild.js] ✅ Loaded signing credentials from ${envPath}`);
  return result;
};

const args = process.argv.slice(2);
const targetsWindows = args.some((arg) => arg === '--win' || arg === '-w' || arg.startsWith('--win='));
const signingEnv = loadSigningEnv();
const env = { ...process.env, ...signingEnv };
if (targetsWindows) {
  delete env.CSC_LINK;
  delete env.CSC_KEY_PASSWORD;
  console.log('[signedBuild.js] Windows target: skipped generic Apple signing env vars');
}
const electronBuilderCommand = fs.existsSync(electronBuilderBin) ? electronBuilderBin : 'electron-builder';
if (process.platform === 'darwin' && !targetsWindows) {
  const retryPreloadPath = path.join(rootDir, 'scripts', 'codesignRetry.preload.js');
  const retryPreloadOption = `--require=${JSON.stringify(retryPreloadPath)}`;
  env.NODE_OPTIONS = [env.NODE_OPTIONS, retryPreloadOption].filter(Boolean).join(' ');
  console.log('[signedBuild.js] Enabled per-file Apple timestamp retry for codesign');
}
console.log(`[signedBuild.js] Running: ${electronBuilderCommand} ${args.join(' ')}`);

const result = spawnSync(electronBuilderCommand, args, {
  env,
  stdio: 'inherit',
  cwd: rootDir,
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
