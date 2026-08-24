/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after } from 'node:test';
import { build } from 'esbuild';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-sheet-grid-'));
const sheetPreviewPath = join(
  projectRoot,
  'src/renderer/onlypreview/preview/src/components/SheetPreview/SheetPreview.vue'
);
const previewStorePath = join(
  projectRoot,
  'src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts'
);
const findAdapterPath = join(
  projectRoot,
  'src/renderer/onlypreview/preview/src/onlyPreviewFindAdapter.service.ts'
);
const sheetPreviewSource = readFileSync(sheetPreviewPath, 'utf8');
const sheetPreviewDescriptor = parse(sheetPreviewSource, { filename: sheetPreviewPath }).descriptor;
const sheetPreviewScript = compileScript(sheetPreviewDescriptor, {
  id: 'onlypreview-sheet-test',
  genDefaultAs: '__sheetPreview'
});
const sheetPreviewTemplate = compileTemplate({
  id: 'onlypreview-sheet-test',
  filename: sheetPreviewPath,
  source: sheetPreviewDescriptor.template.content,
  compilerOptions: { bindingMetadata: sheetPreviewScript.bindings }
});
assert.deepEqual(sheetPreviewTemplate.errors, []);
const sheetPreviewCompiled = `${sheetPreviewScript.content}\n${sheetPreviewTemplate.code}\n__sheetPreview.render = render;\nexport default __sheetPreview;\nexport { createApp, nextTick } from 'vue';\n`;

await build({
  entryPoints: {
    format: join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/onlyPreviewSheetFormat.service.ts'
    ),
    model: join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/onlyPreviewSheetModel.service.ts'
    ),
    viewport: join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/onlyPreviewSheetViewport.service.ts'
    ),
    contract: join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/workers/onlyPreviewSheetWorker.contract.ts'
    ),
    sheetPreviewStore: join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/components/SheetPreview/SheetPreview.store.ts'
    ),
    sheetPreview: sheetPreviewPath
  },
  outdir: buildRoot,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json'),
  plugins: [
    {
      name: 'compile-sheet-preview',
      setup(buildContext) {
        buildContext.onLoad({ filter: /onlyPreviewFindAdapter\.service\.ts$/ }, (args) => {
          if (args.path !== findAdapterPath) return null;
          return {
            contents: `
              export const onlyPreviewFindAdapterBridge = {
                register: () => () => {}
              };
            `,
            loader: 'ts'
          };
        });
        buildContext.onLoad({ filter: /onlyPreviewPreview\.store\.ts$/ }, (args) => {
          if (args.path !== previewStorePath) return null;
          return {
            contents: `
              export const onlyPreviewPreviewStore = {
                reportSurfaceError: async (revision, errorCode) => {
                  globalThis.__onlyPreviewSheetErrors?.push({ revision, errorCode });
                }
              };
            `,
            loader: 'ts'
          };
        });
        buildContext.onLoad({ filter: /SheetPreview\.vue$/ }, (args) => {
          if (args.path !== sheetPreviewPath) return null;
          return {
            contents: sheetPreviewCompiled,
            loader: 'ts',
            resolveDir: dirname(sheetPreviewPath)
          };
        });
      }
    }
  ]
});

export const sheetFormat = await import(pathToFileURL(join(buildRoot, 'format.mjs')).href);
export const sheetModel = await import(pathToFileURL(join(buildRoot, 'model.mjs')).href);
export const sheetViewport = await import(pathToFileURL(join(buildRoot, 'viewport.mjs')).href);
export const sheetContract = await import(pathToFileURL(join(buildRoot, 'contract.mjs')).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

export const makeWorkbookLike = (cellValues) => {
  const cells = cellValues.map((value, index) => ({
    row: 1,
    col: index + 1,
    value,
    numFmt: 'General'
  }));
  return {
    worksheets: [
      {
        name: 'Limits',
        rowCount: 1,
        actualRowCount: cells.length ? 1 : 0,
        columnCount: Math.max(1, cells.length),
        _rows: [undefined, { number: 1, _cells: [undefined, ...cells] }],
        columns: [],
        _merges: {}
      }
    ],
    properties: {}
  };
};
