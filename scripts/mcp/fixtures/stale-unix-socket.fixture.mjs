#!/usr/bin/env node

import net from 'node:net';

const socketPath = process.argv[2];
if (!socketPath) throw new Error('A Unix socket path is required');

const server = net.createServer();
server.listen(socketPath, () => {
  process.stdout.write('ready\n');
});

setInterval(() => undefined, 1000);
