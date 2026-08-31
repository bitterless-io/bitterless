const fs = require('fs');
const path = require('path');
const {
  assertSelectedRuntimeProfile,
  loadCanonicalRigEnvironment
} = require('./environment/runtimeProfile.config.cjs');

const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const builderTmpPath = path.join(rootDir, 'electron-builder.tmp.yml');
const builderOutPath = path.join(rootDir, 'electron-builder.yml');

const selectedProfile = loadCanonicalRigEnvironment(rootDir);
assertSelectedRuntimeProfile(rootDir, selectedProfile.viteMode);
const viteEnv = selectedProfile.viteEnv;
const viteMode = selectedProfile.viteMode;
const releaseChannel = selectedProfile.releaseChannel;

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const baseName = pkg._name;
const isTimestampVersionCode = (value) => {
  if (typeof value !== 'string' || !/^\d{12}$/.test(value)) return false;
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  const hour = Number(value.slice(6, 8));
  const minute = Number(value.slice(8, 10));
  const second = Number(value.slice(10, 12));
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
};
if (!isTimestampVersionCode(pkg.version_code)) {
  throw new Error('[before.js] package.json version_code must be a YYMMDDHHmmss string');
}
if (pkg.versionCode != null) {
  throw new Error('[before.js] legacy package.json versionCode is not allowed');
}

const isDebug = viteMode === 'debug';
const isDev = viteEnv === 'dev';
const isPreview = releaseChannel === 'preview';

if (isPreview) {
  pkg.name = `${baseName}_PREVIEW`;
} else if (isDev) {
  pkg.name = isDebug ? `${baseName}_DEBUG_DEV` : `${baseName}_DEV`;
} else {
  pkg.name = isDebug ? `${baseName}_DEBUG_PROD` : baseName;
}

if (pkg._version) {
  pkg.version = pkg._version;
}

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
console.log(`[before.js] VITE_ENV=${viteEnv}, VITE_MODE=${viteMode}, VITE_RELEASE_CHANNEL=${releaseChannel}, package.json name set to: ${pkg.name}, version set to: ${pkg.version}`);

// Generate electron-builder.yml from template
const productName = isPreview ? `${baseName} Preview` : (isDev ? `${baseName}_DEV` : baseName);
const executableName = productName;
const appId = isPreview
  ? 'io.bitterless.desktop.preview'
  : (viteEnv === 'dev' ? 'io.bitterless.desktop_dev' : 'io.bitterless.desktop');
const artifactStem = isPreview ? `${baseName}-Preview` : productName;
const outputDirectory = isPreview ? 'dist/preview' : 'dist';
const iconStem = isPreview ? 'icon-preview' : 'icon';

let builderContent = fs.readFileSync(builderTmpPath, 'utf-8');
builderContent = builderContent.replace(/^appId:.*$/m, `appId: ${appId}`);
builderContent = builderContent.replace(/^productName:.*$/m, `productName: ${productName}`);
builderContent = builderContent.replace(/^(\s+output:).*$/m, `$1 ${outputDirectory}`);
builderContent = builderContent.replace(/^(\s+executableName:).*$/m, `$1 ${executableName}`);
builderContent = builderContent.replace(/^(\s+icon:) build\/icon\.ico$/m, `$1 build/${iconStem}.ico`);
builderContent = builderContent.replace(/^(\s+icon:) build\/icon\.icns$/m, `$1 build/${iconStem}.icns`);
builderContent = builderContent.replace(/ARTIFACT_STEM/g, artifactStem);

fs.writeFileSync(builderOutPath, builderContent, 'utf-8');
console.log(`[before.js] electron-builder.yml generated: appId=${appId}, productName=${productName}, executableName=${executableName}, output=${outputDirectory}, icon=${iconStem}, releaseChannel=${releaseChannel}`);

// Generate installer.nsh from template
const installerTmpPath = path.join(rootDir, 'build', 'installer.tmp.nsh');
const installerNshPath = path.join(rootDir, 'build', 'installer.nsh');
let installerContent = fs.readFileSync(installerTmpPath, 'utf-8');
installerContent = installerContent.replace(/EXECUTABLE_NAME/g, executableName);
const onlyPreviewInstall = [
  '    WriteRegStr SHCTX "Software\\Classes\\*\\shell\\OnlyPreview" "" "Open in Bitterless"',
  '    WriteRegStr SHCTX "Software\\Classes\\*\\shell\\OnlyPreview" "Icon" "$INSTDIR\\' + executableName + '.exe"',
  '    WriteRegStr SHCTX "Software\\Classes\\*\\shell\\OnlyPreview\\command" "" \'"$INSTDIR\\' + executableName + '.exe" "%1"\''
].join('\n');
installerContent = installerContent.replace(
  'ONLY_PREVIEW_INSTALL',
  isPreview ? '    ; Preview does not own the Stable OnlyPreview shell registration.' : onlyPreviewInstall
);
installerContent = installerContent.replace(
  'ONLY_PREVIEW_UNINSTALL',
  isPreview
    ? '    ; Preview must not remove the Stable OnlyPreview shell registration.'
    : '    DeleteRegKey SHCTX "Software\\Classes\\*\\shell\\OnlyPreview"'
);
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
  const distDir = path.join(rootDir, outputDirectory);
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
    versionCode: pkg.version_code,
    channel: releaseChannel,
    releaseNotes,
  };

  const versionInfoPath = path.join(distDir, 'version_info.json');
  fs.writeFileSync(versionInfoPath, JSON.stringify(versionInfo, null, 2) + '\n', 'utf-8');
  console.log(`[before.js] ✅ version_info.json written to ${outputDirectory}/ (version=${pkg.version}, versionCode=${pkg.version_code}, channel=${releaseChannel})`);
};

writeVersionInfo();
