import { lstat, readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import { isAbsolute } from 'node:path';
import { isRecord } from '../core/jsonRpcPeer';

export interface AcpBridgeOptions { socketPath?: string; descriptorPath?: string; args?: string[] }
export const resolveBridgeSocket = async (options: AcpBridgeOptions = {}): Promise<string> => {
  let socketPath = options.socketPath;
  let descriptorPath = options.descriptorPath;
  const args = options.args ?? process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if ((arg !== '--socket' && arg !== '--descriptor') || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Usage: --socket ABSOLUTE_PATH or --descriptor ABSOLUTE_PATH');
    if (arg === '--socket') socketPath = args[++index]; else descriptorPath = args[++index];
  }
  if (socketPath && descriptorPath) throw new Error('Choose --socket or --descriptor, not both');
  if (descriptorPath) {
    if (!isAbsolute(descriptorPath)) throw new Error('Descriptor path must be absolute');
    const stat = await lstat(descriptorPath);
    if (!stat.isFile() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid()) || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw new Error('Unsafe ACP discovery descriptor');
    const descriptor: unknown = JSON.parse(await readFile(descriptorPath, 'utf8'));
    if (!isRecord(descriptor) || descriptor.protocol !== 'acp' || descriptor.version !== 1 || typeof descriptor.socketPath !== 'string') throw new Error('Invalid ACP discovery descriptor');
    socketPath = descriptor.socketPath;
  }
  if (!socketPath) throw new Error('Specify --socket or --descriptor');
  if (process.platform === 'win32') {
    if (!socketPath.startsWith('\\\\.\\pipe\\')) throw new Error('ACP Windows endpoint must be a local named pipe');
  } else {
    if (!isAbsolute(socketPath)) throw new Error('Socket path must be absolute');
    const stat = await lstat(socketPath);
    if (!stat.isSocket() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o077) !== 0) throw new Error('Unsafe ACP socket');
  }
  return socketPath;
};
export const connectBridgeSocket = async (options: AcpBridgeOptions = {}): Promise<Socket> => {
  const path = await resolveBridgeSocket(options);
  return new Promise<Socket>((resolve, reject) => {
    const socket = createConnection(path);
    const failure = (error: Error): void => { socket.destroy(); reject(error); };
    socket.once('error', failure);
    socket.setTimeout(5_000, () => failure(new Error('ACP connection timed out')));
    socket.once('connect', () => { socket.setTimeout(0); socket.off('error', failure); resolve(socket); });
  });
};
