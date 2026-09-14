/* eslint-disable @typescript-eslint/explicit-function-return-type -- Isolated native Web fixture. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { buildSync } from 'esbuild';
import WebSocket from 'ws';

const binary = join(process.cwd(), 'build/maestro-tools/zellij');
const run = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (condition, timeout = 5000) => {
  const end = Date.now() + timeout;
  while (!(await condition())) {
    if (Date.now() >= end) throw new Error('Isolated native Web fixture timed out');
    await delay(25);
  }
};

// https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-client/assets/websockets.js
// https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-client/src/web_client/http_handlers.rs
// login cookie -> POST /session -> paired terminal/control WebSockets.
test(
  'actual native Web renders beside a stalled sibling, survives transport restart and respects tombstones',
  {
    skip:
      process.platform !== 'darwin' || !existsSync(binary) ? 'requires staged macOS Zellij' : false,
    timeout: 30000
  },
  async (t) => {
    const root = mkdtempSync('/tmp/bl-web-native-');
    const home = join(root, 'home');
    const cwd = join(root, 'cwd');
    const socketDirectory = join(root, 's');
    const configFile = join(root, 'config.kdl');
    const layout = join(root, 'layout.kdl');
    const session = `fixture-${root.split('-').at(-1).toLowerCase()}`;
    const cacheDirectory = join(
      home,
      'Library/Caches/org.Zellij-Contributors.Zellij/contract_version_1/session_info'
    );
    for (const path of [
      home,
      cwd,
      join(root, 'tmp'),
      join(root, 'data'),
      join(socketDirectory, 'contract_version_1'),
      cacheDirectory
    ])
      mkdirSync(path, { recursive: true });
    writeFileSync(
      configFile,
      `default_shell "/bin/sh"\nweb_sharing "on"\nweb_server false\nenforce_https_for_localhost false\nsession_serialization false\ndefault_layout ${JSON.stringify(layout)}\n`
    );
    const shellCommand =
      "printf '\\033[32mBITTERLESS_WEB_FIXTURE\\033[0m\\n'; while read -r line; do printf 'WEB_INPUT_ACCEPTED\\n'; done";
    writeFileSync(
      layout,
      `layout { pane command="/bin/sh" { args "-c" ${JSON.stringify(shellCommand)}; }; }\n`
    );
    const env = {
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: home,
      TMPDIR: join(root, 'tmp'),
      XDG_DATA_HOME: join(root, 'data'),
      XDG_CONFIG_HOME: join(root, 'config'),
      SHELL: '/bin/sh',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      ZELLIJ_SOCKET_DIR: socketDirectory,
      ZELLIJ_CONFIG_DIR: root,
      ZELLIJ_CONFIG_FILE: configFile
    };
    const output = join(root, 'fixture.cjs');
    buildSync({
      stdin: {
        contents: `export * from './src/main/zellij/zellijNativeSession.service'; export * from './src/main/zellij/zellijWebBridge.service'; export * from './src/main/zellij/zellijNativeOwner.service';`,
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
      ZellijWebBridgeService,
      inspectZellijNativeOwner,
      isZellijNativeOwnerAlive
    } = createRequire(import.meta.url)(output);
    const service = new ZellijNativeSessionService({
      binary,
      configFile,
      socketDirectory,
      cacheDirectory,
      ownershipFile: join(root, 'owners.json'),
      spawn: async (socket, name, selectedCwd) => {
        await run(binary, ['--server', socket], {
          cwd: selectedCwd,
          env: { ...env, ZELLIJ: '0', ZELLIJ_SESSION_NAME: name },
          timeout: 4000
        });
      }
    });
    const peers = new Set();
    const websockets = new Set();
    const bridges = [];
    const children = [];
    let badContacts = 0;
    let identity;
    const bad = createServer((socket) => {
      badContacts++;
      peers.add(socket);
      socket.on('data', () => {});
      socket.on('error', () => {});
      socket.on('close', () => peers.delete(socket));
    });
    const stopChild = async (entry) => {
      if (entry.child.exitCode === null && entry.child.signalCode === null)
        entry.child.kill('SIGTERM');
      const timer = setTimeout(() => entry.child.kill('SIGKILL'), 1500);
      await entry.closed;
      clearTimeout(timer);
      assert.ok(entry.child.exitCode !== null || entry.child.signalCode !== null);
    };
    t.after(async () => {
      for (const socket of websockets) socket.terminate();
      for (const entry of children) await stopChild(entry);
      for (const bridge of bridges) await bridge.stop();
      for (const socket of peers) socket.destroy();
      await new Promise((resolve) => bad.close(resolve));
      await service.close(session);
      if (identity) assert.equal(await isZellijNativeOwnerAlive(identity), false);
      rmSync(root, { recursive: true, force: true });
      assert.equal(existsSync(root), false);
    });
    await new Promise((resolve, reject) => {
      bad.once('error', reject);
      bad.listen(join(socketDirectory, 'contract_version_1', 'unresponsive-sibling'), resolve);
    });
    await service.create(session, cwd);
    identity = await inspectZellijNativeOwner(service.socket(session), binary);
    assert.ok(identity);
    const tokenResult = await run(binary, ['--config', configFile, 'web', '--create-token'], {
      env,
      cwd,
      timeout: 3000
    });
    const token = tokenResult.stdout.match(/token_\d+:\s*([0-9a-f-]{36})/i)?.[1];
    assert.ok(token, 'isolated native authentication token was created');

    const startWeb = async () => {
      const bridge = new ZellijWebBridgeService(() => {});
      bridges.push(bridge);
      await bridge.register(session, service.socket(session));
      const portLease = createServer();
      await new Promise((resolve) => portLease.listen(0, '127.0.0.1', resolve));
      const port = portLease.address().port;
      await new Promise((resolve) => portLease.close(resolve));
      const child = spawn(
        binary,
        ['--config', configFile, 'web', '--start', '--ip', '127.0.0.1', '--port', String(port)],
        {
          cwd,
          env: { ...env, ZELLIJ_SOCKET_DIR: bridge.directory },
          stdio: 'ignore'
        }
      );
      const entry = { child, closed: new Promise((resolve) => child.once('close', resolve)) };
      children.push(entry);
      const origin = `http://127.0.0.1:${port}`;
      await until(async () => {
        assert.equal(child.exitCode, null, 'isolated web server remains running');
        try {
          const response = await fetch(`${origin}/info/version`, {
            signal: AbortSignal.timeout(300)
          });
          return response.ok && (await response.text()).trim() === '0.45.1';
        } catch {
          return false;
        }
      });
      const login = await fetch(`${origin}/command/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_token: token, remember_me: false }),
        signal: AbortSignal.timeout(1000)
      });
      assert.equal(login.status, 200);
      assert.equal((await login.json()).success, true);
      const cookie = login.headers.get('set-cookie')?.split(';')[0];
      assert.ok(cookie, 'isolated browser session cookie exists');
      return { bridge, entry, origin, cookie };
    };
    const attach = async (web) => {
      const response = await fetch(`${web.origin}/session?session=${session}&welcome=false`, {
        method: 'POST',
        headers: { Cookie: web.cookie },
        signal: AbortSignal.timeout(1000)
      });
      assert.equal(response.status, 200);
      const { web_client_id: clientId } = await response.json();
      const wsOrigin = web.origin.replace('http:', 'ws:');
      const terminal = new WebSocket(
        `${wsOrigin}/ws/terminal/${session}?web_client_id=${clientId}&rows=24&cols=100`,
        { headers: { Cookie: web.cookie }, handshakeTimeout: 1500 }
      );
      const control = new WebSocket(`${wsOrigin}/ws/control?web_client_id=${clientId}`, {
        headers: { Cookie: web.cookie },
        handshakeTimeout: 1500
      });
      let rendered = '';
      let closed = false;
      let failed = false;
      for (const socket of [terminal, control]) {
        websockets.add(socket);
        socket.on('error', () => {
          failed = true;
        });
        socket.once('close', () => websockets.delete(socket));
      }
      terminal.on('message', (data) => {
        rendered += data.toString();
      });
      terminal.once('close', () => {
        closed = true;
      });
      control.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'QueryTerminalSize')
          control.send(
            JSON.stringify({
              web_client_id: clientId,
              payload: { type: 'TerminalResize', rows: 24, cols: 100 }
            })
          );
      });
      return {
        terminal,
        control,
        rendered: () => rendered,
        closed: () => closed,
        failed: () => failed
      };
    };

    let web = await startWeb();
    let browser = await attach(web);
    await until(() => browser.rendered().includes('BITTERLESS_WEB_FIXTURE'));
    assert.ok(browser.rendered().includes('\x1b['), 'native terminal produced an ANSI render');
    browser.terminal.send('\r');
    await until(() => browser.rendered().includes('WEB_INPUT_ACCEPTED'));
    assert.equal(browser.failed(), false);
    assert.equal(badContacts, 0, 'actual Web attach never probes the canonical stalled sibling');
    t.diagnostic(
      'actual native WebSocket rendered and accepted input through the production bridge'
    );
    browser.terminal.terminate();
    browser.control.terminate();
    await stopChild(web.entry);
    await web.bridge.stop();
    assert.equal(await isZellijNativeOwnerAlive(identity), true);
    web = await startWeb();
    browser = await attach(web);
    await until(() => browser.rendered().includes('BITTERLESS_WEB_FIXTURE'));
    assert.equal(browser.failed(), false);
    assert.equal(
      (await inspectZellijNativeOwner(service.socket(session), binary)).pid,
      identity.pid
    );
    assert.equal(badContacts, 0);
    t.diagnostic('fresh Web server and bridge reattached to the unchanged canonical native PID');

    web.bridge.retire(session);
    await service.close(session);
    const bridgeSocket = join(web.bridge.directory, 'contract_version_1', session);
    const inode = lstatSync(bridgeSocket).ino;
    const rejected = await attach(web);
    await until(() => rejected.closed());
    assert.equal(rejected.rendered().includes('BITTERLESS_WEB_FIXTURE'), false);
    assert.equal(existsSync(service.socket(session)), false);
    assert.equal(
      lstatSync(bridgeSocket).ino,
      inode,
      'native Web did not replace the tombstone to auto-create a session'
    );
    assert.equal(await inspectZellijNativeOwner(bridgeSocket, binary), null);
    assert.equal(badContacts, 0);
    t.diagnostic('retired bridge rejected Web attach without creating a native session');
  }
);
