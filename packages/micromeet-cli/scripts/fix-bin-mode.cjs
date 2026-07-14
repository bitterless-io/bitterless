const { chmodSync, existsSync } = require('fs')
const { join } = require('path')

const bin = join(__dirname, '..', 'dist', 'cli.js')
if (existsSync(bin)) chmodSync(bin, 0o755)
