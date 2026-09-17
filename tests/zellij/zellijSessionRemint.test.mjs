/* eslint-disable @typescript-eslint/explicit-function-return-type -- Production-method runtime harness. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { buildSync } from 'esbuild';

const directory = fs.mkdtempSync(join(tmpdir(), 'zellij-recovery-'));
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
const outfile = join(directory, 'session.cjs');
buildSync({
  entryPoints: ['src/main/zellij/zellijSession.service.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  tsconfig: 'tsconfig.node.json'
});
const naming = createRequire(import.meta.url)(outfile);
const profile = 'production-debug';
const named = (surface) =>
  naming.resolveZellijSessionName?.(profile, surface) ?? naming.zellijSessionNameForTab(surface);
const origin = 'http://127.0.0.1:12902';
const source = ts.createSourceFile(
  'runtime.ts',
  fs.readFileSync('src/main/zellij/zellijRuntime.service.ts', 'utf8'),
  ts.ScriptTarget.Latest,
  true
);
const names = [
  'TRANSIENT_IPC_CODES',
  'surfacePreparations',
  'recoveredSessions',
  'sessionMappingsDirty',
  'baseSessionName',
  'recoverySessionName',
  'sessionMappings',
  'persistSessionMappings',
  'rememberPreparedSession',
  'sessionName',
  'zellijTerminalUrl',
  'prepareZellijTerminal',
  'prepareZellijSurface',
  'closeZellijTerminal',
  'stopZellijRuntime',
  'failedSession'
];
const statements = source.statements.filter(
  (statement) =>
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some((declaration) =>
      names.includes(declaration.name.getText(source))
    )
);
assert.equal(statements.length, names.length);
const code = ts.transpileModule(
  statements.map((statement) => statement.getText(source).replace(/^export /u, '')).join('\n') +
    '\nglobalThis.api={prepare:prepareZellijTerminal,close:closeZellijTerminal,stop:stopZellijRuntime,failed:failedSession,name:sessionName};',
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText;
class IpcError extends Error {
  constructor(code) {
    super('native IPC failure');
    this.code = code;
  }
}
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const fixture = (options = {}) => {
  const userData = options.userData ?? fs.mkdtempSync(join(directory, 'profile-'));
  const attempts = [],
    bridges = [],
    closed = [],
    retired = [];
  const native = {
    prepare: async (name) => {
      attempts.push(name);
      await options.prepare?.(name, attempts.length);
    },
    close: async (name) => {
      closed.push(name);
      await options.close?.(name);
    },
    deactivate: () => {},
    stop: async () => {},
    waitForClosures: async () => {}
  };
  const runtime = {
    initialize: options.initialize ?? (async () => ({ status: 'ready' })),
    stop: async () => {}
  };
  const bridge = {
    register: async (name, socket) => {
      bridges.push({ name, socket });
      await options.register?.(name);
    },
    retire: (name) => retired.push(name),
    stop: async () => {}
  };
  const context = vm.createContext({
    ...fs,
    ...naming,
    join,
    randomUUID,
    readFileSync: (file, encoding) =>
      file === 'config.kdl' ? '' : fs.readFileSync(file, encoding),
    renameSync: options.renameSync ?? fs.renameSync,
    app: { getPath: () => userData },
    getRuntimeProfile: () => ({ id: profile }),
    zellijOrigin: () => origin,
    ZellijNativeIpcError: IpcError,
    zellijErrorCode: (error) =>
      [
        'config-invalid',
        'authentication-failed',
        'token-failed',
        'config-validation-failed'
      ].includes(error?.message)
        ? error.message
        : 'operation-failed',
    zellijLog: { info: () => {}, warn: () => {}, error: () => {} },
    zellijDetail: () => '',
    zellijSurfaceTag: (value) => value,
    zellijSessionTag: (value) => value,
    console: { warn: () => {}, error: () => {} },
    process: { platform: options.platform ?? 'darwin' },
    setTimeout: options.delay ?? ((callback) => setImmediate(callback)),
    clearInterval,
    runtimeGeneration: 0,
    runtimeStopping: null,
    surfaceGenerations: new Map(),
    preparedSurfaces: new Map(),
    failureListeners: new Set(),
    healthTimer: null,
    bridgeCleanup: null,
    webProcess: null,
    runtimeConfig: { file: 'config.kdl', initialize: options.configInitialize ?? (async () => {}) },
    parse: () => ({ nodes: [{ getName: () => 'web_sharing', getArguments: () => ['on'] }] }),
    getZellijRuntime: () => runtime,
    runtime,
    getZellijDirectories: () => native,
    directoryService: native,
    getWebBridge: () => bridge,
    webBridge: bridge,
    getNativeSessions: () => ({ socket: (name) => '/fixture/socket/' + name }),
    startSessionHealthChecks: () => {}
  });
  vm.runInContext(code, context);
  const mappingFile = join(userData, 'zellij', 'surface-sessions.json');
  return {
    ...context.api,
    context,
    attempts,
    bridges,
    closed,
    retired,
    userData,
    mappingFile,
    saved: () => JSON.parse(fs.readFileSync(mappingFile, 'utf8')).sessions
  };
};

test('hard native failure rebuilds once in the same operation; URL, bridge and persisted mapping agree', async () => {
  const f = fixture({
    prepare: async (_name, count) => {
      if (count === 1) throw new Error('operation-failed');
    }
  });
  const url = await f.prepare('surface-hard');
  assert.equal(f.attempts.length, 2);
  assert.equal(f.attempts[0], named('surface-hard'));
  assert.notEqual(f.attempts[1], f.attempts[0]);
  assert.equal(url, naming.zellijSessionUrl(origin, f.attempts[1]));
  assert.deepEqual(f.bridges, [
    { name: f.attempts[1], socket: '/fixture/socket/' + f.attempts[1] }
  ]);
  assert.equal(f.saved()['surface-hard'], f.attempts[1]);
  assert.deepEqual(f.closed, [], 'fallback never deletes or kills the unknown old session');
});

test('a transient native error first recovers the same identity without reconstructing', async () => {
  const f = fixture({
    prepare: async (_name, count) => {
      if (count === 1) throw new IpcError('rejected');
    }
  });
  await f.prepare('transient');
  assert.deepEqual(f.attempts, [named('transient'), named('transient')]);
  assert.equal(fs.existsSync(f.mappingFile), false);
});

test('two transient failures consume the original budget then allow one fresh attempt only', async () => {
  const f = fixture({
    prepare: async (_name, count) => {
      if (count <= 2) throw new IpcError('timeout');
    }
  });
  await f.prepare('transient-hard');
  assert.equal(f.attempts.length, 3);
  assert.equal(f.attempts[0], f.attempts[1]);
  assert.notEqual(f.attempts[1], f.attempts[2]);
});

test('a fresh failure stops with an error and no scheduled rebuild loop', async () => {
  for (const transient of [false, true]) {
    let delays = 0;
    const f = fixture({
      prepare: async () => {
        throw transient ? new IpcError('timeout') : new Error('operation-failed');
      },
      delay: (cb) => {
        delays++;
        setImmediate(cb);
      }
    });
    await assert.rejects(f.prepare('fails'), /native IPC failure|operation-failed/u);
    await flush();
    assert.equal(f.attempts.length, transient ? 3 : 2);
    assert.equal(delays, transient ? 1 : 0);
    assert.equal(fs.existsSync(f.mappingFile), false);
  }
});

test('runtime, config, bridge, non-native and explicit config errors do not rebuild sessions', async () => {
  for (const options of [
    { initialize: async () => ({ status: 'error', error: 'authentication-failed' }) },
    {
      configInitialize: async () => {
        throw new Error('config-invalid');
      }
    },
    {
      register: async () => {
        throw new IpcError('timeout');
      }
    },
    {
      prepare: async () => {
        throw new Error('config-validation-failed');
      }
    },
    {
      platform: 'win32',
      prepare: async () => {
        throw new IpcError('timeout');
      }
    }
  ]) {
    const f = fixture(options);
    await assert.rejects(f.prepare('not-native'));
    assert.ok(f.attempts.length <= 1);
    assert.equal(fs.existsSync(f.mappingFile), false);
  }
});

test('long surface identities reserve suffix space and remain distinct', async () => {
  const f = fixture({
    prepare: async (_name, count) => {
      if (count === 1) throw new Error('operation-failed');
    }
  });
  await f.prepare('surface-'.repeat(20));
  assert.notEqual(f.attempts[0], f.attempts[1]);
  assert.ok(f.attempts[1].length <= naming.ZELLIJ_SESSION_MAX_LENGTH);
  assert.match(f.attempts[1], /-r-[a-f0-9]{12}$/u);
});

test('concurrent callers share the same attempt budget and fresh session', async () => {
  const gate = deferred();
  const f = fixture({
    prepare: async (_name, count) => {
      if (count === 1) {
        await gate.promise;
        throw new Error('operation-failed');
      }
    }
  });
  const first = f.prepare('concurrent');
  assert.equal(f.prepare('concurrent'), first);
  gate.resolve();
  await first;
  assert.equal(f.attempts.length, 2);
});

test('close and shutdown during retry delay prevent a second attempt or remint', async () => {
  for (const action of ['close', 'stop']) {
    let resume;
    const f = fixture({
      prepare: async () => {
        throw new IpcError('disconnected');
      },
      delay: (cb) => {
        resume = cb;
      }
    });
    const pending = f.prepare('cancel-delay');
    const rejected = assert.rejects(pending, /operation-failed/u);
    await flush();
    assert.ok(resume);
    await f[action]('cancel-delay');
    resume();
    await rejected;
    assert.equal(f.attempts.length, 1);
    assert.equal(fs.existsSync(f.mappingFile), false);
  }
});

test('close during fresh creation targets that fresh session and prevents mapping persistence', async () => {
  const gate = deferred();
  const f = fixture({
    prepare: async (_name, count) => {
      if (count === 1) throw new Error('operation-failed');
      await gate.promise;
    }
  });
  const pending = f.prepare('cancel-fresh');
  const rejected = assert.rejects(pending, /operation-failed/u);
  await flush();
  assert.equal(f.attempts.length, 2);
  await f.close('cancel-fresh');
  gate.resolve();
  await rejected;
  assert.deepEqual(f.closed, [f.attempts[1]]);
  assert.equal(f.bridges.length, 0);
  assert.equal(fs.existsSync(f.mappingFile), false);
});

test('fresh mapping survives restart even when subsequent bridge attachment fails', async () => {
  const f = fixture({
    prepare: async (_name, count) => {
      if (count === 1) throw new Error('operation-failed');
    },
    register: async () => {
      throw new Error('bridge failed');
    }
  });
  await assert.rejects(f.prepare('restart'), /bridge failed/u);
  assert.equal(f.attempts.length, 2);
  const restarted = fixture({ userData: f.userData });
  await restarted.prepare('restart');
  assert.deepEqual(restarted.attempts, [f.attempts[1]]);
});

test('persistence failure is visible and retried without rebuilding the prepared fresh session', async () => {
  let writes = 0;
  const f = fixture({
    prepare: async (_name, count) => {
      if (count === 1) throw new Error('operation-failed');
    },
    renameSync: (...args) => {
      if (++writes === 1) throw new Error('disk unavailable');
      fs.renameSync(...args);
    }
  });
  await assert.rejects(f.prepare('persist'), /disk unavailable/u);
  assert.equal(f.bridges.length, 0);
  await f.prepare('persist');
  assert.equal(f.attempts[2], f.attempts[1]);
  assert.equal(f.saved().persist, f.attempts[1]);
});

test('successful explicit close removes persisted mapping; failed close and app quit retain it', async () => {
  const f = fixture({
    prepare: async (_name, count) => {
      if (count === 1) throw new Error('operation-failed');
    }
  });
  await f.prepare('closed');
  const recovered = f.attempts[1];
  await f.stop();
  assert.equal(f.saved().closed, recovered);
  const refused = fixture({
    userData: f.userData,
    close: async () => {
      throw new Error('close failed');
    }
  });
  await assert.rejects(refused.close('closed'), /close failed/u);
  assert.equal(refused.saved().closed, recovered);
  const restarted = fixture({ userData: f.userData });
  await restarted.close('closed');
  assert.deepEqual(restarted.closed, [recovered]);
  assert.deepEqual(restarted.saved(), {});
});

test('late failure notification for a retired original session cannot invalidate fresh recovery', async () => {
  let f;
  f = fixture({
    prepare: async (_name, count) => {
      if (count === 1) throw new Error('operation-failed');
      f.failed(named('late-old'));
    }
  });
  f.context.preparedSurfaces.set('late-old', named('late-old'));
  await f.prepare('late-old');
  assert.equal(f.attempts.length, 2);
  assert.equal(f.context.preparedSurfaces.get('late-old'), f.attempts[1]);
});

test('disposed view aborts its recovery without reminting, and cannot cancel a replacement operation', async () => {
  let resume;
  const replacementGate = deferred();
  const lifetime = new AbortController();
  const f = fixture({
    prepare: async (_name, count) => {
      if (count === 1) throw new IpcError('timeout');
      await replacementGate.promise;
    },
    delay: (cb) => {
      resume = cb;
    }
  });
  const stale = f.prepare('disposed', lifetime.signal);
  const rejected = assert.rejects(stale, /operation-failed/u);
  await flush();
  lifetime.abort();
  const replacement = f.prepare('disposed', new AbortController().signal);
  resume();
  await rejected;
  assert.equal(f.prepare('disposed'), replacement);
  replacementGate.resolve();
  await replacement;
  assert.deepEqual(f.attempts, [named('disposed'), named('disposed')]);
  assert.equal(fs.existsSync(f.mappingFile), false);
});
