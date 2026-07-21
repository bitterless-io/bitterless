import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { build } from 'esbuild';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..', '..');
const buildDirectory = mkdtempSync(join(tmpdir(), 'bitterless-todoist-sync-cross-repo-'));
const bundlePath = join(buildDirectory, 'crossRepoSmoke.child.cjs');
const stateRoot = mkdtempSync(join(tmpdir(), 'bitterless-todoist-sync-cross-repo-state-'));
const requiredEnvironment = [
  'TODOIST_SYNC_SMOKE_BASE_URL',
  'TODOIST_SYNC_SMOKE_CUSTOMER_ID',
  'TODOIST_SYNC_SMOKE_DEVICE_A_ID',
  'TODOIST_SYNC_SMOKE_DEVICE_A_TOKEN',
  'TODOIST_SYNC_SMOKE_DEVICE_B_ID',
  'TODOIST_SYNC_SMOKE_DEVICE_B_TOKEN',
  'TODOIST_SYNC_SMOKE_ISOLATION_CUSTOMER_ID',
  'TODOIST_SYNC_SMOKE_ISOLATION_DEVICE_ID',
  'TODOIST_SYNC_SMOKE_ISOLATION_TOKEN'
];

for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`[todoist sync cross-repo] missing ${name}`);
}

const runtimeTripwires = {
  name: 'todoist-sync-cross-repo-runtime-tripwires',
  setup(buildApi) {
    buildApi.onResolve({ filter: /^electron$/ }, () => ({
      path: 'electron',
      namespace: 'todoist-sync-cross-repo-test'
    }));
    buildApi.onResolve({ filter: /^electron-xpc\/main$/ }, () => ({
      path: 'electron-xpc-main',
      namespace: 'todoist-sync-cross-repo-test'
    }));
    buildApi.onLoad({ filter: /.*/, namespace: 'todoist-sync-cross-repo-test' }, (args) => {
      if (args.path === 'electron') {
        return {
          contents: `
            const fail = (name) => {
              globalThis.__todoistSyncSafeStorageTripwireHits =
                (globalThis.__todoistSyncSafeStorageTripwireHits ?? 0) + 1;
              throw new Error('[credential tripwire] Electron ' + name + ' was accessed');
            };
            export const safeStorage = new Proxy({}, {
              get: (_target, property) => fail('safeStorage.' + String(property))
            });
            export const app = {
              getPath: () => fail('app.getPath')
            };
          `
        };
      }
      return {
        contents: `
          export const xpcMain = {
            broadcast: () => undefined
          };
        `
      };
    });
  }
};

const fixedPasswords = {
  TODOIST_SYNC_SMOKE_PASSWORD_A: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  TODOIST_SYNC_SMOKE_PASSWORD_B: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
};

const secretValues = [
  process.env.TODOIST_SYNC_SMOKE_DEVICE_A_TOKEN,
  process.env.TODOIST_SYNC_SMOKE_DEVICE_B_TOKEN,
  process.env.TODOIST_SYNC_SMOKE_ISOLATION_TOKEN,
  ...Object.values(fixedPasswords)
].filter(Boolean);

const forwardSafeOutput = (value) => {
  if (!value) return;
  for (const secret of secretValues) {
    if (value.includes(secret))
      throw new Error('[todoist sync cross-repo] child output contained a secret');
  }
  process.stdout.write(value);
};

const runPhase = (phase) => {
  const result = spawnSync(electronPath, [bundlePath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...fixedPasswords,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_PATH: [join(projectRoot, 'node_modules'), process.env.NODE_PATH]
        .filter(Boolean)
        .join(delimiter),
      TODOIST_SYNC_CROSS_REPO_PHASE: phase,
      TODOIST_SYNC_CROSS_REPO_ROOT: stateRoot
    },
    encoding: 'utf8'
  });
  forwardSafeOutput(result.stdout);
  forwardSafeOutput(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Todoist sync cross-repo ${phase} child exited with status ${String(result.status)}`
    );
  }
};

try {
  await build({
    entryPoints: [join(scriptDirectory, 'crossRepoSmoke.child.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    tsconfig: join(projectRoot, 'scripts/todoist-sync/tsconfig.strict.json'),
    external: ['better-sqlite3-multiple-ciphers'],
    plugins: [runtimeTripwires],
    logLevel: 'silent'
  });
  runPhase('primary');
  runPhase('restart-b');
  runPhase('final');
} finally {
  rmSync(stateRoot, { recursive: true, force: true });
  rmSync(buildDirectory, { recursive: true, force: true });
}
