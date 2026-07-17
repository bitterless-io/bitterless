import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type {
  EyesOnAgentsBridgeReviewReason,
  EyesOnAgentsBridgeStatus
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import type { CodexHookDefinition } from './codexAppServer.supervisor';
import {
  createCodexHookCommand,
  createCodexHookShim,
  getCodexHookBridgeEndpoint,
  getCodexHookOutboxPath
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
  appRootPath: string;
  helperSourcePath?: string;
  platform?: NodeJS.Platform;
  idFactory?: () => string;
  now?: () => number;
  runtimeStatus?: () => {
    listening: boolean;
    listeningSince: number | null;
    lastEventAt: number | null;
  };
}

interface BridgeState {
  schemaVersion: 1;
  installationId: string;
  installed: boolean;
  originalSettingsExisted: boolean;
}

interface HookSpec {
  event: 'SessionStart' | 'UserPromptSubmit' | 'PermissionRequest' | 'Stop';
  protocolEvent: 'sessionStart' | 'userPromptSubmit' | 'permissionRequest' | 'stop';
  matcher?: string;
}

const HOOKS: HookSpec[] = [
  { event: 'SessionStart', protocolEvent: 'sessionStart', matcher: 'startup|resume|clear' },
  { event: 'UserPromptSubmit', protocolEvent: 'userPromptSubmit' },
  { event: 'PermissionRequest', protocolEvent: 'permissionRequest' },
  { event: 'Stop', protocolEvent: 'stop' }
];

const MAX_BRIDGE_ERROR_LENGTH = 300;
const HOOK_INSPECTION_ERROR = 'Codex hook inspection failed; reconnect or Sync to retry';
const HOOK_OPERATIONAL_ERROR = 'Codex hook observation failed; reconnect or Sync to retry';
const MAX_HELPER_ARTIFACT_FILES = 16;
const MAX_HELPER_ARTIFACT_BYTES = 512 * 1024;
const RELATIVE_REQUIRE_PATTERN = /require\(["'](\.[^"']+)["']\)/g;

type HookInspection =
  | { hooks: CodexHookDefinition[]; error: null; inspectedAt: number }
  | { hooks: null; error: string; inspectedAt: number };

interface HelperArtifactFile {
  relativePath: string;
  content: Buffer;
}

const boundedError = (_value: unknown): string => {
  return HOOK_INSPECTION_ERROR.slice(0, MAX_BRIDGE_ERROR_LENGTH);
};

const atomicWrite = (path: string, content: string | Uint8Array, mode = 0o600): void => {
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
  private readonly now: () => number;
  private readonly statePath: string;
  private readonly legacyStatePath: string;
  private readonly settingsPath: string;
  private readonly shimPath: string;
  private readonly helperRootPath: string;
  private readonly helperPath: string;
  private readonly legacyHelperPath: string;
  private readonly helperSourcePath: string;
  private hookInspection: HookInspection | null = null;
  private operationalError: string | null = null;

  constructor(private readonly dependencies: CodexDesktopBridgeDependencies) {
    this.platform = dependencies.platform ?? process.platform;
    this.idFactory = dependencies.idFactory ?? randomUUID;
    this.now = dependencies.now ?? Date.now;
    this.statePath = join(dependencies.userDataPath, 'eyes-on-agents', 'codex-bridge.json');
    this.legacyStatePath = join(dependencies.userDataPath, 'coding-agent', 'installation.json');
    this.settingsPath = join(dependencies.homePath, '.codex', 'hooks.json');
    this.shimPath = join(
      dependencies.userDataPath,
      'bin',
      `bitterless-codex-session-hook${this.platform === 'win32' ? '.cmd' : ''}`
    );
    this.helperRootPath = join(
      dependencies.userDataPath,
      'bin',
      'bitterless-codex-hook-helper'
    );
    this.helperPath = join(this.helperRootPath, 'codexHookHelper.cjs');
    this.legacyHelperPath = join(dependencies.userDataPath, 'bin', 'bitterless-codex-hook-helper.cjs');
    this.helperSourcePath = dependencies.helperSourcePath ?? join(
      dependencies.appRootPath,
      'out',
      'main',
      'codexHookHelper.js'
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
      helperPath: this.helperPath,
      endpointPath: getCodexHookBridgeEndpoint(
        this.dependencies.userDataPath,
        this.platform
      ).path,
      installationId,
      outboxPath: getCodexHookOutboxPath(this.dependencies.userDataPath),
      platform: this.platform
    });
  }

  private expectedHelperArtifact(): HelperArtifactFile[] {
    const sourceRoot = dirname(this.helperSourcePath);
    const queue = [this.helperSourcePath];
    const visited = new Set<string>();
    const files: HelperArtifactFile[] = [];
    let totalBytes = 0;
    while (queue.length > 0) {
      const sourcePath = resolve(queue.shift() as string);
      if (visited.has(sourcePath)) continue;
      visited.add(sourcePath);
      const sourceRelativePath = relative(sourceRoot, sourcePath);
      if (
        !sourceRelativePath ||
        sourceRelativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
        sourceRelativePath === '..' ||
        isAbsolute(sourceRelativePath)
      ) {
        throw new Error('Codex hook helper dependency escaped its build directory');
      }
      if (!lstatSync(sourcePath).isFile()) {
        throw new Error('Codex hook helper artifact contains a non-file dependency');
      }
      const content = readFileSync(sourcePath);
      totalBytes += content.length;
      if (files.length + 1 > MAX_HELPER_ARTIFACT_FILES || totalBytes > MAX_HELPER_ARTIFACT_BYTES) {
        throw new Error('Codex hook helper artifact exceeds its bounded package');
      }
      files.push({
        relativePath: sourcePath === resolve(this.helperSourcePath)
          ? 'codexHookHelper.cjs'
          : sourceRelativePath,
        content
      });
      const source = content.toString('utf8');
      for (const match of source.matchAll(RELATIVE_REQUIRE_PATTERN)) {
        const dependencyPath = resolve(dirname(sourcePath), match[1]);
        const dependencyRelativePath = relative(sourceRoot, dependencyPath);
        if (
          dependencyRelativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
          dependencyRelativePath === '..' ||
          isAbsolute(dependencyRelativePath)
        ) {
          throw new Error('Codex hook helper dependency escaped its build directory');
        }
        queue.push(dependencyPath);
      }
    }
    return files;
  }

  private installHelperArtifact(files: HelperArtifactFile[]): void {
    mkdirSync(this.helperRootPath, { recursive: true, mode: 0o700 });
    if (this.platform !== 'win32') chmodSync(this.helperRootPath, 0o700);
    const entry = files.find((file) => file.relativePath === 'codexHookHelper.cjs');
    if (!entry) throw new Error('Codex hook helper entry is missing');
    for (const file of files) {
      if (file === entry) continue;
      atomicWrite(join(this.helperRootPath, file.relativePath), file.content);
    }
    atomicWrite(this.helperPath, entry.content);
    const expected = new Set(files.map((file) => resolve(this.helperRootPath, file.relativePath)));
    const cleanDirectory = (directory: string): void => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        const stats = lstatSync(path);
        if (stats.isDirectory()) {
          cleanDirectory(path);
          if (readdirSync(path).length === 0) rmSync(path, { recursive: false, force: true });
        } else if (!expected.has(resolve(path))) {
          unlinkSync(path);
        }
      }
    };
    cleanDirectory(this.helperRootPath);
    if (existsSync(this.legacyHelperPath)) unlinkSync(this.legacyHelperPath);
  }

  private isHelperArtifactExact(files: HelperArtifactFile[]): boolean {
    return files.every((file) => {
      const path = join(this.helperRootPath, file.relativePath);
      return existsSync(path) && readFileSync(path).equals(file.content);
    });
  }

  private isOwnedHandler(value: unknown): boolean {
    if (!isEyesOnAgentsRecord(value)) return false;
    const expectedCommand = createCodexHookCommand(this.shimPath, this.platform);
    return [value.command, value.commandWindows].some(
      (command) => command === expectedCommand
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

  private runtime(): {
    listening: boolean;
    listeningSince: number | null;
    lastEventAt: number | null;
  } {
    return this.dependencies.runtimeStatus?.() ?? {
      listening: false,
      listeningSince: null,
      lastEventAt: null
    };
  }

  private response(
    state: EyesOnAgentsBridgeStatus['state'],
    error: string | null = null,
    reviewReason: EyesOnAgentsBridgeReviewReason | null = null
  ): EyesOnAgentsBridgeStatus {
    const runtime = this.runtime();
    return {
      state,
      reviewReason,
      listening: runtime.listening,
      listeningSince: runtime.listeningSince === null
        ? null
        : new Date(runtime.listeningSince).toISOString(),
      lastEventAt: runtime.lastEventAt === null
        ? null
        : new Date(runtime.lastEventAt).toISOString(),
      lastInspectedAt: this.hookInspection === null
        ? null
        : new Date(this.hookInspection.inspectedAt).toISOString(),
      error
    };
  }

  updateHookInspection(hooks: CodexHookDefinition[]): void {
    this.operationalError = null;
    this.hookInspection = {
      hooks: hooks.map((hook) => ({ ...hook })),
      error: null,
      inspectedAt: this.now()
    };
  }

  setHookInspectionError(error: unknown): void {
    this.operationalError = null;
    this.hookInspection = {
      hooks: null,
      error: boundedError(error),
      inspectedAt: this.now()
    };
  }

  setOperationalError(_error: unknown): void {
    this.operationalError = HOOK_OPERATIONAL_ERROR.slice(0, MAX_BRIDGE_ERROR_LENGTH);
  }

  private inspectedStatus(): EyesOnAgentsBridgeStatus {
    if (this.operationalError !== null) {
      return this.response('error', this.operationalError);
    }
    if (this.hookInspection === null) {
      return this.response('needs_trust', null, 'untrusted');
    }
    if (this.hookInspection.error !== null) {
      return this.response('error', this.hookInspection.error);
    }
    const expectedCommand = this.expectedHandler().command;
    const commandMatches = this.hookInspection.hooks.filter(
      (hook) => hook.command === expectedCommand
    );
    if (commandMatches.some((hook) => !this.isRuntimeOwnedDefinition(hook))) {
      return this.response('drifted', 'Codex reported changed Bitterless hook ownership');
    }
    const owned = commandMatches.filter(
      (hook) => this.isRuntimeOwnedDefinition(hook)
    );
    if (owned.length !== HOOKS.length) {
      return this.response(
        'drifted',
        `Codex reported ${owned.length} of ${HOOKS.length} Bitterless hooks`
      );
    }
    const matched: CodexHookDefinition[] = [];
    for (const spec of HOOKS) {
      const definitions = owned.filter((hook) =>
        hook.command === expectedCommand &&
        hook.eventName === spec.protocolEvent &&
        hook.handlerType === 'command' &&
        hook.matcher === (spec.matcher ?? null)
      );
      if (definitions.length !== 1) {
        return this.response('drifted', 'Codex reported changed Bitterless hook definitions');
      }
      matched.push(definitions[0]);
    }
    if (matched.some((hook) => !hook.enabled)) {
      return this.response('needs_trust', null, 'disabled');
    }
    if (matched.some((hook) =>
      hook.trustStatus !== 'trusted' &&
      hook.trustStatus !== 'managed' &&
      hook.trustStatus !== 'modified' &&
      hook.trustStatus !== 'untrusted'
    )) {
      return this.response('error', HOOK_INSPECTION_ERROR);
    }
    if (matched.some((hook) => hook.trustStatus === 'modified')) {
      return this.response('needs_trust', null, 'modified');
    }
    if (matched.some((hook) => hook.trustStatus === 'untrusted')) {
      return this.response('needs_trust', null, 'untrusted');
    }
    return this.response('installed');
  }

  private canonicalHookSourcePath(path: string): string {
    const canonical = resolve(path);
    return this.platform === 'win32' ? canonical.toLowerCase() : canonical;
  }

  private isRuntimeOwnedDefinition(hook: CodexHookDefinition): boolean {
    return hook.command === this.expectedHandler().command &&
      hook.source === 'user' &&
      hook.isManaged === false &&
      this.canonicalHookSourcePath(hook.sourcePath) ===
        this.canonicalHookSourcePath(this.settingsPath);
  }

  hasInstallationIntent(): boolean {
    try {
      return this.readState()?.installed === true;
    } catch {
      return false;
    }
  }

  hasExactInstallation(): boolean {
    try {
      const state = this.readState();
      if (!state?.installed) return false;
      const root = parseRoot(existsSync(this.settingsPath)
        ? readFileSync(this.settingsPath, 'utf8')
        : '{}');
      const inspection = this.inspect(root);
      return inspection.ownedCount === HOOKS.length &&
        inspection.exactCount === HOOKS.length &&
        existsSync(this.shimPath) &&
        readFileSync(this.shimPath, 'utf8') === this.expectedShim(state.installationId) &&
        existsSync(this.helperPath) &&
        this.isHelperArtifactExact(this.expectedHelperArtifact());
    } catch {
      return false;
    }
  }

  refreshInstalledArtifacts(): EyesOnAgentsBridgeStatus {
    try {
      const state = this.readState();
      if (!state?.installed) return this.getStatus();
      const root = parseRoot(existsSync(this.settingsPath)
        ? readFileSync(this.settingsPath, 'utf8')
        : '{}');
      const inspection = this.inspect(root);
      if (
        inspection.ownedCount !== HOOKS.length ||
        inspection.exactCount !== HOOKS.length
      ) {
        return this.response('drifted', 'Bitterless Codex hook configuration changed');
      }
      this.installHelperArtifact(this.expectedHelperArtifact());
      atomicWrite(
        this.shimPath,
        this.expectedShim(state.installationId),
        this.platform === 'win32' ? 0o600 : 0o700
      );
      return this.getStatus();
    } catch (error) {
      return this.response('error', error instanceof Error ? error.message : String(error));
    }
  }

  getDisabledExactHookKeys(): string[] {
    if (this.hookInspection?.error !== null || !this.hookInspection?.hooks) return [];
    if (this.inspectedStatus().reviewReason !== 'disabled') return [];
    const expectedCommand = this.expectedHandler().command;
    const keys: string[] = [];
    for (const spec of HOOKS) {
      const matches = this.hookInspection.hooks.filter((hook) =>
        this.isRuntimeOwnedDefinition(hook) &&
        hook.command === expectedCommand &&
        hook.eventName === spec.protocolEvent &&
        hook.handlerType === 'command' &&
        hook.matcher === (spec.matcher ?? null)
      );
      if (matches.length !== 1) return [];
      const hook = matches[0];
      if (!hook.enabled) {
        if (!hook.key) return [];
        keys.push(hook.key);
      }
    }
    return new Set(keys).size === keys.length ? keys : [];
  }

  getStatus(): EyesOnAgentsBridgeStatus {
    try {
      const state = this.readState();
      const root = parseRoot(existsSync(this.settingsPath)
        ? readFileSync(this.settingsPath, 'utf8')
        : '{}');
      const inspection = this.inspect(root);
      const shimExists = existsSync(this.shimPath);
      const helperExists = existsSync(this.helperPath);
      if (!state?.installed) {
        if (inspection.ownedCount > 0 || shimExists || helperExists) {
          return this.response('drifted', 'An incomplete Bitterless Codex hook was found');
        }
        return this.response('not_installed');
      }
      const shimExact = shimExists &&
        readFileSync(this.shimPath, 'utf8') === this.expectedShim(state.installationId);
      const helperExact = helperExists &&
        this.isHelperArtifactExact(this.expectedHelperArtifact());
      if (
        inspection.ownedCount !== HOOKS.length ||
        inspection.exactCount !== HOOKS.length ||
        !shimExact ||
        !helperExact
      ) {
        return this.response('drifted', 'Bitterless Codex hook configuration changed');
      }
      return this.inspectedStatus();
    } catch (error) {
      return this.response('error', error instanceof Error ? error.message : String(error));
    }
  }

  install(): EyesOnAgentsBridgeStatus {
    try {
      this.hookInspection = null;
      this.operationalError = null;
      const installationId = this.ensureInstallationId();
      const state = this.readState() as BridgeState;
      const root = parseRoot(existsSync(this.settingsPath)
        ? readFileSync(this.settingsPath, 'utf8')
        : '{}');
      this.installHelperArtifact(this.expectedHelperArtifact());
      atomicWrite(
        this.shimPath,
        this.expectedShim(installationId),
        this.platform === 'win32' ? 0o600 : 0o700
      );
      const inspection = this.inspect(root);
      if (
        inspection.ownedCount !== HOOKS.length ||
        inspection.exactCount !== HOOKS.length
      ) {
        atomicWrite(
          this.settingsPath,
          `${JSON.stringify(this.addExpectedHooks(root), null, 2)}\n`
        );
      }
      state.installed = true;
      this.writeState(state);
      return this.getStatus();
    } catch (error) {
      return this.response('error', error instanceof Error ? error.message : String(error));
    }
  }

  remove(): EyesOnAgentsBridgeStatus {
    try {
      this.hookInspection = null;
      this.operationalError = null;
      let state: BridgeState | null = null;
      let stateCorrupt = false;
      try {
        state = this.readState();
      } catch {
        stateCorrupt = true;
      }
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
      if (existsSync(this.helperRootPath)) {
        rmSync(this.helperRootPath, { recursive: true, force: true });
      }
      if (existsSync(this.legacyHelperPath)) unlinkSync(this.legacyHelperPath);
      const outboxPath = getCodexHookOutboxPath(this.dependencies.userDataPath);
      if (existsSync(outboxPath)) rmSync(outboxPath, { recursive: true, force: true });
      if (state) {
        state.installed = false;
        this.writeState(state);
      } else if (stateCorrupt && existsSync(this.statePath)) {
        unlinkSync(this.statePath);
      }
      return this.getStatus();
    } catch (error) {
      return this.response('error', error instanceof Error ? error.message : String(error));
    }
  }
}
