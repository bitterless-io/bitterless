import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-trench-browser-unit-'));
const entryPoint = join(projectRoot, 'tests', 'coin', 'unit', 'trenchVault.store.test.ts');

try {
  await build({
    entryPoints: [entryPoint],
    outfile: join(buildRoot, 'trenchVault.store.test.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: 'inline',
    tsconfig: join(projectRoot, 'tsconfig.node.json'),
  });
  const result = spawnSync(
    process.execPath,
    ['--test', join(buildRoot, 'trenchVault.store.test.mjs')],
    { cwd: projectRoot, stdio: 'inherit' },
  );
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
}
