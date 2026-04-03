import sharp from 'sharp';
import { resolve, parse } from 'path';
import { mkdir } from 'fs/promises';

// Mac app icon sizes: standard iconset sizes + common UI sizes
const SIZES = [16, 32, 64, 128, 256, 512, 1024];
const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT_DIR = resolve(ROOT, 'doc/app_icons');

const input = process.argv[2];
if (!input) {
  console.error('用法: node scripts/generate_app_icons.js <图片路径>');
  process.exit(1);
}

const source = resolve(input);
const { name } = parse(source);

await mkdir(OUTPUT_DIR, { recursive: true });

for (const size of SIZES) {
  const output = resolve(OUTPUT_DIR, `${name}${size}.png`);
  await sharp(source)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(output);
  console.log(`✅ ${name}${size}.png`);
}

console.log(`\n图标已生成到 ${OUTPUT_DIR}`);
