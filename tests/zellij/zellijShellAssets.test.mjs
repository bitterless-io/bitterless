/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native Node test fixtures. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';
import { buildSync } from 'esbuild';

const root = mkdtempSync(join(tmpdir(), 'zellij-shell-assets-'));
const output = join(root, 'environment.cjs');
buildSync({
  entryPoints: ['src/main/zellij/zellijEnvironment.service.ts'],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs'
});
const { resolveZellijShellAssetDirectory } = createRequire(import.meta.url)(output);
const source = resolve('resources/zellij');
const verify = (directory) => {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.commit, 'db085e4661f6aafd24e5acb5b2e17e4dd5dddf3e');
  assert.equal(manifest.version, '0.8.0');
  assert.equal(manifest.license, 'BSD-3-Clause');
  for (const entry of manifest.files) {
    const file = join(directory, manifest.name, entry.path);
    assert.equal(lstatSync(file).isSymbolicLink(), false);
    const data = readFileSync(file);
    assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256, entry.path);
    assert.equal(
      createHash('sha1')
        .update(Buffer.from(`blob ${data.length}\0`))
        .update(data)
        .digest('hex'),
      entry.gitBlobSha1,
      `${entry.path} upstream Git blob`
    );
  }
  for (const required of [
    'COPYING.md',
    '.version',
    '.revision-hash',
    'zsh-syntax-highlighting.zsh',
    'highlighters/main/main-highlighter.zsh'
  ]) {
    assert.ok(
      manifest.files.some((entry) => entry.path === required),
      required
    );
  }
  return manifest;
};
test.after(() => rmSync(root, { recursive: true, force: true }));

test('vendored official highlighter has its license and byte-identical pinned Git blobs', () => {
  assert.equal(verify(source).files.length, 13);
  assert.equal(
    resolveZellijShellAssetDirectory({
      packaged: false,
      appPath: process.cwd(),
      resourcesPath: '/unused'
    }),
    source
  );
});

test('packaged resource mapping copies the complete offline plugin outside app.asar', () => {
  const builder = yaml.load(readFileSync('electron-builder.tmp.yml', 'utf8'));
  const resource = builder.extraResources.find((entry) => entry.from === 'resources/zellij');
  assert.equal(resource.to, 'zellij-shell');
  const packaged = resolveZellijShellAssetDirectory({
    packaged: true,
    appPath: join(root, 'app.asar'),
    resourcesPath: root
  });
  assert.equal(packaged, join(root, resource.to));
  cpSync(resolve(resource.from), packaged, { recursive: true });
  assert.deepEqual(verify(packaged), verify(source));
});
