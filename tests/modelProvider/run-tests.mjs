import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-model-provider-'));
const entryPoints = [
  resolve(projectRoot, 'tests/coin/unit/codexCredential.service.test.ts'),
  resolve(projectRoot, 'tests/modelProvider/codexProxy.service.test.ts'),
  resolve(projectRoot, 'tests/modelProvider/modelProviderCancelConnect.test.ts'),
];

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
    tsconfig: resolve(projectRoot, 'tsconfig.node.json'),
  });

  const tests = entryPoints.map((entry) =>
    join(buildRoot, entry.split('/').at(-1).replace(/\.ts$/, '.mjs')),
  );
  const result = spawnSync(process.execPath, ['--test', ...tests], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
}
