/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ANCHOR_FILE_NAME,
  planIdeReveal,
  resolveAnchorFile
} from '../../src/main/submodules/ideReveal.service.ts';

const workspace = () => mkdtempSync(join(tmpdir(), 'bitterless-ide-reveal-'));

/** A submodule directory plus the pointer-file Git directory a registered submodule really has. */
const submodule = (root, relativePath, { git = true } = {}) => {
  const path = join(root, relativePath);
  mkdirSync(path, { recursive: true });
  if (!git) return path;
  const gitDirectory = join(root, '.git', 'modules', relativePath);
  mkdirSync(gitDirectory, { recursive: true });
  writeFileSync(join(path, '.git'), `gitdir: ${gitDirectory}\n`);
  return path;
};

const excludeOf = (root, relativePath) =>
  readFileSync(join(root, '.git', 'modules', relativePath, 'info', 'exclude'), 'utf8');

test('a README carries the reveal, and the root is the only project argument', () => {
  const root = workspace();
  try {
    const path = submodule(root, 'projects/bitterless');
    writeFileSync(join(path, 'README.md'), '# bitterless\n');

    const plan = planIdeReveal({ rootPath: root, submodulePath: path });
    assert.deepEqual(plan.args, [root, join(path, 'README.md')]);
    // The submodule directory must never be an argument on its own: the launcher would open it as a
    // second project window, which is the whole defect being fixed.
    assert.equal(plan.args.includes(path), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('README matching ignores case and extension, and .md wins a tie', () => {
  const root = workspace();
  try {
    const rst = submodule(root, 'projects/rst');
    writeFileSync(join(rst, 'ReadMe.RST'), '');
    assert.equal(resolveAnchorFile(rst), join(rst, 'ReadMe.RST'));

    const bare = submodule(root, 'projects/bare');
    writeFileSync(join(bare, 'README'), '');
    assert.equal(resolveAnchorFile(bare), join(bare, 'README'));

    const both = submodule(root, 'projects/both');
    for (const name of ['README', 'readme.txt', 'ReadMe.md']) writeFileSync(join(both, name), '');
    assert.equal(resolveAnchorFile(both), join(both, 'ReadMe.md'));

    const linked = submodule(root, 'projects/linked');
    writeFileSync(join(root, 'real.md'), '');
    symlinkSync(join(root, 'real.md'), join(linked, 'readme.md'));
    assert.equal(resolveAnchorFile(linked), join(linked, 'readme.md'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('no README creates an empty .BL_ANCHOR, even when other files exist', () => {
  const root = workspace();
  try {
    const path = submodule(root, 'projects/demo-center');
    // package.json is deliberately not an anchor: the owner asked for README or .BL_ANCHOR only, so
    // the file a click opens is predictable for every submodule.
    writeFileSync(join(path, 'package.json'), '{}');
    mkdirSync(join(path, 'src'));

    const plan = planIdeReveal({ rootPath: root, submodulePath: path });
    assert.deepEqual(plan.args, [root, join(path, ANCHOR_FILE_NAME)]);
    assert.equal(readFileSync(join(path, ANCHOR_FILE_NAME), 'utf8'), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an empty or subdirectory-only submodule gets an anchor instead of losing the reveal', () => {
  const root = workspace();
  try {
    const empty = submodule(root, 'projects/empty', { git: false });
    assert.equal(resolveAnchorFile(empty), join(empty, ANCHOR_FILE_NAME));

    const nested = submodule(root, 'projects/nested');
    mkdirSync(join(nested, 'src'));
    writeFileSync(join(nested, 'src', 'main.ts'), '');
    assert.equal(resolveAnchorFile(nested), join(nested, ANCHOR_FILE_NAME));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the anchor is registered once in the submodule Git info/exclude, never in a tracked file', () => {
  const root = workspace();
  try {
    const path = submodule(root, 'projects/app');

    resolveAnchorFile(path);
    assert.equal(excludeOf(root, 'projects/app'), `${ANCHOR_FILE_NAME}\n`);

    // A second click must not append a duplicate line.
    resolveAnchorFile(path);
    resolveAnchorFile(path);
    assert.equal(excludeOf(root, 'projects/app'), `${ANCHOR_FILE_NAME}\n`);

    // Nothing tracked is touched: no .gitignore is created or modified.
    assert.equal(existsSyncSafe(join(path, '.gitignore')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an existing info/exclude keeps its content and gains one newline-terminated entry', () => {
  const root = workspace();
  try {
    const path = submodule(root, 'projects/existing');
    const infoDirectory = join(root, '.git', 'modules', 'projects/existing', 'info');
    mkdirSync(infoDirectory, { recursive: true });
    // No trailing newline: the append must not glue the entry onto the last rule.
    writeFileSync(join(infoDirectory, 'exclude'), '# local rules\n*.local');

    resolveAnchorFile(path);
    assert.equal(
      excludeOf(root, 'projects/existing'),
      `# local rules\n*.local\n${ANCHOR_FILE_NAME}\n`
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a submodule with no readable Git directory still gets its anchor', () => {
  const root = workspace();
  try {
    const path = submodule(root, 'projects/uninitialized', { git: false });
    const plan = planIdeReveal({ rootPath: root, submodulePath: path });
    assert.deepEqual(plan.args, [root, join(path, ANCHOR_FILE_NAME)]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing submodule directory falls back to the root alone, never to itself', () => {
  const root = workspace();
  try {
    const plan = planIdeReveal({ rootPath: root, submodulePath: join(root, 'projects/gone') });
    assert.equal(plan.anchorPath, null);
    assert.deepEqual(plan.args, [root]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function existsSyncSafe(path) {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}
