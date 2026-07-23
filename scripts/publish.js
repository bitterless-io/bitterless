#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');
const OSS = require('ali-oss');
const { appBuilderPath } = require('app-builder-bin');
const { compareVersions } = require('compare-versions');
const { auditDesktopPackage } = require('./package/desktopPackage.audit.cjs');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const keychainDir = process.env.BITTERLESS_KEYCHAIN_DIR || '/Users/ral/Documents/projects/overmind/areas/keychain/bitterless';
const defaultPublishEnvPath = path.join(keychainDir, 'publish.env');
const defaultPublicBaseUrl = 'https://assets.terncloud.com';
const defaultOssPrefix = 'bitterless/distro';
const defaultSigningEnvPath = path.join(keychainDir, 'signing.env');
const defaultSigningCertificatePath = path.join(keychainDir, 'Certificates.p12');

const platformConfigs = {
  mac_arm: {
    buildArgs: ['--mac', '--arm64'],
    appOutputDir: 'mac-arm64',
    artifactExtensions: ['.dmg', '.zip', '.blockmap'],
    updaterFiles: ['latest-mac.yml'],
  },
  mac_intel: {
    buildArgs: ['--mac', '--x64'],
    appOutputDir: 'mac',
    artifactExtensions: ['.dmg', '.zip', '.blockmap'],
    updaterFiles: ['latest-mac.yml'],
  },
  win64: {
    buildArgs: ['--win', '--x64'],
    appOutputDir: 'win-unpacked',
    artifactExtensions: ['.exe', '.blockmap'],
    updaterFiles: ['latest.yml'],
  },
};

const usage = () => {
  console.log(`Usage:
  node scripts/publish.js --env prod --platform mac_arm [--build] [--dry-run]

Options:
  --env <dev|prod>             Release environment. Default: prod
  --platform <mac_arm|mac_intel|win64>
                               Target platform. Default: current host platform
  --build                      Run release env preparation, build, and electron-builder first
  --bump                       Run scripts/patch.js before building
  --dry-run                    Print planned uploads without writing to OSS
  --env-file <path>            OSS env file. Default: ${defaultPublishEnvPath}
  --prefix <prefix>            OSS object prefix. Default: ${defaultOssPrefix}
  --public-base-url <url>      Public CDN base URL. Default: ${defaultPublicBaseUrl}
  --no-cdn-refresh             Skip Aliyun CDN directory refresh after upload
  --help                       Show this help

publish.env supports these keys:
  ak, as, bucket, region
  or OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_BUCKET, OSS_REGION
  optional: CDN_API_ENDPOINT
`);
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const result = {
    env: 'prod',
    platform: detectHostPlatform(),
    build: false,
    bump: false,
    dryRun: false,
    envFile: defaultPublishEnvPath,
    prefix: defaultOssPrefix,
    publicBaseUrl: defaultPublicBaseUrl,
    cdnRefresh: true,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--build') {
      result.build = true;
    } else if (arg === '--bump') {
      result.bump = true;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--no-cdn-refresh') {
      result.cdnRefresh = false;
    } else if (arg === '--env') {
      result.env = requireValue(args, ++i, arg);
    } else if (arg === '--platform') {
      result.platform = requireValue(args, ++i, arg);
    } else if (arg === '--env-file') {
      result.envFile = path.resolve(requireValue(args, ++i, arg));
    } else if (arg === '--prefix') {
      result.prefix = normalizePrefix(requireValue(args, ++i, arg));
    } else if (arg === '--public-base-url') {
      result.publicBaseUrl = requireValue(args, ++i, arg).replace(/\/+$/, '');
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (result.env !== 'dev' && result.env !== 'prod') {
    throw new Error('--env must be dev or prod');
  }
  if (!platformConfigs[result.platform]) {
    throw new Error('--platform must be mac_arm, mac_intel, or win64');
  }
  return result;
};

const requireValue = (args, index, argName) => {
  const value = args[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${argName} requires a value`);
  }
  return value;
};

function detectHostPlatform() {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'mac_arm' : 'mac_intel';
  }
  if (process.platform === 'win32') {
    return 'win64';
  }
  return 'mac_arm';
}

const normalizePrefix = (value) => {
  return value.replace(/^\/+/, '').replace(/\/+$/, '');
};

const parseEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Env file not found: ${filePath}`);
  }

  const env = {};
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([\w]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    env[match[1]] = unwrapEnvValue(match[2]);
  }
  return env;
};

const unwrapEnvValue = (value) => {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
};

const getRequiredEnv = (env, keys, label) => {
  for (const key of keys) {
    if (env[key]) return env[key];
  }
  throw new Error(`Missing ${label} in publish env (${keys.join(' or ')})`);
};

const createPublishConfig = (options) => {
  const env = parseEnvFile(options.envFile);
  return {
    accessKeyId: getRequiredEnv(env, ['ak', 'OSS_ACCESS_KEY_ID', 'accessKeyId'], 'OSS access key id'),
    accessKeySecret: getRequiredEnv(env, ['as', 'OSS_ACCESS_KEY_SECRET', 'accessKeySecret'], 'OSS access key secret'),
    bucket: getRequiredEnv(env, ['bucket', 'OSS_BUCKET'], 'OSS bucket'),
    region: getRequiredEnv(env, ['region', 'OSS_REGION'], 'OSS region'),
    cdnEndpoint: env.CDN_API_ENDPOINT || process.env.CDN_API_ENDPOINT || 'https://cdn.ap-southeast-1.aliyuncs.com',
  };
};

const run = (command, args) => {
  console.log(`[publish.js] Running: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
};

const runOutput = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    encoding: 'utf-8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
};

const runPrivate = (command, args, label) => {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 1}`);
  }
};

const runBuild = (options) => {
  run('rig', ['--env', `release_${options.env}`]);
  run('node', ['scripts/before.js']);
  run('yarn', ['build']);
  run('node', ['scripts/prepare-maestro-cli.cjs', options.platform]);
  run('node', ['scripts/signedBuild.js', ...platformConfigs[options.platform].buildArgs]);
};

const auditPackagedApplication = (platform) => {
  const appOutputPath = path.join(distDir, platformConfigs[platform].appOutputDir);
  console.log(`[publish.js] Auditing packaged application: ${appOutputPath}`);
  auditDesktopPackage(appOutputPath);
};

const listFiles = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((filePath) => fs.statSync(filePath).isFile());
};

const readDistVersionInfo = () => {
  const versionInfoPath = path.join(distDir, 'version_info.json');
  if (!fs.existsSync(versionInfoPath)) {
    throw new Error(`version_info.json not found: ${versionInfoPath}. Run scripts/before.js or use --build.`);
  }
  return JSON.parse(fs.readFileSync(versionInfoPath, 'utf-8'));
};

const findArtifacts = (platform, version) => {
  if (!fs.existsSync(distDir)) {
    throw new Error(`dist directory not found: ${distDir}. Run with --build or build first.`);
  }

  const config = platformConfigs[platform];
  const files = listFiles(distDir);
  const artifacts = files.filter((filePath) => {
    const name = path.basename(filePath);
    const ext = path.extname(name);
    return config.updaterFiles.includes(name) || (
      config.artifactExtensions.includes(ext) && name.includes(`-${version}`)
    );
  });

  const missingUpdaterFiles = config.updaterFiles.filter((name) => {
    return !artifacts.some((filePath) => path.basename(filePath) === name);
  });
  if (missingUpdaterFiles.length > 0) {
    throw new Error(`Missing updater metadata in dist: ${missingUpdaterFiles.join(', ')}`);
  }

  return artifacts.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
};

const loadSigningEnv = () => {
  const localEnvPath = path.join(rootDir, 'local', 'signing.env');
  const envPath = fs.existsSync(localEnvPath)
    ? localEnvPath
    : defaultSigningEnvPath;
  return parseEnvFile(envPath);
};

const normalizeFilePath = (value) => {
  return decodeURIComponent(value.replace(/^file:\/\//, ''));
};

const resolveSigningCertificatePath = (env) => {
  const configuredPath = env.CSC_LINK
    ? normalizeFilePath(env.CSC_LINK)
    : defaultSigningCertificatePath;
  if (fs.existsSync(configuredPath)) return configuredPath;
  if (fs.existsSync(defaultSigningCertificatePath)) return defaultSigningCertificatePath;
  throw new Error(`Developer ID certificate not found: ${configuredPath}`);
};

const parseUserKeychainSearchList = (output) => {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
};

const readUserKeychainSearchList = () => {
  return parseUserKeychainSearchList(runOutput('security', ['list-keychains', '-d', 'user']));
};

const setUserKeychainSearchList = (keychainPaths) => {
  runPrivate(
    'security',
    ['list-keychains', '-d', 'user', '-s', ...keychainPaths],
    'Update user keychain search list',
  );
};

const withTemporaryUserKeychainSearchList = (keychainPath, callback, dependencies = {}) => {
  const readSearchList = dependencies.readSearchList ?? readUserKeychainSearchList;
  const setSearchList = dependencies.setSearchList ?? setUserKeychainSearchList;
  const originalSearchList = readSearchList();
  const temporarySearchList = [
    keychainPath,
    ...originalSearchList.filter((item) => item !== keychainPath),
  ];

  setSearchList(temporarySearchList);
  try {
    return callback();
  } finally {
    setSearchList(originalSearchList);
  }
};

const parseDeveloperIdApplicationIdentities = (output) => {
  const identities = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(
      /^\s*\d+\)\s+([0-9A-F]{40})\s+"(Developer ID Application: .+ \(([A-Z0-9]+)\))"\s*$/i,
    );
    if (!match) continue;
    identities.push({
      hash: match[1],
      name: match[2],
      teamIdentifier: match[3],
    });
  }
  return identities;
};

const selectDeveloperIdApplicationIdentity = (output, teamIdentifier) => {
  const matches = parseDeveloperIdApplicationIdentities(output)
    .filter((identity) => identity.teamIdentifier === teamIdentifier);
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one Developer ID Application identity for team ${teamIdentifier}, found ${matches.length}`,
    );
  }
  return matches[0].hash;
};

const withTemporarySigningKeychain = (callback) => {
  const env = loadSigningEnv();
  const certificatePath = resolveSigningCertificatePath(env);
  const certificatePassword = env.CSC_KEY_PASSWORD ?? '';
  const keychainPassword = crypto.randomBytes(32).toString('hex');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bitterless-dmg-sign-'));
  const keychainPath = path.join(tempDir, 'dmg-signing.keychain-db');

  try {
    runPrivate('security', ['create-keychain', '-p', keychainPassword, keychainPath], 'Create signing keychain');
    runPrivate('security', ['unlock-keychain', '-p', keychainPassword, keychainPath], 'Unlock signing keychain');
    runPrivate('security', ['set-keychain-settings', '-lut', '21600', keychainPath], 'Configure signing keychain');
    runPrivate(
      'security',
      ['import', certificatePath, '-k', keychainPath, '-P', certificatePassword, '-T', '/usr/bin/codesign'],
      'Import Developer ID certificate',
    );
    runPrivate(
      'security',
      ['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', keychainPassword, keychainPath],
      'Authorize codesign key access',
    );
    return withTemporaryUserKeychainSearchList(keychainPath, () => {
      const identities = runOutput('security', [
        'find-identity',
        '-v',
        '-p',
        'codesigning',
        keychainPath,
      ]);
      return callback({ keychainPath, identities });
    });
  } finally {
    spawnSync('security', ['delete-keychain', keychainPath], { stdio: 'ignore' });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

const getMacAppPath = (platform) => {
  const dirName = platform === 'mac_intel' ? 'mac' : 'mac-arm64';
  const appDir = path.join(distDir, dirName);
  if (!fs.existsSync(appDir)) {
    throw new Error(`Mac app output directory not found: ${appDir}`);
  }
  const appName = fs.readdirSync(appDir).find((name) => name.endsWith('.app'));
  if (!appName) {
    throw new Error(`No .app bundle found in: ${appDir}`);
  }
  return path.join(appDir, appName);
};

const findSingleFileByExt = (ext) => {
  const matches = listFiles(distDir).filter((filePath) => path.extname(filePath) === ext);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    matches.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  }
  return matches[0];
};

const getMacAppTeamIdentifier = (appPath) => {
  runOutput('codesign', ['--verify', '--deep', '--strict', appPath]);
  const output = runOutput('codesign', ['-dvvv', appPath]);
  const match = output.match(/^TeamIdentifier=([A-Z0-9]+)$/m);
  if (!match) {
    throw new Error('Could not find a TeamIdentifier in the verified signed app');
  }
  return match[1];
};

const signDmg = (dmgPath, teamIdentifier) => {
  withTemporarySigningKeychain(({ keychainPath, identities }) => {
    const identityHash = selectDeveloperIdApplicationIdentity(identities, teamIdentifier);
    run('codesign', [
      '--keychain',
      keychainPath,
      '--sign',
      identityHash,
      '--force',
      '--timestamp',
      dmgPath,
    ]);
  });
  run('codesign', ['--verify', '--verbose=4', dmgPath]);
};

const notarizeDmg = (dmgPath) => {
  const env = loadSigningEnv();
  const appleId = env.APPLE_ID;
  const password = env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = env.APPLE_TEAM_ID;
  if (!appleId || !password || !teamId) {
    throw new Error('Missing APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID in signing env');
  }
  console.log(`[publish.js] Running: xcrun notarytool submit ${path.basename(dmgPath)} --wait`);
  const result = spawnSync('xcrun', [
    'notarytool',
    'submit',
    dmgPath,
    '--apple-id',
    appleId,
    '--password',
    password,
    '--team-id',
    teamId,
    '--no-s3-acceleration',
    '--wait',
    '--output-format',
    'json',
  ], {
    cwd: rootDir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`DMG notarization failed: ${result.stderr || result.stdout}`);
  }
  const output = result.stdout?.trim();
  if (output) {
    const parsed = JSON.parse(output);
    if (parsed.status !== 'Accepted') {
      throw new Error(`DMG notarization status is ${parsed.status}`);
    }
  }
  run('xcrun', ['stapler', 'staple', dmgPath]);
  run('xcrun', ['stapler', 'validate', dmgPath]);
};

const regenerateBlockmap = (filePath) => {
  const output = `${filePath}.blockmap`;
  run(appBuilderPath, ['blockmap', '--input', filePath, '--output', output]);
};

const sha512Base64 = (filePath) => {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
};

const updateLatestMacYml = (dmgPath) => {
  const latestPath = path.join(distDir, 'latest-mac.yml');
  if (!fs.existsSync(latestPath)) {
    throw new Error(`latest-mac.yml not found: ${latestPath}`);
  }
  const latest = yaml.load(fs.readFileSync(latestPath, 'utf-8'));
  const dmgName = path.basename(dmgPath);
  const size = fs.statSync(dmgPath).size;
  const sha512 = sha512Base64(dmgPath);
  if (Array.isArray(latest.files)) {
    for (const file of latest.files) {
      if (file.url === dmgName) {
        file.sha512 = sha512;
        file.size = size;
      }
    }
  }
  if (latest.path === dmgName) {
    latest.sha512 = sha512;
  }
  fs.writeFileSync(latestPath, yaml.dump(latest, { lineWidth: 120 }), 'utf-8');
};

const finalizeMacDmg = (platform) => {
  if (platform !== 'mac_arm' && platform !== 'mac_intel') return;
  const dmgPath = findSingleFileByExt('.dmg');
  if (!dmgPath) {
    throw new Error('No DMG artifact found in dist');
  }
  const appPath = getMacAppPath(platform);
  const teamIdentifier = getMacAppTeamIdentifier(appPath);
  console.log(`[publish.js] Signing DMG: ${path.basename(dmgPath)}`);
  signDmg(dmgPath, teamIdentifier);
  console.log(`[publish.js] Notarizing DMG: ${path.basename(dmgPath)}`);
  notarizeDmg(dmgPath);
  console.log(`[publish.js] Regenerating DMG blockmap and latest-mac.yml`);
  regenerateBlockmap(dmgPath);
  updateLatestMacYml(dmgPath);
};

const createVersionInfoForUpload = (options) => {
  const versionInfo = readDistVersionInfo();
  const downloadUrl = `${options.publicBaseUrl}/${options.prefix}/${options.env}/${options.platform}`;
  const uploadInfo = {
    ...versionInfo,
    downloadUrl,
  };

  const publishDir = path.join(distDir, '.publish', options.env, options.platform);
  fs.mkdirSync(publishDir, { recursive: true });
  const publishVersionInfoPath = path.join(publishDir, 'version_info.json');
  fs.writeFileSync(publishVersionInfoPath, JSON.stringify(uploadInfo, null, 2) + os.EOL, 'utf-8');
  return publishVersionInfoPath;
};

const contentTypeFor = (filePath) => {
  const name = path.basename(filePath);
  const ext = path.extname(name).toLowerCase();
  if (name.endsWith('.yml') || name.endsWith('.yaml')) return 'text/yaml; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.zip') return 'application/zip';
  if (ext === '.dmg') return 'application/x-apple-diskimage';
  if (ext === '.exe') return 'application/vnd.microsoft.portable-executable';
  return 'application/octet-stream';
};

const uploadFile = async (client, objectKey, filePath, dryRun) => {
  const size = fs.statSync(filePath).size;
  if (dryRun) {
    console.log(`[publish.js] DRY RUN upload ${filePath} -> oss://${objectKey} (${size} bytes)`);
    return;
  }

  await client.put(objectKey, filePath, {
    headers: {
      'Content-Type': contentTypeFor(filePath),
    },
  });
  console.log(`[publish.js] Uploaded ${path.basename(filePath)} -> ${objectKey}`);
};

const assertNoRemoteDowngrade = async (client, objectPrefix) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
  const localVersionCode = String(pkg.version_code);
  let remoteInfo;
  try {
    const result = await client.get(`${objectPrefix}/version_info.json`);
    remoteInfo = JSON.parse(result.content.toString('utf-8'));
  } catch (error) {
    if (error?.code === 'NoSuchKey' || error?.status === 404 || error?.statusCode === 404) {
      console.log('[publish.js] No existing remote version manifest; first publish is allowed.');
      return;
    }
    throw error;
  }

  const remoteVersionCode = String(remoteInfo.versionCode);
  if (!/^\d+$/.test(remoteVersionCode)) {
    throw new Error(`Remote version_info.json has invalid versionCode: ${remoteVersionCode}`);
  }
  const order = compareVersions(localVersionCode, remoteVersionCode);
  if (order < 0) {
    throw new Error(
      `Refusing version downgrade: local ${localVersionCode}, remote ${remoteVersionCode}`,
    );
  }
  if (order === 0 && remoteInfo.version !== pkg.version) {
    throw new Error(
      `Remote version_code ${remoteVersionCode} belongs to version ${remoteInfo.version}, not ${pkg.version}`,
    );
  }
  console.log(
    `[publish.js] Version order verified: local ${localVersionCode}, remote ${remoteVersionCode}`,
  );
};

const rfc3986 = (value) => {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => {
    return `%${char.charCodeAt(0).toString(16).toUpperCase()}`;
  });
};

const canonicalQuery = (params) => {
  return Object.entries(params)
    .sort(([left], [right]) => left < right ? -1 : 1)
    .map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`)
    .join('&');
};

const signCdnParams = (params, accessKeySecret) => {
  const stringToSign = `GET&${rfc3986('/')}&${rfc3986(canonicalQuery(params))}`;
  return crypto.createHmac('sha1', `${accessKeySecret}&`).update(stringToSign).digest('base64');
};

const callCdn = async (publishConfig, action, params) => {
  const requestParams = {
    Action: action,
    Format: 'JSON',
    Version: '2018-05-10',
    AccessKeyId: publishConfig.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: new Date().toISOString(),
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    ...params,
  };
  requestParams.Signature = signCdnParams(requestParams, publishConfig.accessKeySecret);
  const response = await fetch(`${publishConfig.cdnEndpoint}/?${canonicalQuery(requestParams)}`);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (data?.Code) {
    throw new Error(`${action}: ${data.Code} - ${data.Message || ''}`);
  }
  if (!response.ok) {
    throw new Error(`${action} HTTP ${response.status}: ${text}`);
  }
  return data;
};

const delay = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const waitForCdnRefresh = async (publishConfig, taskId) => {
  for (let i = 0; i < 100; i++) {
    const info = await callCdn(publishConfig, 'DescribeRefreshTaskById', {
      TaskId: String(taskId),
    });
    const tasks = info?.Tasks?.CDNTask || info?.Tasks || [];
    const taskList = Array.isArray(tasks) ? tasks : [tasks];
    if (taskList.length > 0 && taskList.every((task) => task.Status === 'Complete')) {
      console.log('[publish.js] CDN refresh done.');
      return;
    }
    if (taskList.some((task) => task.Status === 'Failed')) {
      throw new Error(`CDN refresh failed: ${JSON.stringify(taskList)}`);
    }
    process.stdout.write('.');
    await delay(3000);
  }
  throw new Error('CDN refresh polling timed out');
};

const refreshCdnDirectory = async (options, publishConfig, objectPrefix) => {
  if (options.dryRun || !options.cdnRefresh) return;
  const refreshPath = `${options.publicBaseUrl}/${objectPrefix}/`;
  console.log(`[publish.js] Refreshing CDN directory: ${refreshPath}`);
  const result = await callCdn(publishConfig, 'RefreshObjectCaches', {
    ObjectPath: refreshPath,
    ObjectType: 'Directory',
  });
  console.log(`[publish.js] CDN refresh task: ${result.RefreshTaskId}`);
  await waitForCdnRefresh(publishConfig, result.RefreshTaskId);
};

const main = async () => {
  const options = parseArgs();
  if (options.help) {
    usage();
    return;
  }

  if (options.bump) {
    run('node', ['scripts/patch.js']);
  }
  run('yarn', ['audit:sqlite-migrations']);

  const publishConfig = createPublishConfig(options);
  const objectPrefix = `${options.prefix}/${options.env}/${options.platform}`;
  const client = options.dryRun
    ? null
    : new OSS({
      region: publishConfig.region,
      accessKeyId: publishConfig.accessKeyId,
      accessKeySecret: publishConfig.accessKeySecret,
      bucket: publishConfig.bucket,
    });
  if (client) await assertNoRemoteDowngrade(client, objectPrefix);

  if (options.build) {
    runBuild(options);
  }

  auditPackagedApplication(options.platform);

  if (!options.dryRun) {
    finalizeMacDmg(options.platform);
  }
  const versionInfoPath = createVersionInfoForUpload(options);
  const versionInfo = readDistVersionInfo();
  const artifacts = findArtifacts(options.platform, versionInfo.version);

  console.log(`[publish.js] Env file: ${options.envFile}`);
  console.log(`[publish.js] Target: oss://${publishConfig.bucket}/${objectPrefix}/`);
  console.log(`[publish.js] Public URL: ${options.publicBaseUrl}/${objectPrefix}`);

  for (const artifact of artifacts) {
    await uploadFile(client, `${objectPrefix}/${path.basename(artifact)}`, artifact, options.dryRun);
  }
  await uploadFile(client, `${objectPrefix}/version_info.json`, versionInfoPath, options.dryRun);
  await refreshCdnDirectory(options, publishConfig, objectPrefix);

  console.log('[publish.js] Done.');
};

if (require.main === module) {
  main().catch((err) => {
    console.error(`[publish.js] ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseDeveloperIdApplicationIdentities,
  parseUserKeychainSearchList,
  selectDeveloperIdApplicationIdentity,
  withTemporaryUserKeychainSearchList,
};
