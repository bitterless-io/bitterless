import type { ZellijErrorCode, ZellijSnapshot } from '@shared/zellij/zellij.type';
import { defaultZellijShortcuts } from './zellijConfigEdit.service';
import { dirname } from 'node:path';
import type { ZellijRuntimeDependencies, ZellijOwnedProcess } from './zellijRuntime.type';
import { zellijDetail, zellijLog } from './zellijLog.service';

const ERRORS = new Set<ZellijErrorCode>([
  'binary-missing',
  'unsupported-platform',
  'port-occupied',
  'version-mismatch',
  'web-sharing-disabled',
  'start-failed',
  'startup-timeout',
  'controls-load-timeout',
  'terminal-load-timeout',
  'controls-load-failed',
  'terminal-load-failed',
  'authentication-failed',
  'token-failed',
  'secure-storage-unavailable',
  'config-invalid',
  'config-drift',
  'config-validation-failed',
  'config-write-failed',
  'shortcut-invalid',
  'shortcut-conflict',
  'directory-missing',
  'directory-open-failed',
  'operation-failed'
]);

export const zellijErrorCode = (error: unknown): ZellijErrorCode => {
  const value = error as { code?: string; message?: string } | null;
  for (const code of [value?.code, value?.message]) {
    if (ERRORS.has(code as ZellijErrorCode)) return code as ZellijErrorCode;
  }
  return 'operation-failed';
};

export const parseZellijToken = (output: string): string => {
  const tokens = [
    ...output.matchAll(
      /^\s*token_\d+:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/gim
    )
  ];
  if (tokens.length !== 1) throw new Error('token-failed');
  return tokens[0][1];
};

export class ZellijProcessService {
  private status: ZellijSnapshot['status'] = 'idle';
  private error: ZellijErrorCode | null = null;
  private generation = 0;
  private pending: Promise<ZellijSnapshot> | null = null;
  private owned: ZellijOwnedProcess | null = null;
  private stopping: Promise<void> | null = null;

  constructor(private readonly dependencies: ZellijRuntimeDependencies) {}

  snapshot(): ZellijSnapshot {
    let config: ReturnType<ZellijRuntimeDependencies['config']['read']>;
    try {
      config = this.dependencies.config.read();
    } catch (error) {
      return {
        status: 'error',
        error: zellijErrorCode(error),
        configDirectory: dirname(this.dependencies.config.file),
        configFile: this.dependencies.config.file,
        configRevision: '',
        configExists: true,
        shortcuts: defaultZellijShortcuts(process.platform)
      };
    }
    return {
      ...config,
      status: this.status,
      error: this.error
    };
  }

  initialize(): Promise<ZellijSnapshot> {
    if (this.stopping)
      return this.stopping.then(
        () => this.initialize(),
        () => this.snapshot()
      );
    if (this.status === 'ready') return Promise.resolve(this.snapshot());
    if (this.pending) return this.pending;
    const generation = this.generation;
    const pending = this.open(generation).finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
    return pending;
  }

  async settingsSnapshot(): Promise<ZellijSnapshot> {
    try {
      this.dependencies.checkBinary();
      await this.dependencies.config.initialize();
      return this.snapshot();
    } catch (error) {
      return { ...this.snapshot(), configRevision: '', error: zellijErrorCode(error) };
    }
  }

  reportViewFailure(): void {
    this.status = 'error';
    this.error = 'operation-failed';
    this.publish();
  }

  async saveShortcuts(input: {
    revision: string;
    shortcuts: ZellijSnapshot['shortcuts'];
  }): Promise<ZellijSnapshot> {
    try {
      this.dependencies.checkBinary();
      await this.dependencies.config.save(input);
      // A settings save does not restart a failed server. Keep Retry visible until initialization.
      if (this.status !== 'error') this.error = null;
    } catch (error) {
      return { ...this.snapshot(), error: zellijErrorCode(error) };
    }
    this.publish();
    return { ...this.snapshot(), error: null };
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.generation += 1;
    this.pending = null;
    const owned = this.owned;
    this.status = 'idle';
    this.error = null;
    this.publish();
    const stopping = (async () => {
      try {
        if (owned) {
          await owned.stop();
          if (!owned.exited()) throw new Error('operation-failed');
          if (this.owned === owned) this.owned = null;
        }
      } catch {
        this.status = 'error';
        this.error = 'operation-failed';
        this.publish();
        throw new Error('operation-failed');
      }
    })().finally(() => {
      if (this.stopping === stopping) this.stopping = null;
    });
    this.stopping = stopping;
    return stopping;
  }

  private async open(generation: number): Promise<ZellijSnapshot> {
    const startedAt = Date.now();
    zellijLog.info('runtime-open-start', {
      generation,
      status: this.status,
      owned: Boolean(this.owned)
    });
    try {
      this.assertActive(generation);
      this.dependencies.checkBinary();
      this.status = 'starting';
      this.error = null;
      this.publish();
      const retained = this.owned;
      if (retained) {
        await retained.stop();
        if (!retained.exited()) throw new Error('operation-failed');
        if (this.owned === retained) this.owned = null;
        this.assertActive(generation);
      }
      this.dependencies.config.read();
      await this.dependencies.config.initialize();
      this.assertActive(generation);
      let probe = await this.dependencies.probe();
      zellijLog.info('runtime-probe', {
        phase: 'initial',
        verdict: probe,
        elapsedMs: Date.now() - startedAt
      });
      this.assertActive(generation);
      if (probe === 'mismatch') throw new Error('version-mismatch');
      if (probe === 'occupied') throw new Error('port-occupied');
      if (probe === 'absent') {
        const previous = this.owned;
        if (previous) {
          await previous.stop();
          if (!previous.exited()) throw new Error('operation-failed');
          if (this.owned === previous) this.owned = null;
        }
        this.assertActive(generation);
        // `server spawned pid=` only fires on the child's own 'spawn' event. A spawn that never
        // reaches it — busy binary, sandbox denial, fork failure — left no line at all.
        zellijLog.info('runtime-spawn-requested', {
          port: this.dependencies.port(),
          elapsedMs: Date.now() - startedAt
        });
        const child = this.dependencies.spawn([
          '--config',
          this.dependencies.config.file,
          'web',
          '--start',
          '--ip',
          '127.0.0.1',
          '--port',
          String(this.dependencies.port())
        ]);
        this.owned = child;
        child.onExit(() => {
          if (this.owned !== child) return;
          this.owned = null;
          if (generation !== this.generation) return;
          this.status = 'error';
          this.error = 'start-failed';
          this.publish();
        });
        let attempts = 0;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          attempts = attempt + 1;
          this.assertActive(generation);
          if (child.exited()) throw new Error('start-failed');
          await this.dependencies.delay(250);
          this.assertActive(generation);
          probe = await this.dependencies.probe();
          this.assertActive(generation);
          if (probe === 'matching') break;
          if (probe === 'mismatch' || probe === 'occupied') throw new Error('port-occupied');
        }
        // One line at completion, never per attempt: 40 x 250ms plus 40 probes is up to ~20s of a
        // slow boot, and until now that entire loop left no trace either way.
        const pollLine = { attempts, verdict: probe, elapsedMs: Date.now() - startedAt };
        if (probe === 'matching') zellijLog.info('runtime-poll-done', pollLine);
        else zellijLog.error('runtime-poll-done', pollLine);
        if (probe !== 'matching') throw new Error('startup-timeout');
      }
      this.assertActive(generation);
      const authAt = Date.now();
      let token = this.dependencies.readToken();
      if (token && (await this.dependencies.login(token))) {
        this.assertActive(generation);
        // Never the token itself: only which path produced it. The create-token CLI's stdout
        // contains a credential and is deliberately unlogged everywhere.
        zellijLog.info('runtime-auth', {
          tokenPath: 'reused',
          loginOk: true,
          elapsedMs: Date.now() - authAt
        });
        this.status = 'ready';
      } else {
        this.assertActive(generation);
        token = parseZellijToken(
          await this.dependencies.run([
            '--config',
            this.dependencies.config.file,
            'web',
            '--create-token'
          ])
        );
        this.assertActive(generation);
        this.dependencies.writeToken(token);
        if (!(await this.dependencies.login(token))) {
          zellijLog.error('runtime-auth', {
            tokenPath: 'created',
            loginOk: false,
            elapsedMs: Date.now() - authAt
          });
          throw new Error('authentication-failed');
        }
        this.assertActive(generation);
        zellijLog.info('runtime-auth', {
          tokenPath: 'created',
          loginOk: true,
          elapsedMs: Date.now() - authAt
        });
        this.status = 'ready';
      }
      zellijLog.info('runtime-open-end', {
        outcome: 'ready',
        generation,
        elapsedMs: Date.now() - startedAt
      });
    } catch (error) {
      if (generation === this.generation) {
        const child = this.owned;
        if (child) {
          try {
            await child.stop();
            if (child.exited() && this.owned === child) this.owned = null;
          } catch {
            /* Keep ownership until actual exit; Retry cannot borrow this process. */
          }
        }
        if (generation !== this.generation) return this.snapshot();
        this.status = 'error';
        this.error = zellijErrorCode(error);
      }
      // `changed()` already reported a failed status, but with no duration, no generation and no way
      // to tell a superseded open (assertActive throws the same string) from a real breakage.
      zellijLog.error(
        'runtime-open-end',
        {
          outcome: 'failure',
          reason: zellijErrorCode(error),
          generation,
          current: this.generation,
          elapsedMs: Date.now() - startedAt
        },
        zellijDetail(error instanceof Error ? error.message : error)
      );
    }
    if (generation === this.generation) this.publish();
    return this.snapshot();
  }

  private assertActive(generation: number): void {
    if (generation !== this.generation) throw new Error('operation-failed');
  }

  private publish(): void {
    this.dependencies.changed(this.snapshot());
  }
}
