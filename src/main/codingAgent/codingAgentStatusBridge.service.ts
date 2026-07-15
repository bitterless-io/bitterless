import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  applyEdits,
  modify,
  parse as parseJsonc,
  type FormattingOptions,
  type ParseError
} from 'jsonc-parser';
import {
  createCodingAgentHookCommand,
  createPosixCodingAgentHookShim,
  createWindowsCodingAgentHookShim,
  getCodingAgentBridgeEndpoint
} from '@shared/codingAgent/codingAgentHookBridge.contract';
import type {
  CodingAgentIntegrationConfiguration,
  CodingAgentIntegrationStatus,
  CodingAgentProvider
} from '@shared/codingAgent/codingAgentSession.type';
import { isPlainRecord, parseProvider, parseUuid } from '@shared/codingAgent/codingAgentSession.contract';

type JsonRecord = Record<string, unknown>;

interface HookSpec {
  event: string;
  matcher?: string;
}

interface ProviderInstallState {
  installed: boolean;
  settingsPath: string;
  shimPath: string;
  shimHash: string | null;
  backupPath: string;
  originalExisted: boolean;
}

interface InstallationState {
  schemaVersion: 1;
  installationId: string;
  providers: Partial<Record<CodingAgentProvider, ProviderInstallState>>;
}

interface SettingsSnapshot {
  existed: boolean;
  raw: Buffer;
  text: string;
  value: JsonRecord;
}

interface ProviderLayout {
  settingsPath: string;
  shimPath: string;
  backupPath: string;
}

interface ConfigInspection {
  status: 'absent' | 'exact' | 'upgradeable' | 'drifted';
  snapshot: SettingsSnapshot;
  reason: string;
}

export interface CodingAgentStatusBridgeDependencies {
  userDataPath: string;
  homePath: string;
  execPath: string;
  appPath: string | null;
  platform?: NodeJS.Platform;
  idFactory?: () => string;
  bridgeStatus?: (provider: CodingAgentProvider) => {
    listening: boolean;
    lastEventAt: number | null;
  };
}

const HOOKS: Record<CodingAgentProvider, HookSpec[]> = {
  codex: [
    { event: 'SessionStart', matcher: 'startup|resume|clear' },
    { event: 'UserPromptSubmit' },
    { event: 'PermissionRequest' },
    { event: 'Stop' }
  ],
  claude: [
    { event: 'SessionStart', matcher: 'startup|resume|clear' },
    { event: 'UserPromptSubmit' },
    { event: 'PermissionRequest' },
    { event: 'Notification', matcher: 'permission_prompt|idle_prompt' },
    { event: 'Stop' },
    { event: 'StopFailure' },
    { event: 'SessionEnd' }
  ]
};

const sha256 = (value: string | Buffer): string => {
  return createHash('sha256').update(value).digest('hex');
};

const atomicWrite = (path: string, content: string | Buffer, mode?: number): void => {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const targetMode = mode ?? (existsSync(path) ? statSync(path).mode & 0o777 : 0o600);
  try {
    writeFileSync(temp, content, { flag: 'wx', mode: targetMode });
    renameSync(temp, path);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
};

const parseProviderInstallState = (value: unknown): ProviderInstallState => {
  if (
    !isPlainRecord(value) ||
    typeof value.installed !== 'boolean' ||
    typeof value.settingsPath !== 'string' ||
    typeof value.shimPath !== 'string' ||
    (value.shimHash !== null && typeof value.shimHash !== 'string') ||
    typeof value.backupPath !== 'string' ||
    typeof value.originalExisted !== 'boolean'
  ) {
    throw new Error('Invalid coding-agent provider installation state');
  }
  return value as unknown as ProviderInstallState;
};

const parseInstallationState = (value: unknown): InstallationState => {
  if (!isPlainRecord(value) || value.schemaVersion !== 1 || !isPlainRecord(value.providers)) {
    throw new Error('Invalid coding-agent installation state');
  }
  const providers: InstallationState['providers'] = {};
  for (const provider of ['codex', 'claude'] as const) {
    if (value.providers[provider] !== undefined) {
      providers[provider] = parseProviderInstallState(value.providers[provider]);
    }
  }
  return {
    schemaVersion: 1,
    installationId: parseUuid(value.installationId, 'installationId'),
    providers
  };
};

const parseSettingsText = (text: string, provider: CodingAgentProvider): JsonRecord => {
  let value: unknown;
  if (provider === 'claude') {
    const errors: ParseError[] = [];
    value = parseJsonc(text, errors, { allowTrailingComma: true });
    if (errors.length > 0) throw new Error('Claude Code settings contain invalid JSONC');
  } else {
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      throw new Error('Codex hooks contain invalid JSON');
    }
  }
  if (!isPlainRecord(value)) throw new Error('Provider settings root must be a JSON object');
  validateHookTree(value);
  return value;
};

const readSettings = (path: string, provider: CodingAgentProvider): SettingsSnapshot => {
  if (!existsSync(path)) {
    return { existed: false, raw: Buffer.alloc(0), text: '{}\n', value: {} };
  }
  const raw = readFileSync(path);
  const text = raw.toString('utf8');
  return { existed: true, raw, text, value: parseSettingsText(text, provider) };
};

const validateHookTree = (root: JsonRecord): void => {
  if (root.hooks === undefined) return;
  if (!isPlainRecord(root.hooks)) throw new Error('Provider hooks must be a JSON object');
  for (const groups of Object.values(root.hooks)) {
    if (!Array.isArray(groups)) throw new Error('Provider hook event must be an array');
    for (const group of groups) {
      if (!isPlainRecord(group) || !Array.isArray(group.hooks)) {
        throw new Error('Provider hook matcher group is invalid');
      }
      if (group.matcher !== undefined && typeof group.matcher !== 'string') {
        throw new Error('Provider hook matcher must be a string');
      }
      if (!group.hooks.every(isPlainRecord)) {
        throw new Error('Provider hook handler is invalid');
      }
    }
  }
};

const expectedHandler = (
  command: string,
  provider: CodingAgentProvider,
  platform: NodeJS.Platform
): JsonRecord => ({
  type: 'command',
  command,
  ...(provider === 'codex' && platform === 'win32' ? { commandWindows: command } : {}),
  timeout: 2
});

const isExpectedHandler = (value: JsonRecord, expected: JsonRecord): boolean => {
  const keys = Object.keys(value).sort();
  const expectedKeys = Object.keys(expected).sort();
  return keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]) &&
    expectedKeys.every((key) => value[key] === expected[key]);
};

const matcherMatches = (group: JsonRecord, spec: HookSpec): boolean => {
  return spec.matcher === undefined
    ? group.matcher === undefined
    : group.matcher === spec.matcher;
};

const isOwnedHookCommand = (
  value: unknown,
  shimPath: string,
  command: string
): boolean => {
  if (typeof value !== 'string') return false;
  return value === command ||
    value.includes(shimPath) ||
    value.replace(/%%/g, '%').includes(shimPath);
};

const isOwnedHookHandler = (
  value: JsonRecord,
  shimPath: string,
  command: string
): boolean => {
  return isOwnedHookCommand(value.command, shimPath, command) ||
    isOwnedHookCommand(value.commandWindows, shimPath, command);
};

const inspectConfig = (
  snapshot: SettingsSnapshot,
  provider: CodingAgentProvider,
  shimPath: string,
  command: string,
  platform: NodeJS.Platform
): ConfigInspection => {
  const hooks = isPlainRecord(snapshot.value.hooks) ? snapshot.value.hooks : {};
  const expected = expectedHandler(command, provider, platform);
  let allOwnedCount = 0;
  for (const groupsValue of Object.values(hooks)) {
    const groups = groupsValue as JsonRecord[];
    for (const group of groups) {
      for (const handler of group.hooks as JsonRecord[]) {
        if (isOwnedHookHandler(handler, shimPath, command)) allOwnedCount += 1;
      }
    }
  }
  let exactCount = 0;
  let candidateCount = 0;
  let matcherCandidateCount = 0;
  for (const spec of HOOKS[provider]) {
    const groups = Array.isArray(hooks[spec.event])
      ? hooks[spec.event] as JsonRecord[]
      : [];
    let eventExact = 0;
    let eventCandidates = 0;
    let eventMatcherCandidates = 0;
    for (const groupValue of groups) {
      const group = groupValue as JsonRecord;
      for (const handlerValue of group.hooks as JsonRecord[]) {
        const handler = handlerValue;
        if (!isOwnedHookHandler(handler, shimPath, command)) continue;
        eventCandidates += 1;
        if (matcherMatches(group, spec)) {
          eventMatcherCandidates += 1;
          if (isExpectedHandler(handler, expected)) eventExact += 1;
        }
      }
    }
    candidateCount += eventCandidates;
    matcherCandidateCount += eventMatcherCandidates;
    exactCount += eventExact;
    if (
      eventCandidates !== 0 &&
      (eventCandidates !== 1 || eventMatcherCandidates !== 1)
    ) {
      return {
        status: 'drifted',
        snapshot,
        reason: `Bitterless-owned ${spec.event} hook was modified or duplicated`
      };
    }
  }
  if (allOwnedCount !== candidateCount) {
    return {
      status: 'drifted',
      snapshot,
      reason: 'Bitterless-owned hooks were found under unexpected events'
    };
  }
  if (candidateCount === 0) return { status: 'absent', snapshot, reason: '' };
  if (
    candidateCount !== HOOKS[provider].length ||
    matcherCandidateCount !== HOOKS[provider].length
  ) {
    return { status: 'drifted', snapshot, reason: 'Bitterless-owned hooks are incomplete' };
  }
  if (exactCount !== HOOKS[provider].length) {
    return {
      status: 'upgradeable',
      snapshot,
      reason: 'Bitterless hook definition changed and can be repaired by reinstalling'
    };
  }
  return { status: 'exact', snapshot, reason: '' };
};

const formattingOptions = (text: string): FormattingOptions => ({
  insertSpaces: !/\n\t+\S/.test(text),
  tabSize: 2,
  eol: text.includes('\r\n') ? '\r\n' : '\n'
});

const applyJsoncEdit = (
  text: string,
  path: (string | number)[],
  value: unknown,
  isArrayInsertion = false
): string => {
  return applyEdits(text, modify(text, path, value, {
    formattingOptions: formattingOptions(text),
    isArrayInsertion
  }));
};

const addHooks = (
  source: string,
  provider: CodingAgentProvider,
  command: string,
  platform: NodeJS.Platform
): string => {
  let text = source;
  for (const spec of HOOKS[provider]) {
    const root = parseSettingsText(text, provider);
    const hooks = isPlainRecord(root.hooks) ? root.hooks : {};
    const groups = Array.isArray(hooks[spec.event]) ? hooks[spec.event] as JsonRecord[] : [];
    const groupIndex = groups.findIndex((item) => matcherMatches(item, spec));
    if (groupIndex < 0) {
      const group = {
        ...(spec.matcher === undefined ? {} : { matcher: spec.matcher }),
        hooks: [expectedHandler(command, provider, platform)]
      };
      text = groups.length === 0
        ? applyJsoncEdit(text, ['hooks', spec.event], [group])
        : applyJsoncEdit(text, ['hooks', spec.event, -1], group, true);
    } else {
      text = applyJsoncEdit(
        text,
        ['hooks', spec.event, groupIndex, 'hooks', -1],
        expectedHandler(command, provider, platform),
        true
      );
    }
  }
  return text;
};

const removeHooks = (
  source: string,
  provider: CodingAgentProvider,
  shimPath: string,
  command: string
): string => {
  let text = source;
  while (true) {
    const root = parseSettingsText(text, provider);
    if (!isPlainRecord(root.hooks)) break;
    let ownedLocation: {
      event: string;
      groupIndex: number;
      handlerIndex: number;
    } | null = null;
    const events = Object.keys(root.hooks).reverse();
    for (const event of events) {
      const groups = root.hooks[event] as JsonRecord[];
      for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
        const handlers = groups[groupIndex].hooks as JsonRecord[];
        for (let handlerIndex = handlers.length - 1; handlerIndex >= 0; handlerIndex -= 1) {
          if (isOwnedHookHandler(handlers[handlerIndex], shimPath, command)) {
            ownedLocation = { event, groupIndex, handlerIndex };
            break;
          }
        }
        if (ownedLocation) break;
      }
      if (ownedLocation) break;
    }
    if (!ownedLocation) break;
    const groups = root.hooks[ownedLocation.event] as JsonRecord[];
    const handlers = groups[ownedLocation.groupIndex].hooks as JsonRecord[];
    if (handlers.length > 1) {
      text = applyJsoncEdit(
        text,
        [
          'hooks',
          ownedLocation.event,
          ownedLocation.groupIndex,
          'hooks',
          ownedLocation.handlerIndex
        ],
        undefined
      );
    } else if (groups.length > 1) {
      text = applyJsoncEdit(
        text,
        ['hooks', ownedLocation.event, ownedLocation.groupIndex],
        undefined
      );
    } else {
      text = applyJsoncEdit(text, ['hooks', ownedLocation.event], undefined);
    }
  }
  const finalRoot = parseSettingsText(text, provider);
  if (isPlainRecord(finalRoot.hooks) && Object.keys(finalRoot.hooks).length === 0) {
    text = applyJsoncEdit(text, ['hooks'], undefined);
  }
  return text;
};

export class CodingAgentStatusBridgeService {
  private readonly platform: NodeJS.Platform;
  private readonly idFactory: () => string;
  private readonly statePath: string;

  constructor(private readonly dependencies: CodingAgentStatusBridgeDependencies) {
    this.platform = dependencies.platform ?? process.platform;
    this.idFactory = dependencies.idFactory ?? randomUUID;
    this.statePath = join(dependencies.userDataPath, 'coding-agent', 'installation.json');
  }

  private layout(provider: CodingAgentProvider): ProviderLayout {
    const extension = this.platform === 'win32' ? '.cmd' : '';
    const settingsPath = provider === 'codex'
      ? join(this.dependencies.homePath, '.codex', 'hooks.json')
      : join(this.dependencies.homePath, '.claude', 'settings.json');
    return {
      settingsPath,
      shimPath: join(
        this.dependencies.userDataPath,
        'bin',
        `bitterless-${provider}-session-hook${extension}`
      ),
      backupPath: join(
        this.dependencies.userDataPath,
        'coding-agent',
        'backups',
        `${provider}-original.json`
      )
    };
  }

  private readState(): InstallationState | null {
    if (!existsSync(this.statePath)) return null;
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(this.statePath, 'utf8')) as unknown;
    } catch {
      throw new Error('Coding-agent installation state contains invalid JSON');
    }
    return parseInstallationState(value);
  }

  private writeState(state: InstallationState): void {
    atomicWrite(this.statePath, `${JSON.stringify(state, null, 2)}\n`, 0o600);
  }

  ensureInstallationId(): string {
    const existing = this.readState();
    if (existing) return existing.installationId;
    const state: InstallationState = {
      schemaVersion: 1,
      installationId: parseUuid(this.idFactory(), 'installationId'),
      providers: {}
    };
    this.writeState(state);
    return state.installationId;
  }

  private expectedShim(provider: CodingAgentProvider, installationId: string): string {
    const endpoint = getCodingAgentBridgeEndpoint(
      this.dependencies.userDataPath,
      this.platform
    );
    const params = {
      execPath: this.dependencies.execPath,
      appPath: this.dependencies.appPath,
      endpointPath: endpoint.path,
      provider,
      installationId
    };
    return this.platform === 'win32'
      ? createWindowsCodingAgentHookShim(params)
      : createPosixCodingAgentHookShim(params);
  }

  private runtimeStatus(provider: CodingAgentProvider): {
    listening: boolean;
    lastEventAt: number | null;
  } {
    return this.dependencies.bridgeStatus?.(provider) ?? {
      listening: false,
      lastEventAt: null
    };
  }

  private response(
    provider: CodingAgentProvider,
    configuration: CodingAgentIntegrationConfiguration,
    message: string
  ): CodingAgentIntegrationStatus {
    const runtime = this.runtimeStatus(provider);
    return {
      provider,
      product: provider === 'codex' ? 'Codex' : 'Claude Code CLI',
      configuration,
      bridgeListening: runtime.listening,
      requiresTrust: provider === 'codex' && configuration === 'configured',
      lastEventAt: runtime.lastEventAt,
      message
    };
  }

  getStatus(providerValue: CodingAgentProvider): CodingAgentIntegrationStatus {
    const provider = parseProvider(providerValue);
    try {
      const state = this.readState();
      const layout = this.layout(provider);
      const install = state?.providers[provider];
      const snapshot = readSettings(layout.settingsPath, provider);
      const command = createCodingAgentHookCommand(layout.shimPath, this.platform);
      const inspection = inspectConfig(
        snapshot,
        provider,
        layout.shimPath,
        command,
        this.platform
      );
      const shimExists = existsSync(layout.shimPath);

      if (!install || !install.installed) {
        if (inspection.status !== 'absent' || shimExists) {
          return this.response(provider, 'drifted', 'Unowned or incomplete Bitterless hook files were found');
        }
        return this.response(provider, 'not-installed', 'Status bridge is not installed');
      }
      if (
        install.settingsPath !== layout.settingsPath ||
        install.shimPath !== layout.shimPath ||
        inspection.status !== 'exact' ||
        !shimExists ||
        install.shimHash === null ||
        sha256(readFileSync(layout.shimPath)) !== install.shimHash
      ) {
        return this.response(
          provider,
          'drifted',
          inspection.reason || 'Bitterless hook configuration or shim changed externally'
        );
      }
      return this.response(
        provider,
        'configured',
        provider === 'codex'
          ? 'Configured; review and trust the exact hook definition with /hooks in Codex'
          : 'Configured for Claude Code CLI hooks (not Claude Desktop)'
      );
    } catch (error) {
      return this.response(
        provider,
        'invalid',
        error instanceof Error ? error.message : 'Invalid integration configuration'
      );
    }
  }

  install(providerValue: CodingAgentProvider): CodingAgentIntegrationStatus {
    const provider = parseProvider(providerValue);
    const installationId = this.ensureInstallationId();
    const state = this.readState() as InstallationState;
    const layout = this.layout(provider);
    const existingInstall = state.providers[provider];
    const currentStatus = this.getStatus(provider);
    const expectedShim = this.expectedShim(provider, installationId);
    const expectedShimHash = sha256(expectedShim);

    if (existingInstall?.installed) {
      if (currentStatus.configuration === 'drifted') {
        const ownershipMatches = existingInstall.settingsPath === layout.settingsPath &&
          existingInstall.shimPath === layout.shimPath &&
          existingInstall.backupPath === layout.backupPath &&
          existsSync(layout.backupPath);
        if (!ownershipMatches) return currentStatus;
        const snapshot = readSettings(layout.settingsPath, provider);
        const command = createCodingAgentHookCommand(layout.shimPath, this.platform);
        const withoutOwnedHooks = removeHooks(
          snapshot.text,
          provider,
          layout.shimPath,
          command
        );
        const nextSettings = addHooks(
          withoutOwnedHooks,
          provider,
          command,
          this.platform
        );
        atomicWrite(layout.settingsPath, nextSettings);
        atomicWrite(layout.shimPath, expectedShim, 0o700);
        if (this.platform !== 'win32') chmodSync(layout.shimPath, 0o700);
        existingInstall.shimHash = expectedShimHash;
        this.writeState(state);
        return this.getStatus(provider);
      }
      if (currentStatus.configuration !== 'configured') return currentStatus;
      if (existingInstall.shimHash !== expectedShimHash) {
        atomicWrite(layout.shimPath, expectedShim, 0o700);
        if (this.platform !== 'win32') chmodSync(layout.shimPath, 0o700);
        existingInstall.shimHash = expectedShimHash;
        this.writeState(state);
      }
      return this.getStatus(provider);
    }
    if (currentStatus.configuration !== 'not-installed') return currentStatus;

    const snapshot = readSettings(layout.settingsPath, provider);
    if (existingInstall) {
      if (
        existingInstall.settingsPath !== layout.settingsPath ||
        existingInstall.shimPath !== layout.shimPath ||
        existingInstall.backupPath !== layout.backupPath ||
        !existsSync(layout.backupPath)
      ) {
        return this.response(provider, 'drifted', 'Stored integration ownership no longer matches this profile');
      }
    } else {
      mkdirSync(dirname(layout.backupPath), { recursive: true });
      writeFileSync(layout.backupPath, snapshot.raw, { flag: 'wx', mode: 0o600 });
    }

    atomicWrite(layout.shimPath, expectedShim, 0o700);
    if (this.platform !== 'win32') chmodSync(layout.shimPath, 0o700);
    const command = createCodingAgentHookCommand(layout.shimPath, this.platform);
    const nextSettings = addHooks(snapshot.text, provider, command, this.platform);
    atomicWrite(layout.settingsPath, nextSettings);
    state.providers[provider] = {
      installed: true,
      settingsPath: layout.settingsPath,
      shimPath: layout.shimPath,
      shimHash: expectedShimHash,
      backupPath: layout.backupPath,
      originalExisted: existingInstall?.originalExisted ?? snapshot.existed
    };
    this.writeState(state);
    return this.getStatus(provider);
  }

  remove(providerValue: CodingAgentProvider): CodingAgentIntegrationStatus {
    const provider = parseProvider(providerValue);
    const state = this.readState();
    const install = state?.providers[provider];
    if (!state || !install || !install.installed) return this.getStatus(provider);
    const status = this.getStatus(provider);
    if (status.configuration !== 'configured') return status;

    const layout = this.layout(provider);
    const snapshot = readSettings(layout.settingsPath, provider);
    const command = createCodingAgentHookCommand(layout.shimPath, this.platform);
    const nextSettings = removeHooks(snapshot.text, provider, layout.shimPath, command);
    const nextValue = parseSettingsText(nextSettings, provider);
    if (!install.originalExisted && Object.keys(nextValue).length === 0) {
      if (existsSync(layout.settingsPath)) unlinkSync(layout.settingsPath);
    } else {
      atomicWrite(layout.settingsPath, nextSettings);
    }
    if (existsSync(layout.shimPath)) unlinkSync(layout.shimPath);
    install.installed = false;
    install.shimHash = null;
    this.writeState(state);
    return this.getStatus(provider);
  }
}
