#!/usr/bin/env node

/**
 * Generate a macOS-style rounded-corner icon from a square PNG.
 *
 * Usage:
 *   node roundIcon.js <input.png> [output.png]
 *
 * If output is omitted, writes to <input>_rounded.png.
 *
 * macOS app icon corner radius ≈ 22.37% of icon size (continuous corner / squircle approximation).
 * For a 512×512 icon the radius is ~114.5 px.
 */

const sharp = require('sharp');
const path = require('path');

const RADIUS_RATIO = 0.2237; // macOS app icon corner-radius ratio

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node roundIcon.js <input.png> [output.png]');
    process.exit(1);
  }

  const metadata = await sharp(inputPath).metadata();
  const size = metadata.width || 512;
  const radius = Math.round(size * RADIUS_RATIO);

  const outputPath = process.argv[3] || inputPath.replace(/\.png$/i, '_rounded.png');

  // Create an SVG mask with rounded rect
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}">
       <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="white"/>
     </svg>`
  );

  await sharp(inputPath)
    .resize(size, size)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toFile(outputPath);

  console.log(`✓ Rounded icon saved to: ${outputPath}`);
  console.log(`  Size: ${size}×${size}, Corner radius: ${radius}px (${(RADIUS_RATIO * 100).toFixed(2)}%)`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
