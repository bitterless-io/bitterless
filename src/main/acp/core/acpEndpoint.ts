import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, chmod, unlink, rename, writeFile, readFile, rmdir, link } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import type { Stats } from 'node:fs';

export interface AcpEndpoint {
  socketPath: string;
  descriptorPath: string;
  environment: string;
}
export interface AcpDescriptor extends AcpEndpoint {
  version: 1;
  protocol: 'acp';
  protocolVersion: 1;
  pid: number;
  instanceId: string;
  agent: { name: string; version: string; title?: string };
}
export const createAcpEndpoint = (options: {
  appId: string; userData: string; environment: string; socketPath?: string; descriptorPath?: string;
}): AcpEndpoint => {
  if (!isAbsolute(options.userData)) throw new Error('ACP userData must be absolute');
  const key = createHash('sha256').update(`${options.appId}\0${options.userData}\0${options.environment}`).digest('hex').slice(0, 24);
  const uid = process.getuid?.() ?? 'user';
  const safeApp = options.appId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 24);
  const socketPath = options.socketPath ?? (process.platform === 'win32'
    ? `\\\\.\\pipe\\${safeApp}-acp-${key}`
    : join(tmpdir(), `acp-${uid}`, `${key}.sock`));
  if (process.platform !== 'win32' && (!isAbsolute(socketPath) || Buffer.byteLength(socketPath) >= 104)) {
    throw new Error('ACP socket path must be absolute and shorter than 104 UTF-8 bytes');
  }
  const descriptorPath = options.descriptorPath ?? join(options.userData, 'acp', `${options.environment.replace(/[^a-zA-Z0-9_-]/g, '-')}.json`);
  if (!isAbsolute(descriptorPath)) throw new Error('ACP discovery descriptor path must be absolute');
  return { socketPath, descriptorPath, environment: options.environment };
};
const maybeStat = async (path: string): Promise<Stats | undefined> => {
  try { return await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
};
const sameFile = (left: Stats, right?: Stats): boolean => !!right && left.dev === right.dev && left.ino === right.ino;
export const ensurePrivateDirectory = async (path: string): Promise<void> => {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('ACP runtime directory must be a real directory');
  if (process.getuid && stat.uid !== process.getuid()) throw new Error('ACP runtime directory belongs to another user');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error('ACP runtime directory must have permissions 0700');
  }
};
const isLiveSocket = (path: string): Promise<boolean> => new Promise((resolve, reject) => {
  const socket = createConnection(path);
  const finish = (value: boolean): void => { socket.destroy(); resolve(value); };
  socket.once('connect', () => finish(true));
  socket.once('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') finish(false);
    else { socket.destroy(); reject(error); }
  });
  socket.setTimeout(500, () => finish(true));
});
export const prepareAcpEndpoint = async (endpoint: AcpEndpoint): Promise<void> => {
  await ensurePrivateDirectory(dirname(endpoint.descriptorPath));
  if (process.platform === 'win32') {
    // Named-pipe authorization is supplied by the Windows host; do not claim POSIX mode bits protect a pipe.
    if (!endpoint.socketPath.startsWith('\\\\.\\pipe\\')) throw new Error('ACP Windows endpoint must be a named pipe');
    return;
  }
  await ensurePrivateDirectory(dirname(endpoint.socketPath));
  const stat = await maybeStat(endpoint.socketPath);
  if (!stat) return;
  if (!stat.isSocket() || stat.isSymbolicLink()) throw new Error('Refusing to replace non-socket ACP endpoint');
  if (process.getuid && stat.uid !== process.getuid()) throw new Error('ACP endpoint belongs to another user');
  if (await isLiveSocket(endpoint.socketPath)) throw new Error('ACP endpoint is already serving another instance');
  if (!sameFile(stat, await maybeStat(endpoint.socketPath))) throw new Error('ACP endpoint changed during stale-socket inspection');
  await unlink(endpoint.socketPath);
};
export const publishAcpDescriptor = async (descriptor: AcpDescriptor): Promise<() => Promise<void>> => {
  const file = descriptor.descriptorPath;
  const existing = await maybeStat(file);
  if (existing && (!existing.isFile() || existing.isSymbolicLink() || (process.getuid && existing.uid !== process.getuid()))) {
    throw new Error('Refusing to overwrite unsafe ACP discovery descriptor');
  }
  if (existing) {
    const previous: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (typeof previous !== 'object' || previous === null || !('protocol' in previous) || previous.protocol !== 'acp' || !('version' in previous) || previous.version !== 1 || !('instanceId' in previous) || typeof previous.instanceId !== 'string' || !('descriptorPath' in previous) || previous.descriptorPath !== file) throw new Error('Refusing to overwrite an unrelated discovery file');
    if (typeof previous === 'object' && previous !== null && 'socketPath' in previous && typeof previous.socketPath === 'string' && previous.socketPath !== descriptor.socketPath && await isLiveSocket(previous.socketPath)) {
      throw new Error('ACP discovery descriptor belongs to a live endpoint');
    }
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(descriptor, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => undefined); }
  const owned = await lstat(file);
  return async () => {
    if (sameFile(owned, await maybeStat(file))) await unlink(file).catch(() => undefined);
  };
};
export const ownSocketCleanup = async (path: string): Promise<() => Promise<void>> => {
  if (process.platform === 'win32') return async () => undefined;
  await chmod(path, 0o600);
  const owned = await lstat(path);
  return async () => {
    const current = await maybeStat(path);
    if (current?.isSocket() && sameFile(owned, current)) await unlink(path).catch(() => undefined);
  };
};

/** A lifetime lock serializes stale-socket recovery and bind, including concurrent application launches. */
export const acquireAcpEndpointLock = async (endpoint: AcpEndpoint): Promise<() => Promise<void>> => {
  const lockDirectory = process.platform === 'win32' ? `${endpoint.descriptorPath}.lock` : `${endpoint.socketPath}.lock`;
  await ensurePrivateDirectory(dirname(lockDirectory));
  const ownerFile = join(lockDirectory, 'owner.json');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockDirectory, { mode: 0o700 });
      const token = randomUUID();
      await writeFile(ownerFile, JSON.stringify({ protocol: 'acp-lock', pid: process.pid, token }), { flag: 'wx', mode: 0o600 });
      const directory = await lstat(lockDirectory);
      const file = await lstat(ownerFile);
      return async () => {
        if (!sameFile(directory, await maybeStat(lockDirectory)) || !sameFile(file, await maybeStat(ownerFile))) return;
        await unlink(ownerFile);
        await rmdir(lockDirectory).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const directory = await lstat(lockDirectory);
      if (!directory.isDirectory() || directory.isSymbolicLink() || (process.getuid && directory.uid !== process.getuid())) throw new Error('Unsafe ACP endpoint lock');
      const file = await lstat(ownerFile);
      if (!file.isFile() || file.isSymbolicLink()) throw new Error('Unsafe ACP lock owner file');
      const owner: unknown = JSON.parse(await readFile(ownerFile, 'utf8'));
      if (typeof owner !== 'object' || owner === null || !('protocol' in owner) || owner.protocol !== 'acp-lock' || !('pid' in owner) || typeof owner.pid !== 'number' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error('Invalid ACP endpoint lock');
      try { process.kill(owner.pid, 0); throw new Error('ACP endpoint is already owned by another process'); }
      catch (failure) { if ((failure as NodeJS.ErrnoException).code !== 'ESRCH') throw failure; }
      const recovery = join(lockDirectory, 'recovery');
      await writeFile(recovery, '', { flag: 'wx', mode: 0o600 });
      try {
        if (!sameFile(directory, await maybeStat(lockDirectory)) || !sameFile(file, await maybeStat(ownerFile))) throw new Error('ACP endpoint lock changed during recovery');
        await unlink(ownerFile);
      } finally { await unlink(recovery).catch(() => undefined); }
      await rmdir(lockDirectory);
    }
  }
  throw new Error('Could not acquire ACP endpoint lock');
};

/** Bind a private staging name: libuv unlinks its bind path blindly on close.
 * Publishing a hard link then removing the staging name lets our inode-checked cleanup
 * protect a replacement at the public path, including another live server. */
export const createAcpBindPath = (endpoint: AcpEndpoint): string => {
  if (process.platform === 'win32') return endpoint.socketPath;
  const path = join(dirname(endpoint.socketPath), '.acp-' + randomUUID().replace(/-/g, '').slice(0, 16) + '.sock');
  if (Buffer.byteLength(path) >= 104) throw new Error('ACP socket directory is too long for a safe staging endpoint');
  return path;
};
export const publishListeningSocket = async (bindPath: string, endpoint: AcpEndpoint): Promise<void> => {
  if (process.platform === 'win32') return;
  await chmod(bindPath, 0o600);
  await link(bindPath, endpoint.socketPath);
  await unlink(bindPath);
};
