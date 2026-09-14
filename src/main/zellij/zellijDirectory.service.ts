import { randomUUID } from 'node:crypto';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { isZellijNoSessionsError } from './zellijChildProcess.service';
import type { ZellijNativeSessionService } from './zellijNativeSession.service';

interface DirectoryDependencies {
  file: string;
  home: string;
  configFile: string;
  run(args: string[], cwd?: string): Promise<string>;
  native?: Pick<ZellijNativeSessionService, 'exists' | 'create' | 'close' | 'metadata' | 'stop'>;
}

/** Native JSON includes command lines. Return only a uniquely focused, visible terminal cwd. */
export const activeZellijPaneDirectory = (
  tabSource: string,
  panesSource: string
): string | null => {
  try {
    const tab = JSON.parse(tabSource);
    const panes: unknown = JSON.parse(panesSource);
    if (
      !tab ||
      !Number.isInteger(tab.tab_id) ||
      typeof tab.are_floating_panes_visible !== 'boolean' ||
      !Array.isArray(panes)
    )
      return null;
    const active = panes.filter(
      (pane) =>
        pane &&
        pane.tab_id === tab.tab_id &&
        pane.is_focused === true &&
        pane.is_floating === tab.are_floating_panes_visible &&
        pane.is_plugin === false &&
        pane.is_suppressed !== true &&
        pane.exited === false &&
        pane.is_selectable === true
    );
    const cwd = active.length === 1 ? active[0].pane_cwd : null;
    return typeof cwd === 'string' && isAbsolute(cwd) ? cwd : null;
  } catch {
    return null;
  }
};

export class ZellijDirectoryService {
  private active: string | null = null;
  private generation = 0;
  private lifecycle = 0;
  private observation: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly preparing = new Map<string, Promise<void>>();
  private readonly closing = new Map<string, Promise<void>>();
  private readonly sessionGenerations = new Map<string, number>();
  private remembered: string | null;

  constructor(private readonly dependencies: DirectoryDependencies) {
    this.remembered = this.readRemembered();
  }

  directory(): string {
    return this.usable(this.remembered) ? this.remembered! : this.dependencies.home;
  }

  activate(session: string): void {
    this.generation += 1;
    this.active = session;
    if (!this.timer) {
      this.timer = setInterval(() => void this.refresh(), 2_000);
      this.timer.unref?.();
    }
    void this.refresh();
  }

  deactivate(session: string): void {
    if (this.active !== session) return;
    const generation = this.generation;
    void (async () => {
      if (this.observation) await this.observation;
      if (generation !== this.generation || this.active !== session) return;
      await this.refresh();
      if (generation !== this.generation || this.active !== session) return;
      this.generation += 1;
      this.active = null;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    })();
  }

  async refresh(): Promise<void> {
    const previous = this.observation;
    if (previous) {
      await previous;
      return;
    }
    const session = this.active;
    if (!session) return;
    const generation = this.generation;
    const observing = (async () => {
      try {
        const tab = await this.metadata(session, 'current-tab-info');
        const panes = await this.metadata(session, 'list-panes');
        if (generation !== this.generation || this.active !== session) return;
        const cwd = activeZellijPaneDirectory(tab, panes);
        if (this.usable(cwd) && cwd !== this.remembered) this.persist(cwd!);
      } catch {
        // Closing/resurrecting sessions briefly have no metadata. No raw pane JSON in logs.
      }
    })().finally(() => {
      if (this.observation === observing) this.observation = null;
    });
    this.observation = observing;
    await observing;
  }

  prepare(session: string): Promise<void> {
    const closing = this.closing.get(session);
    if (closing) {
      const generation = this.sessionGenerations.get(session) ?? 0;
      const lifecycle = this.lifecycle;
      return closing.then(() => {
        if (
          generation !== (this.sessionGenerations.get(session) ?? 0) ||
          lifecycle !== this.lifecycle
        )
          throw new Error('operation-failed');
        return this.prepare(session);
      });
    }
    const existing = this.preparing.get(session);
    if (existing) return existing;
    const pending = this.prepareSession(session).finally(() => {
      if (this.preparing.get(session) === pending) this.preparing.delete(session);
    });
    this.preparing.set(session, pending);
    return pending;
  }

  close(session: string): Promise<void> {
    this.sessionGenerations.set(session, (this.sessionGenerations.get(session) ?? 0) + 1);
    const existing = this.closing.get(session);
    if (existing) return existing;
    const preparing = this.preparing.get(session);
    const pending = (async () => {
      await preparing?.catch(() => undefined);
      if (this.active === session) {
        if (this.observation) await this.observation;
        await this.refresh();
      }
      if (this.dependencies.native) {
        await this.dependencies.native.close(session);
        return;
      }
      let sessions = await this.listSessions();
      if (this.running(sessions, session)) {
        await this.dependencies.run([
          '--config',
          this.dependencies.configFile,
          'kill-session',
          session
        ]);
        for (let attempt = 0; attempt < 40; attempt += 1) {
          sessions = await this.listSessions();
          if (!this.running(sessions, session)) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (this.running(sessions, session)) throw new Error('operation-failed');
      }
      // An explicit close must not resurrect the old pane tree when the fixed window id reopens.
      if (sessions.split(/\r?\n/u).some((line) => line.startsWith(`${session} [`))) {
        await this.dependencies.run([
          '--config',
          this.dependencies.configFile,
          'delete-session',
          session
        ]);
      }
    })().finally(() => {
      if (this.closing.get(session) === pending) this.closing.delete(session);
    });
    this.closing.set(session, pending);
    this.deactivate(session);
    return pending;
  }

  async stop(): Promise<void> {
    const preparing = [...this.preparing.values()];
    this.lifecycle += 1;
    this.generation += 1;
    this.active = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.dependencies.native?.stop();
    this.preparing.clear();
    await Promise.allSettled(preparing);
    if (this.observation) await this.observation;
    await this.waitForClosures();
  }

  async waitForClosures(): Promise<void> {
    // A still-visible host can receive an explicit close while application teardown awaits.
    while (this.closing.size) await Promise.allSettled([...this.closing.values()]);
  }

  private async prepareSession(session: string): Promise<void> {
    const lifecycle = this.lifecycle;
    const sessionGeneration = this.sessionGenerations.get(session) ?? 0;
    const assertActive = (): void => {
      if (
        lifecycle !== this.lifecycle ||
        sessionGeneration !== (this.sessionGenerations.get(session) ?? 0)
      )
        throw new Error('operation-failed');
    };
    // Finish any in-flight sample then take a fresh one: a recent `cd` before New Tab wins.
    if (this.observation) await this.observation;
    await this.refresh();
    assertActive();
    if (this.dependencies.native) {
      if (!(await this.dependencies.native.exists(session))) {
        assertActive();
        await this.dependencies.native.create(session, this.directory());
      }
      assertActive();
      return;
    }
    const sessions = await this.listSessions();
    assertActive();
    if (this.running(sessions, session)) return;
    try {
      await this.dependencies.run(
        [
          '--config',
          this.dependencies.configFile,
          'attach',
          '--create-background',
          session,
          'options',
          '--web-server',
          'false'
        ],
        this.directory()
      );
    } catch (error) {
      // Another open/process may have created this exact named session between the check and attach.
      try {
        await this.metadata(session, 'list-panes');
      } catch {
        throw error;
      }
    }
  }

  private running(sessions: string, session: string): boolean {
    return sessions
      .split(/\r?\n/u)
      .some(
        (line) =>
          line.startsWith(`${session} [Created `) &&
          !line.includes('(EXITED - attach to resurrect)')
      );
  }

  private async listSessions(): Promise<string> {
    try {
      return await this.dependencies.run([
        '--config',
        this.dependencies.configFile,
        'list-sessions',
        '--no-formatting'
      ]);
    } catch (error) {
      if (isZellijNoSessionsError(error)) return '';
      throw error;
    }
  }

  private metadata(session: string, action: string): Promise<string> {
    if (this.dependencies.native) return this.dependencies.native.metadata(session, action);
    return this.dependencies.run([
      '--config',
      this.dependencies.configFile,
      '--session',
      session,
      'action',
      action,
      '--json'
    ]);
  }

  private usable(cwd: string | null): boolean {
    if (!cwd || !isAbsolute(cwd)) return false;
    try {
      if (!statSync(cwd).isDirectory()) return false;
      accessSync(cwd, constants.R_OK | constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  private readRemembered(): string | null {
    try {
      const value = JSON.parse(readFileSync(this.dependencies.file, 'utf8'));
      return typeof value.cwd === 'string' ? value.cwd : null;
    } catch {
      return null;
    }
  }

  private persist(cwd: string): void {
    const file = this.dependencies.file;
    const directory = dirname(file);
    mkdirSync(directory, { recursive: true });
    const temporary = join(directory, `.cwd-${randomUUID()}.json`);
    try {
      writeFileSync(temporary, JSON.stringify({ cwd }), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, file);
      this.remembered = cwd;
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
}
