/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';
import { parse as parseYaml } from 'yaml';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

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

test('builder configs use the canonical macOS ICNS without a runtime PNG', () => {
  const builderConfigs = ['electron-builder.tmp.yml'];
  if (existsSync(resolve(projectRoot, 'electron-builder.yml'))) {
    builderConfigs.push('electron-builder.yml');
  }
  for (const relativePath of builderConfigs) {
    const config = parseYaml(readProjectText(relativePath));
    assert.equal(config.mac?.icon, 'build/icon.icns', `${relativePath} must name the ICNS`);
    assert.equal(
      config.extraResources?.some(
        (resource) => resource?.from === 'build/icon.png' || resource?.to === 'app.png'
      ),
      false,
      `${relativePath} must not package a runtime Dock PNG`
    );
  }
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

test('derived ICNS and ICO contain the current canonical PNG artwork', async () => {
  const canonical = readProjectFile('build/icon.png');
  const canonicalMetadata = await sharp(canonical).metadata();
  assert.equal(canonicalMetadata.format, 'png');
  assert.equal(canonicalMetadata.width, 1024);
  assert.equal(canonicalMetadata.height, 1024);

  const icnsEntries = parseIcns(readProjectFile('build/icon.icns'));
  const icns1024 = icnsEntries.get('ic10');
  assert(icns1024, 'ICNS is missing its 1024px representation');
  assertSameImage(await rawImage(icns1024), await rawImage(canonical), 'ICNS 1024px artwork');

  const icoEntries = parseIco(readProjectFile('build/icon.ico'));
  const ico256 = icoEntries.find((entry) => entry.width === 256 && entry.height === 256);
  assert(ico256, 'ICO is missing its 256px representation');
  assertSameImage(await rawImage(ico256.data), await rawImage(canonical, 256), 'ICO 256px artwork');
});
