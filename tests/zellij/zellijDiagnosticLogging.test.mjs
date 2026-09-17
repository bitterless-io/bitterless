/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native Node test fixtures. */
/**
 * Guards for the diagnostics the 2026-09-17 packaged incident needed and did not have
 * (docs/issues/zellij-update-restart-blocks-and-new-tab-fails.md).
 *
 * Two of these assert against the LOG SANITIZER rather than against zellij: the application log
 * sanitizes every record twice, and the two rules below silently erased exactly the fields this
 * subsystem must report. A line that reads fine in dev and turns into `***` on the Preview channel
 * is worse than no line, because it looks like evidence.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';

const directory = mkdtempSync('/tmp/bl-zellij-diagnostics-');
const load = (entry, name) => {
  const outfile = join(directory, `${name}.cjs`);
  buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    tsconfig: 'tsconfig.node.json'
  });
  return createRequire(import.meta.url)(outfile);
};

const { zellijLine, zellijDetail, zellijElapsed, zellijSessionTag, zellijSurfaceTag } = load(
  'src/main/zellij/zellijLog.service.ts',
  'log'
);
const { sanitizeDiagnostic, sanitizeErrorCauseChain } = load(
  'src/shared/diagnostics/diagnostic.service.ts',
  'diagnostic'
);
const { ZellijNativeIpcError } = load('src/main/zellij/zellijNativeIpc.service.ts', 'ipc');
const { ZellijNativeSessionService } = load(
  'src/main/zellij/zellijNativeSession.service.ts',
  'session'
);
const { encodeZellijServerMessage } = load(
  'src/main/zellij/zellijNativeProtocol.ts',
  'protocol'
);

test.after(() => rmSync(directory, { recursive: true, force: true }));

test('every field a zellij log line carries survives the application sanitizer unchanged', () => {
  const lines = [
    zellijLine('prepare-start', {
      surface: '8f61a9105519',
      attempt: 1,
      profile: 'production-preview',
      prepared: 5,
      stopping: false,
      generation: 0
    }),
    zellijLine('prepare-stage', { surface: '8f61a9105519', stage: 'directory-prepare', elapsedMs: 1234 }),
    zellijLine('prepare-end', {
      surface: '8f61a9105519',
      outcome: 'failure',
      reason: 'operation-failed',
      stage: 'directory-prepare',
      elapsedMs: 15000
    }),
    zellijLine('native-create', {
      session: '8f61a9105519',
      outcome: 'failure',
      reason: 'first-client-rejected',
      pid: 48339,
      elapsedMs: 14990
    }),
    zellijLine('native-inventory', { session: 'd71a35d20252', pid: 86638, verdict: 'unverifiable' }),
    zellijLine('runtime-probe', { phase: 'initial', verdict: 'absent', elapsedMs: 900 }),
    zellijLine('config-write', { mode: 'upgrade', bytes: 6470, elapsedMs: 480 })
  ];
  for (const line of lines) assert.equal(sanitizeDiagnostic(line), line, line);
});

test('a full Preview session name is unloggable, which is why identity travels as its tag', () => {
  // 31 characters: the sanitizer's 24-char opaque-token rule erases it. The Production form is 23
  // and survives — the asymmetry that would have made this class of line pass review on dev only.
  assert.equal(sanitizeDiagnostic('bitterless-preview-8f61a9105519'), '***');
  assert.equal(sanitizeDiagnostic('bitterless-8f61a9105519'), 'bitterless-8f61a9105519');
  assert.equal(zellijSessionTag('bitterless-preview-8f61a9105519'), '8f61a9105519');
  assert.equal(zellijSessionTag('bitterless-8f61a9105519'), '8f61a9105519');
  const tagged = zellijLine('native-exists', {
    session: zellijSessionTag('bitterless-preview-8f61a9105519'),
    verdict: 'reuse'
  });
  assert.equal(sanitizeDiagnostic(tagged), tagged);
  assert.match(tagged, /session=8f61a9105519/u);
});

test('a field name the sanitizer treats as a credential key is renamed, never dropped', () => {
  // `code=rejected` became `code=***` in main.log. The helper renames the key so the VALUE lives.
  assert.equal(sanitizeDiagnostic('code=rejected'), 'code=***');
  const line = zellijLine('native-create', { code: 'rejected' });
  assert.match(line, /codeValue=rejected/u);
  assert.equal(sanitizeDiagnostic(line), line);
  for (const name of ['token', 'password', 'credential', 'api_key', 'authorization_code']) {
    const rendered = zellijLine('probe', { [name]: 'value' });
    assert.equal(sanitizeDiagnostic(rendered), rendered, rendered);
  }
});

test('an error cause chain reports its code instead of having it redacted', () => {
  const chain = sanitizeErrorCauseChain(new ZellijNativeIpcError('rejected', 'Zellij rejected the request'));
  // The regression this pins: with the field named `code`, the second sanitizer pass erased it and
  // the only line the incident produced read `code=***`.
  assert.match(chain, /errorCode=rejected/u);
  assert.equal(sanitizeDiagnostic(`[error ${chain}]`), `[error ${chain}]`);
  assert.doesNotMatch(sanitizeDiagnostic(`[error ${chain}]`), /\*\*\*/u);
  const legacy = '[error name=ZellijNativeIpcError code=rejected message=Zellij rejected the request]';
  assert.match(sanitizeDiagnostic(legacy), /code=\*\*\*/u);
});

test('values are bounded and non-strings are coerced without ever emitting NaN or a raw object', () => {
  assert.match(zellijLine('probe', { value: 'a'.repeat(200) }), /value=a{23}(?: |$)/u);
  assert.match(zellijLine('probe', { value: Number.NaN }), /value=invalid/u);
  assert.match(zellijLine('probe', { value: -5 }), /value=0/u);
  assert.match(zellijLine('probe', { value: undefined }), /value=none/u);
  assert.match(zellijLine('probe', { value: '  ' }), /value=none/u);
  assert.match(zellijLine('probe', { value: 'a b/c' }), /value=a-b-c/u);
  assert.equal(zellijElapsed(Date.now() + 5_000), 0);
  assert.equal(zellijElapsed(1_000, 1_500), 500);
  assert.equal(zellijElapsed(Number.NaN), 0);
  assert.equal(zellijSurfaceTag('omni-8f61a9105519-cell'), 'omni-8f61a9105519-cell');
});

test('zellij detail is bounded, sanitized and keeps credentials out of the log', () => {
  assert.equal(zellijDetail(''), 'detail=none');
  assert.match(zellijDetail('No active tab'), /^detail=No active tab$/u);
  assert.doesNotMatch(zellijDetail('token=abcdefghijklmnopqrstuvwxyz'), /abcdefghij/u);
  assert.ok(zellijDetail('x'.repeat(500)).length < 200);
});

test('a rejection keeps its consumer-facing message and carries Zellij own words only as detail', () => {
  const logged = new ZellijNativeIpcError('rejected', 'Zellij rejected the request', 'No active tab');
  // tests/zellij/zellijNativeIpc.test.mjs pins the message a consumer sees; the native text must
  // stay off it, because that message reaches renderer state.
  assert.equal(logged.message, 'Zellij rejected the request');
  assert.equal(logged.detail, 'No active tab');
  assert.equal(new ZellijNativeIpcError('timeout', 'Zellij IPC request timed out').detail, '');
});

/** A daemon that answers ConnStatus and is gone by the next request: measured, not hypothetical. */
const vanishingSocket = async (path) => {
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    socket.end(encodeZellijServerMessage({ connected: {} }));
    // One answer, then the endpoint disappears — exactly what a `--server` that never received
    // FirstClientConnected does after its first action request. Closing a Unix server also unlinks
    // its path, so the next connect gets ECONNREFUSED/ENOENT.
    server.close();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, resolve);
  });
  return {
    dispose: () => {
      for (const socket of sockets) socket.destroy();
      if (server.listening) server.close();
    }
  };
};

test('a session that vanishes between probe and list-panes is absent, not a dead tab', async () => {
  const root = mkdtempSync('/tmp/bl-zellij-vanish-');
  const socketDirectory = join(root, 'contract_version_1');
  mkdirSync(socketDirectory, { recursive: true, mode: 0o700 });
  const session = 'bitterless-preview-8f61a9105519';
  const fixture = await vanishingSocket(join(socketDirectory, session));
  const service = new ZellijNativeSessionService({
    socketDirectory: root,
    configFile: join(root, 'config.kdl'),
    cacheDirectory: join(root, 'cache'),
    ownershipFile: join(root, 'native-sessions.json'),
    binary: process.execPath,
    spawn: async () => {
      throw new Error('spawn must not be reached by this test');
    }
  });
  try {
    // Before the repair this rejected with the raw IPC error, which `zellijErrorCode` turned into
    // `operation-failed` — the sentence Ral saw, on a tab that only needed a new session.
    assert.equal(await service.exists(session), false);
  } finally {
    fixture.dispose();
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
});
