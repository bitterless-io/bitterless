import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { compareVersions } from 'compare-versions';
import { zellijLog } from './zellijLog.service';
import type { ZellijSnapshot } from '@shared/zellij/zellij.type';
import {
  defaultZellijShortcuts,
  editZellijShortcuts,
  readZellijShortcuts
} from './zellijConfigEdit.service';
import { buildZellijDefaultConfig } from './zellijDefaultConfig';
import { ensureZellijConfigDefaults } from './zellijConfigDefaults.service';
import { ZELLIJ_CONFIG_VERSION_CODE } from './zellijDefaultConfig.constant';
import type { ZellijShortcuts } from './zellijConfig.type';

export const ZELLIJ_CONFIG_ARG = '--zellij-config';

/**
 * `--zellij-config=<path>` on the app's own command line.
 *
 * Ranked ABOVE the two Zellij environment variables on purpose: a launch argument describes THIS
 * launch, while an exported env var leaks into every child process the app spawns — including the
 * `zellij` CLI itself, where it would silently override the `--config` we pass explicitly. An
 * argument also survives being read twice, which an env var mutated mid-run does not.
 *
 * macOS caveat: a bundle started from Finder or the Dock receives no arguments, so this is for
 * terminal launches (`open -a Bitterless --args --zellij-config=…`, or the binary directly) and for
 * per-environment shortcuts. It is NOT a substitute for a user-facing setting.
 */
export const parseZellijConfigArg = (argv: readonly string[]): string | undefined => {
  const prefix = `${ZELLIJ_CONFIG_ARG}=`;
  let found: string | undefined;
  for (const arg of argv) {
    if (arg === ZELLIJ_CONFIG_ARG) {
      // Reject the space-separated form rather than quietly consuming the next argv entry, which on
      // a packaged launch is just as likely to be a file the OS appended (Open With) as our value.
      throw new Error(`${ZELLIJ_CONFIG_ARG} must be written as ${ZELLIJ_CONFIG_ARG}=<path>`);
    }
    if (!arg.startsWith(prefix)) continue;
    const value = arg.slice(prefix.length);
    if (!value || /[\0\r\n]/.test(value)) {
      throw new Error(`${ZELLIJ_CONFIG_ARG} must be a non-empty single-line path`);
    }
    // Ambiguity here is a misconfiguration, not something to resolve by picking one.
    if (found !== undefined) throw new Error(`${ZELLIJ_CONFIG_ARG} may be provided only once`);
    found = value;
  }
  return found;
};

export const resolveZellijConfigFile = (
  options: {
    argv?: readonly string[];
    env?: NodeJS.ProcessEnv;
    home?: string;
    platform?: string;
    /**
     * The app's private data root. When given it is the default, ranked BELOW the explicit
     * argument and the two Zellij env vars so an operator can still point at the system file.
     * Omitted (tests, and any caller that genuinely wants the system config) keeps the old
     * directory probing.
     */
    userData?: string;
  } = {}
): string => {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const fromArgv = parseZellijConfigArg(options.argv ?? process.argv);
  if (fromArgv) return resolve(fromArgv);
  if (env.ZELLIJ_CONFIG_FILE) return resolve(env.ZELLIJ_CONFIG_FILE);
  if (env.ZELLIJ_CONFIG_DIR) return join(resolve(env.ZELLIJ_CONFIG_DIR), 'config.kdl');
  // App-private by default (Ral 2026-09-11). Bitterless and cowork both bundle Zellij, and the
  // shared system file made their settings panels fight: one app's save is the other's
  // `config-drift`, because drift detection is a sha256 of the whole file. `userData` already
  // differs per runtime profile, so Production/Preview/debug get separate files for free.
  if (options.userData) return join(options.userData, 'zellij', 'config.kdl');
  const conventional = join(home, '.config', 'zellij');
  const platformDirectory =
    platform === 'win32'
      ? join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Zellij', 'config')
      : platform === 'darwin'
        ? join(home, 'Library', 'Application Support', 'org.Zellij-Contributors.Zellij')
        : join(
            env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)
              ? env.XDG_CONFIG_HOME
              : join(home, '.config'),
            'zellij'
          );
  const candidates =
    platform === 'win32' ? [platformDirectory] : [conventional, platformDirectory, '/etc/zellij'];
  const existing = candidates.find((directory) => {
    try {
      return statSync(directory).isDirectory();
    } catch {
      return false;
    }
  });
  return join(existing ?? (platform === 'win32' ? platformDirectory : conventional), 'config.kdl');
};

export class ZellijConfigService {
  private initializing: Promise<void> | undefined;

  constructor(
    readonly file: string,
    private readonly options: { platform: string; validate: (file: string) => Promise<void> }
  ) {}

  read(): Pick<
    ZellijSnapshot,
    'configDirectory' | 'configFile' | 'configRevision' | 'configExists' | 'shortcuts'
  > {
    const source = this.source();
    return {
      configDirectory: dirname(this.file),
      configFile: this.file,
      configRevision: this.revision(source),
      configExists: source !== null,
      shortcuts:
        source === null || this.needsTemplateUpgrade(this.markerSource())
          ? defaultZellijShortcuts(this.options.platform)
          : readZellijShortcuts(source, this.options.platform)
    };
  }

  /**
   * Upgrade older templates with a validated full replacement and a backup. Within one template
   * version, complete only missing defaults and preserve explicit user choices.
   */
  initialize(): Promise<void> {
    if (this.initializing) return this.initializing;
    const pending = this.ensureDefaults().finally(() => {
      if (this.initializing === pending) this.initializing = undefined;
    });
    this.initializing = pending;
    return pending;
  }

  private async ensureDefaults(): Promise<void> {
    const startedAt = Date.now();
    const source = this.source();
    const revision = this.revision(source);
    const markerSource = this.markerSource();
    const upgrade = source === null || this.needsTemplateUpgrade(markerSource);
    const candidate = upgrade
      ? buildZellijDefaultConfig({ platform: this.options.platform })
      : ensureZellijConfigDefaults(source!, this.options.platform);
    // The most consequential invisible act of the 2026-09-17 boot: this replaced the whole template
    // (260914150147 → 260916230933) mid-startup, and the only trace was a backup file's mtime.
    // Zellij reads --config once, at server start, so which boot rewrote it decides which sessions
    // are running which configuration.
    zellijLog.info('config-decide', {
      exists: source !== null,
      upgrade,
      templateVersion: ZELLIJ_CONFIG_VERSION_CODE,
      willWrite: upgrade || candidate !== source
    });
    if (!upgrade && candidate === source) return;
    const directory = dirname(this.file);
    mkdirSync(directory, { recursive: true });
    const temporary = join(directory, `.bitterless-zellij-${randomUUID()}.kdl`);
    const temporaryMarker = `${temporary}.version.json`;
    try {
      const mode = source === null ? 0o600 : lstatSync(this.file).mode & 0o777;
      writeFileSync(temporary, candidate, { flag: 'wx', mode });
      const validateAt = Date.now();
      try {
        await this.options.validate(temporary);
      } catch (error) {
        zellijLog.error('config-validate', { verdict: 'failed', elapsedMs: Date.now() - validateAt });
        throw error;
      }
      // Spawns `zellij setup --check`: a 15s-bounded child whose duration is the single largest
      // unmeasured cost on the prepare path.
      zellijLog.info('config-validate', { verdict: 'ok', elapsedMs: Date.now() - validateAt });
      if (this.revision(this.source()) !== revision || this.markerSource() !== markerSource) {
        zellijLog.warn('config-drift', { stage: 'post-validate' });
        throw new Error('config-drift');
      }
      if (upgrade) {
        writeFileSync(
          temporaryMarker,
          JSON.stringify({
            schemaVersion: 1,
            versionCode: ZELLIJ_CONFIG_VERSION_CODE,
            configFile: resolve(this.file)
          }) + '\n',
          { flag: 'wx', mode: 0o600 }
        );
      }
      if (source !== null) {
        const backupAt = Date.now();
        writeFileSync(`${this.file}.bitterless-backup-${backupAt}-${randomUUID()}`, source, {
          flag: 'wx',
          mode: 0o600
        });
        // `backupAt` is the stamp IN the filename, so this line finds the artefact on disk.
        zellijLog.info('config-backup', { backupAt, bytes: source.length });
      }
      // No await between the final revision check and replacement.
      renameSync(temporary, this.file);
      // A marker never claims an upgrade before its validated configuration has landed.
      if (upgrade) renameSync(temporaryMarker, this.markerFile());
      zellijLog.info('config-write', {
        mode: upgrade ? 'upgrade' : 'defaults',
        bytes: candidate.length,
        elapsedMs: Date.now() - startedAt
      });
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
      if (existsSync(temporaryMarker)) unlinkSync(temporaryMarker);
    }
  }

  async save(input: { revision: string; shortcuts: ZellijShortcuts }): Promise<void> {
    const source = this.source();
    if (this.revision(source) !== input.revision) throw new Error('config-drift');
    const candidate = editZellijShortcuts(source ?? '', input.shortcuts);
    const directory = dirname(this.file);
    mkdirSync(directory, { recursive: true });
    const temporary = join(directory, `.bitterless-zellij-${randomUUID()}.kdl`);
    const mode = source === null ? 0o600 : lstatSync(this.file).mode & 0o777;
    try {
      writeFileSync(temporary, candidate, { flag: 'wx', mode });
      await this.options.validate(temporary);
      if (this.revision(this.source()) !== input.revision) throw new Error('config-drift');
      if (source !== null) {
        writeFileSync(`${this.file}.bitterless-backup-${Date.now()}-${randomUUID()}`, source, {
          flag: 'wx',
          mode: 0o600
        });
      }
      // No await between the final revision check and replacement.
      renameSync(temporary, this.file);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  private source(): string | null {
    if (!existsSync(this.file)) return null;
    const stat = lstatSync(this.file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024)
      throw new Error('config-invalid');
    return readFileSync(this.file, 'utf8');
  }

  private markerFile(): string {
    return `${this.file}.bitterless-version.json`;
  }

  private markerSource(): string | null {
    const file = this.markerFile();
    if (!existsSync(file)) return null;
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024) {
      throw new Error('config-invalid');
    }
    return readFileSync(file, 'utf8');
  }

  private needsTemplateUpgrade(markerSource: string | null): boolean {
    try {
      const marker = JSON.parse(markerSource ?? 'null') as {
        schemaVersion?: unknown;
        versionCode?: unknown;
        configFile?: unknown;
      } | null;
      return (
        !marker ||
        marker.schemaVersion !== 1 ||
        marker.configFile !== resolve(this.file) ||
        typeof marker.versionCode !== 'string' ||
        !/^\d{12}$/.test(marker.versionCode) ||
        compareVersions(marker.versionCode, ZELLIJ_CONFIG_VERSION_CODE) < 0
      );
    } catch {
      return true;
    }
  }

  private revision(source: string | null): string {
    return source === null ? 'missing' : createHash('sha256').update(source).digest('hex');
  }
}
