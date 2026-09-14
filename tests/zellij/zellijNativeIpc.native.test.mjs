/* eslint-disable @typescript-eslint/explicit-function-return-type -- Isolated native Node fixture. */
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { buildSync } from 'esbuild';

const binary = join(process.cwd(), 'build/maestro-tools/zellij');
const run = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (check, timeout = 3000) => {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Native fixture deadline');
    await sleep(25);
  }
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test(
  'staged native exact IPC creates, queries and closes beside an unresponsive sibling',
  {
    skip:
      process.platform !== 'darwin' || !existsSync(binary) ? 'requires staged macOS Zellij' : false,
    timeout: 15000
  },
  async (t) => {
    const directory = mkdtempSync('/tmp/bl-ipc-native-');
    const socketBase = join(directory, 's');
    const socketDirectory = join(socketBase, 'contract_version_1');
    const sessionName = `fixture-${directory.split('-').at(-1)}`;
    const socketPath = join(socketDirectory, sessionName);
    const configFilePath = join(directory, 'config.kdl');
    const layoutPath = join(directory, 'layout.kdl');
    const cwd = join(directory, 'cwd');
    for (const folder of [socketDirectory, cwd, 'home', 'tmp', 'cache', 'data'].map((folder) =>
      folder.startsWith('/') ? folder : join(directory, folder)
    )) {
      mkdirSync(folder, { recursive: true });
    }
    const env = {
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: join(directory, 'home'),
      TMPDIR: join(directory, 'tmp'),
      XDG_CACHE_HOME: join(directory, 'cache'),
      XDG_DATA_HOME: join(directory, 'data'),
      XDG_CONFIG_HOME: join(directory, 'home'),
      ZELLIJ_CONFIG_DIR: directory,
      ZELLIJ_CONFIG_FILE: configFilePath,
      ZELLIJ_SOCKET_DIR: socketBase,
      ZELLIJ_SESSION_NAME: sessionName,
      SHELL: '/bin/sh',
      TERM: 'xterm-256color'
    };
    const shellPidPath = join(directory, 'shell.pid');
    const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
    const command = `printf '%s\\n' "$$" > ${quote(shellPidPath)}; pwd > ${quote(join(directory, 'actual-cwd'))}; while :; do sleep 60; done`;
    writeFileSync(
      configFilePath,
      'default_shell "/bin/sh"\nweb_server false\nweb_sharing "on"\nsession_serialization false\n'
    );
    writeFileSync(
      layoutPath,
      `layout { pane command="/bin/sh" { args "-c" ${JSON.stringify(command)}; }; }\n`
    );
    const output = join(directory, 'ipc.cjs');
    buildSync({
      entryPoints: ['src/main/zellij/zellijNativeIpc.service.ts'],
      outfile: output,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      tsconfig: 'tsconfig.node.json'
    });
    const { ZellijNativeIpcService } = createRequire(import.meta.url)(output);
    const client = new ZellijNativeIpcService(socketPath);
    const sockets = new Set();
    let siblingConnections = 0;
    let siblingBytes = 0;
    let serverPid;
    let shellPid;
    const sibling = createServer((socket) => {
      siblingConnections++;
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('data', (data) => {
        siblingBytes += data.length;
      });
      socket.on('close', () => sockets.delete(socket));
    });
    t.after(async () => {
      if (existsSync(socketPath)) {
        try {
          await client.killSession();
          await until(() => !existsSync(socketPath), 1000);
        } catch {
          // A failed fixture still needs the exact owned-process cleanup below.
        }
      }
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => sibling.close(resolve));
      if (serverPid && alive(serverPid)) {
        // Only the server owning this newly-created socket, and its current descendants, are ours.
        const command = execFileSync('/bin/ps', ['-p', String(serverPid), '-o', 'command='], {
          encoding: 'utf8'
        });
        assert.ok(command.includes(socketPath));
        const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' })
          .trim()
          .split('\n')
          .map((row) => row.trim().split(/\s+/).map(Number));
        const owned = [serverPid];
        for (let index = 0; index < owned.length; index++) {
          owned.push(...rows.filter(([, parent]) => parent === owned[index]).map(([pid]) => pid));
        }
        for (const pid of owned.reverse()) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // The fixture process can exit between enumeration and signal delivery.
          }
        }
      }
      if (serverPid) await until(() => !alive(serverPid));
      if (shellPid) await until(() => !alive(shellPid));
      rmSync(directory, { recursive: true, force: true });
      assert.equal(existsSync(directory), false);
    });
    await new Promise((resolve, reject) => {
      sibling.once('error', reject);
      sibling.listen(join(socketDirectory, 'unresponsive-sibling'), resolve);
    });
    assert.match(
      (await run(binary, ['--version'], { env, cwd, timeout: 3000 })).stdout,
      /0\.45\.1/
    );
    await run(binary, ['--config', configFilePath, 'setup', '--check'], {
      env,
      cwd,
      timeout: 3000
    });
    await run(binary, ['--server', socketPath], { env, cwd, timeout: 4000 });
    await until(() => existsSync(socketPath));
    const owners = execFileSync('/usr/sbin/lsof', ['-t', '--', socketPath], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map(Number);
    assert.equal(owners.length, 1);
    serverPid = owners[0];
    await client.firstClientConnected({
      configFilePath,
      configDir: directory,
      cwd,
      layout: { filePath: layoutPath },
      dataDir: join(directory, 'data')
    });
    await until(() => existsSync(shellPidPath));
    shellPid = Number(readFileSync(shellPidPath, 'utf8').trim());
    assert.equal(readFileSync(join(directory, 'actual-cwd'), 'utf8').trim(), realpathSync(cwd));
    const panes = JSON.parse(await client.listPanes());
    assert.ok(
      Array.isArray(panes) && panes.some((pane) => JSON.stringify(pane).includes('/bin/sh'))
    );
    await assert.rejects(client.currentTabInfo(), {
      code: 'rejected'
    });
    assert.equal(siblingConnections, 0, 'direct creation and metadata do not scan siblings');
    await assert.rejects(
      run(binary, ['list-sessions', '--no-formatting'], { env, cwd, timeout: 900 }),
      (error) => error.killed === true
    );
    assert.ok(siblingConnections > 0 && siblingBytes >= 6);
    assert.equal(await client.probe(), 'ready');
    const caches = readdirSync(directory, { recursive: true }).filter((name) =>
      name.endsWith('session_info')
    );
    t.diagnostic(`isolated native session cache: ${caches.join(', ')}`);
    await client.killSession();
    await until(() => !existsSync(socketPath));
    assert.equal(await client.probe(), 'absent');
    await until(() => !alive(serverPid) && !alive(shellPid));
  }
);
