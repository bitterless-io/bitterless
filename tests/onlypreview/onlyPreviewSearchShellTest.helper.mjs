import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-search-shell-'));

export const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

await build({
  entryPoints: {
    characterCountGate: join(
      projectRoot,
      'src/renderer/onlypreview/common/onlyPreviewCharacterCountGate.service.ts'
    ),
    result: join(
      projectRoot,
      'src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearchResult.service.ts'
    ),
    tree: join(projectRoot, 'src/renderer/onlypreview/shell/src/onlyPreviewTree.service.ts')
  },
  outdir: buildRoot,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.web.json')
});

export const characterCountGate = await import(
  pathToFileURL(join(buildRoot, 'characterCountGate.mjs')).href
);
export const result = await import(pathToFileURL(join(buildRoot, 'result.mjs')).href);
export const tree = await import(pathToFileURL(join(buildRoot, 'tree.mjs')).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));
