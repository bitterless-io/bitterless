/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-coding-agent-integration-build-'));
const fixtureRoot = mkdtempSync(join(tmpdir(), 'bitterless-coding-agent-integration-'));

const loadTypeScriptModule = async (name, entry) => {
  const outfile = join(buildRoot, `${name}.mjs`);
  await build({
    entryPoints: [join(projectRoot, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.node.json')
  });
  return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}-${name}`);
};

const RESUME_ID = '11111111-1111-4111-8111-111111111111';
const LAUNCH_ID = '22222222-2222-4222-8222-222222222222';
const CLEANUP_ID = '33333333-3333-4333-8333-333333333333';
const ERROR_ID = '44444444-4444-4444-8444-444444444444';

try {
  const terminal = await loadTypeScriptModule(
    'terminal',
    'src/main/codingAgent/codingAgentTerminal.service.ts'
  );
  const appPath = join(fixtureRoot, 'app');
  const userDataPath = join(fixtureRoot, 'user-data');
  const externalBinPath = join(fixtureRoot, 'external-bin');
  const pathBinPath = join(fixtureRoot, 'path-bin');
  const internalPathBin = join(fixtureRoot, 'internal-path-bin');
  const cwd = join(fixtureRoot, "work's 100% ! & ($HOME)");
  mkdirSync(join(appPath, 'bin'), { recursive: true });
  mkdirSync(externalBinPath, { recursive: true });
  mkdirSync(pathBinPath, { recursive: true });
  mkdirSync(internalPathBin, { recursive: true });
  mkdirSync(cwd, { recursive: true });

  const executable = join(externalBinPath, 'claude');
  writeFileSync(
    executable,
    [
      '#!/bin/sh',
      '{',
      '  printf \'%s\\n\' "$PWD"',
      '  for bitterless_arg in "$@"; do printf \'%s\\n\' "$bitterless_arg"; done',
      '} > "$BITTERLESS_CAPTURE_PATH"',
      ''
    ].join('\n'),
    { mode: 0o700 }
  );
  chmodSync(executable, 0o700);
  symlinkSync(executable, join(pathBinPath, 'claude'));
  assert.equal(
    terminal.resolveClaudeExecutable({
      platform: 'darwin',
      pathValue: pathBinPath,
      appPath
    }),
    realpathSync(executable)
  );

  const internalExecutable = join(appPath, 'bin', 'claude');
  writeFileSync(internalExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  chmodSync(internalExecutable, 0o700);
  symlinkSync(internalExecutable, join(internalPathBin, 'claude'));
  assert.throws(
    () =>
      terminal.resolveClaudeExecutable({
        platform: 'darwin',
        pathValue: internalPathBin,
        appPath
      }),
    /executable is unavailable/
  );
  assert.throws(
    () =>
      terminal.resolveClaudeExecutable({
        platform: 'darwin',
        pathValue: 'relative-path-entry',
        appPath
      }),
    /executable is unavailable/
  );

  const openedPaths = [];
  const launcher = new terminal.CodingAgentTerminalLauncher({
    userDataPath,
    appPath,
    openPath: async (path) => {
      openedPaths.push(path);
      return '';
    },
    platform: 'darwin',
    idFactory: () => LAUNCH_ID,
    resolveClaudeExecutable: () => join(pathBinPath, 'claude')
  });
  assert.equal(
    await launcher.launch({
      kind: 'claude-resume',
      sessionId: RESUME_ID,
      cwd
    }),
    'resume'
  );
  const launchPath = openedPaths.at(-1);
  const launchDirectory = dirname(launchPath);
  assert.equal(resolve(launchDirectory).startsWith(resolve(userDataPath)), true);
  assert.equal(lstatSync(launchDirectory).mode & 0o777, 0o700);
  assert.equal(lstatSync(launchPath).mode & 0o777, 0o700);
  const launchScript = readFileSync(launchPath, 'utf8');
  assert.ok(launchScript.indexOf('rm -f -- "$0"') < launchScript.indexOf('exec '));
  assert.match(launchScript, /--resume/);
  assert.match(launchScript, new RegExp(RESUME_ID));

  const capturePath = join(fixtureRoot, 'capture.txt');
  const execution = spawnSync(launchPath, [], {
    encoding: 'utf8',
    env: { ...process.env, BITTERLESS_CAPTURE_PATH: capturePath }
  });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(existsSync(launchPath), false, 'the POSIX launcher must unlink before Claude runs');
  assert.deepEqual(readFileSync(capturePath, 'utf8').trim().split('\n'), [
    cwd,
    '--resume',
    RESUME_ID
  ]);

  const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  for (let index = 0; index < 20; index += 1) {
    const suffix = String(index).padStart(12, '0');
    const stalePath = join(launchDirectory, `claude-00000000-0000-4000-8000-${suffix}.command`);
    writeFileSync(stalePath, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    utimesSync(stalePath, oldDate, oldDate);
  }
  const unrelatedPath = join(launchDirectory, 'owner-note.command');
  writeFileSync(unrelatedPath, 'leave me alone\n', { mode: 0o600 });
  const cleanupLauncher = new terminal.CodingAgentTerminalLauncher({
    userDataPath,
    appPath,
    openPath: async (path) => {
      openedPaths.push(path);
      return '';
    },
    platform: 'darwin',
    idFactory: () => CLEANUP_ID,
    resolveClaudeExecutable: () => executable,
    now: () => Date.now()
  });
  assert.equal(
    await cleanupLauncher.launch({
      kind: 'claude-attach',
      jobId: 'job_A-12:child',
      cwd
    }),
    'attach'
  );
  const retainedLaunchFiles = readdirSync(launchDirectory).filter((name) =>
    /^claude-.*\.command$/.test(name)
  );
  assert.ok(retainedLaunchFiles.length <= 16, 'stale launch files must remain bounded');
  assert.equal(existsSync(unrelatedPath), true, 'cleanup must ignore unrelated files');

  const failedPath = join(launchDirectory, `claude-${ERROR_ID}.command`);
  const failedLauncher = new terminal.CodingAgentTerminalLauncher({
    userDataPath,
    appPath,
    openPath: async () => 'No application can open this file',
    platform: 'darwin',
    idFactory: () => ERROR_ID,
    resolveClaudeExecutable: () => executable
  });
  await assert.rejects(
    failedLauncher.launch({
      kind: 'claude-resume',
      sessionId: RESUME_ID,
      cwd
    }),
    /could not open the terminal launcher/
  );
  assert.equal(existsSync(failedPath), false, 'an unaccepted launcher must be removed');
  await assert.rejects(
    failedLauncher.launch({
      kind: 'claude-attach',
      jobId: 'job & whoami',
      cwd
    }),
    /invalid/
  );

  const internalLauncher = new terminal.CodingAgentTerminalLauncher({
    userDataPath,
    appPath,
    openPath: async () => '',
    platform: 'darwin',
    idFactory: () => ERROR_ID,
    resolveClaudeExecutable: () => join(internalPathBin, 'claude')
  });
  await assert.rejects(
    internalLauncher.launch({
      kind: 'claude-resume',
      sessionId: RESUME_ID,
      cwd
    }),
    /executable is unavailable/
  );

  const windowsScript = terminal.createWindowsClaudeTerminalScript({
    executable: 'C:\\Users\\Ral%profile!\\bin & tools\\claude.cmd',
    target: {
      action: 'attach',
      args: ['attach', 'job_100%!&^()'],
      cwd: 'C:\\Work\\100% ! & (project)^'
    }
  });
  assert.match(windowsScript, /setlocal DisableDelayedExpansion/);
  assert.match(windowsScript, /C:\\Work\\100%% ! & \(project\)\^/);
  assert.match(windowsScript, /"C:\\Users\\Ral%%profile!\\bin & tools\\claude\.cmd"/);
  assert.match(windowsScript, /"job_100%%!&\^\(\)"/);
  assert.ok(
    windowsScript.indexOf('del /f /q "%~f0"') <
      windowsScript.indexOf('"C:\\Users\\Ral%%profile!')
  );
  assert.equal(windowsScript.includes('\r\n'), true);
  assert.doesNotMatch(windowsScript, /\bcall\b|powershell|cmd\.exe/i);
  assert.throws(
    () =>
      terminal.createWindowsClaudeTerminalScript({
        executable: 'C:\\claude.exe',
        target: { action: 'resume', args: ['--resume', RESUME_ID], cwd: 'C:\\bad"cwd' }
      }),
    /double quotes/
  );

  const sharedSource = readFileSync(
    join(projectRoot, 'src/shared/codingAgent/codingAgentSession.type.ts'),
    'utf8'
  );
  const openResultStart = sharedSource.indexOf('export type OpenCodingAgentSessionResult');
  const openResultEnd = sharedSource.indexOf('export interface CodingAgentSessionApi');
  assert.ok(openResultStart >= 0 && openResultEnd > openResultStart);
  const publicOpenContract = sharedSource.slice(openResultStart, openResultEnd);
  for (const forbidden of ['terminal-command', 'target', 'executable', 'args', 'cwd']) {
    assert.equal(
      publicOpenContract.includes(forbidden),
      false,
      `public open result must not expose ${forbidden}`
    );
  }
  const storeSource = readFileSync(
    join(
      projectRoot,
      'src/renderer/home/src/views/codingAgentSessions/codingAgentSession.store.ts'
    ),
    'utf8'
  );
  for (const forbidden of ['result.target', 'result.executable', 'result.args', 'result.cwd']) {
    assert.equal(storeSource.includes(forbidden), false);
  }

  console.log('[coding-agent-integration] ok');
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
  rmSync(fixtureRoot, { recursive: true, force: true });
}
