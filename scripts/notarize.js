#!/usr/bin/env node

/**
 * Reusable macOS application and DMG notarization.
 *
 * Electron Builder loads the named `afterSign` export. The CLI can independently
 * retry an already signed application or DMG without rebuilding:
 *
 *   node scripts/notarize.js --dist dist/mac-arm64
 *   node scripts/notarize.js --file dist/mac-arm64/Bitterless.app
 *   node scripts/notarize.js --file dist/Bitterless-0.0.49.dmg
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const keychainDir = process.env.BITTERLESS_KEYCHAIN_DIR || '/Users/ral/Documents/projects/overmind/areas/keychain/bitterless';
const keychainSigningEnvPath = process.env.BITTERLESS_SIGNING_ENV || path.join(keychainDir, 'signing.env');
const SUBMIT_RETRY_DELAYS_MS = [30_000, 120_000, 300_000];
const WAIT_RETRY_DELAYS_MS = [30_000, 60_000, 120_000];
const NETWORK_FAILURE_PATTERNS = [
  /\babortedUpload\b/i,
  /\bdeadlineExceeded\b/i,
  /\bHTTPClientError\b/i,
  /\bSotoS3\b/i,
  /\bNetwork\.NWError\b/i,
  /\bNSURLError\b/i,
  /\bECONN(?:ABORTED|RESET|REFUSED)\b/i,
  /\bE(?:AI_AGAIN|HOSTUNREACH|NETDOWN|NETUNREACH|PIPE|TIMEDOUT)\b/i,
  /\bconnection (?:was )?(?:closed|lost|reset|timed out)\b/i,
  /\bcould not connect\b/i,
  /\bnetwork connection was lost\b/i,
  /\brequest timed out\b/i,
  /\boperation timed out\b/i,
  /\bdeadline exceeded\b/i,
  /\bTLS handshake\b/i,
  /\bHTTP(?: response| status(?: code)?)?[^0-9]*(?:500|502|503|504)\b/i,
];

const timestamp = () => new Date().toISOString();

const log = (level, message) => {
  const writer = level === 'error'
    ? console.error
    : level === 'warn'
      ? console.warn
      : console.log;
  writer(`[${timestamp()}] [notarize] ${message}`);
};

const delay = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const unwrapEnvValue = (value) => {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
};

const parseEnvFile = (filePath) => {
  const result = {};
  if (!fs.existsSync(filePath)) return result;
  for (const line of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.*?)\s*$/);
    if (match) result[match[1]] = unwrapEnvValue(match[2]);
  }
  return result;
};

const loadSigningCredentials = () => {
  const localEnvPath = path.join(rootDir, 'local', 'signing.env');
  const envPath = fs.existsSync(localEnvPath)
    ? localEnvPath
    : keychainSigningEnvPath;
  const fileEnv = parseEnvFile(envPath);
  const credentials = {
    appleId: process.env.APPLE_ID || fileEnv.APPLE_ID,
    appPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD || fileEnv.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID || fileEnv.APPLE_TEAM_ID,
  };
  if (!credentials.appleId || !credentials.appPassword || !credentials.teamId) {
    throw new Error('Missing APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID in signing environment');
  }
  return credentials;
};

const redact = (value, sensitiveValues) => {
  let result = String(value ?? '');
  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue) result = result.split(sensitiveValue).join('<redacted>');
  }
  return result;
};

const createLineWriter = (streamName, sensitiveValues) => {
  let buffer = '';
  const writeLine = (line) => {
    const output = redact(line, sensitiveValues).trimEnd();
    if (output) log('info', `${streamName}: ${output}`);
  };
  return {
    write: (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split(/\r\n|\n|\r/);
      buffer = lines.pop() ?? '';
      for (const line of lines) writeLine(line);
    },
    flush: () => {
      if (buffer) writeLine(buffer);
      buffer = '';
    },
  };
};

const runStreamingCommand = ({
  command,
  args,
  label,
  sensitiveValues = [],
}) => {
  log('info', label);
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let spawnError = null;
    const stdoutWriter = createLineWriter('stdout', sensitiveValues);
    const stderrWriter = createLineWriter('stderr', sensitiveValues);
    let child;
    try {
      child = spawn(command, args, {
        cwd: rootDir,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({
        status: null,
        signal: null,
        error,
        stdout,
        stderr,
      });
      return;
    }

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      stdoutWriter.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      stderrWriter.write(chunk);
    });
    child.on('error', (error) => {
      spawnError = error;
    });
    child.on('close', (status, signal) => {
      stdoutWriter.flush();
      stderrWriter.flush();
      resolve({
        status,
        signal,
        error: spawnError,
        stdout,
        stderr,
      });
    });
  });
};

const resultText = (result) => {
  return [
    result.error?.code,
    result.error?.message,
    result.stdout,
    result.stderr,
    result.signal,
  ].filter(Boolean).join('\n');
};

const isTransientNetworkFailure = (result) => {
  const output = resultText(result);
  return NETWORK_FAILURE_PATTERNS.some((pattern) => pattern.test(output));
};

const createCommandError = (label, result, sensitiveValues = []) => {
  const reason = result.error?.message
    || (result.signal ? `signal ${result.signal}` : `exit code ${result.status ?? 1}`);
  const output = redact(resultText(result), sensitiveValues).trim();
  return new Error(`${label} failed with ${reason}${output ? `: ${output}` : ''}`);
};

const assertCommandSucceeded = (label, result, sensitiveValues = []) => {
  if (result.status === 0 && !result.error && !result.signal) return;
  throw createCommandError(label, result, sensitiveValues);
};

const credentialArgs = (credentials) => {
  return [
    '--apple-id',
    credentials.appleId,
    '--password',
    credentials.appPassword,
    '--team-id',
    credentials.teamId,
  ];
};

const credentialValues = (credentials) => {
  return [credentials.appleId, credentials.appPassword, credentials.teamId];
};

const parseSubmissionId = (output) => {
  const normalized = output.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
  const matches = [
    ...normalized.matchAll(/\bid\s*:\s*"?([0-9a-f]{8}-[0-9a-f-]{27,})"?/gi),
  ];
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
};

const parseNotarizationStatus = (output) => {
  const normalized = output.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
  const matches = [
    ...normalized.matchAll(/"?status"?\s*:\s*"?(Accepted|Invalid|Rejected|In Progress)"?/gi),
  ];
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
};

const retryDelayFor = (delays, attemptIndex) => {
  return delays[attemptIndex] ?? null;
};

const submitWithRetry = async (artifactPath, credentials) => {
  const sensitiveValues = credentialValues(credentials);
  const maxAttempts = SUBMIT_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log('info', `submit attempt ${attempt}/${maxAttempts}: ${path.basename(artifactPath)} (S3 acceleration enabled)`);
    const result = await runStreamingCommand({
      command: 'xcrun',
      args: [
        'notarytool',
        'submit',
        artifactPath,
        ...credentialArgs(credentials),
        '--s3-acceleration',
        '--output-format',
        'normal',
        '--progress',
        '--verbose',
      ],
      label: `starting notarytool submit attempt ${attempt}/${maxAttempts}`,
      sensitiveValues,
    });
    const submissionId = parseSubmissionId(`${result.stdout}\n${result.stderr}`);
    if (result.status === 0 && !result.error && !result.signal) {
      if (!submissionId) {
        throw new Error('notarytool submit succeeded but did not return a submission ID');
      }
      log('info', `submission ID: ${submissionId}`);
      return submissionId;
    }

    const retryDelayMs = retryDelayFor(SUBMIT_RETRY_DELAYS_MS, attempt - 1);
    if (!isTransientNetworkFailure(result) || retryDelayMs === null) {
      throw createCommandError('notarytool submit', result, sensitiveValues);
    }
    log('warn', `transient submit transport failure; retrying upload in ${retryDelayMs / 1000}s`);
    await delay(retryDelayMs);
  }
  throw new Error('notarytool submit exhausted its bounded retry attempts');
};

const fetchNotarizationLog = async (submissionId, credentials) => {
  const sensitiveValues = credentialValues(credentials);
  const result = await runStreamingCommand({
    command: 'xcrun',
    args: [
      'notarytool',
      'log',
      submissionId,
      ...credentialArgs(credentials),
    ],
    label: `fetching Apple notarization log for ${submissionId}`,
    sensitiveValues,
  });
  if (result.status !== 0 || result.error || result.signal) {
    log('warn', redact(`could not fetch notarization log: ${resultText(result)}`, sensitiveValues));
  }
};

const waitWithRetry = async (submissionId, credentials) => {
  const sensitiveValues = credentialValues(credentials);
  const maxAttempts = WAIT_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log('info', `wait attempt ${attempt}/${maxAttempts} for submission ${submissionId}`);
    const result = await runStreamingCommand({
      command: 'xcrun',
      args: [
        'notarytool',
        'wait',
        submissionId,
        ...credentialArgs(credentials),
        '--timeout',
        '30m',
        '--output-format',
        'normal',
        '--progress',
        '--verbose',
      ],
      label: `starting notarytool wait attempt ${attempt}/${maxAttempts}`,
      sensitiveValues,
    });
    const status = parseNotarizationStatus(`${result.stdout}\n${result.stderr}`);
    if (status) log('info', `submission ${submissionId} status: ${status}`);
    if (status === 'Accepted') {
      log('info', `submission ${submissionId} accepted`);
      return;
    }
    if (status === 'Invalid' || status === 'Rejected') {
      await fetchNotarizationLog(submissionId, credentials);
      throw new Error(`Apple notarization ${status} for submission ${submissionId}`);
    }

    if (result.status === 0 && !result.error && !result.signal) {
      throw new Error(`notarytool wait completed without an Accepted status for submission ${submissionId}`);
    }
    const retryDelayMs = retryDelayFor(WAIT_RETRY_DELAYS_MS, attempt - 1);
    if (!isTransientNetworkFailure(result) || retryDelayMs === null) {
      throw createCommandError('notarytool wait', result, sensitiveValues);
    }
    log('warn', `transient wait transport failure; retrying submission ${submissionId} in ${retryDelayMs / 1000}s without uploading again`);
    await delay(retryDelayMs);
  }
  throw new Error(`notarytool wait exhausted its bounded retry attempts for submission ${submissionId}`);
};

const notarizeSubmission = async (artifactPath, credentials) => {
  const submissionId = await submitWithRetry(artifactPath, credentials);
  await waitWithRetry(submissionId, credentials);
  return submissionId;
};

const stapleAndValidate = async (targetPath) => {
  const targetName = path.basename(targetPath);
  log('info', `stapling accepted ticket to exact target: ${targetName}`);
  const stapleResult = await runStreamingCommand({
    command: 'xcrun',
    args: ['stapler', 'staple', targetPath],
    label: `starting stapler staple for ${targetName}`,
  });
  assertCommandSucceeded('stapler staple', stapleResult);

  log('info', `validating stapled ticket on exact target: ${targetName}`);
  const validateResult = await runStreamingCommand({
    command: 'xcrun',
    args: ['stapler', 'validate', targetPath],
    label: `starting stapler validate for ${targetName}`,
  });
  assertCommandSucceeded('stapler validate', validateResult);
  log('info', `staple validation passed: ${targetName}`);
};

const assertExactTarget = (targetPath, expectedExtension) => {
  if (path.extname(targetPath).toLowerCase() !== expectedExtension) {
    throw new Error(`Expected an exact ${expectedExtension} target: ${targetPath}`);
  }
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Notarization target not found: ${targetPath}`);
  }
};

const notarizeApplication = async (appPath) => {
  const exactAppPath = path.resolve(appPath);
  assertExactTarget(exactAppPath, '.app');
  if (!fs.statSync(exactAppPath).isDirectory()) {
    throw new Error(`Application target is not a directory: ${exactAppPath}`);
  }

  const credentials = loadSigningCredentials();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bitterless-notarize-'));
  const zipPath = path.join(tempDir, `${path.basename(exactAppPath)}.zip`);
  try {
    log('info', `creating a fresh application submission ZIP for exact target: ${exactAppPath}`);
    const zipResult = await runStreamingCommand({
      command: 'ditto',
      args: ['-c', '-k', '--keepParent', exactAppPath, zipPath],
      label: `creating fresh submission ZIP: ${path.basename(zipPath)}`,
    });
    assertCommandSucceeded('create application submission ZIP', zipResult);
    await notarizeSubmission(zipPath, credentials);
    await stapleAndValidate(exactAppPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    log('info', `removed temporary application submission ZIP: ${zipPath}`);
  }
};

const notarizeDmg = async (dmgPath) => {
  const exactDmgPath = path.resolve(dmgPath);
  assertExactTarget(exactDmgPath, '.dmg');
  if (!fs.statSync(exactDmgPath).isFile()) {
    throw new Error(`DMG target is not a file: ${exactDmgPath}`);
  }

  const credentials = loadSigningCredentials();
  log('info', `notarizing exact DMG target: ${exactDmgPath}`);
  await notarizeSubmission(exactDmgPath, credentials);
  await stapleAndValidate(exactDmgPath);
};

const afterSign = async (context) => {
  if (context.electronPlatformName !== 'darwin') {
    log('info', `afterSign skipped for ${context.electronPlatformName}`);
    return;
  }
  const productFilename = context.packager?.appInfo?.productFilename;
  if (!productFilename) {
    throw new Error('Electron Builder afterSign context did not include productFilename');
  }
  const appPath = path.join(context.appOutDir, `${productFilename}.app`);
  log('info', `afterSign application notarization started: ${appPath}`);
  await notarizeApplication(appPath);
};

const usage = () => {
  console.log(`Usage:
  node scripts/notarize.js --dist <signed-app-directory>
  node scripts/notarize.js --file <exact-signed-app-or-dmg>

Options:
  --dist <path>  Find exactly one .app directly inside this directory.
                 Default: dist/mac-arm64
  --file <path>  Notarize one exact existing .app or .dmg without rebuilding.
                 DMG example: --file dist/Bitterless-0.0.49.dmg
  --help         Show this help.
`);
};

const parseArgs = (args = process.argv.slice(2)) => {
  let distDir = null;
  let filePath = null;
  let help = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help') {
      help = true;
    } else if (arg === '--dist' || arg === '--file') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a path`);
      }
      if (arg === '--dist') distDir = path.resolve(rootDir, value);
      if (arg === '--file') filePath = path.resolve(rootDir, value);
      index++;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (distDir && filePath) {
    throw new Error('Use either --dist or --file, not both');
  }
  return {
    distDir: distDir || (filePath ? null : path.join(rootDir, 'dist', 'mac-arm64')),
    filePath,
    help,
  };
};

const findExactAppInDist = (distDir) => {
  if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
    throw new Error(`Application directory not found: ${distDir}`);
  }
  const appEntries = fs.readdirSync(distDir)
    .filter((entry) => entry.endsWith('.app'));
  if (appEntries.length !== 1) {
    throw new Error(`Expected exactly one .app directly inside ${distDir}, found ${appEntries.length}`);
  }
  return path.join(distDir, appEntries[0]);
};

const main = async () => {
  const options = parseArgs();
  if (options.help) {
    usage();
    return;
  }
  const targetPath = options.filePath || findExactAppInDist(options.distDir);
  const extension = path.extname(targetPath).toLowerCase();
  if (extension === '.app') {
    await notarizeApplication(targetPath);
    return;
  }
  if (extension === '.dmg') {
    await notarizeDmg(targetPath);
    return;
  }
  throw new Error(`Only an exact .app or .dmg target can be notarized: ${targetPath}`);
};

if (require.main === module) {
  main().catch((error) => {
    log('error', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  afterSign,
  isTransientNetworkFailure,
  notarizeApplication,
  notarizeDmg,
};
