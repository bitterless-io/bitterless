/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-surface-layout-'));
const bundlePath = join(buildRoot, 'layout.mjs');

await build({
  entryPoints: [join(projectRoot, 'src/main/miniapps/onlypreview/onlyPreviewSurfaceLayout.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});

const {
  clampOnlyPreviewSurfaceLayout,
  ONLY_PREVIEW_MIN_SIDEBAR_WIDTH,
  ONLY_PREVIEW_RESIZE_HANDLE_WIDTH,
  ONLY_PREVIEW_MENU_BAR_HEIGHT,
  ONLY_PREVIEW_PREVIEW_TOOLBAR_HEIGHT,
  ONLY_PREVIEW_STATUS_HEIGHT
} = await import(pathToFileURL(bundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

test('the composite chrome matches the Shell dimensions', () => {
  // Pinned because the Shell renders to them: the MenuBar strip, the preview toolbar, the status bar
  // and the narrowest the project rail may become.
  assert.equal(ONLY_PREVIEW_MIN_SIDEBAR_WIDTH, 180);
  assert.equal(ONLY_PREVIEW_RESIZE_HANDLE_WIDTH, 5);
  assert.equal(ONLY_PREVIEW_MENU_BAR_HEIGHT, 32);
  assert.equal(ONLY_PREVIEW_PREVIEW_TOOLBAR_HEIGHT, 32);
  assert.equal(ONLY_PREVIEW_STATUS_HEIGHT, 25);
});

// The clamp the window helper applied, reproduced here so "unchanged for any sane extent" is an
// assertion rather than a claim.
const legacy = (value, contentWidth, contentHeight) => {
  const x = Math.min(
    Math.max(value.x, ONLY_PREVIEW_MIN_SIDEBAR_WIDTH + ONLY_PREVIEW_RESIZE_HANDLE_WIDTH),
    contentWidth
  );
  const minimumY = ONLY_PREVIEW_MENU_BAR_HEIGHT + ONLY_PREVIEW_PREVIEW_TOOLBAR_HEIGHT;
  const y = Math.min(
    Math.max(value.y, minimumY),
    Math.max(minimumY, contentHeight - ONLY_PREVIEW_STATUS_HEIGHT)
  );
  return {
    x,
    y,
    width: Math.min(value.width, Math.max(0, contentWidth - x)),
    height: Math.min(value.height, Math.max(0, contentHeight - y - ONLY_PREVIEW_STATUS_HEIGHT))
  };
};

test('the preview rect is unchanged at or above the standalone minimum size', () => {
  // A standalone window enforces 800x600, so this is the whole range standalone can ever produce.
  for (const width of [800, 801, 1180, 1920, 3840]) {
    for (const height of [600, 601, 760, 1080, 2160]) {
      for (const measured of [
        { x: 185, y: 75, width: 400, height: 300 },
        { x: 0, y: 0, width: 10_000, height: 10_000 },
        { x: 900, y: 500, width: 100, height: 100 },
        { x: 185, y: 75, width: 0, height: 0 }
      ]) {
        const { preview } = clampOnlyPreviewSurfaceLayout(measured, { width, height });
        assert.deepEqual(
          preview,
          legacy(measured, width, height),
          `changed at ${width}x${height} for ${JSON.stringify(measured)}`
        );
      }
    }
  }
});

test('every layer rect lies inside the composite, for any extent and any reported rect', () => {
  // The invariant that stands in for ancestor clipping, which is NOT established on this Electron
  // build. Nothing may depend on Chromium trimming a child to its parent, so the layout does it.
  const extents = [0, 1, 4, 50, 184, 185, 186, 200, 799, 800, 1180, 4096];
  const reported = [
    { x: 0, y: 0, width: 0, height: 0 },
    { x: -500, y: -500, width: 100, height: 100 },
    { x: 185, y: 75, width: 400, height: 300 },
    { x: 10_000, y: 10_000, width: 10_000, height: 10_000 },
    { x: 100.4, y: 74.6, width: 399.5, height: 299.5 },
    { x: 0, y: 0, width: -10, height: -10 }
  ];
  for (const width of extents) {
    for (const height of extents) {
      for (const measured of reported) {
        const layout = clampOnlyPreviewSurfaceLayout(measured, { width, height });
        for (const [name, rect] of Object.entries(layout)) {
          const where = `${name} at ${width}x${height} for ${JSON.stringify(measured)}`;
          assert.ok(rect.width >= 0 && rect.height >= 0, `${where}: negative size`);
          assert.ok(rect.x >= 0 && rect.y >= 0, `${where}: origin outside the composite`);
          assert.ok(rect.x + rect.width <= width, `${where}: overflows the composite width`);
          assert.ok(rect.y + rect.height <= height, `${where}: overflows the composite height`);
        }
      }
    }
  }
});

test('the overlay is exactly the composite rect, rounded to a native rect', () => {
  assert.deepEqual(
    clampOnlyPreviewSurfaceLayout({ x: 0, y: 0, width: 0, height: 0 }, { width: 1180, height: 760 })
      .overlay,
    { x: 0, y: 0, width: 1180, height: 760 }
  );
  // A host that measures its rect in a renderer can report fractions; a native rect is integral.
  assert.deepEqual(
    clampOnlyPreviewSurfaceLayout(
      { x: 0, y: 0, width: 0, height: 0 },
      { width: 900.4, height: 599.6 }
    ).overlay,
    { x: 0, y: 0, width: 900, height: 600 }
  );
  // A negative extent is a host that has not measured yet, not a rect to argue with.
  assert.deepEqual(
    clampOnlyPreviewSurfaceLayout({ x: 0, y: 0, width: 0, height: 0 }, { width: -5, height: -5 })
      .overlay,
    { x: 0, y: 0, width: 0, height: 0 }
  );
});

test('the composite never imports a host', () => {
  // The mount seam exists so the dependency points one way. A host implements `OnlyPreviewMount`
  // and hands it in; if OnlyPreview reached back for Maestro, the seam would be decoration.
  const root = join(projectRoot, 'src/main/miniapps/onlypreview');
  const walk = (directory) =>
    readdirSync(directory).flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  const offenders = walk(root)
    .filter((path) => path.endsWith('.ts'))
    .filter((path) => /from '@maestro|require\('@maestro|from '@main\/maestro/.test(readFileSync(path, 'utf8')))
    .map((path) => path.slice(projectRoot.length + 1));
  assert.deepEqual(offenders, [], 'OnlyPreview must not import a host');
});
