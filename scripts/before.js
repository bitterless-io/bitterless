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
const viteMode = envVars.VITE_MODE || '';

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const baseName = pkg._name;
const baseLower = baseName.toLowerCase();

const isDebug = viteMode === 'debug';
const isDev = viteEnv === 'dev';

if (isDev) {
  pkg.name = isDebug ? `${baseLower}_dev_debug` : `${baseLower}_dev`;
} else {
  pkg.name = isDebug ? `${baseLower}_debug` : baseLower;
}

if (pkg._version) {
  pkg.version = pkg._version;
}

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
console.log(`[before.js] VITE_ENV=${viteEnv}, VITE_MODE=${viteMode}, package.json name set to: ${pkg.name}, version set to: ${pkg.version}`);

// Generate electron-builder.yml from template
const productName = isDev ? `${baseName}_DEV` : baseName;
const executableName = productName;
const appId = viteEnv === 'dev' ? 'io.bitterless.desktop_dev' : 'io.bitterless.desktop';

let builderContent = fs.readFileSync(builderTmpPath, 'utf-8');
builderContent = builderContent.replace(/^appId:.*$/m, `appId: ${appId}`);
builderContent = builderContent.replace(/^productName:.*$/m, `productName: ${productName}`);
builderContent = builderContent.replace(/^(\s+executableName:).*$/m, `$1 ${executableName}`);
builderContent = builderContent.replace(/VITE_ENV_PART/g, '');

fs.writeFileSync(builderOutPath, builderContent, 'utf-8');
console.log(`[before.js] electron-builder.yml generated: appId=${appId}, productName=${productName}, executableName=${executableName}, viteEnv=${viteEnv}`);

// Generate installer.nsh with the actual executable name
const installerNshPath = path.join(rootDir, 'build', 'installer.nsh');
const installerNshContent = `!macro preInit\n  ; Kill existing process before installation to avoid file lock\n  nsExec::ExecToLog 'taskkill /F /IM "${executableName}.exe" /T'\n  Sleep 1000\n!macroend\n`;
fs.writeFileSync(installerNshPath, installerNshContent, 'utf-8');
console.log(`[before.js] installer.nsh generated: executableName=${executableName}`);

// Validate release_note.md exists for release builds
if (viteMode === 'release') {
  const releaseNotePath = path.join(rootDir, 'build', 'release_note.md');
  if (!fs.existsSync(releaseNotePath)) {
    console.warn('[before.js] ⚠️  Warning: release_note.md not found in build/ directory for release build');
  } else {
    console.log('[before.js] ✅ release_note.md found');
  }
}

// Copy platform-specific Chromium zip files to asar_unpacked directory
const copyChromium = () => {
  const platform = process.platform;
  const arch = process.arch;

  let chromiumSourceFile = null;
  let zipFileName = null;

  if (platform === 'darwin') {
    if (arch === 'arm64') {
      zipFileName = 'chrome-macarm.zip';
      chromiumSourceFile = path.join(rootDir, 'external_resources', 'chromium', 'mac_arm', zipFileName);
    } else if (arch === 'x64') {
      zipFileName = 'chrome-mac.zip';
      chromiumSourceFile = path.join(rootDir, 'external_resources', 'chromium', 'mac_x64', zipFileName);
    }
  } else if (platform === 'win32') {
    zipFileName = 'chrome-win.zip';
    chromiumSourceFile = path.join(rootDir, 'external_resources', 'chromium', 'win', zipFileName);
  }

  if (!chromiumSourceFile || !zipFileName) {
    console.log(`[before.js] ⚠️  No Chromium configuration for platform=${platform}, arch=${arch}`);
    return;
  }

  const asarUnpackedDir = path.join(rootDir, 'asar_unpacked');
  const chromiumDestFile = path.join(asarUnpackedDir, zipFileName);

  if (!fs.existsSync(asarUnpackedDir)) {
    fs.mkdirSync(asarUnpackedDir, { recursive: true });
  }

  if (fs.existsSync(chromiumDestFile)) {
    console.log(`[before.js] ✅ ${zipFileName} already exists in asar_unpacked, skipping copy`);
    return;
  }

  if (!fs.existsSync(chromiumSourceFile)) {
    console.warn(`[before.js] ⚠️  Warning: ${zipFileName} not found at ${chromiumSourceFile}`);
    return;
  }

  console.log(`[before.js] Copying ${zipFileName} from ${chromiumSourceFile} to ${chromiumDestFile}...`);
  fs.copyFileSync(chromiumSourceFile, chromiumDestFile);
  console.log(`[before.js] ✅ ${zipFileName} copied successfully`);
};

copyChromium();
