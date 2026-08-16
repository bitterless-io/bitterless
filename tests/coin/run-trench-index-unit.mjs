import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cacheRoot = join(projectRoot, 'node_modules', '.cache');
mkdirSync(cacheRoot, { recursive: true });
const buildRoot = mkdtempSync(join(cacheRoot, 'bitterless-trench-index-unit-'));
const entryPoint = join(projectRoot, 'tests', 'coin', 'unit', 'trenchIo.repository.test.ts');
const output = join(buildRoot, 'trenchIo.repository.test.mjs');

try {
  await build({
    entryPoints: [entryPoint],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: 'inline',
    tsconfig: join(projectRoot, 'tsconfig.node.json'),
    external: ['better-sqlite3-multiple-ciphers'],
  });
  const result = spawnSync(
    join(projectRoot, 'node_modules', '.bin', 'electron'),
    ['--test', output],
    {
      cwd: projectRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
}
