/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-image-rotation-'));

await build({
  entryPoints: {
    fixtureGenerator: join(projectRoot, 'tests/onlypreview/fixtures/createOnlyPreviewFixtures.ts'),
    imageViewport: join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/onlyPreviewImageViewport.service.ts'
    )
  },
  outdir: buildRoot,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json')
});

const fixtures = await import(pathToFileURL(join(buildRoot, 'fixtureGenerator.mjs')).href);
const viewport = await import(pathToFileURL(join(buildRoot, 'imageViewport.mjs')).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const landscape = {
  naturalWidth: 1_000,
  naturalHeight: 500,
  viewportWidth: 400,
  viewportHeight: 300
};

const manual = (overrides = {}) => ({
  mode: 'manual',
  rotation: 0,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  ...overrides
});

const assertCode = (code) => (error) => {
  assert.equal(error?.code, code);
  return true;
};

test('quarter turns swap effective dimensions while half turns keep image geometry', () => {
  for (const rotation of [0, 180]) {
    assert.deepEqual(viewport.getOnlyPreviewImageEffectiveDimensions(landscape, rotation), {
      width: 1_000,
      height: 500
    });
    assert.equal(viewport.getOnlyPreviewImageFitScale(landscape, rotation), 0.4);
  }
  for (const rotation of [90, 270]) {
    assert.deepEqual(viewport.getOnlyPreviewImageEffectiveDimensions(landscape, rotation), {
      width: 500,
      height: 1_000
    });
    assert.equal(viewport.getOnlyPreviewImageFitScale(landscape, rotation), 0.3);
  }
  assert.throws(
    () => viewport.getOnlyPreviewImageEffectiveDimensions(landscape, 45),
    assertCode('INVALID_INPUT')
  );
});

test('fit minimum, manual zoom and input guards retain their bounded behavior', () => {
  const huge = {
    naturalWidth: 100_000,
    naturalHeight: 50_000,
    viewportWidth: 100,
    viewportHeight: 100
  };
  assert.equal(viewport.getOnlyPreviewImageFitScale(huge), 0.001);
  assert.equal(viewport.getOnlyPreviewImageMinimumScale(huge), 0.001);
  assert.equal(
    viewport.zoomOnlyPreviewImageViewport(viewport.fitOnlyPreviewImageViewport(huge), 'out', huge)
      .scale,
    0.001
  );
  assert.equal(viewport.zoomOnlyPreviewImageViewport(manual(), 'in', landscape).scale, 1.25);
  assert.equal(
    viewport.zoomOnlyPreviewImageViewport(manual({ scale: 8 }), 'in', landscape).scale,
    8
  );
  assert.equal(
    viewport.zoomOnlyPreviewImageViewport(manual({ scale: 0.1 }), 'out', landscape).scale,
    0.1
  );
  assert.equal(viewport.getOnlyPreviewImageFitScale({ ...landscape, viewportWidth: 0 }), 1);
  for (const invalid of [
    { ...landscape, naturalWidth: 0 },
    { ...landscape, naturalHeight: Number.NaN },
    { ...landscape, viewportWidth: -1 }
  ]) {
    assert.throws(() => viewport.getOnlyPreviewImageFitScale(invalid), assertCode('INVALID_INPUT'));
  }
  assert.throws(() => viewport.clampOnlyPreviewImageScale(Number.NaN), assertCode('INVALID_INPUT'));
  assert.throws(
    () => viewport.getOnlyPreviewImageFitScale({ ...landscape, viewportWidth: 0 }, 45),
    assertCode('INVALID_INPUT')
  );
});

test('fit rotation resets offsets and cycles in both directions without losing orientation', () => {
  let state = viewport.fitOnlyPreviewImageViewport(landscape);
  assert.deepEqual(state, { mode: 'fit', rotation: 0, scale: 0.4, offsetX: 0, offsetY: 0 });
  state = viewport.rotateOnlyPreviewImageViewport(state, 'right', landscape);
  assert.deepEqual(state, { mode: 'fit', rotation: 90, scale: 0.3, offsetX: 0, offsetY: 0 });
  state = viewport.rotateOnlyPreviewImageViewport(state, 'right', landscape);
  assert.deepEqual(state, { mode: 'fit', rotation: 180, scale: 0.4, offsetX: 0, offsetY: 0 });
  state = viewport.rotateOnlyPreviewImageViewport(state, 'right', landscape);
  assert.deepEqual(state, { mode: 'fit', rotation: 270, scale: 0.3, offsetX: 0, offsetY: 0 });
  state = viewport.rotateOnlyPreviewImageViewport(state, 'right', landscape);
  assert.equal(state.rotation, 0);
  assert.equal(viewport.rotateOnlyPreviewImageViewport(state, 'left', landscape).rotation, 270);
});

test('manual rotation, zoom, pan and resize preserve state then clamp to rotated bounds', () => {
  const rotated = viewport.rotateOnlyPreviewImageViewport(
    manual({ offsetX: 300, offsetY: 300 }),
    'right',
    landscape
  );
  assert.deepEqual(rotated, {
    mode: 'manual',
    rotation: 90,
    scale: 1,
    offsetX: 50,
    offsetY: 300
  });
  assert.deepEqual(viewport.getOnlyPreviewImagePanBounds(landscape, 1, 90), {
    maxX: 50,
    maxY: 350
  });
  assert.deepEqual(
    viewport.resizeOnlyPreviewImageViewport(rotated, {
      ...landscape,
      viewportWidth: 600,
      viewportHeight: 600
    }),
    { mode: 'manual', rotation: 90, scale: 1, offsetX: 0, offsetY: 200 }
  );
  assert.deepEqual(
    viewport.resizeOnlyPreviewImageViewport(
      { mode: 'fit', rotation: 90, scale: 0.3, offsetX: 40, offsetY: 40 },
      { ...landscape, viewportWidth: 600, viewportHeight: 600 }
    ),
    { mode: 'fit', rotation: 90, scale: 0.6, offsetX: 0, offsetY: 0 }
  );
  assert.equal(viewport.zoomOnlyPreviewImageViewport(rotated, 'in', landscape).scale, 1.25);
  assert.deepEqual(viewport.resetOnlyPreviewImageViewport(landscape), {
    mode: 'manual',
    rotation: 0,
    scale: 1,
    offsetX: 0,
    offsetY: 0
  });
});

test('generated web image and PCM WAV fixtures stay valid and native media controls stay direct', () => {
  const generated = fixtures.createOnlyPreviewFixtures(join(buildRoot, 'safe-fixtures'));
  const png = readFileSync(generated.imagePath);
  const wav = readFileSync(generated.audioPath);
  const successWav = readFileSync(
    join(projectRoot, 'src/renderer/common/assets/sound/success.wav')
  );
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  for (const input of [wav, successWav]) {
    assert.equal(input.toString('ascii', 0, 4), 'RIFF');
    assert.equal(input.toString('ascii', 8, 12), 'WAVE');
    assert.equal(input.readUInt16LE(20), 1, 'fixture must use uncompressed PCM');
  }
  assert.equal(successWav.readUInt16LE(22), 2);
  assert.equal(successWav.readUInt32LE(24), 44_100);
  assert.equal(successWav.readUInt16LE(34), 16);

  const mediaSource = readFileSync(
    join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/components/MediaPreview/MediaPreview.vue'
    ),
    'utf8'
  );
  assert.match(mediaSource, /<audio[\s\S]*controls[\s\S]*preload="metadata"/);
  assert.match(mediaSource, /<video[\s\S]*controls[\s\S]*preload="metadata"/);
  assert.doesNotMatch(mediaSource, /\bautoplay\b|createObjectURL|arrayBuffer\s*\(/);
});

test('image rotation remains a renderer transform with no mutation or bitmap-copy path', () => {
  const source = readFileSync(
    join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/components/ImagePreview/ImagePreview.vue'
    ),
    'utf8'
  );
  assert.match(source, /IconRotate/);
  assert.match(source, /imageRotateLeft/);
  assert.match(source, /imageRotateRight/);
  assert.match(source, /rotate\(\$\{viewportState\.rotation\}deg\)/);
  assert.doesNotMatch(source, /writeFile|toDataURL|getContext\s*\(|<canvas\b/);
});
