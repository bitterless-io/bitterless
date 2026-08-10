/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-require-imports */
const { spawn, spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const {
  PROFILE_NAMES,
  normalizeRigEnvironment
} = require('./runtimeProfile.config.cjs');

const fail = (message) => {
  console.error(`[runtime-profile] ${message}`);
  process.exit(1);
};

const separatorIndex = process.argv.indexOf('--', 2);
if (separatorIndex !== 3 || !PROFILE_NAMES.includes(process.argv[2])) {
  fail(
    'usage: node scripts/environment/runWithRuntimeProfile.cjs <profile> -- <command> [args...]'
  );
}

const projectRoot = resolve(__dirname, '..', '..');
const profileName = process.argv[2];
const command = process.argv[4];
const commandArguments = process.argv.slice(5);
if (!command) fail('a child command is required');

const rigExecutable = process.platform === 'win32' ? 'rig.cmd' : 'rig';
const rigResult = spawnSync(rigExecutable, ['--env', profileName], {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true
});
if (rigResult.error) fail(`could not execute Rig: ${rigResult.error.message}`);
if (rigResult.status !== 0) process.exit(rigResult.status ?? 1);

let selected;
try {
  selected = normalizeRigEnvironment(projectRoot, profileName);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const childEnvironment = {
  ...process.env,
  VITE_ENV: selected.viteEnv,
  VITE_MODE: selected.viteMode
};

let childExecutable = command;
let childArguments = commandArguments;
if (command === 'yarn' && process.env.npm_execpath) {
  childExecutable = process.execPath;
  childArguments = [process.env.npm_execpath, ...commandArguments];
} else if (process.platform === 'win32' && !command.toLowerCase().endsWith('.exe')) {
  childExecutable = command.toLowerCase().endsWith('.cmd') ? command : `${command}.cmd`;
}

const child = spawn(childExecutable, childArguments, {
  cwd: projectRoot,
  env: childEnvironment,
  stdio: 'inherit',
  windowsHide: true
});
child.once('error', (error) => fail(`could not execute ${command}: ${error.message}`));
child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
