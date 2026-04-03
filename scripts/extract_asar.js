const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');

const asarPath = process.argv[2];

if (!asarPath) {
  console.error('Usage: node scripts/extract_asar.js <asar-absolute-path>');
  process.exit(1);
}

if (!path.isAbsolute(asarPath)) {
  console.error('Error: asar path must be absolute.');
  process.exit(1);
}

if (!fs.existsSync(asarPath)) {
  console.error(`Error: file not found: ${asarPath}`);
  process.exit(1);
}

const dumpDir = path.resolve(__dirname, '../dump');

if (fs.existsSync(dumpDir)) {
  fs.rmSync(dumpDir, { recursive: true, force: true });
}
fs.mkdirSync(dumpDir, { recursive: true });

console.log(`Extracting ${asarPath} -> ${dumpDir}`);
execSync(`npx @electron/asar extract "${asarPath}" "${dumpDir}"`, { stdio: 'inherit' });
console.log('Done.');
