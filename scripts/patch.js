#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// Bump _version patch (last segment +1)
const versionParts = packageJson._version.split('.');
const oldVersion = packageJson._version;
versionParts[2] = String(parseInt(versionParts[2]) + 1);
const newVersion = versionParts.join('.');
packageJson._version = newVersion;

// Update versionCode: yyMMdd + 2-digit daily sequence
const now = new Date();
const year = now.getFullYear().toString().slice(-2);
const month = (now.getMonth() + 1).toString().padStart(2, '0');
const day = now.getDate().toString().padStart(2, '0');
const todayPrefix = `${year}${month}${day}`;

const currentVersionCode = packageJson.versionCode ? String(packageJson.versionCode) : '';
let newVersionCode;

if (currentVersionCode.startsWith(todayPrefix)) {
  const suffix = parseInt(currentVersionCode.slice(6));
  if (suffix >= 99) {
    console.error('❌ 今天发布次数已达上限，请明天继续');
    process.exit(1);
  }
  newVersionCode = parseInt(`${todayPrefix}${(suffix + 1).toString().padStart(2, '0')}`);
} else {
  newVersionCode = parseInt(`${todayPrefix}01`);
}

packageJson.versionCode = newVersionCode;

fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
console.log(`✅ _version: ${oldVersion} -> ${newVersion}`);
console.log(`✅ versionCode: ${currentVersionCode} -> ${newVersionCode}`);
