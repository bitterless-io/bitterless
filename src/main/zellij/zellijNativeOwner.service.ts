import { execFile } from 'node:child_process';
import { lstatSync, realpathSync, unlinkSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export interface ZellijNativeIdentity {
  pid: number;
  started: string;
  command: string;
  executable: string;
  device: number;
  inode: number;
  uid: number;
  /** Adopted mapped file identity survives bundle moves/removal; absent only in legacy records. */
  executableDevice?: number;
  executableInode?: number;
}

const socketIdentity = (socket: string): { device: number; inode: number; uid: number } | null => {
  try {
    const status = lstatSync(socket);
    if (!status.isSocket() || status.isSymbolicLink()) return null;
    return { device: status.dev, inode: status.ino, uid: status.uid };
  } catch {
    return null;
  }
};

const processIdentity = async (
  pid: number
): Promise<{ started: string; command: string; processUid: number; state: string } | null> => {
  try {
    const { stdout } = await execute(
      '/bin/ps',
      ['-p', String(pid), '-o', 'uid=,stat=,lstart=,command='],
      {
        timeout: 750,
        maxBuffer: 16 * 1024,
        env: { ...process.env, LC_ALL: 'C' }
      }
    );
    const row = stdout
      .trim()
      .match(/^(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.+)$/u);
    if (!row) throw new Error('operation-failed');
    return { processUid: Number(row[1]), state: row[2], started: row[3], command: row[4] };
  } catch (error) {
    const failure = error as { code?: number; killed?: boolean; stdout?: string; stderr?: string };
    if (failure.code === 1 && !failure.killed && !failure.stdout?.trim() && !failure.stderr?.trim())
      return null;
    throw new Error('operation-failed');
  }
};

const hasExecutableIdentity = (identity: ZellijNativeIdentity): boolean => {
  if (
    !Object.prototype.hasOwnProperty.call(identity, 'executableDevice') &&
    !Object.prototype.hasOwnProperty.call(identity, 'executableInode')
  )
    return false;
  if (
    !Number.isSafeInteger(identity.executableDevice) ||
    typeof identity.executableDevice !== 'number' ||
    identity.executableDevice < 0 ||
    !Number.isSafeInteger(identity.executableInode) ||
    typeof identity.executableInode !== 'number' ||
    identity.executableInode <= 0
  )
    throw new Error('operation-failed');
  return true;
};

const processExecutable = async (
  pid: number
): Promise<{ executable: string; executableDevice: number; executableInode: number }> => {
  // The first kernel-backed txt mapping is the executable. Later mappings do not prove ownership.
  const { stdout } = await execute(
    '/usr/sbin/lsof',
    ['-a', '-p', String(pid), '-d', 'txt', '-F0pfnDi'],
    { timeout: 750, maxBuffer: 64 * 1024 }
  );
  const fields = stdout.split('\0').map((field) => field.replace(/^\n/u, ''));
  if (fields[0] !== 'p' + pid || fields[1] !== 'ftxt') throw new Error('operation-failed');
  const image = new Map<string, string>();
  for (const field of fields.slice(2)) {
    const key = field[0];
    if (key === 'f' || key === 'p') break;
    if (!['n', 'D', 'i'].includes(key)) continue;
    if (image.has(key)) throw new Error('operation-failed');
    image.set(key, field.slice(1));
  }
  const executable = image.get('n') ?? '';
  const device = image.get('D') ?? '';
  const inode = image.get('i') ?? '';
  const executableDevice = Number(device);
  const executableInode = Number(inode);
  if (
    !isAbsolute(executable) ||
    !/^0x[\da-f]+$/iu.test(device) ||
    !/^\d+$/u.test(inode) ||
    !Number.isSafeInteger(executableDevice) ||
    executableDevice < 0 ||
    !Number.isSafeInteger(executableInode) ||
    executableInode <= 0
  )
    throw new Error('operation-failed');
  return { executable, executableDevice, executableInode };
};

/** Adopt only the exact native executable, --server path, UID and socket inode. No command or
 * process environment is logged. Legacy sessions are audited by the same rule after app restart. */
export const inspectZellijNativeOwner = async (
  socket: string,
  binary: string
): Promise<ZellijNativeIdentity | null> => {
  // Two attempts, because "the audit said no" and "the audit could not run" used to return the same
  // null. It spends up to three `ps`/`lsof` round trips bounded at 750ms each, and
  // `lsof -t -- <socket>` measured 0.33–0.48s on an IDLE machine — so a loaded host (the first boot
  // after an update: a full workspace re-index plus every renderer starting at once) loses the race
  // and a brand-new session is reported as somebody else's process. A CLEAN negative verdict still
  // returns immediately; only a thrown audit is retried
  // (docs/issues/zellij-update-restart-blocks-and-new-tab-fails.md #3.4).
  for (let attempt = 0; ; attempt += 1) {
    const found = await auditZellijNativeOwner(socket, binary);
    if (found !== 'audit-failed') return found;
    if (attempt > 0) return null;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
};

const auditZellijNativeOwner = async (
  socket: string,
  binary: string
): Promise<ZellijNativeIdentity | null | 'audit-failed'> => {
  const identity = socketIdentity(socket);
  if (!identity || identity.uid !== process.getuid?.()) return null;
  try {
    const { stdout } = await execute('/usr/sbin/lsof', ['-t', '--', socket], {
      timeout: 750,
      maxBuffer: 16 * 1024
    });
    const candidates = [...new Set(stdout.trim().split(/\s+/u).map(Number))];
    const expected = new Set([
      `${binary} --server ${socket}`,
      `${realpathSync(binary)} --server ${socket}`
    ]);
    const executable = realpathSync(binary);
    const expectedImage = lstatSync(executable);
    if (!expectedImage.isFile()) return null;
    const matches = await Promise.all(
      candidates
        .filter((pid) => Number.isInteger(pid) && pid > 1)
        .map(async (pid): Promise<ZellijNativeIdentity | null> => {
          const owner = await processIdentity(pid);
          if (!owner || owner.processUid !== identity.uid || !expected.has(owner.command))
            return null;
          const image = await processExecutable(pid);
          if (
            realpathSync(image.executable) !== executable ||
            image.executableDevice !== expectedImage.dev ||
            image.executableInode !== expectedImage.ino
          )
            return null;
          return {
            ...identity,
            executableDevice: image.executableDevice,
            executableInode: image.executableInode,
            started: owner.started,
            command: owner.command,
            executable,
            pid
          };
        })
    );
    const found = matches.filter((value): value is ZellijNativeIdentity => value !== null);
    return found.length === 1 && sameZellijSocket(socket, found[0]) ? found[0] : null;
  } catch {
    // `ps`/`lsof` itself failed or was killed at its deadline. That is not a verdict.
    return 'audit-failed';
  }
};

export const sameZellijSocket = (socket: string, identity: ZellijNativeIdentity): boolean => {
  const current = socketIdentity(socket);
  return Boolean(
    current &&
    current.device === identity.device &&
    current.inode === identity.inode &&
    current.uid === identity.uid
  );
};

const waitForKernelExit = async (identity: ZellijNativeIdentity): Promise<false> => {
  // Darwin can expose ?E while discarding argv, before it exposes Z or removes the PID. E alone
  // is not proof of death: wait briefly for a confirmed terminal state and otherwise preserve it.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const current = await processIdentity(identity.pid);
    if (!current || current.started !== identity.started) return false;
    if (current.processUid !== identity.uid) throw new Error('operation-failed');
    if (current.state.startsWith('Z')) return false;
  }
  throw new Error('operation-failed');
};

export const isZellijNativeOwnerAlive = async (
  identity: ZellijNativeIdentity
): Promise<boolean> => {
  // Old persisted records have no independently verified image. Unknown ownership must not be
  // interpreted as a dead daemon, because callers may unlink its socket after a false result.
  if (
    !identity.executable ||
    !isAbsolute(identity.executable) ||
    identity.uid !== process.getuid?.()
  )
    throw new Error('operation-failed');
  const fileIdentity = hasExecutableIdentity(identity);
  const current = await processIdentity(identity.pid);
  if (!current || current.started !== identity.started) return false;
  if (current.processUid !== identity.uid) throw new Error('operation-failed');
  // A same-birth, same-UID zombie has exited; macOS may already discard its argv/text mappings
  // before launchd reaps it. Missing live-process proof alone still never means death.
  if (current.state.startsWith('Z')) return false;
  if (current.state.includes('E')) return waitForKernelExit(identity);
  if (current.command !== identity.command) throw new Error('operation-failed');
  try {
    const image = await processExecutable(identity.pid);
    if (
      fileIdentity
        ? image.executableDevice !== identity.executableDevice ||
          image.executableInode !== identity.executableInode
        : realpathSync(image.executable) !== identity.executable
    )
      throw new Error('operation-failed');
  } catch {
    // The process may exit between ps and lsof; only a fresh process lookup proves that case.
    const rechecked = await processIdentity(identity.pid);
    if (!rechecked || rechecked.started !== identity.started) return false;
    if (rechecked.processUid === identity.uid && rechecked.state.startsWith('Z')) return false;
    if (rechecked.processUid === identity.uid && rechecked.state.includes('E'))
      return waitForKernelExit(identity);
    throw new Error('operation-failed');
  }
  return true;
};

const hasChildren = async (pid: number): Promise<boolean> => {
  const { stdout } = await execute('/bin/ps', ['-axo', 'ppid='], {
    timeout: 750,
    maxBuffer: 1024 * 1024
  });
  return stdout.split(/\s+/u).some((value) => Number(value) === pid);
};

/** Explicit close fallback for a proven half-shutdown daemon only. Active panes are never
 * inferred dead from a timeout. Check identity again immediately before every signal/unlink. */
export const finishZellijNativeShutdown = async (
  socket: string,
  identity: ZellijNativeIdentity
): Promise<void> => {
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    if (!(await isZellijNativeOwnerAlive(identity))) break;
    if (!sameZellijSocket(socket, identity) || (await hasChildren(identity.pid)))
      throw new Error('operation-failed');
    if (!(await isZellijNativeOwnerAlive(identity))) break;
    if (!sameZellijSocket(socket, identity)) throw new Error('operation-failed');
    process.kill(identity.pid, signal);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (!(await isZellijNativeOwnerAlive(identity))) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (await isZellijNativeOwnerAlive(identity)) throw new Error('operation-failed');
  if (sameZellijSocket(socket, identity)) unlinkSync(socket);
};
