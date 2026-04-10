#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
};

run('node scripts/patch.js');
run('git add .');
run('git commit -m "nm"');

const branch = execSync('git branch --show-current').toString().trim();
run(`git push origin ${branch}`);
