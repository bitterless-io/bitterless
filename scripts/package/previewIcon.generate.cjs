#!/usr/bin/env node

'use strict';

const path = require('node:path');
const sharp = require('sharp');

const rootDir = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(rootDir, 'build', 'icon.png');
const outputPath = path.join(rootDir, 'build', 'icon-preview.png');

const PREVIEW_BADGE = Object.freeze({
  color: '#c2410c',
  height: 100,
  radius: 50,
  width: 384,
  x: 540,
  y: 870
});

const createBadgeSvg = () => Buffer.from(
  `<svg width="${PREVIEW_BADGE.width}" height="${PREVIEW_BADGE.height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${PREVIEW_BADGE.width}" height="${PREVIEW_BADGE.height}" rx="${PREVIEW_BADGE.radius}" fill="${PREVIEW_BADGE.color}"/>
    <text x="${PREVIEW_BADGE.width / 2}" y="66" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700" letter-spacing="1">PREVIEW</text>
  </svg>`
);

const generatePreviewIcon = async () => {
  const encodedMetadata = await sharp(sourcePath).metadata();
  if (
    encodedMetadata.format !== 'png' ||
    encodedMetadata.width !== 1024 ||
    encodedMetadata.height !== 1024
  ) {
    throw new Error('build/icon.png must remain the canonical 1024x1024 PNG');
  }
  const source = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const metadata = source.info;
  const badge = await sharp(createBadgeSvg())
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.from(source.data);
  for (let y = 0; y < PREVIEW_BADGE.height; y += 1) {
    for (let x = 0; x < PREVIEW_BADGE.width; x += 1) {
      const badgeOffset = (y * PREVIEW_BADGE.width + x) * 4;
      const sourceAlpha = badge.data[badgeOffset + 3] / 255;
      if (sourceAlpha === 0) continue;
      const outputOffset = (
        (y + PREVIEW_BADGE.y) * metadata.width + x + PREVIEW_BADGE.x
      ) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        output[outputOffset + channel] = Math.round(
          badge.data[badgeOffset + channel] * sourceAlpha +
          output[outputOffset + channel] * (1 - sourceAlpha)
        );
      }
    }
  }
  await sharp(output, {
    raw: {
      channels: 4,
      height: metadata.height,
      width: metadata.width
    }
  })
    .png()
    .toFile(outputPath);
  console.log(`[preview-icon] Generated ${outputPath}`);
};

if (require.main === module) {
  generatePreviewIcon().catch((error) => {
    console.error(`[preview-icon] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  PREVIEW_BADGE,
  generatePreviewIcon
};
