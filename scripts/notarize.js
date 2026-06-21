#!/usr/bin/env node

/**
 * notarize.js
 * Usage: node scripts/notarize.js [--dist <path>]
 *
 * Reads Apple credentials from local/signing.env or the overmind keychain fallback,
 * zips the .app bundle,
 * submits it to Apple notarytool (with auto-retry on network errors),
 * waits for the result (with auto-retry on signal/timeout), then staples
 * the ticket to the .app and any .dmg found in the same dist directory.
 *
 * Defaults to dist/mac-arm64 if --dist is not provided.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const keychainDir = process.env.BITTERLESS_KEYCHAIN_DIR || '/Users/ral/Documents/projects/overmind/areas/keychain/bitterless';
const keychainSigningEnvPath = process.env.BITTERLESS_SIGNING_ENV || path.join(keychainDir, 'signing.env');

// ── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const loadSigningEnv = () => {
  const localEnvPath = path.join(rootDir, 'local', 'signing.env');
  const envPath = fs.existsSync(localEnvPath)
    ? localEnvPath
    : keychainSigningEnvPath;
  if (!fs.existsSync(envPath)) {
    console.error('❌  signing env not found');
    process.exit(1);
  }
  const result = {};
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.*?)\s*$/);
    if (match) result[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return result;
};

const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (result.error) {
    console.error(`❌  Failed to launch: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal) {
    console.error(`❌  Process killed by signal: ${result.signal}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`❌  Command exited with code ${result.status}`);
    process.exit(result.status ?? 1);
  }
};

// ── Submit with retry ─────────────────────────────────────────────────────────

const SUBMIT_MAX_RETRIES = 6;
const SUBMIT_RETRY_DELAY_S = 20;

const submitWithRetry = (zipPath, appleId, appPassword, teamId) => {
  for (let attempt = 1; attempt <= SUBMIT_MAX_RETRIES; attempt++) {
    console.log(`\n▶  [submit ${attempt}/${SUBMIT_MAX_RETRIES}] xcrun notarytool submit ${path.basename(zipPath)} --output-format json`);

    const result = spawnSync(
      'xcrun',
      ['notarytool', 'submit', zipPath,
        '--apple-id', appleId,
        '--password', appPassword,
        '--team-id', teamId,
        '--output-format', 'json'],
      { stdio: ['inherit', 'pipe', 'inherit'], shell: false },
    );

    const stdout = result.stdout?.toString().trim() ?? '';

    if (result.error) {
      console.warn(`⚠️  Launch error: ${result.error.message}`);
    } else if (result.signal) {
      console.warn(`⚠️  Killed by signal: ${result.signal}`);
    } else if (result.status === 0 && stdout) {
      let submissionId;
      try {
        submissionId = JSON.parse(stdout).id;
      } catch (_) {
        const m = stdout.match(/id:\s+([a-f0-9-]+)/i);
        submissionId = m?.[1];
      }
      if (submissionId) {
        console.log(`✅  Submission ID: ${submissionId}`);
        return submissionId;
      }
      console.warn('⚠️  Submission succeeded but could not parse ID');
      console.warn(stdout);
    } else {
      console.warn(`⚠️  Exited with code ${result.status}`);
      if (stdout) console.warn(stdout);
    }

    if (attempt < SUBMIT_MAX_RETRIES) {
      console.log(`⏳  Retrying submit in ${SUBMIT_RETRY_DELAY_S}s …`);
      sleep(SUBMIT_RETRY_DELAY_S * 1000);
    }
  }

  console.error(`❌  Submit failed after ${SUBMIT_MAX_RETRIES} attempts`);
  process.exit(1);
};

// ── Wait with retry ───────────────────────────────────────────────────────────

const WAIT_MAX_RETRIES = 15;
const WAIT_RETRY_DELAY_S = 30;

const waitWithRetry = (submissionId, appleId, appPassword, teamId) => {
  console.log(`\nℹ️   Manual re-check: xcrun notarytool wait ${submissionId} --apple-id ${appleId} --password <redacted> --team-id ${teamId}`);

  for (let attempt = 1; attempt <= WAIT_MAX_RETRIES; attempt++) {
    console.log(`\n▶  [wait ${attempt}/${WAIT_MAX_RETRIES}] xcrun notarytool wait ${submissionId}`);

    const result = spawnSync(
      'xcrun',
      ['notarytool', 'wait', submissionId,
        '--apple-id', appleId,
        '--password', appPassword,
        '--team-id', teamId,
        '--output-format', 'json'],
      { stdio: ['inherit', 'pipe', 'inherit'], shell: false },
    );

    const stdout = result.stdout?.toString().trim() ?? '';

    // Parse status if available
    let status;
    if (stdout) {
      try {
        status = JSON.parse(stdout).status;
      } catch (_) {
        const m = stdout.match(/"status"\s*:\s*"([^"]+)"/);
        status = m?.[1];
      }
    }

    if (status) {
      console.log(`\n   Notarization status: ${status}`);
    }

    if (result.status === 0 && status === 'Accepted') {
      console.log('✅  Notarization accepted');
      return;
    }

    // Non-retryable: Apple explicitly rejected
    if (status === 'Invalid' || status === 'Rejected') {
      console.error(`❌  Notarization ${status} — fetching log …`);
      run('xcrun', ['notarytool', 'log', submissionId,
        '--apple-id', appleId,
        '--password', appPassword,
        '--team-id', teamId]);
      process.exit(1);
    }

    // Network/signal issue — retry
    if (result.error) {
      console.warn(`⚠️  Launch error: ${result.error.message}`);
    } else if (result.signal) {
      console.warn(`⚠️  Killed by signal: ${result.signal}`);
    } else {
      console.warn(`⚠️  Exited with code ${result.status}${status ? ` (status: ${status})` : ''}`);
      if (stdout && !status) console.warn(stdout);
    }

    if (attempt < WAIT_MAX_RETRIES) {
      console.log(`⏳  Retrying wait in ${WAIT_RETRY_DELAY_S}s …`);
      sleep(WAIT_RETRY_DELAY_S * 1000);
    }
  }

  console.error(`❌  Wait failed after ${WAIT_MAX_RETRIES} attempts`);
  process.exit(1);
};

// ── Parse CLI args ────────────────────────────────────────────────────────────

const parseArgs = () => {
  const args = process.argv.slice(2);
  let distDir = path.join(rootDir, 'dist', 'mac-arm64');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dist' && args[i + 1]) {
      distDir = path.resolve(args[i + 1]);
      i++;
    }
  }
  return { distDir };
};

// ── Main ──────────────────────────────────────────────────────────────────────

const main = () => {
  const { distDir } = parseArgs();

  if (!fs.existsSync(distDir)) {
    console.error(`❌  dist directory not found: ${distDir}`);
    process.exit(1);
  }

  const appEntry = fs.readdirSync(distDir).find((f) => f.endsWith('.app'));
  if (!appEntry) {
    console.error(`❌  No .app bundle found in: ${distDir}`);
    process.exit(1);
  }
  const appPath = path.join(distDir, appEntry);
  const appName = appEntry.replace(/\.app$/, '');
  const zipPath = path.join(distDir, `${appName}.zip`);

  console.log(`\n📦  App bundle : ${appPath}`);
  console.log(`📁  Dist dir   : ${distDir}`);

  const env = loadSigningEnv();
  const appleId = env.APPLE_ID;
  const appPassword = env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = env.APPLE_TEAM_ID;

  if (!appleId || !appPassword || !teamId) {
    console.error('❌  Missing one of APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID in signing env');
    process.exit(1);
  }

  console.log(`\n🔐  Apple ID   : ${appleId}`);
  console.log(`🏢  Team ID    : ${teamId}`);

  // 1. Create zip (skip if already exists)
  if (fs.existsSync(zipPath)) {
    console.log(`\n📦  Step 1/3 — Zip already exists, skipping: ${zipPath}`);
  } else {
    console.log('\n📦  Step 1/3 — Creating zip archive …');
    run('ditto', ['-c', '-k', '--keepParent', appPath, zipPath]);
    console.log(`✅  Created: ${zipPath}`);
  }

  // 2. Submit (with retry on network errors)
  console.log('\n🚀  Step 2/3 — Submitting to Apple notarytool …');
  const submissionId = submitWithRetry(zipPath, appleId, appPassword, teamId);

  // 3. Wait (with retry on signal/timeout)
  console.log('\n⏳  Step 3/4 — Waiting for notarization result …');
  waitWithRetry(submissionId, appleId, appPassword, teamId);

  // 4. Staple
  console.log('\n📎  Step 4/4 — Stapling ticket …');
  run('xcrun', ['stapler', 'staple', appPath]);
  console.log(`✅  Stapled: ${appEntry}`);

  const dmgEntry = fs.readdirSync(distDir).find((f) => f.endsWith('.dmg'));
  if (dmgEntry) {
    run('xcrun', ['stapler', 'staple', path.join(distDir, dmgEntry)]);
    console.log(`✅  Stapled: ${dmgEntry}`);
  }

  // Clean up zip
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
  console.log(`🗑️   Removed temp zip: ${zipPath}`);

  console.log('\n🎉  Notarization complete!\n');
};

main();
