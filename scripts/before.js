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

const isDebug = viteMode === 'debug';
const isDev = viteEnv === 'dev';

if (isDev) {
  pkg.name = isDebug ? `${baseName}_DEV_DEBUG` : `${baseName}_DEV`;
} else {
  pkg.name = isDebug ? `${baseName}_DEBUG` : baseName;
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

// Generate installer.nsh from template
const installerTmpPath = path.join(rootDir, 'build', 'installer.tmp.nsh');
const installerNshPath = path.join(rootDir, 'build', 'installer.nsh');
let installerContent = fs.readFileSync(installerTmpPath, 'utf-8');
installerContent = installerContent.replace(/EXECUTABLE_NAME/g, executableName);
fs.writeFileSync(installerNshPath, installerContent, 'utf-8');
console.log(`[before.js] installer.nsh generated from template: executableName=${executableName}`);

// Validate release_note.md exists for release builds
if (viteMode === 'release') {
  const releaseNotePath = path.join(rootDir, 'build', 'release_note.md');
  if (!fs.existsSync(releaseNotePath)) {
    console.warn('[before.js] ⚠️  Warning: release_note.md not found in build/ directory for release build');
  } else {
    console.log('[before.js] ✅ release_note.md found');
  }
}

// Write version_info.json to dist/
const writeVersionInfo = () => {
  const distDir = path.join(rootDir, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const releaseNotePath = path.join(rootDir, 'build', 'release_note.md');
  let releaseNotes = '';
  if (fs.existsSync(releaseNotePath)) {
    releaseNotes = fs.readFileSync(releaseNotePath, 'utf-8').trim();
  }

  const versionInfo = {
    version: pkg.version,
    versionCode: pkg.versionCode,
    releaseNotes,
  };

  const versionInfoPath = path.join(distDir, 'version_info.json');
  fs.writeFileSync(versionInfoPath, JSON.stringify(versionInfo, null, 2) + '\n', 'utf-8');
  console.log(`[before.js] ✅ version_info.json written to dist/ (version=${pkg.version}, versionCode=${pkg.versionCode})`);
};

writeVersionInfo();
