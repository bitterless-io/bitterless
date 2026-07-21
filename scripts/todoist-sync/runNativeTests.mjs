import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { build } from 'esbuild';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..', '..');
const buildDirectory = mkdtempSync(join(tmpdir(), 'bitterless-todoist-sync-native-'));
const bundlePath = join(buildDirectory, 'native.test.cjs');

const runtimeTripwires = {
  name: 'todoist-sync-runtime-tripwires',
  setup(buildApi) {
    buildApi.onResolve({ filter: /^electron$/ }, () => ({
      path: 'electron',
      namespace: 'todoist-sync-test',
    }));
    buildApi.onResolve({ filter: /^electron-xpc\/main$/ }, () => ({
      path: 'electron-xpc-main',
      namespace: 'todoist-sync-test',
    }));
    buildApi.onLoad({ filter: /.*/, namespace: 'todoist-sync-test' }, (args) => {
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
              getPath: () => {
                throw new Error('[todoist sync test] app.getPath must be injected');
              }
            };
          `,
        };
      }
      return {
        contents: `
          export const xpcMain = {
            broadcast: (event, payload) => {
              globalThis.__todoistSyncBroadcasts ??= [];
              globalThis.__todoistSyncBroadcasts.push({ event, payload });
            }
          };
        `,
      };
    });
  },
};

try {
  await build({
    entryPoints: [join(scriptDirectory, 'native.test.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    tsconfig: join(projectRoot, 'scripts/todoist-sync/tsconfig.strict.json'),
    external: ['better-sqlite3-multiple-ciphers'],
    plugins: [runtimeTripwires],
    logLevel: 'silent',
  });
  const result = spawnSync(electronPath, [bundlePath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_PATH: [join(projectRoot, 'node_modules'), process.env.NODE_PATH]
        .filter(Boolean)
        .join(delimiter),
      TODOIST_SYNC_NATIVE_TEST: '1',
    },
    encoding: 'utf8',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Todoist sync native tests exited with status ${String(result.status)}`);
  }
} finally {
  rmSync(buildDirectory, { recursive: true, force: true });
}
