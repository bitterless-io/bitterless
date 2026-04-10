#!/usr/bin/env node

const { execSync } = require('child_process');

const branch = execSync('git branch --show-current').toString().trim();

execSync('git restore .', { stdio: 'inherit' });
execSync(`git pull --no-edit origin ${branch}`, { stdio: 'inherit' });
