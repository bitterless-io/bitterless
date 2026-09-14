import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { buildSync } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'zellij-child-tests-'));
const output = join(directory, 'child.cjs');
buildSync({
  entryPoints: ['src/main/zellij/zellijChildProcess.service.ts'],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  tsconfig: 'tsconfig.node.json'
});
const { spawnZellijServer, runZellijCli, ZellijCliError, isZellijNoSessionsError } = createRequire(
  import.meta.url
)(output);
test.after(() => rmSync(directory, { recursive: true, force: true }));

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Node runs this JavaScript harness directly.
const captureLogs = (t) => {
  const records = [];
  const listeners = new Set();
  for (const level of ['info', 'error']) {
    t.mock.method(console, level, (...args) => {
      const record = { level, args, text: args.join(' ') };
      records.push(record);
      for (const listener of listeners) listener(record);
    });
  }
  return {
    records,
    wait: (event) => {
      const existing = records.find((record) => record.text.includes(event));
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Missing child event ${event}`)), 5_000);
        // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- JavaScript event callback.
        const listener = (record) => {
          if (!record.text.includes(event)) return;
          clearTimeout(timer);
          listeners.delete(listener);
          resolve(record);
        };
        listeners.add(listener);
      });
    }
  };
};

test('the real adapter logs nonzero exit with drained, sanitized stderr and no stdout', async (t) => {
  const logs = captureLogs(t);
  const child = spawnZellijServer(process.execPath, {
    args: [
      '-e',
      `
      process.stdout.write('stdout-private-token');
      process.stderr.write('\u001b[31mIPC socket path is too long: /Users/fixture-user/socket\u001b[0m\\npassword=');
      setTimeout(() => { process.stderr.write('short-secret\\n'); process.exitCode = 7; }, 20);
    `
    ]
  });
  let exits = 0;
  child.onExit(() => {
    exits += 1;
  });
  const failure = await logs.wait('unexpected-exit');
  assert.equal(failure.level, 'error');
  assert.match(failure.text, /exitCode=7 signal=none/);
  assert.match(failure.text, /IPC socket path is too long: ~\/socket/);
  assert.match(failure.text, /password=\*\*\*/);
  assert.doesNotMatch(failure.text, /fixture-user|short-secret|stdout-private-token/);
  assert.equal(failure.text.includes(String.fromCharCode(27)), false);
  assert.equal(child.exited(), true);
  assert.equal(exits, 1);
  await child.stop();
});

test('OS spawn failures log code and syscall and notify exit exactly once', async (t) => {
  const logs = captureLogs(t);
  const child = spawnZellijServer(join(directory, 'missing-zellij'), { args: [] });
  let exits = 0;
  child.onExit(() => {
    exits += 1;
  });
  const failure = await logs.wait('spawn-error');
  assert.match(failure.text, /osError=ENOENT syscall=spawn/);
  assert.equal(child.exited(), true);
  assert.equal(exits, 1);
  await child.stop();
});

test('requested stop is distinguished from an unexpected signal exit', async (t) => {
  const logs = captureLogs(t);
  const child = spawnZellijServer(process.execPath, {
    args: ['-e', 'setInterval(() => {}, 1000)']
  });
  await logs.wait('server spawned');
  await child.stop();
  const stopped = await logs.wait('requested-stop');
  assert.equal(stopped.level, 'info');
  assert.equal(
    logs.records.some((record) => record.level === 'error'),
    false
  );

  spawnZellijServer(process.execPath, { args: ['-e', 'process.kill(process.pid, "SIGTERM")'] });
  const failure = await logs.wait('unexpected-exit');
  assert.equal(failure.level, 'error');
  assert.match(failure.text, /signal=SIGTERM/);
});

test('stderr is bounded and an incomplete truncated credential line is withheld', async (t) => {
  const logs = captureLogs(t);
  spawnZellijServer(process.execPath, {
    args: [
      '-e',
      `process.stderr.write('native failure\\n' + 'x'.repeat(16355) + ' password=short-secret-more-data'); process.exitCode = 1;`
    ]
  });
  const failure = await logs.wait('unexpected-exit');
  const stderr = failure.args.find((value) => value.startsWith('stderr='));
  assert.equal(stderr, 'stderr=native failure');
  assert.doesNotMatch(failure.text, /short-secret/);
});

test('CLI failure retains safe diagnostics but token stdout never reaches a log', async (t) => {
  const logs = captureLogs(t);
  await assert.rejects(
    runZellijCli(process.execPath, {
      args: [
        '-e',
        `process.stdout.write('private-token-output'); process.stderr.write('Error: password=short-secret'); process.exitCode = 9;`
      ]
    }),
    /operation-failed/
  );
  const failure = await logs.wait('cli failed');
  assert.match(failure.text, /exitCode=9/);
  assert.match(failure.text, /stderr=Error: password=\*\*\*/);
  assert.doesNotMatch(failure.text, /private-token-output|short-secret/);
  const result = await runZellijCli(process.execPath, {
    args: ['-e', 'process.stdout.write("private-success-token")']
  });
  assert.equal(result, 'private-success-token');
  assert.equal(logs.records.length, 1);
});

test('CLI stdout limit fails without exposing oversized token output', async (t) => {
  const logs = captureLogs(t);
  await assert.rejects(
    runZellijCli(process.execPath, {
      args: [
        '-e',
        `process.stdout.write('private-output-'.repeat(6000)); setInterval(() => {}, 1000);`
      ]
    }),
    /operation-failed/
  );
  const failure = await logs.wait('cli failed');
  assert.match(failure.text, /reason=stdout-limit/);
  assert.doesNotMatch(failure.text, /private-output/);
});

test('CLI and server inherit the supplied socket environment without logging unrelated values', async (t) => {
  const logs = captureLogs(t);
  const env = {
    ...process.env,
    ZELLIJ_SOCKET_DIR: '/tmp/test-short-socket',
    PRIVATE_VALUE: 'do-not-log'
  };
  const script =
    'if (process.env.ZELLIJ_SOCKET_DIR !== "/tmp/test-short-socket" || process.env.PRIVATE_VALUE !== "do-not-log") process.exitCode = 12;';
  assert.equal(await runZellijCli(process.execPath, { args: ['-e', script], env }), '');
  spawnZellijServer(process.execPath, { args: ['-e', script], env });
  const stopped = await logs.wait('unexpected-exit');
  assert.match(stopped.text, /exitCode=0/);
  assert.doesNotMatch(JSON.stringify(logs.records), /do-not-log/);
});

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- JavaScript test fixture.
const mockCli = (t) => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = t.mock.fn(() => true);
  child.unref = t.mock.fn();
  t.mock.method(childProcess, 'spawn', () => child);
  return child;
};

test('CLI operations are classified by command, never by an option value or command payload', async (t) => {
  const logs = captureLogs(t);
  const child = mockCli(t);
  const cases = [
    [['--version'], 'version'],
    [['--server', 'private-socket'], 'session-bootstrap'],
    [['--config', '--server', 'setup', '--check'], 'config-check'],
    [['--session', '--server', 'action', 'list-panes', '--json'], 'pane-metadata'],
    [['--config', 'action', 'setup', '--check'], 'config-check'],
    [['--config', 'attach', 'setup', '--dump-config'], 'setup'],
    [['--config', 'web', 'list-sessions', '--no-formatting'], 'session-list'],
    [['--config', 'setup', 'attach', '--create-background', 'private-session'], 'session-prepare'],
    [['--session', 'attach', 'action', 'list-panes', '--json'], 'pane-metadata'],
    [['--session', 'setup', 'action', 'current-tab-info', '--json'], 'pane-metadata'],
    [['--session', 'list-sessions', 'action', 'write-chars', 'private-command'], 'session-action'],
    [['--config', 'setup', 'kill-session', 'private-session'], 'session-kill'],
    [['--config', 'setup', 'delete-session', 'private-session'], 'session-delete'],
    [['--config', 'action', 'web', '--create-token'], 'create-token'],
    [['web', '--port', '12879'], 'web'],
    [['private-unknown-command', 'setup', '--check'], 'unknown'],
    [[], 'unknown']
  ];
  for (const [args, operation] of cases) {
    child.removeAllListeners();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const result = runZellijCli('/private-binary', { args });
    child.emit('close', 7, null);
    await assert.rejects(result, (error) => {
      assert.ok(error instanceof ZellijCliError);
      assert.equal(error.operation, operation);
      assert.equal(error.reason, 'exit');
      assert.equal(error.exitCode, 7);
      assert.equal(error.terminationObserved, true);
      assert.equal(error.message, 'operation-failed');
      assert.equal(isZellijNoSessionsError(error), false);
      return true;
    });
    assert.match(logs.records.at(-1).text, new RegExp(`operation=${operation} reason=exit`));
  }
  assert.doesNotMatch(
    JSON.stringify(logs.records),
    /private-binary|private-session|private-socket|private-command|private-unknown-command/
  );
});

test('only the exact native empty-inventory result is classified as no-sessions', async (t) => {
  captureLogs(t);
  const child = mockCli(t);
  const cases = [
    { code: 1, stderr: 'No active zellij sessions found.\n', empty: true },
    { code: 1, stderr: 'Socket failed\nNo active zellij sessions found.\n', empty: false },
    { code: 1, stderr: 'No active zellij sessions found.\n' + 'x'.repeat(17_000), empty: false },
    { code: 2, stderr: 'No active zellij sessions found.\n', empty: false },
    { code: 1, stderr: '', empty: false },
    {
      code: 1,
      stderr: 'No active zellij sessions found.\n',
      stdout: 'private-token',
      empty: false
    },
    { code: 1, stderr: 'No active zellij sessions found.\n', command: 'kill-session', empty: false }
  ];
  // Each invocation owns its own streams: accumulated stderr must not cross commands.
  for (const { code, stderr, stdout = '', command = 'list-sessions', empty } of cases) {
    child.removeAllListeners();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const result = runZellijCli('/private-binary', { args: [command] });
    child.stdout.write(stdout);
    child.stderr.write(stderr);
    child.emit('close', code, null);
    await assert.rejects(result, (error) => {
      assert.equal(isZellijNoSessionsError(error), empty);
      assert.equal(error.reason, empty ? 'no-sessions' : 'exit');
      assert.doesNotMatch(JSON.stringify(error), /private-token|No active/);
      return true;
    });
  }
  assert.equal(isZellijNoSessionsError(new Error('No active zellij sessions found.')), false);
});

test('real CLI spawn errors retain safe OS metadata and never imply an empty inventory', async (t) => {
  const logs = captureLogs(t);
  await assert.rejects(
    runZellijCli(join(directory, 'private-missing-binary'), { args: ['list-sessions'] }),
    (error) => {
      assert.ok(error instanceof ZellijCliError);
      assert.equal(error.operation, 'session-list');
      assert.equal(error.reason, 'spawn-error');
      assert.equal(error.osErrorCode, 'ENOENT');
      assert.equal(isZellijNoSessionsError(error), false);
      assert.doesNotMatch(JSON.stringify(error), /private-missing-binary/);
      return true;
    }
  );
  assert.match(logs.records[0].text, /operation=session-list reason=spawn-error/);
});

test('synchronous spawn failures also use structured metadata without exposing invalid arguments', async (t) => {
  const logs = captureLogs(t);
  await assert.rejects(runZellijCli('private-binary\0', { args: ['--version'] }), (error) => {
    assert.ok(error instanceof ZellijCliError);
    assert.equal(error.operation, 'version');
    assert.equal(error.reason, 'spawn-error');
    assert.equal(error.osErrorCode, 'ERR_INVALID_ARG_VALUE');
    assert.equal(error.terminationObserved, false);
    assert.equal(isZellijNoSessionsError(error), false);
    assert.doesNotMatch(JSON.stringify(error), /private-binary/);
    return true;
  });
  assert.doesNotMatch(JSON.stringify(logs.records), /private-binary/);
});

test('a real timed-out CLI waits for close and reports the observed SIGKILL', async (t) => {
  const logs = captureLogs(t);
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) =>
    schedule(callback, delay === 15_000 ? 100 : delay, ...args)
  );
  await assert.rejects(
    runZellijCli(process.execPath, {
      args: ['-e', 'process.stdout.write("private-token"); setInterval(() => {}, 1000);']
    }),
    (error) => {
      assert.ok(error instanceof ZellijCliError);
      assert.equal(error.reason, 'timeout');
      assert.equal(error.exitCode, null);
      assert.equal(error.signal, 'SIGKILL');
      assert.equal(error.requestedSignal, 'SIGKILL');
      assert.equal(error.terminationObserved, true);
      assert.equal(isZellijNoSessionsError(error), false);
      assert.doesNotMatch(JSON.stringify(error), /private-token/);
      return true;
    }
  );
  assert.match(logs.records[0].text, /reason=timeout exitCode=null signal=SIGKILL/);
  assert.doesNotMatch(JSON.stringify(logs.records), /private-token/);
});

test('timeout settlement stays bounded when close never arrives and marks unobserved termination', async (t) => {
  const logs = captureLogs(t);
  const child = mockCli(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let settled = false;
  const result = runZellijCli('/private-binary', { args: ['list-sessions'] });
  const checked = assert.rejects(result, (error) => {
    settled = true;
    assert.equal(error.operation, 'session-list');
    assert.equal(error.reason, 'timeout');
    assert.equal(error.signal, null);
    assert.equal(error.requestedSignal, 'SIGKILL');
    assert.equal(error.terminationObserved, false);
    assert.equal(isZellijNoSessionsError(error), false);
    return true;
  });
  t.mock.timers.tick(15_000);
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(
    child.kill.mock.calls.map((call) => call.arguments),
    [['SIGKILL']]
  );
  t.mock.timers.tick(1_000);
  await checked;
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);
  assert.equal(child.unref.mock.callCount(), 1);
  assert.match(
    logs.records[0].text,
    /signal=unknown requestedSignal=SIGKILL terminationObserved=false/
  );
  child.emit('close', null, 'SIGKILL');
  assert.equal(logs.records.length, 1);
});

test('an observed exit signal survives a missing close event and bounded pipe cleanup', async (t) => {
  const logs = captureLogs(t);
  const child = mockCli(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = runZellijCli('/private-binary', { args: ['list-sessions'] });
  const checked = assert.rejects(result, (error) => {
    assert.equal(error.reason, 'timeout');
    assert.equal(error.signal, 'SIGKILL');
    assert.equal(error.terminationObserved, true);
    return true;
  });
  t.mock.timers.tick(15_000);
  child.emit('exit', null, 'SIGKILL');
  t.mock.timers.tick(1_000);
  await checked;
  assert.match(
    logs.records[0].text,
    /signal=SIGKILL requestedSignal=SIGKILL terminationObserved=true/
  );
});

test('an explicit bootstrap timeout is honored instead of the default fifteen seconds', async (t) => {
  const logs = captureLogs(t);
  const child = mockCli(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = runZellijCli('/private-binary', {
    args: ['--server', 'private-socket'],
    timeoutMs: 5_000
  });
  const checked = assert.rejects(result, (error) => {
    assert.equal(error.operation, 'session-bootstrap');
    assert.equal(error.reason, 'timeout');
    assert.equal(error.signal, 'SIGKILL');
    return true;
  });
  t.mock.timers.tick(4_999);
  assert.equal(child.kill.mock.callCount(), 0);
  t.mock.timers.tick(1);
  assert.deepEqual(child.kill.mock.calls[0].arguments, ['SIGKILL']);
  child.emit('close', null, 'SIGKILL');
  await checked;
  assert.doesNotMatch(JSON.stringify(logs.records), /private-socket/);
});

test('exit zero without close rejects incomplete stdout instead of returning partial success', async (t) => {
  const logs = captureLogs(t);
  const child = mockCli(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = runZellijCli('/private-binary', { args: ['web', '--create-token'] });
  const checked = assert.rejects(result, (error) => {
    assert.ok(error instanceof ZellijCliError);
    assert.equal(error.operation, 'create-token');
    assert.equal(error.reason, 'close-timeout');
    assert.equal(error.exitCode, 0);
    assert.equal(error.signal, null);
    assert.equal(error.requestedSignal, null);
    assert.equal(error.terminationObserved, true);
    assert.equal(isZellijNoSessionsError(error), false);
    assert.doesNotMatch(JSON.stringify(error), /private-partial-token/);
    return true;
  });
  child.stdout.write('private-partial-token');
  child.emit('exit', 0, null);
  t.mock.timers.tick(1_000);
  await checked;
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);
  assert.equal(child.kill.mock.callCount(), 0);
  assert.equal(child.unref.mock.callCount(), 1);
  assert.match(logs.records[0].text, /reason=close-timeout exitCode=0/);
  assert.doesNotMatch(JSON.stringify(logs.records), /private-partial-token/);
  child.emit('close', 0, null);
  assert.equal(logs.records.length, 1);
});

test('exit one without close never treats an incomplete empty-inventory stderr prefix as no-sessions', async (t) => {
  const logs = captureLogs(t);
  const child = mockCli(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = runZellijCli('/private-binary', { args: ['list-sessions'] });
  const checked = assert.rejects(result, (error) => {
    assert.ok(error instanceof ZellijCliError);
    assert.equal(error.operation, 'session-list');
    assert.equal(error.reason, 'close-timeout');
    assert.equal(error.exitCode, 1);
    assert.equal(error.terminationObserved, true);
    assert.equal(isZellijNoSessionsError(error), false);
    return true;
  });
  child.stderr.write('No active zellij sessions found.\n');
  child.emit('exit', 1, null);
  t.mock.timers.tick(1_000);
  await checked;
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);
  assert.match(logs.records[0].text, /operation=session-list reason=close-timeout/);
});

test('output received after exit is returned only after close completes within the drain deadline', async (t) => {
  const logs = captureLogs(t);
  const child = mockCli(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let settled = false;
  const result = runZellijCli('/private-binary', { args: ['web', '--create-token'] });
  result.then(() => {
    settled = true;
  });
  child.stdout.write('private-prefix');
  child.emit('exit', 0, null);
  t.mock.timers.tick(500);
  await Promise.resolve();
  assert.equal(settled, false);
  child.stdout.write('-complete-token');
  child.emit('close', 0, null);
  assert.equal(await result, 'private-prefix-complete-token');
  t.mock.timers.tick(1_000);
  assert.equal(child.unref.mock.callCount(), 0);
  assert.equal(child.kill.mock.callCount(), 0);
  assert.equal(logs.records.length, 0);
});

test('server stop callers share one pending operation until SIGTERM exit is observed', async (t) => {
  const logs = captureLogs(t);
  const native = mockCli(t);
  native.pid = 17701;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const server = spawnZellijServer('/private-binary', { args: ['web', '--start'] });
  let exits = 0;
  server.onExit(() => {
    exits += 1;
  });
  const first = server.stop();
  const second = server.stop();
  assert.equal(first, second);
  let settled = false;
  first.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(server.exited(), false);
  assert.deepEqual(
    native.kill.mock.calls.map((call) => call.arguments),
    [['SIGTERM']]
  );
  native.emit('exit', null, 'SIGTERM');
  await first;
  assert.equal(server.exited(), true);
  assert.equal(exits, 1);
  native.emit('close', null, 'SIGTERM');
  await server.stop();
  t.mock.timers.tick(10_000);
  assert.equal(native.kill.mock.callCount(), 1);
  assert.equal(native.unref.mock.callCount(), 0);
  assert.match(logs.records[0].text, /requested-stop.*signal=SIGTERM/);
});

test('server SIGKILL escalation waits for observed exit rather than resolving on the kill request', async (t) => {
  captureLogs(t);
  const native = mockCli(t);
  native.pid = 17702;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const server = spawnZellijServer('/private-binary', { args: ['web', '--start'] });
  let settled = false;
  const pending = server.stop();
  pending.then(() => {
    settled = true;
  });
  t.mock.timers.tick(2_000);
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(server.exited(), false);
  assert.equal(server.stop(), pending);
  assert.deepEqual(
    native.kill.mock.calls.map((call) => call.arguments),
    [['SIGTERM'], ['SIGKILL']]
  );
  t.mock.timers.tick(500);
  native.emit('exit', null, 'SIGKILL');
  await pending;
  assert.equal(server.exited(), true);
  // A descendant retaining stderr cannot retain the diagnostic pipe indefinitely after death.
  t.mock.timers.tick(1_000);
  assert.equal(native.stderr.destroyed, true);
  assert.equal(native.unref.mock.callCount(), 1);
});

test('a real server ignoring SIGTERM resolves stop only after observed SIGKILL death', async (t) => {
  const logs = captureLogs(t);
  const spawn = childProcess.spawn;
  let native;
  t.mock.method(childProcess, 'spawn', (...args) => {
    native = spawn(...args);
    return native;
  });
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) =>
    schedule(callback, delay === 2_000 ? 100 : delay, ...args)
  );
  const server = spawnZellijServer(process.execPath, {
    args: [
      '-e',
      'process.on("SIGTERM", () => {}); process.stderr.write("ready"); setInterval(() => {}, 1000);'
    ]
  });
  t.after(() => {
    if (native.exitCode === null && native.signalCode === null) native.kill('SIGKILL');
  });
  await once(native.stderr, 'data');
  const pending = server.stop();
  assert.equal(server.stop(), pending);
  await pending;
  assert.equal(server.exited(), true);
  assert.equal(native.signalCode, 'SIGKILL');
  const stopped = await logs.wait('requested-stop');
  assert.match(stopped.text, /signal=SIGKILL/);
});

test('unobserved server death rejects after both stages and signal errors do not imply exit', async (t) => {
  const logs = captureLogs(t);
  const native = mockCli(t);
  native.pid = 17703;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const server = spawnZellijServer('/private-binary', { args: ['web', '--start'] });
  let exits = 0;
  server.onExit(() => {
    exits += 1;
  });
  const pending = server.stop();
  const checked = assert.rejects(pending, /operation-failed/);
  native.emit(
    'error',
    Object.assign(new Error('private-signal-payload'), { code: 'EPERM', syscall: 'kill' })
  );
  assert.equal(server.exited(), false);
  assert.equal(exits, 0);
  t.mock.timers.tick(2_000);
  t.mock.timers.tick(2_000);
  await checked;
  assert.equal(server.exited(), false);
  assert.equal(exits, 0);
  assert.equal(native.stderr.destroyed, true);
  assert.equal(native.unref.mock.callCount(), 1);
  assert.match(
    logs.records[0].text,
    /stop-failed.*reason=exit-unobserved.*requestedSignal=SIGKILL/
  );
  assert.match(logs.records[0].text, /osError=EPERM syscall=kill/);
  assert.doesNotMatch(JSON.stringify(logs.records), /private-signal-payload/);
  native.emit('exit', null, 'SIGKILL');
  native.emit('close', null, 'SIGKILL');
  assert.equal(server.exited(), true);
  assert.equal(exits, 1);
  await server.stop();
  assert.equal(native.kill.mock.callCount(), 2);
});

test('already exited servers and failed spawns settle stop without sending any signals', async (t) => {
  captureLogs(t);
  const native = mockCli(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const exitedServer = spawnZellijServer('/private-binary', { args: [] });
  native.emit('exit', 0, null);
  native.emit('close', 0, null);
  await exitedServer.stop();
  assert.equal(native.kill.mock.callCount(), 0);
  const missing = mockCli(t);
  const failedServer = spawnZellijServer('/private-missing-binary', { args: [] });
  missing.emit(
    'error',
    Object.assign(new Error('private-spawn-payload'), { code: 'ENOENT', syscall: 'spawn' })
  );
  assert.equal(failedServer.exited(), true);
  await failedServer.stop();
  missing.emit('close', -2, null);
  t.mock.timers.tick(10_000);
  assert.equal(missing.kill.mock.callCount(), 0);
});
