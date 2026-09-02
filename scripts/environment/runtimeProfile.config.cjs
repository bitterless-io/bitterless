/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-require-imports */
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const JSON5 = require('json5');

const PROFILE_CONTRACTS = Object.freeze({
  debug_dev: Object.freeze({ viteEnv: 'dev', viteMode: 'debug', releaseChannel: 'dev' }),
  debug_prod: Object.freeze({ viteEnv: 'prod', viteMode: 'debug', releaseChannel: 'prod' }),
  release_dev: Object.freeze({ viteEnv: 'dev', viteMode: 'release', releaseChannel: 'dev' }),
  release_prod: Object.freeze({ viteEnv: 'prod', viteMode: 'release', releaseChannel: 'prod' }),
  release_preview: Object.freeze({
    viteEnv: 'prod',
    viteMode: 'release',
    releaseChannel: 'preview'
  })
});
const PROFILE_NAMES = Object.freeze(Object.keys(PROFILE_CONTRACTS));
const PROFILE_NAME_SET = new Set(PROFILE_NAMES);

const parseEnvironmentLines = (content) => {
  const entries = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) throw new Error(`[runtime-profile] malformed .env.rig line: ${line}`);
    entries.push({ key: match[1], value: match[2] });
  }
  return entries;
};

const readProfileDefinitions = (projectRoot) => {
  const definitionsPath = join(projectRoot, 'env.rig.json5');
  const definitions = JSON5.parse(readFileSync(definitionsPath, 'utf8'));
  for (const profileName of PROFILE_NAMES) {
    const profile = definitions[profileName];
    const contract = PROFILE_CONTRACTS[profileName];
    if (!profile || typeof profile !== 'object') {
      throw new Error(`[runtime-profile] missing Rig profile ${profileName}`);
    }
    if (profile.VITE_MODE !== 'debug' && profile.VITE_MODE !== 'release') {
      throw new Error(`[runtime-profile] ${profileName} has unsupported VITE_MODE`);
    }
    if (profile.VITE_ENV !== 'dev' && profile.VITE_ENV !== 'prod') {
      throw new Error(`[runtime-profile] ${profileName} has unsupported VITE_ENV`);
    }
    if (
      profile.VITE_MODE !== contract.viteMode ||
      profile.VITE_ENV !== contract.viteEnv ||
      profile.VITE_RELEASE_CHANNEL !== contract.releaseChannel
    ) {
      throw new Error(`[runtime-profile] ${profileName} does not match its mode/backend/channel identity`);
    }
  }
  return definitions;
};

const getProfileDefinition = (projectRoot, profileName) => {
  if (!PROFILE_NAME_SET.has(profileName)) {
    throw new Error(`[runtime-profile] unsupported profile ${profileName}`);
  }
  return readProfileDefinitions(projectRoot)[profileName];
};

const normalizeRigEnvironment = (projectRoot, profileName) => {
  const envPath = join(projectRoot, '.env.rig');
  if (!existsSync(envPath)) {
    throw new Error('[runtime-profile] Rig did not create .env.rig');
  }
  const profile = getProfileDefinition(projectRoot, profileName);
  const entries = parseEnvironmentLines(readFileSync(envPath, 'utf8'));
  const selectedProfiles = entries.filter(({ key }) => key === 'MODE');
  if (selectedProfiles.length !== 1 || selectedProfiles[0].value !== profileName) {
    throw new Error(`[runtime-profile] Rig selected profile does not equal ${profileName}`);
  }
  const emittedModes = entries.filter(({ key }) => key === 'VITE_MODE');
  if (!emittedModes.length) throw new Error('[runtime-profile] Rig omitted VITE_MODE');
  if (
    emittedModes.some(
      ({ value }) => value !== profileName && value !== profile.VITE_MODE
    )
  ) {
    throw new Error('[runtime-profile] Rig emitted an unexpected VITE_MODE value');
  }

  const canonicalEntries = entries.filter(({ key }) => key !== 'VITE_MODE');
  const viteEnvironment = canonicalEntries.filter(({ key }) => key === 'VITE_ENV');
  if (viteEnvironment.length !== 1 || viteEnvironment[0].value !== profile.VITE_ENV) {
    throw new Error(`[runtime-profile] Rig VITE_ENV does not match ${profileName}`);
  }
  const releaseChannels = canonicalEntries.filter(({ key }) => key === 'VITE_RELEASE_CHANNEL');
  if (releaseChannels.length !== 1 || releaseChannels[0].value !== profile.VITE_RELEASE_CHANNEL) {
    throw new Error(`[runtime-profile] Rig VITE_RELEASE_CHANNEL does not match ${profileName}`);
  }
  const insertIndex = canonicalEntries.findIndex(({ key }) => key === 'VITE_ENV') + 1;
  canonicalEntries.splice(insertIndex, 0, { key: 'VITE_MODE', value: profile.VITE_MODE });
  writeFileSync(
    envPath,
    `${canonicalEntries.map(({ key, value }) => `${key} = ${value}`).join('\n')}\n`,
    'utf8'
  );
  return {
    profileName,
    releaseChannel: profile.VITE_RELEASE_CHANNEL,
    viteEnv: profile.VITE_ENV,
    viteMode: profile.VITE_MODE
  };
};

const loadCanonicalRigEnvironment = (projectRoot) => {
  const envPath = join(projectRoot, '.env.rig');
  if (!existsSync(envPath)) throw new Error('[runtime-profile] .env.rig is missing');
  const entries = parseEnvironmentLines(readFileSync(envPath, 'utf8'));
  const environment = {};
  for (const { key, value } of entries) {
    if (Object.hasOwn(environment, key)) {
      throw new Error(`[runtime-profile] .env.rig contains duplicate ${key}`);
    }
    environment[key] = value;
  }
  const profileName = environment.MODE;
  const profile = getProfileDefinition(projectRoot, profileName);
  if (environment.VITE_MODE !== profile.VITE_MODE) {
    throw new Error(`[runtime-profile] canonical VITE_MODE does not match ${profileName}`);
  }
  if (environment.VITE_ENV !== profile.VITE_ENV) {
    throw new Error(`[runtime-profile] canonical VITE_ENV does not match ${profileName}`);
  }
  if (environment.VITE_RELEASE_CHANNEL !== profile.VITE_RELEASE_CHANNEL) {
    throw new Error(`[runtime-profile] canonical VITE_RELEASE_CHANNEL does not match ${profileName}`);
  }
  return {
    environment,
    profileName,
    releaseChannel: profile.VITE_RELEASE_CHANNEL,
    viteEnv: profile.VITE_ENV,
    viteMode: profile.VITE_MODE
  };
};

const assertSelectedRuntimeProfile = (projectRoot, expectedMode) => {
  if (expectedMode !== 'debug' && expectedMode !== 'release') {
    throw new Error(`[runtime-profile] unsupported expected mode ${expectedMode}`);
  }
  const selected = loadCanonicalRigEnvironment(projectRoot);
  if (selected.viteMode !== expectedMode) {
    throw new Error(
      `[runtime-profile] selected ${selected.profileName} is not a ${expectedMode} profile`
    );
  }
  if (process.env.VITE_MODE !== selected.viteMode) {
    throw new Error('[runtime-profile] child VITE_MODE does not match the selected Rig profile');
  }
  if (process.env.VITE_ENV !== selected.viteEnv) {
    throw new Error('[runtime-profile] child VITE_ENV does not match the selected Rig profile');
  }
  if (process.env.VITE_RELEASE_CHANNEL !== selected.releaseChannel) {
    throw new Error(
      '[runtime-profile] child VITE_RELEASE_CHANNEL does not match the selected Rig profile'
    );
  }
  return selected;
};

module.exports = {
  PROFILE_NAMES,
  assertSelectedRuntimeProfile,
  loadCanonicalRigEnvironment,
  normalizeRigEnvironment,
  parseEnvironmentLines,
  readProfileDefinitions
};
