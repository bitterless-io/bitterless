#!/usr/bin/env node

const { execSync } = require('child_process');

const branch = execSync('git branch --show-current').toString().trim();

execSync(`git push origin ${branch}`, { stdio: 'inherit' });
