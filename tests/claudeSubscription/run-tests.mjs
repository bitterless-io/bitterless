import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-subscription-'));
const entryPoints = [
  resolve(projectRoot, 'tests/claudeSubscription/claudeAccount.repository.test.ts'),
  resolve(projectRoot, 'tests/claudeSubscription/claudeSubscription.schema.test.ts'),
  resolve(projectRoot, 'tests/claudeSubscription/claudeCli.executor.test.ts'),
  resolve(projectRoot, 'tests/claudeSubscription/claudeSubscription.integration.test.ts'),
  resolve(projectRoot, 'tests/claudeSubscription/claudeResponses.translation.test.ts'),
  resolve(projectRoot, 'tests/claudeSubscription/claudeAccount.router.test.ts'),
  resolve(projectRoot, 'tests/claudeSubscription/claudeResponses.server.test.ts'),
  resolve(projectRoot, 'tests/claudeSubscription/claudeAuth.parser.test.ts'),
  resolve(projectRoot, 'tests/claudeSubscription/claudeAuth.command.test.ts'),
  resolve(projectRoot, 'tests/claudeSubscription/claudeCli.capability.test.ts'),
  resolve(projectRoot, 'tests/claudeSubscription/claudeAuth.coordinator.test.ts'),
  resolve(projectRoot, 'tests/claudeSubscription/claudeAuthLogin.pty.test.ts'),
  resolve(projectRoot, 'tests/claudeSubscription/claudeSubscription.service.test.ts'),
  resolve(projectRoot, 'tests/claudeSubscription/claudeSubscription.authSource.test.ts')
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
    external: ['electron']
  });

  const tests = entryPoints.map((entry) =>
    join(buildRoot, entry.split('/').at(-1).replace(/\.ts$/, '.mjs'))
  );
  const result = spawnSync(process.execPath, ['--test', ...tests], {
    cwd: projectRoot,
    stdio: 'inherit'
  });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
}
