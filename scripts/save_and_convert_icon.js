const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const buildDir = path.resolve(__dirname, '../build');
const tempIconPath = path.join(buildDir, 'temp_icon.png');

console.log('Please provide the path to the bee image:');
console.log('Usage: node scripts/save_and_convert_icon.js <image_path>');

const imagePath = process.argv[2];

if (!imagePath) {
  console.error('\nError: Please provide the image path as an argument.');
  console.error('Example: node scripts/save_and_convert_icon.js ~/Downloads/bee.png');
  process.exit(1);
}

if (!fs.existsSync(imagePath)) {
  console.error(`\nError: Image not found at: ${imagePath}`);
  process.exit(1);
}

console.log(`\nCopying image from: ${imagePath}`);
fs.copyFileSync(imagePath, tempIconPath);

console.log('Running conversion script...\n');
execSync(`bash ${path.join(__dirname, 'convert_icon.sh')} "${tempIconPath}"`, { stdio: 'inherit' });

fs.unlinkSync(tempIconPath);
console.log('\n✓ All done!');
