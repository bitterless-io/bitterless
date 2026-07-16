import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'bitterless-eyes-projects-'));
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-eyes-project-build-'));

try {
  const outfile = join(buildRoot, 'project-resolver.mjs');
  await build({
    entryPoints: [join(projectRoot, 'src/main/eyesOnAgents/projectResolver.service.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.node.json'),
  });
  const resolver = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);

  const repository = join(fixtureRoot, 'repository');
  const repositoryChild = join(repository, 'src', 'feature');
  mkdirSync(join(repository, '.git'), { recursive: true });
  mkdirSync(repositoryChild, { recursive: true });
  const canonicalRepository = realpathSync.native(repository);
  const resolvedRepository = resolver.resolveEyesOnAgentsProject(repository);
  assert.equal(resolvedRepository.type, 'project');
  assert.equal(resolvedRepository.project.projectRoot, canonicalRepository);
  assert.deepEqual(
    resolver.resolveEyesOnAgentsProject(repositoryChild),
    resolvedRepository,
    'children must resolve to their nearest repository root',
  );

  const nested = join(repository, 'packages', 'nested');
  const nestedChild = join(nested, 'lib');
  mkdirSync(join(nested, '.git'), { recursive: true });
  mkdirSync(nestedChild, { recursive: true });
  assert.equal(
    resolver.resolveEyesOnAgentsProject(nestedChild).project.projectRoot,
    realpathSync.native(nested),
    'a nested repository must win over an outer worktree',
  );

  const gitMetadata = join(fixtureRoot, 'git-metadata');
  const linkedWorktree = join(fixtureRoot, 'linked-worktree');
  mkdirSync(gitMetadata);
  mkdirSync(linkedWorktree);
  writeFileSync(join(linkedWorktree, '.git'), 'gitdir: ../git-metadata\n');
  assert.equal(
    resolver.resolveEyesOnAgentsProject(linkedWorktree).project.projectRoot,
    realpathSync.native(linkedWorktree),
    'a bounded gitdir file must identify a linked worktree',
  );

  const symlink = join(fixtureRoot, 'repository-link');
  symlinkSync(repository, symlink, 'dir');
  assert.equal(
    resolver.resolveEyesOnAgentsProject(join(symlink, 'src')).project.projectRoot,
    canonicalRepository,
    'symlinked cwd values must use the canonical worktree root',
  );

  const plain = join(fixtureRoot, 'plain-folder');
  mkdirSync(plain);
  assert.deepEqual(resolver.resolveEyesOnAgentsProject(plain), { type: 'none' });
  assert.deepEqual(
    resolver.resolveEyesOnAgentsProject(join(fixtureRoot, 'missing')),
    { type: 'unavailable' },
  );
  assert.deepEqual(resolver.resolveEyesOnAgentsProject('relative/path'), { type: 'unavailable' });
  const regularFile = join(fixtureRoot, 'file.txt');
  writeFileSync(regularFile, 'not a directory');
  assert.deepEqual(resolver.resolveEyesOnAgentsProject(regularFile), { type: 'unavailable' });

  const blocked = join(fixtureRoot, 'blocked');
  mkdirSync(blocked);
  chmodSync(blocked, 0o000);
  try {
    assert.deepEqual(
      resolver.resolveEyesOnAgentsProject(blocked),
      { type: 'unavailable' },
      'filesystem access errors must not be classified as confirmed no-Project',
    );
  } finally {
    chmodSync(blocked, 0o700);
  }

  assert.equal(
    resolver.normalizeEyesOnAgentsProjectKey('/tmp/Cafe\u0301/', 'darwin'),
    '/tmp/Café',
  );
  assert.equal(
    resolver.normalizeEyesOnAgentsProjectKey('C:\\Users\\Ral\\Repo\\', 'win32'),
    'c:/users/ral/repo',
  );
  console.log('EyesOnAgents Project resolver tests passed');
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(buildRoot, { recursive: true, force: true });
}
