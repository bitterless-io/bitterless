#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { compareVersions } = require('compare-versions');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// Bump _version patch (last segment +1)
const versionParts = packageJson._version.split('.');
const oldVersion = packageJson._version;
versionParts[2] = String(parseInt(versionParts[2]) + 1);
const newVersion = versionParts.join('.');
packageJson._version = newVersion;
packageJson.version = newVersion;

// Update version_code: local build timestamp YYMMDDHHmmss.
const now = new Date();
const year = now.getFullYear().toString().slice(-2);
const month = (now.getMonth() + 1).toString().padStart(2, '0');
const day = now.getDate().toString().padStart(2, '0');
const hour = now.getHours().toString().padStart(2, '0');
const minute = now.getMinutes().toString().padStart(2, '0');
const second = now.getSeconds().toString().padStart(2, '0');
const newVersionCode = `${year}${month}${day}${hour}${minute}${second}`;
const currentVersionCode = String(
  packageJson.version_code ?? packageJson.versionCode ?? '0',
);

if (compareVersions(newVersionCode, currentVersionCode) <= 0) {
  console.error(
    `❌ 新 version_code ${newVersionCode} 必须晚于当前版本 ${currentVersionCode}`,
  );
  process.exit(1);
}

packageJson.version_code = newVersionCode;
delete packageJson.versionCode;

fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
console.log(`✅ _version: ${oldVersion} -> ${newVersion}`);
console.log(`✅ version_code: ${currentVersionCode} -> ${newVersionCode}`);
