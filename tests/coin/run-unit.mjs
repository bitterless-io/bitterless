import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const unitRoot = join(projectRoot, 'tests', 'coin', 'unit');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-coin-unit-'));
const entryPoints = readdirSync(unitRoot)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => join(unitRoot, name));

try {
  await build({
    entryPoints,
    outdir: buildRoot,
    entryNames: '[name]',
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: 'inline',
    tsconfig: join(projectRoot, 'tsconfig.node.json'),
  });

  const result = spawnSync(
    process.execPath,
    ['--test', ...entryPoints.map((entry) => join(buildRoot, `${entry.split('/').at(-1).replace(/\.ts$/, '.mjs')}`))],
    { cwd: projectRoot, stdio: 'inherit' },
  );
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
}
