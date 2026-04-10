#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
};

const branch = execSync('git branch --show-current').toString().trim();

run('git restore .');
run(`git pull --no-edit origin ${branch}`);
run('yarn build:win');
run('yarn publish:win');
