import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { parse } from '@bgotink/kdl/v1-compat';
import { ZellijNativeIpcError, ZellijNativeIpcService } from './zellijNativeIpc.service';
import type { ZellijNativeFirstClientOptions } from './zellijNativeIpc.type';
import { zellijDetail, zellijLog, zellijSessionTag } from './zellijLog.service';
import {
  finishZellijNativeShutdown,
  inspectZellijNativeOwner,
  isZellijNativeOwnerAlive,
  sameZellijSocket,
  type ZellijNativeIdentity
} from './zellijNativeOwner.service';

interface NativeSessionDependencies {
  socketDirectory: string;
  configFile: string;
  cacheDirectory: string;
  ownershipFile: string;
  binary: string;
  spawn(socket: string, session: string, cwd: string): Promise<void>;
}

/** Darwin native lifecycle. Every operation addresses one canonical socket; a stuck sibling
 * never participates. The hidden --server path is paired with the pinned native IPC contract. */
export class ZellijNativeSessionService {
  private readonly owners = new Map<string, ZellijNativeIdentity>();
  private abort = new AbortController();

  constructor(private readonly dependencies: NativeSessionDependencies) {
    try {
      const data = JSON.parse(readFileSync(dependencies.ownershipFile, 'utf8'));
      for (const [name, value] of Object.entries(data)) {
        const owner = value as ZellijNativeIdentity;
        if (
          /^[a-z0-9-]{1,48}$/u.test(name) &&
          Number.isInteger(owner.pid) &&
          owner.pid > 1 &&
          typeof owner.command === 'string' &&
          typeof owner.started === 'string' &&
          typeof owner.executable === 'string'
        ) {
          // Preserve invalid file IDs so ownership checks reject them instead of downgrading.
          this.owners.set(name, owner);
        }
      }
    } catch {
      /* Missing or invalid ownership cannot authorize cleanup. */
    }
    // Kicked from the constructor, not from the runtime's accessor, because the accessor is a DI
    // seam that tests replace with a stub class. Best effort, never awaited: the inventory is
    // diagnostics, and a slow `ps`/`lsof` must not delay the first terminal.
    if (this.owners.size) void this.auditRecordedOwners().catch(() => undefined);
  }

  socket(session: string): string {
    if (!/^[a-z0-9-]{1,48}$/u.test(session)) throw new Error('operation-failed');
    return join(this.dependencies.socketDirectory, 'contract_version_1', session);
  }

  async exists(session: string): Promise<boolean> {
    const socket = this.socket(session);
    const tag = zellijSessionTag(session);
    const startedAt = Date.now();
    const result = await new ZellijNativeIpcService(socket).probe({ signal: this.abort.signal });
    if (result === 'ready') {
      // ConnStatus also answers before FirstClientConnected. Only initialized sessions can attach.
      let panes: string;
      try {
        panes = await new ZellijNativeIpcService(socket).listPanes({ signal: this.abort.signal });
      } catch (error) {
        // A daemon can answer ConnStatus and then refuse the very next request — measured on
        // 2026-09-17: a `--server` that never received FirstClientConnected replies 'ready' to a
        // probe, then ECONNREFUSED to list-panes, then exits. That endpoint is gone, not broken, so
        // it must fall through to the stale-socket audit and be recreated. Treating it as fatal is
        // what stranded a tab on 'The terminal operation failed.' with no way back
        // (docs/issues/zellij-update-restart-blocks-and-new-tab-fails.md #3.3). Any other rejection
        // still describes a LIVE daemon, and inventing a second session for it would be worse.
        const code = error instanceof ZellijNativeIpcError ? error.code : 'none';
        if (code !== 'absent' && code !== 'disconnected') {
          zellijLog.error(
            'native-exists',
            { session: tag, verdict: 'panes-refused', ipcCode: code, elapsedMs: Date.now() - startedAt },
            zellijDetail(error instanceof ZellijNativeIpcError ? error.detail : error)
          );
          throw error;
        }
        zellijLog.warn('native-exists', {
          session: tag,
          verdict: 'vanished-after-probe',
          ipcCode: code,
          elapsedMs: Date.now() - startedAt
        });
        return this.auditStaleSocket(session, socket, tag, startedAt);
      }
      if (!Array.isArray(JSON.parse(panes))) {
        zellijLog.error('native-exists', {
          session: tag,
          verdict: 'panes-invalid',
          elapsedMs: Date.now() - startedAt
        });
        throw new Error('operation-failed');
      }
      zellijLog.info('native-exists', {
        session: tag,
        verdict: 'reuse',
        elapsedMs: Date.now() - startedAt
      });
      return true;
    }
    return this.auditStaleSocket(session, socket, tag, startedAt);
  }

  /**
   * The socket file outlived its daemon, or never had one. Unlink it only on proof of ownership and
   * death; otherwise refuse, because an unlink against a live foreign endpoint is unrecoverable.
   */
  private async auditStaleSocket(
    session: string,
    socket: string,
    tag: string,
    startedAt: number
  ): Promise<boolean> {
    if (!existsSync(socket)) {
      zellijLog.info('native-exists', {
        session: tag,
        verdict: 'absent',
        elapsedMs: Date.now() - startedAt
      });
      return false;
    }
    const owner = this.owners.get(session);
    let alive: boolean;
    try {
      alive = Boolean(owner) && (await isZellijNativeOwnerAlive(owner!));
    } catch (error) {
      zellijLog.error(
        'native-exists',
        { session: tag, verdict: 'owner-unverifiable', pid: owner?.pid, elapsedMs: Date.now() - startedAt },
        zellijDetail(error)
      );
      throw error;
    }
    if (!owner || !sameZellijSocket(socket, owner) || alive) {
      zellijLog.error('native-exists', {
        session: tag,
        verdict: !owner || !sameZellijSocket(socket, owner) ? 'socket-unowned' : 'owner-alive',
        pid: owner?.pid,
        elapsedMs: Date.now() - startedAt
      });
      throw new Error('operation-failed');
    }
    if (sameZellijSocket(socket, owner)) unlinkSync(socket);
    zellijLog.warn('native-exists', {
      session: tag,
      verdict: 'stale-socket-removed',
      pid: owner.pid,
      elapsedMs: Date.now() - startedAt
    });
    return false;
  }

  async create(session: string, cwd: string): Promise<void> {
    const signal = this.abort.signal;
    const socket = this.socket(session);
    const tag = zellijSessionTag(session);
    const startedAt = Date.now();
    // --server unlinks its path before binding. A present/unknown endpoint is never handed to it.
    if (await this.exists(session)) return;
    if (signal.aborted || existsSync(socket)) {
      zellijLog.error('native-create', {
        session: tag,
        outcome: 'failure',
        reason: signal.aborted ? 'aborted' : 'socket-present',
        elapsedMs: Date.now() - startedAt
      });
      throw new Error('operation-failed');
    }
    mkdirSync(dirname(socket), { recursive: true, mode: 0o700 });
    const layout = this.layout(session, cwd);
    zellijLog.info('native-create-start', {
      session: tag,
      layoutSource: Object.keys(layout ?? {})[0] ?? 'none'
    });
    await this.dependencies.spawn(socket, session, cwd);
    const deadline = Date.now() + 3_000;
    while (!existsSync(socket)) {
      if (Date.now() >= deadline) {
        zellijLog.error('native-create', {
          session: tag,
          outcome: 'failure',
          reason: 'socket-timeout',
          elapsedMs: Date.now() - startedAt
        });
        throw new Error('operation-failed');
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    // The retry for a timed-out audit lives inside `inspectZellijNativeOwner` — it is the place that
    // used to conflate "could not run the audit" with "not our process".
    const owner = await inspectZellijNativeOwner(socket, this.dependencies.binary);
    if (!owner) {
      zellijLog.error('native-create', {
        session: tag,
        outcome: 'failure',
        reason: 'unowned',
        elapsedMs: Date.now() - startedAt
      });
      throw new Error('operation-failed');
    }
    try {
      this.owners.set(session, owner);
      this.persistOwners();
      if (signal.aborted) throw new Error('operation-failed');
      await new ZellijNativeIpcService(socket).firstClientConnected(
        {
          configFilePath: this.dependencies.configFile,
          configDir: dirname(this.dependencies.configFile),
          layout
        },
        { signal }
      );
      zellijLog.info('native-create', {
        session: tag,
        outcome: 'success',
        reason: 'ready',
        pid: owner.pid,
        elapsedMs: Date.now() - startedAt
      });
    } catch (error) {
      const ipc = error instanceof ZellijNativeIpcError ? error : null;
      // THE line the 2026-09-17 incident needed: which session, which pid, which IPC verdict, and
      // Zellij's own words. Previously this failure produced one anonymous `operation-failed`.
      zellijLog.error(
        'native-create',
        {
          session: tag,
          outcome: 'failure',
          reason: ipc ? `first-client-${ipc.code}` : 'first-client-error',
          pid: owner.pid,
          elapsedMs: Date.now() - startedAt
        },
        zellijDetail(ipc?.detail || (error instanceof Error ? error.message : error))
      );
      // A cancelled or rejected bootstrap must not leave an empty daemon advertised as ready.
      // The fallback refuses any process with children; an initialized user session is retained.
      try {
        await finishZellijNativeShutdown(socket, owner);
        zellijLog.warn('native-shutdown-on-failure', { session: tag, pid: owner.pid, outcome: 'killed' });
      } catch (shutdown) {
        /* Preserve uncertain/live ownership. */
        zellijLog.error(
          'native-shutdown-on-failure',
          { session: tag, pid: owner.pid, outcome: 'retained' },
          zellijDetail(shutdown)
        );
      }
      throw error;
    }
  }

  metadata(session: string, action: string): Promise<string> {
    const ipc = new ZellijNativeIpcService(this.socket(session));
    return action === 'current-tab-info'
      ? ipc.currentTabInfo({ signal: this.abort.signal })
      : ipc.listPanes({ signal: this.abort.signal });
  }

  async close(session: string): Promise<void> {
    const tag = zellijSessionTag(session);
    const startedAt = Date.now();
    try {
      await this.closeSession(session);
      zellijLog.info('native-close', {
        session: tag,
        outcome: 'closed',
        elapsedMs: Date.now() - startedAt
      });
    } catch (error) {
      // Five distinct throws inside share one string. A close that fails is exactly how a
      // deliberately closed tab keeps its session alive — the case an update used to force.
      zellijLog.error(
        'native-close',
        {
          session: tag,
          outcome: 'failure',
          pid: this.owners.get(session)?.pid,
          elapsedMs: Date.now() - startedAt
        },
        zellijDetail(error)
      );
      throw error;
    }
  }

  private async closeSession(session: string): Promise<void> {
    const socket = this.socket(session);
    const recorded = this.owners.get(session);
    const owner = recorded ?? (await inspectZellijNativeOwner(socket, this.dependencies.binary));
    if (existsSync(socket)) {
      if (!owner || !sameZellijSocket(socket, owner)) throw new Error('operation-failed');
      // Recorded image mismatches cannot authorize IPC or be bypassed through fresh adoption.
      const alive = await isZellijNativeOwnerAlive(owner);
      if (!alive && sameZellijSocket(socket, owner)) unlinkSync(socket);
      // KillSession is authorized by this exact deliberate close, even when ConnStatus is stuck.
      try {
        if (alive)
          await new ZellijNativeIpcService(socket).killSession({
            verifyEndpoint: () => sameZellijSocket(socket, owner)
          });
      } catch {
        /* Audit below decides cleanup. */
      }
      const deadline = Date.now() + 1_000;
      while (existsSync(socket) && Date.now() < deadline) {
        if (owner && !sameZellijSocket(socket, owner)) throw new Error('operation-failed');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (owner) {
        if (await isZellijNativeOwnerAlive(owner)) await finishZellijNativeShutdown(socket, owner);
        else if (sameZellijSocket(socket, owner)) unlinkSync(socket);
      } else if (existsSync(socket)) throw new Error('operation-failed');
    }
    const ownerAlive = owner && (await isZellijNativeOwnerAlive(owner));
    if (ownerAlive || existsSync(socket)) throw new Error('operation-failed');
    // Native delete-session removes this exact cache directory. Do the same only after exit;
    // using its CLI here would reintroduce the global blocking session assertion.
    const cache = join(this.dependencies.cacheDirectory, session);
    if (existsSync(cache)) {
      const status = lstatSync(cache);
      if (!status.isDirectory() || status.isSymbolicLink() || status.uid !== process.getuid?.())
        throw new Error('operation-failed');
      rmSync(cache, { recursive: true });
    }
    this.owners.delete(session);
    this.persistOwners();
  }

  stop(): void {
    zellijLog.info('native-abort', { recorded: this.owners.size });
    this.abort.abort();
    this.abort = new AbortController();
  }

  /**
   * One pass over the sessions this application recorded, at boot: how many were retained across the
   * restart and whether each owner is still verifiable.
   *
   * Retaining native sessions on quit is deliberate (Ral 2026-09-12: 主动关 tab 就结束其会话；应用退出
   * 则保留会话), but nothing ever wrote that inventory down — so four daemons accumulating from
   * Sep 15/16 were invisible in every log, and so was the fact that an update had made all four
   * unverifiable. Best-effort and never awaited on the prepare path.
   */
  async auditRecordedOwners(): Promise<void> {
    let verified = 0;
    let unverifiable = 0;
    let gone = 0;
    for (const [session, owner] of [...this.owners].slice(0, 20)) {
      const tag = zellijSessionTag(session);
      try {
        const alive = await isZellijNativeOwnerAlive(owner);
        if (alive) verified += 1;
        else gone += 1;
        zellijLog.info('native-inventory', {
          session: tag,
          pid: owner.pid,
          verdict: alive ? 'alive' : 'exited',
          fileIdentity: owner.executableInode === undefined ? 'legacy' : 'recorded'
        });
      } catch (error) {
        unverifiable += 1;
        zellijLog.warn(
          'native-inventory',
          {
            session: tag,
            pid: owner.pid,
            verdict: 'unverifiable',
            fileIdentity: owner.executableInode === undefined ? 'legacy' : 'recorded'
          },
          zellijDetail(error)
        );
      }
    }
    zellijLog.info('native-inventory-summary', {
      recorded: this.owners.size,
      verified,
      exited: gone,
      unverifiable
    });
  }

  private layout(session: string, cwd: string): ZellijNativeFirstClientOptions['layout'] {
    const resurrect = join(this.dependencies.cacheDirectory, session, 'session-layout.kdl');
    if (existsSync(resurrect)) return { filePath: resurrect };
    const config = parse(readFileSync(this.dependencies.configFile, 'utf8'));
    const value = (name: string): unknown =>
      config.nodes.find((node) => node.getName() === name)?.getArguments()[0];
    const configured = value('default_layout');
    const layout = typeof configured === 'string' ? configured : 'default';
    if (/^https?:\/\//u.test(layout)) return { url: layout };
    const folder = value('layout_dir');
    const layoutDirectory =
      typeof folder === 'string'
        ? resolve(cwd, folder)
        : join(dirname(this.dependencies.configFile), 'layouts');
    const file = isAbsolute(layout) ? layout : join(layoutDirectory, layout);
    if (isAbsolute(layout) || extname(layout) || layout.includes('/')) return { filePath: file };
    if (existsSync(file)) return { filePath: file };
    if (existsSync(`${file}.kdl`)) return { filePath: `${file}.kdl` };
    return { builtinName: layout };
  }

  private persistOwners(): void {
    const file = this.dependencies.ownershipFile;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}`;
    try {
      writeFileSync(temporary, JSON.stringify(Object.fromEntries(this.owners)), {
        flag: 'wx',
        mode: 0o600
      });
      renameSync(temporary, file);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
}
