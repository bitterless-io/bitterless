/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';
import { parse as parseYaml } from 'yaml';
import previewIconGenerator from './previewIcon.generate.cjs';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const { PREVIEW_BADGE } = previewIconGenerator;
const STABLE_ICON_SHA256 = '230b1a3c7db260c80139e987a8cd992217387129be039d1358634eda9abfec39';

const readProjectFile = (relativePath) => readFileSync(resolve(projectRoot, relativePath));

const readProjectText = (relativePath) => readProjectFile(relativePath).toString('utf8');

const parseIcns = (buffer) => {
  assert.equal(buffer.subarray(0, 4).toString('ascii'), 'icns', 'ICNS header is missing');
  assert.equal(buffer.readUInt32BE(4), buffer.length, 'ICNS length header is stale');

  const entries = new Map();
  let offset = 8;
  while (offset < buffer.length) {
    assert(offset + 8 <= buffer.length, 'ICNS entry header is truncated');
    const type = buffer.subarray(offset, offset + 4).toString('ascii');
    const length = buffer.readUInt32BE(offset + 4);
    assert(length > 8, `ICNS ${type} entry is empty`);
    assert(offset + length <= buffer.length, `ICNS ${type} entry is truncated`);
    entries.set(type, buffer.subarray(offset + 8, offset + length));
    offset += length;
  }
  assert.equal(offset, buffer.length, 'ICNS entries do not fill the declared container');
  return entries;
};

const parseIco = (buffer) => {
  assert.equal(buffer.readUInt16LE(0), 0, 'ICO reserved header is invalid');
  assert.equal(buffer.readUInt16LE(2), 1, 'ICO image type is invalid');
  const count = buffer.readUInt16LE(4);
  assert(count > 0, 'ICO contains no images');
  assert(6 + count * 16 <= buffer.length, 'ICO directory is truncated');

  const entries = [];
  for (let index = 0; index < count; index++) {
    const directoryOffset = 6 + index * 16;
    const width = buffer[directoryOffset] || 256;
    const height = buffer[directoryOffset + 1] || 256;
    const length = buffer.readUInt32LE(directoryOffset + 8);
    const imageOffset = buffer.readUInt32LE(directoryOffset + 12);
    assert(length > 0, `ICO ${width}x${height} entry is empty`);
    assert(imageOffset + length <= buffer.length, `ICO ${width}x${height} entry is truncated`);
    entries.push({ width, height, data: buffer.subarray(imageOffset, imageOffset + length) });
  }
  return entries;
};

const rawImage = async (input, size) => {
  const pipeline = sharp(input);
  if (size) pipeline.resize(size, size);
  return await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
};

const assertSameImage = (actual, expected, label) => {
  assert.equal(actual.info.width, expected.info.width, `${label} width differs`);
  assert.equal(actual.info.height, expected.info.height, `${label} height differs`);
  assert.equal(actual.info.channels, expected.info.channels, `${label} channel count differs`);
  assert(actual.data.equals(expected.data), `${label} pixels differ from build/icon.png`);
};

test('builder template keeps Stable icons and generator selects exact channel icons', () => {
  const template = parseYaml(readProjectText('electron-builder.tmp.yml'));
  assert.equal(template.mac?.icon, 'build/icon.icns');
  assert.equal(template.win?.icon, 'build/icon.ico');
  assert.equal(
    template.extraResources?.some(
      (resource) => resource?.from === 'build/icon.png' || resource?.to === 'app.png'
    ),
    false,
    'builder template must not package a runtime Dock PNG'
  );

  const generator = readProjectText('scripts/before.js');
  assert.match(generator, /const iconStem = isPreview \? 'icon-preview' : 'icon'/);
  assert.match(generator, /build\/\$\{iconStem\}\.icns/);
  assert.match(generator, /build\/\$\{iconStem\}\.ico/);
});

test('main leaves the macOS Dock icon to the bundle ICNS', () => {
  const source = readProjectText('src/main/app.main.ts');
  assert.doesNotMatch(source, /app\.dock\.setIcon\s*\(/);
});

test('signed package builds run the icon source gate before Electron Builder', () => {
  const packageJson = JSON.parse(readProjectText('package.json'));
  assert.equal(
    packageJson.scripts?.['test:desktop-app-icon'],
    'node --test scripts/package/desktopAppIcon.test.mjs',
  );
  const source = readProjectText('scripts/signedBuild.js');
  const iconGate = source.indexOf("spawnSync(auditCommand, ['test:desktop-app-icon']");
  const builder = source.lastIndexOf('spawnSync(electronBuilderCommand');
  assert(iconGate >= 0, 'signedBuild must invoke the icon source gate');
  assert(builder > iconGate, 'Electron Builder must run after the icon source gate');
});

test('Stable and Preview PNG sources are exact, isolated artwork', async () => {
  const canonical = readProjectFile('build/icon.png');
  assert.equal(createHash('sha256').update(canonical).digest('hex'), STABLE_ICON_SHA256);
  const canonicalMetadata = await sharp(canonical).metadata();
  assert.equal(canonicalMetadata.format, 'png');
  assert.equal(canonicalMetadata.width, 1024);
  assert.equal(canonicalMetadata.height, 1024);

  const preview = readProjectFile('build/icon-preview.png');
  const previewMetadata = await sharp(preview).metadata();
  assert.equal(previewMetadata.format, 'png');
  assert.equal(previewMetadata.width, 1024);
  assert.equal(previewMetadata.height, 1024);

  const canonicalRaw = await rawImage(canonical);
  const previewRaw = await rawImage(preview);
  let changedInsideBadge = false;
  for (let y = 0; y < canonicalRaw.info.height; y += 1) {
    for (let x = 0; x < canonicalRaw.info.width; x += 1) {
      const insideBadge =
        x >= PREVIEW_BADGE.x &&
        x < PREVIEW_BADGE.x + PREVIEW_BADGE.width &&
        y >= PREVIEW_BADGE.y &&
        y < PREVIEW_BADGE.y + PREVIEW_BADGE.height;
      const offset = (y * canonicalRaw.info.width + x) * canonicalRaw.info.channels;
      const stablePixel = canonicalRaw.data.subarray(offset, offset + canonicalRaw.info.channels);
      const previewPixel = previewRaw.data.subarray(offset, offset + previewRaw.info.channels);
      if (stablePixel[3] === 0) {
        assert.equal(previewPixel[3], 0, `Preview badge changed transparent footprint at ${x},${y}`);
      }
      if (insideBadge) {
        if (!stablePixel.equals(previewPixel)) changedInsideBadge = true;
      } else {
        assert(stablePixel.equals(previewPixel), `Preview changed Stable artwork at ${x},${y}`);
      }
    }
  }
  assert.equal(changedInsideBadge, true, 'Preview badge did not change its reserved safe area');
});

test('derived ICNS and ICO contain their exact channel PNG artwork', async () => {
  for (const stem of ['icon', 'icon-preview']) {
    const canonical = readProjectFile(`build/${stem}.png`);

    const icnsEntries = parseIcns(readProjectFile(`build/${stem}.icns`));
    const icns1024 = icnsEntries.get('ic10');
    assert(icns1024, `${stem}.icns is missing its 1024px representation`);
    assertSameImage(
      await rawImage(icns1024),
      await rawImage(canonical),
      `${stem}.icns 1024px artwork`
    );

    const icoEntries = parseIco(readProjectFile(`build/${stem}.ico`));
    const ico256 = icoEntries.find((entry) => entry.width === 256 && entry.height === 256);
    assert(ico256, `${stem}.ico is missing its 256px representation`);
    assertSameImage(
      await rawImage(ico256.data),
      await rawImage(canonical, 256),
      `${stem}.ico 256px artwork`
    );
  }
});
