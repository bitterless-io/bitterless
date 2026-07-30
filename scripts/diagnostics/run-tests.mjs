import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-application-diagnostics-'));
const entry = resolve(projectRoot, 'scripts/diagnostics/applicationDiagnostics.test.ts');

try {
  await build({
    entryPoints: [entry],
    outfile: join(buildRoot, 'applicationDiagnostics.test.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    sourcemap: 'inline',
    tsconfig: resolve(projectRoot, 'tsconfig.node.json')
  });

  const result = spawnSync(
    process.execPath,
    ['--test', join(buildRoot, 'applicationDiagnostics.test.cjs')],
    {
      cwd: projectRoot,
      stdio: 'inherit'
    }
  );
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
}
