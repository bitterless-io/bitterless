import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { EyesOnAgentsBridgeStatus } from '@shared/eyesOnAgents/eyesOnAgents.type';
import {
  createCodexHookCommand,
  createCodexHookShim,
  getCodexHookBridgeEndpoint
} from '@shared/eyesOnAgents/codexHookBridge.contract';
import {
  isEyesOnAgentsRecord,
  parseEyesOnAgentsUuid
} from '@shared/eyesOnAgents/eyesOnAgents.contract';

type JsonRecord = Record<string, unknown>;
type HookGroup = JsonRecord & { hooks: unknown[] };

interface CodexDesktopBridgeDependencies {
  userDataPath: string;
  homePath: string;
  execPath: string;
  appPath: string | null;
  platform?: NodeJS.Platform;
  idFactory?: () => string;
  runtimeStatus?: () => { listening: boolean; lastEventAt: number | null };
}

interface BridgeState {
  schemaVersion: 1;
  installationId: string;
  installed: boolean;
  originalSettingsExisted: boolean;
}

interface HookSpec {
  event: 'SessionStart' | 'UserPromptSubmit' | 'PermissionRequest' | 'Stop';
  matcher?: string;
}

const HOOKS: HookSpec[] = [
  { event: 'SessionStart', matcher: 'startup|resume|clear' },
  { event: 'UserPromptSubmit' },
  { event: 'PermissionRequest' },
  { event: 'Stop' }
];

const atomicWrite = (path: string, content: string, mode = 0o600): void => {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temp, content, { flag: 'wx', mode });
    renameSync(temp, path);
    if (process.platform !== 'win32') chmodSync(path, mode);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
};

const parseRoot = (text: string): JsonRecord => {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Codex hooks contain invalid JSON');
  }
  if (!isEyesOnAgentsRecord(value)) throw new Error('Codex hooks root must be an object');
  if (value.hooks !== undefined && !isEyesOnAgentsRecord(value.hooks)) {
    throw new Error('Codex hooks must be an object');
  }
  return value;
};

const parseState = (value: unknown): BridgeState => {
  if (
    !isEyesOnAgentsRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.installed !== 'boolean' ||
    typeof value.originalSettingsExisted !== 'boolean'
  ) {
    throw new Error('Codex bridge state is invalid');
  }
  return {
    schemaVersion: 1,
    installationId: parseEyesOnAgentsUuid(value.installationId, 'installationId'),
    installed: value.installed,
    originalSettingsExisted: value.originalSettingsExisted
  };
};

const groupMatcher = (group: JsonRecord): string | undefined => {
  return typeof group.matcher === 'string' ? group.matcher : undefined;
};

const isHookGroup = (value: unknown): value is HookGroup => {
  return isEyesOnAgentsRecord(value) && Array.isArray(value.hooks);
};

export class CodexDesktopBridgeService {
  private readonly platform: NodeJS.Platform;
  private readonly idFactory: () => string;
  private readonly statePath: string;
  private readonly legacyStatePath: string;
  private readonly settingsPath: string;
  private readonly shimPath: string;

  constructor(private readonly dependencies: CodexDesktopBridgeDependencies) {
    this.platform = dependencies.platform ?? process.platform;
    this.idFactory = dependencies.idFactory ?? randomUUID;
    this.statePath = join(dependencies.userDataPath, 'eyes-on-agents', 'codex-bridge.json');
    this.legacyStatePath = join(dependencies.userDataPath, 'coding-agent', 'installation.json');
    this.settingsPath = join(dependencies.homePath, '.codex', 'hooks.json');
    this.shimPath = join(
      dependencies.userDataPath,
      'bin',
      `bitterless-codex-session-hook${this.platform === 'win32' ? '.cmd' : ''}`
    );
  }

  private readState(): BridgeState | null {
    if (!existsSync(this.statePath)) return null;
    return parseState(JSON.parse(readFileSync(this.statePath, 'utf8')) as unknown);
  }

  private writeState(state: BridgeState): void {
    atomicWrite(this.statePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  private legacyInstallationId(): string | null {
    if (!existsSync(this.legacyStatePath)) return null;
    try {
      const value = JSON.parse(readFileSync(this.legacyStatePath, 'utf8')) as unknown;
      if (!isEyesOnAgentsRecord(value)) return null;
      return parseEyesOnAgentsUuid(value.installationId, 'legacy installationId');
    } catch {
      return null;
    }
  }

  ensureInstallationId(): string {
    const existing = this.readState();
    if (existing) return existing.installationId;
    const installationId = this.legacyInstallationId() ??
      parseEyesOnAgentsUuid(this.idFactory(), 'installationId');
    this.writeState({
      schemaVersion: 1,
      installationId,
      installed: false,
      originalSettingsExisted: existsSync(this.settingsPath)
    });
    return installationId;
  }

  private expectedHandler(): JsonRecord {
    const command = createCodexHookCommand(this.shimPath, this.platform);
    return {
      type: 'command',
      command,
      ...(this.platform === 'win32' ? { commandWindows: command } : {}),
      timeout: 2
    };
  }

  private expectedShim(installationId: string): string {
    return createCodexHookShim({
      execPath: this.dependencies.execPath,
      appPath: this.dependencies.appPath,
      endpointPath: getCodexHookBridgeEndpoint(
        this.dependencies.userDataPath,
        this.platform
      ).path,
      installationId,
      platform: this.platform
    });
  }

  private isOwnedHandler(value: unknown): boolean {
    if (!isEyesOnAgentsRecord(value)) return false;
    return [value.command, value.commandWindows].some(
      (command) => typeof command === 'string' && command.includes(this.shimPath)
    );
  }

  private isExactHandler(value: unknown): boolean {
    if (!isEyesOnAgentsRecord(value)) return false;
    return JSON.stringify(value) === JSON.stringify(this.expectedHandler());
  }

  private stripOwnedHooks(root: JsonRecord): JsonRecord {
    const next = structuredClone(root);
    if (!isEyesOnAgentsRecord(next.hooks)) return next;
    for (const [event, groupsValue] of Object.entries(next.hooks)) {
      if (!Array.isArray(groupsValue)) throw new Error(`Codex ${event} hooks must be an array`);
      const groups = groupsValue.flatMap((groupValue) => {
        if (!isHookGroup(groupValue)) throw new Error(`Codex ${event} hook group is invalid`);
        const handlers = groupValue.hooks.filter((handler) => !this.isOwnedHandler(handler));
        return handlers.length > 0 ? [{ ...groupValue, hooks: handlers }] : [];
      });
      if (groups.length > 0) next.hooks[event] = groups;
      else delete next.hooks[event];
    }
    if (Object.keys(next.hooks).length === 0) delete next.hooks;
    return next;
  }

  private addExpectedHooks(root: JsonRecord): JsonRecord {
    const next = this.stripOwnedHooks(root);
    const hooks = isEyesOnAgentsRecord(next.hooks) ? next.hooks : {};
    next.hooks = hooks;
    for (const spec of HOOKS) {
      const groupsValue = hooks[spec.event];
      if (groupsValue !== undefined && !Array.isArray(groupsValue)) {
        throw new Error(`Codex ${spec.event} hooks must be an array`);
      }
      const groups = (groupsValue ?? []) as unknown[];
      const groupIndex = groups.findIndex(
        (group) => isHookGroup(group) && groupMatcher(group) === spec.matcher
      );
      if (groupIndex < 0) {
        groups.push({
          ...(spec.matcher ? { matcher: spec.matcher } : {}),
          hooks: [this.expectedHandler()]
        });
      } else {
        const group = groups[groupIndex] as JsonRecord;
        group.hooks = [...(group.hooks as unknown[]), this.expectedHandler()];
      }
      hooks[spec.event] = groups;
    }
    return next;
  }

  private inspect(root: JsonRecord): { ownedCount: number; exactCount: number } {
    if (!isEyesOnAgentsRecord(root.hooks)) return { ownedCount: 0, exactCount: 0 };
    let ownedCount = 0;
    let exactCount = 0;
    for (const groups of Object.values(root.hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!isHookGroup(group)) continue;
        ownedCount += group.hooks.filter((handler) => this.isOwnedHandler(handler)).length;
      }
    }
    for (const spec of HOOKS) {
      const groups = root.hooks[spec.event];
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!isHookGroup(group)) continue;
        for (const handler of group.hooks) {
          if (!this.isOwnedHandler(handler)) continue;
          if (groupMatcher(group) === spec.matcher && this.isExactHandler(handler)) exactCount += 1;
        }
      }
    }
    return { ownedCount, exactCount };
  }

  private runtime(): { listening: boolean; lastEventAt: number | null } {
    return this.dependencies.runtimeStatus?.() ?? { listening: false, lastEventAt: null };
  }

  private response(
    state: EyesOnAgentsBridgeStatus['state'],
    error: string | null = null
  ): EyesOnAgentsBridgeStatus {
    const runtime = this.runtime();
    return {
      state,
      listening: runtime.listening,
      lastEventAt: runtime.lastEventAt === null
        ? null
        : new Date(runtime.lastEventAt).toISOString(),
      error
    };
  }

  getStatus(): EyesOnAgentsBridgeStatus {
    try {
      const state = this.readState();
      const root = parseRoot(existsSync(this.settingsPath)
        ? readFileSync(this.settingsPath, 'utf8')
        : '{}');
      const inspection = this.inspect(root);
      const shimExists = existsSync(this.shimPath);
      if (!state?.installed) {
        if (inspection.ownedCount > 0 || shimExists) {
          return this.response('drifted', 'An incomplete Bitterless Codex hook was found');
        }
        return this.response('not_installed');
      }
      const shimExact = shimExists &&
        readFileSync(this.shimPath, 'utf8') === this.expectedShim(state.installationId);
      if (
        inspection.ownedCount !== HOOKS.length ||
        inspection.exactCount !== HOOKS.length ||
        !shimExact
      ) {
        return this.response('drifted', 'Bitterless Codex hook configuration changed');
      }
      return this.response('installed');
    } catch (error) {
      return this.response('error', error instanceof Error ? error.message : String(error));
    }
  }

  install(): EyesOnAgentsBridgeStatus {
    try {
      const installationId = this.ensureInstallationId();
      const state = this.readState() as BridgeState;
      const root = parseRoot(existsSync(this.settingsPath)
        ? readFileSync(this.settingsPath, 'utf8')
        : '{}');
      atomicWrite(
        this.settingsPath,
        `${JSON.stringify(this.addExpectedHooks(root), null, 2)}\n`
      );
      atomicWrite(this.shimPath, this.expectedShim(installationId), this.platform === 'win32' ? 0o600 : 0o700);
      state.installed = true;
      this.writeState(state);
      return this.getStatus();
    } catch (error) {
      return this.response('error', error instanceof Error ? error.message : String(error));
    }
  }

  remove(): EyesOnAgentsBridgeStatus {
    try {
      const state = this.readState();
      const root = parseRoot(existsSync(this.settingsPath)
        ? readFileSync(this.settingsPath, 'utf8')
        : '{}');
      const next = this.stripOwnedHooks(root);
      if (
        state?.originalSettingsExisted === false &&
        Object.keys(next).length === 0
      ) {
        if (existsSync(this.settingsPath)) unlinkSync(this.settingsPath);
      } else if (existsSync(this.settingsPath) || Object.keys(next).length > 0) {
        atomicWrite(this.settingsPath, `${JSON.stringify(next, null, 2)}\n`);
      }
      if (existsSync(this.shimPath)) unlinkSync(this.shimPath);
      if (state) {
        state.installed = false;
        this.writeState(state);
      }
      return this.getStatus();
    } catch (error) {
      return this.response('error', error instanceof Error ? error.message : String(error));
    }
  }
}
