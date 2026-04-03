#!/usr/bin/env node

/**
 * Convert build/icon.png to build/icon.icns and build/icon.ico
 * Usage: node scripts/convertIcon.js
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const BUILD_DIR = path.resolve(__dirname, '..', 'build');
const INPUT = path.join(BUILD_DIR, 'icon.png');

// ICO sizes (standard Windows icon sizes)
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * Generate .icns using macOS iconutil
 */
async function generateIcns() {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'iconset-'));
  const iconsetDir = path.join(tmpDir, 'icon.iconset');
  fs.mkdirSync(iconsetDir);

  const sizes = [
    { name: 'icon_16x16.png', size: 16 },
    { name: 'icon_16x16@2x.png', size: 32 },
    { name: 'icon_32x32.png', size: 32 },
    { name: 'icon_32x32@2x.png', size: 64 },
    { name: 'icon_128x128.png', size: 128 },
    { name: 'icon_128x128@2x.png', size: 256 },
    { name: 'icon_256x256.png', size: 256 },
    { name: 'icon_256x256@2x.png', size: 512 },
    { name: 'icon_512x512.png', size: 512 },
    { name: 'icon_512x512@2x.png', size: 1024 },
  ];

  for (const { name, size } of sizes) {
    await sharp(INPUT).resize(size, size).png().toFile(path.join(iconsetDir, name));
  }

  const output = path.join(BUILD_DIR, 'icon.icns');
  execSync(`iconutil -c icns "${iconsetDir}" -o "${output}"`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('  ✓ icon.icns');
}

/**
 * Generate .ico by building the binary manually.
 * ICO format: header + directory entries + PNG image data.
 */
async function generateIco() {
  const images = [];
  for (const size of ICO_SIZES) {
    const buf = await sharp(INPUT).resize(size, size).png().toBuffer();
    images.push({ size, data: buf });
  }

  // ICO header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // type: 1 = ICO
  header.writeUInt16LE(images.length, 4);  // number of images

  // Each directory entry: 16 bytes
  const dirSize = 16 * images.length;
  let dataOffset = 6 + dirSize;

  const dirEntries = [];
  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 0);   // width (0 = 256)
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 1);   // height (0 = 256)
    entry.writeUInt8(0, 2);                                  // color palette
    entry.writeUInt8(0, 3);                                  // reserved
    entry.writeUInt16LE(1, 4);                               // color planes
    entry.writeUInt16LE(32, 6);                              // bits per pixel
    entry.writeUInt32LE(img.data.length, 8);                 // image data size
    entry.writeUInt32LE(dataOffset, 12);                     // offset to image data
    dirEntries.push(entry);
    dataOffset += img.data.length;
  }

  const output = path.join(BUILD_DIR, 'icon.ico');
  const ico = Buffer.concat([header, ...dirEntries, ...images.map((i) => i.data)]);
  fs.writeFileSync(output, ico);
  console.log('  ✓ icon.ico');
}

async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error(`Error: ${INPUT} not found`);
    process.exit(1);
  }

  console.log(`Converting ${INPUT}...`);
  await generateIcns();
  await generateIco();
  console.log('✓ Done!');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
