/* eslint-disable @typescript-eslint/explicit-function-return-type -- Isolated native fixtures. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { buildSync } from 'esbuild';

const outputDirectory = mkdtempSync(join(tmpdir(), 'bl177-tests-'));
const output = join(outputDirectory, 'native.cjs');
buildSync({
  stdin: {
    contents: `export * from './src/main/zellij/zellijNativeSession.service'; export * from './src/main/zellij/zellijNativeIpc.service'; export * from './src/main/zellij/zellijWebBridge.service'; export * from './src/main/zellij/zellijNativeOwner.service'; export * from './src/main/zellij/zellijDirectory.service';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: output,
  tsconfig: 'tsconfig.node.json'
});
const {
  ZellijNativeSessionService,
  ZellijDirectoryService,
  ZellijNativeIpcService,
  ZellijWebBridgeService,
  inspectZellijNativeOwner,
  isZellijNativeOwnerAlive
} = createRequire(import.meta.url)(output);
const run = promisify(execFile);
const binary = join(process.cwd(), 'build/maestro-tools/zellij');
const nativeTest = process.platform === 'darwin' && existsSync(binary) ? test : test.skip;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (condition, timeout = 4000) => {
  const end = Date.now() + timeout;
  while (!(await condition())) {
    if (Date.now() >= end) throw new Error('fixture condition timed out');
    await delay(25);
  }
};
test.after(() => rmSync(outputDirectory, { recursive: true, force: true }));

const fixture = async (t) => {
  const root = mkdtempSync('/tmp/bl177-');
  const name = `fixture-${root.split('-').at(-1).toLowerCase()}`;
  const home = join(root, 'home');
  const cwd = join(root, 'cwd');
  const socketDirectory = join(root, 's');
  const configFile = join(root, 'config.kdl');
  const cacheDirectory = join(
    home,
    'Library/Caches/org.Zellij-Contributors.Zellij/contract_version_1/session_info'
  );
  for (const path of [
    home,
    cwd,
    join(root, 'tmp'),
    join(socketDirectory, 'contract_version_1'),
    cacheDirectory
  ])
    mkdirSync(path, { recursive: true });
  const layout = join(root, 'layout.kdl');
  writeFileSync(layout, 'layout { pane; }\n');
  writeFileSync(
    configFile,
    `default_shell "/bin/sh"\nweb_sharing "on"\nweb_server false\nsession_serialization false\ndefault_layout ${JSON.stringify(layout)}\n`
  );
  const env = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: home,
    TMPDIR: join(root, 'tmp'),
    SHELL: '/bin/sh',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    ZELLIJ_SOCKET_DIR: socketDirectory,
    ZELLIJ_CONFIG_FILE: configFile,
    ZELLIJ_CONFIG_DIR: root
  };
  const deps = {
    binary,
    socketDirectory,
    configFile,
    cacheDirectory,
    ownershipFile: join(root, 'owners.json'),
    spawn: async (socket, session, selectedCwd) => {
      await run(binary, ['--server', socket], {
        cwd: selectedCwd,
        env: { ...env, ZELLIJ: '0', ZELLIJ_SESSION_NAME: session },
        timeout: 4000
      });
    }
  };
  const services = [];
  const names = new Set();
  const connections = new Set();
  const servers = [];
  const bridges = [];
  const makeService = () => {
    const service = new ZellijNativeSessionService(deps);
    services.push(service);
    return service;
  };
  const stalled = async (path) => {
    mkdirSync(join(path, '..'), { recursive: true });
    let count = 0;
    const server = createServer((socket) => {
      count++;
      connections.add(socket);
      socket.on('error', () => {});
      socket.on('data', () => {});
      socket.on('close', () => connections.delete(socket));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(path, resolve);
    });
    servers.push(server);
    return () => count;
  };
  t.after(async () => {
    // Release fixture-only web-bus blockers before emergency cleanup; never touch user namespaces.
    for (const socket of connections) socket.destroy();
    for (const bridge of bridges) await bridge.stop();
    for (const session of names)
      await makeService()
        .close(session)
        .catch(() => {});
    for (const server of servers) await new Promise((resolve) => server.close(resolve));
    for (const session of names) {
      const owner = await inspectZellijNativeOwner(
        join(socketDirectory, 'contract_version_1', session),
        binary
      );
      assert.equal(owner, null, 'fixture daemon must be gone before cleanup');
    }
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    home,
    cwd,
    name,
    env,
    configFile,
    socketDirectory,
    cacheDirectory,
    deps,
    names,
    makeService,
    stalled,
    bridge: () => {
      const bridge = new ZellijWebBridgeService(() => {});
      bridges.push(bridge);
      return bridge;
    }
  };
};

nativeTest(
  'native creation, bridged discovery, exact close and service restart survive an unresponsive sibling',
  async (t) => {
    const f = await fixture(t);
    const badContacts = await f.stalled(
      join(f.socketDirectory, 'contract_version_1', 'unresponsive-sibling')
    );
    let service = f.makeService();
    f.names.add(f.name);
    await service.create(f.name, f.cwd);
    assert.equal(badContacts(), 0);
    let panes;
    await until(async () => {
      panes = JSON.parse(await service.metadata(f.name, 'list-panes'));
      return panes.some((pane) => !pane.is_plugin);
    });
    assert.equal(panes.find((pane) => !pane.is_plugin).pane_cwd, realpathSync(f.cwd));
    const identity = await inspectZellijNativeOwner(service.socket(f.name), binary);
    assert.ok(identity);
    await assert.rejects(
      run(binary, ['list-sessions', '--no-formatting'], { env: f.env, timeout: 250 }),
      (error) => error.killed
    );
    assert.ok(badContacts() > 0, 'the old discovery path fails against the same fixture');
    let bridge = f.bridge();
    await bridge.register(f.name, service.socket(f.name));
    const webEnv = { ...f.env, ZELLIJ_SOCKET_DIR: bridge.directory };
    const listed = await run(binary, ['list-sessions', '--no-formatting'], {
      env: webEnv,
      timeout: 1000
    });
    assert.ok(listed.stdout.includes(f.name));
    const bridgedPanes = await run(
      binary,
      ['--session', f.name, 'action', 'list-panes', '--json'],
      { env: webEnv, timeout: 1500 }
    );
    assert.ok(Array.isArray(JSON.parse(bridgedPanes.stdout)));
    service.stop();
    await bridge.stop();
    assert.equal(
      await isZellijNativeOwnerAlive(identity),
      true,
      'app transport teardown retains native session'
    );
    service = f.makeService();
    assert.equal(await service.exists(f.name), true);
    bridge = f.bridge();
    await bridge.register(f.name, service.socket(f.name));
    const second = `${f.name}-new`;
    f.names.add(second);
    await service.create(second, f.home);
    bridge.retire(f.name);
    await service.close(f.name);
    assert.equal(await isZellijNativeOwnerAlive(identity), false);
    assert.equal(await service.exists(second), true, 'closing one session retains its sibling');
    const tombstone = new ZellijNativeIpcService(
      join(bridge.directory, 'contract_version_1', f.name)
    );
    assert.equal(
      await tombstone.probe(),
      'ready',
      'ConnStatus reports bridge liveness to prevent Web auto-create'
    );
    await assert.rejects(tombstone.listPanes(), (error) => error.code === 'rejected');
    await service.create(f.name, f.home);
    await bridge.register(f.name, service.socket(f.name));
    let reopened;
    await until(async () => {
      reopened = JSON.parse(await service.metadata(f.name, 'list-panes'));
      return reopened.some((pane) => !pane.is_plugin);
    });
    assert.equal(reopened.filter((pane) => !pane.is_plugin).length, 1);
    assert.equal(reopened.find((pane) => !pane.is_plugin).pane_cwd, realpathSync(f.home));
    await service.close(f.name);
    await service.close(second);
  }
);

nativeTest(
  'exact explicit close completes native half-shutdown blocked on a stale web-server bus',
  async (t) => {
    const f = await fixture(t);
    const requests = await f.stalled(
      join(f.socketDirectory, 'contract_version_1', 'web_server_bus', 'stalled-web')
    );
    const service = f.makeService();
    f.names.add(f.name);
    await service.create(f.name, f.cwd);
    const owner = await inspectZellijNativeOwner(service.socket(f.name), binary);
    assert.ok(owner);
    await until(() => requests() > 0);
    // Native KillSession removes pane processes, then blocks joining background_jobs before unlink.
    await new ZellijNativeIpcService(service.socket(f.name)).killSession().catch(() => {});
    await assert.rejects(
      new ZellijNativeIpcService(service.socket(f.name), { timeoutMs: 150 }).probe(),
      (error) => ['timeout', 'disconnected'].includes(error.code)
    );
    assert.equal(await isZellijNativeOwnerAlive(owner), true);
    mkdirSync(join(f.cacheDirectory, f.name), { recursive: true });
    writeFileSync(join(f.cacheDirectory, f.name, 'session-layout.kdl'), 'fixture old cache');
    const started = Date.now();
    await service.close(f.name);
    assert.ok(Date.now() - started < 4000);
    assert.equal(await isZellijNativeOwnerAlive(owner), false);
    assert.equal(existsSync(service.socket(f.name)), false);
    assert.equal(existsSync(join(f.cacheDirectory, f.name)), false);
  }
);

nativeTest('stopping during native spawn cleans the exact uninitialized daemon', async (t) => {
  const f = await fixture(t);
  let service;
  const deps = {
    ...f.deps,
    spawn: async (...args) => {
      await f.deps.spawn(...args);
      service.stop();
    }
  };
  service = new ZellijNativeSessionService(deps);
  f.names.add(f.name);
  await assert.rejects(service.create(f.name, f.cwd));
  assert.equal(existsSync(service.socket(f.name)), false);
  assert.equal(await service.exists(f.name), false);
});

nativeTest(
  'native bootstrap honors profile default layouts and relative custom layout directories',
  async (t) => {
    const f = await fixture(t);
    const profileLayouts = join(f.root, 'layouts');
    mkdirSync(profileLayouts);
    writeFileSync(join(profileLayouts, 'default.kdl'), 'layout { pane; pane; }\n');
    writeFileSync(
      f.configFile,
      'default_shell "/bin/sh"\nweb_sharing "on"\nweb_server false\nsession_serialization false\n'
    );
    const service = f.makeService();
    f.names.add(f.name);
    await service.create(f.name, f.cwd);
    await until(
      async () =>
        JSON.parse(await service.metadata(f.name, 'list-panes')).filter((pane) => !pane.is_plugin)
          .length === 2
    );
    await service.close(f.name);
    mkdirSync(join(f.cwd, 'custom-layouts'));
    writeFileSync(join(f.cwd, 'custom-layouts', 'chosen.kdl'), 'layout { pane; pane; pane; }\n');
    writeFileSync(
      f.configFile,
      'default_shell "/bin/sh"\nweb_sharing "on"\nweb_server false\nsession_serialization false\nlayout_dir "custom-layouts"\ndefault_layout "chosen"\n'
    );
    await service.create(f.name, f.cwd);
    await until(
      async () =>
        JSON.parse(await service.metadata(f.name, 'list-panes')).filter((pane) => !pane.is_plugin)
          .length === 3
    );
    const panes = JSON.parse(await service.metadata(f.name, 'list-panes'));
    assert.ok(
      panes.filter((pane) => !pane.is_plugin).every((pane) => pane.pane_cwd === realpathSync(f.cwd))
    );
  }
);

nativeTest(
  'directory shutdown joins a held native bootstrap cleanup and preserves initialized siblings',
  async (t) => {
    const f = await fixture(t);
    const existing = f.makeService();
    f.names.add(f.name);
    await existing.create(f.name, f.home);
    const pendingName = `${f.name}-pending`;
    f.names.add(pendingName);
    let release, entered;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const reached = new Promise((resolve) => {
      entered = resolve;
    });
    const native = new ZellijNativeSessionService({
      ...f.deps,
      spawn: async (...args) => {
        await f.deps.spawn(...args);
        entered();
        await gate;
      }
    });
    const directory = new ZellijDirectoryService({
      native,
      file: join(f.root, 'cwd.json'),
      home: f.home,
      configFile: f.configFile,
      run: async () => {
        throw new Error('unexpected CLI');
      }
    });
    const preparing = directory.prepare(pendingName);
    // Attach rejection handler immediately, while shutdown is deliberately held.
    const rejected = assert.rejects(preparing, /operation-failed/);
    await reached;
    let stopped = false;
    const stopping = directory.stop().then(() => {
      stopped = true;
    });
    await delay(50);
    assert.equal(stopped, false, 'application shutdown must wait for its pending native cleanup');
    release();
    await stopping;
    await rejected;
    assert.equal(existsSync(native.socket(pendingName)), false);
    assert.equal(await existing.exists(f.name), true);
  }
);
