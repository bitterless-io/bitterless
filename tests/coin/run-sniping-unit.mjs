import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-sniping-unit-'));
const entryPoints = [
  'snipingRequest.validation.test.ts',
  'snipingRelay.client.test.ts',
  'snipingSchema.service.test.ts',
  'snipingResponse.validation.test.ts',
  'snipingStore.test.ts',
  'snipingStoreEvidence.test.ts',
].map((name) => join(projectRoot, 'tests', 'coin', 'unit', name));

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
    tsconfig: join(projectRoot, 'tests', 'coin', 'tsconfig.sniping-unit.json'),
  });
  const outputs = entryPoints.map((entry) =>
    join(buildRoot, entry.split('/').at(-1).replace(/\.ts$/, '.mjs')));
  const result = spawnSync(process.execPath, ['--test', ...outputs], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
}
