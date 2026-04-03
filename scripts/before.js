const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const envRigPath = path.join(rootDir, '.env.rig');
const pkgPath = path.join(rootDir, 'package.json');
const builderTmpPath = path.join(rootDir, 'electron-builder.tmp.yml');
const builderOutPath = path.join(rootDir, 'electron-builder.yml');

const parseEnvRig = () => {
  if (!fs.existsSync(envRigPath)) return {};
  const content = fs.readFileSync(envRigPath, 'utf-8');
  const result = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.*?)\s*$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
};

const envVars = parseEnvRig();
const viteEnv = envVars.VITE_ENV || '';

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const baseName = pkg._name;

if (viteEnv) {
  pkg.name = `${baseName}_${viteEnv.toUpperCase()}`;
} else {
  pkg.name = baseName;
}

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
console.log(`[before.js] VITE_ENV=${viteEnv}, package.json name set to: ${pkg.name}`);

// Generate electron-builder.yml from template
const productName = pkg.name;
const executableName = pkg.name;
const appId = viteEnv === 'dev' ? 'io.bitterless.desktop_dev' : 'io.bitterless.desktop';

let builderContent = fs.readFileSync(builderTmpPath, 'utf-8');
builderContent = builderContent.replace(/^appId:.*$/m, `appId: ${appId}`);
builderContent = builderContent.replace(/^productName:.*$/m, `productName: ${productName}`);
builderContent = builderContent.replace(/^(\s+executableName:).*$/m, `$1 ${executableName}`);

fs.writeFileSync(builderOutPath, builderContent, 'utf-8');
console.log(`[before.js] electron-builder.yml generated: appId=${appId}, productName=${productName}, executableName=${executableName}`);

// Validate release_note.md exists for release builds
const viteMode = envVars.VITE_MODE || '';
if (viteMode === 'release') {
  const releaseNotePath = path.join(rootDir, 'build', 'release_note.md');
  if (!fs.existsSync(releaseNotePath)) {
    console.warn('[before.js] ⚠️  Warning: release_note.md not found in build/ directory for release build');
  } else {
    console.log('[before.js] ✅ release_note.md found');
  }
}

// Copy platform-specific Chromium tar files to asar_unpacked directory
const copyChromium = () => {
  const platform = process.platform;
  const arch = process.arch;
  
  let chromiumSourceFile = null;
  let tarFileName = null;
  
  if (platform === 'darwin') {
    if (arch === 'arm64') {
      tarFileName = 'chrome-macarm.tar';
      chromiumSourceFile = path.join(rootDir, 'external_resources', 'chromium', 'mac_arm', tarFileName);
    } else if (arch === 'x64') {
      tarFileName = 'chrome-mac.tar';
      chromiumSourceFile = path.join(rootDir, 'external_resources', 'chromium', 'mac_x64', tarFileName);
    }
  } else if (platform === 'win32') {
    tarFileName = 'chrome-win.tar';
    chromiumSourceFile = path.join(rootDir, 'external_resources', 'chromium', 'win', tarFileName);
  }
  
  if (!chromiumSourceFile || !tarFileName) {
    console.log(`[before.js] ⚠️  No Chromium configuration for platform=${platform}, arch=${arch}`);
    return;
  }
  
  const asarUnpackedDir = path.join(rootDir, 'asar_unpacked');
  const chromiumDestFile = path.join(asarUnpackedDir, tarFileName);
  
  if (!fs.existsSync(asarUnpackedDir)) {
    fs.mkdirSync(asarUnpackedDir, { recursive: true });
  }
  
  if (fs.existsSync(chromiumDestFile)) {
    console.log(`[before.js] ✅ ${tarFileName} already exists in asar_unpacked, skipping copy`);
    return;
  }
  
  if (!fs.existsSync(chromiumSourceFile)) {
    console.warn(`[before.js] ⚠️  Warning: ${tarFileName} not found at ${chromiumSourceFile}`);
    return;
  }
  
  console.log(`[before.js] Copying ${tarFileName} from ${chromiumSourceFile} to ${chromiumDestFile}...`);
  fs.copyFileSync(chromiumSourceFile, chromiumDestFile);
  console.log(`[before.js] ✅ ${tarFileName} copied successfully`);
};

copyChromium();
