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
import { ZellijNativeIpcService } from './zellijNativeIpc.service';
import type { ZellijNativeFirstClientOptions } from './zellijNativeIpc.type';
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
        )
          this.owners.set(name, owner);
      }
    } catch {
      /* Missing or invalid ownership cannot authorize cleanup. */
    }
  }

  socket(session: string): string {
    if (!/^[a-z0-9-]{1,48}$/u.test(session)) throw new Error('operation-failed');
    return join(this.dependencies.socketDirectory, 'contract_version_1', session);
  }

  async exists(session: string): Promise<boolean> {
    const socket = this.socket(session);
    const result = await new ZellijNativeIpcService(socket).probe({ signal: this.abort.signal });
    if (result === 'ready') {
      // ConnStatus also answers before FirstClientConnected. Only initialized sessions can attach.
      const panes = await new ZellijNativeIpcService(socket).listPanes({
        signal: this.abort.signal
      });
      if (!Array.isArray(JSON.parse(panes))) throw new Error('operation-failed');
      return true;
    }
    if (existsSync(socket)) {
      const owner = this.owners.get(session);
      if (!owner || !sameZellijSocket(socket, owner) || (await isZellijNativeOwnerAlive(owner)))
        throw new Error('operation-failed');
      if (sameZellijSocket(socket, owner)) unlinkSync(socket);
    }
    return false;
  }

  async create(session: string, cwd: string): Promise<void> {
    const signal = this.abort.signal;
    const socket = this.socket(session);
    // --server unlinks its path before binding. A present/unknown endpoint is never handed to it.
    if (await this.exists(session)) return;
    if (signal.aborted || existsSync(socket)) throw new Error('operation-failed');
    mkdirSync(dirname(socket), { recursive: true, mode: 0o700 });
    await this.dependencies.spawn(socket, session, cwd);
    const deadline = Date.now() + 3_000;
    while (!existsSync(socket)) {
      if (Date.now() >= deadline) throw new Error('operation-failed');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const owner = await inspectZellijNativeOwner(socket, this.dependencies.binary);
    if (!owner) throw new Error('operation-failed');
    try {
      this.owners.set(session, owner);
      this.persistOwners();
      if (signal.aborted) throw new Error('operation-failed');
      await new ZellijNativeIpcService(socket).firstClientConnected(
        {
          configFilePath: this.dependencies.configFile,
          configDir: dirname(this.dependencies.configFile),
          layout: this.layout(session, cwd)
        },
        { signal }
      );
    } catch (error) {
      // A cancelled or rejected bootstrap must not leave an empty daemon advertised as ready.
      // The fallback refuses any process with children; an initialized user session is retained.
      try {
        await finishZellijNativeShutdown(socket, owner);
      } catch {
        /* Preserve uncertain/live ownership. */
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
    const socket = this.socket(session);
    const current = await inspectZellijNativeOwner(socket, this.dependencies.binary);
    const recorded = this.owners.get(session);
    const owner = current ?? (recorded && sameZellijSocket(socket, recorded) ? recorded : null);
    if (existsSync(socket)) {
      if (!owner || !sameZellijSocket(socket, owner)) throw new Error('operation-failed');
      // KillSession is authorized by this exact deliberate close, even when ConnStatus is stuck.
      try {
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
    this.abort.abort();
    this.abort = new AbortController();
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
