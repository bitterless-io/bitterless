import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type {
  EyesOnAgentsClaudeBridgeStatus,
  EyesOnAgentsClaudeBridgeState,
  EyesOnAgentsClaudeSetupAction
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import type {
  ApplicationRuntimeProfile,
  ApplicationRuntimeProfileId
} from '@shared/diagnostics/applicationDiagnostics.contract';
import {
  CLAUDE_HOOK_HELPER_ARG,
  CLAUDE_HOOK_INSTALLATION_ARG,
  CLAUDE_HOOK_OUTBOX_ARG,
  CLAUDE_HOOK_SOCKET_ARG,
  getClaudeHookBridgeEndpoint,
  getClaudeHookOutboxPath
} from '@shared/eyesOnAgents/claudeHookBridge.contract';
import { parseEyesOnAgentsUuid } from '@shared/eyesOnAgents/eyesOnAgents.contract';
import { runClaudeCommand, type ClaudeCommandResult } from './claudeCommand.runner';

const MAX_ERROR_LENGTH = 300;
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const MAX_ARTIFACT_FILES = 32;
const OWNER_MARKER = '.bitterless-owner.json';
const MAX_STATE_BYTES = 16 * 1024;
const MAX_OWNER_MARKER_BYTES = 4 * 1024;
const MAX_LEGACY_CATALOG_BYTES = 16 * 1024;
const MAX_ARTIFACT_ENTRIES = 64;
const MAX_ARTIFACT_DEPTH = 8;
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;
const PRODUCTION_MARKETPLACE_NAME = 'bitterless-local';
const PRODUCTION_PLUGIN_NAME = 'bitterless-observer';
const PRODUCTION_PLUGIN_ID = 'bitterless-observer@bitterless-local';
const MARKETPLACE_DESCRIPTION = 'Bitterless local lifecycle observation plugins';
const PLUGIN_DESCRIPTION = 'Content-free local Claude lifecycle observation for Bitterless';
const BRIDGE_STATE_KEYS = [
  'schemaVersion', 'installationId', 'installed', 'artifactDigest', 'firstReceiptAt',
  'lastReceiptAt', 'restartRequired', 'recoveryReason'
] as const;

interface BridgeState {
  schemaVersion: 1;
  installationId: string;
  installed: boolean;
  artifactDigest: string | null;
  firstReceiptAt: number | null;
  lastReceiptAt: number | null;
  restartRequired: boolean;
  recoveryReason: 'coverage_gap' | 'outbox_cleanup' | null;
}

interface Inspection {
  configured: boolean;
  enabled: boolean;
  enablement: 'enabled' | 'disabled' | 'unknown';
  drifted: boolean;
  marketplace: 'absent' | 'exact' | 'collision';
  marketplaceNamespaceExclusive: boolean;
  catalogExact: boolean;
  pluginPresent: boolean;
  pluginVersion: string | null;
  pluginVersionExact: boolean;
  artifactExact: boolean;
  finishable: boolean;
  inspectedAt: number;
  error: string | null;
}

interface Artifact {
  relativePath: string;
  content: Buffer;
  mode: number;
}

interface TrustedAutomaticUpgradePlan {
  state: BridgeState;
  artifacts: Artifact[];
  digest: string;
  artifactsStaged: boolean;
}

interface ClaudeNamespaceInspection {
  plugins: Array<Record<string, unknown>>;
  marketplaces: Array<Record<string, unknown>>;
}

interface LegacyMarketplaceProof {
  device: number;
  inode: number;
}

export interface ClaudePluginBridgeIdentity {
  readonly marketplaceName: string;
  readonly pluginName: string;
  readonly pluginId: string;
  readonly artifactRootRelativePath: string;
}

export const resolveClaudePluginBridgeIdentity = (
  profileId: ApplicationRuntimeProfileId
): ClaudePluginBridgeIdentity => {
  switch (profileId) {
    case 'production':
      return Object.freeze({
        marketplaceName: 'bitterless-local',
        pluginName: 'bitterless-observer',
        pluginId: 'bitterless-observer@bitterless-local',
        artifactRootRelativePath: 'eyes-on-agents/claude-marketplace'
      });
    case 'production-debug':
    case 'test-debug':
    case 'test-release': {
      const marketplaceName = `bitterless-local-${profileId}`;
      const pluginName = `bitterless-observer-${profileId}`;
      return Object.freeze({
        marketplaceName,
        pluginName,
        pluginId: `${pluginName}@${marketplaceName}`,
        artifactRootRelativePath: `eyes-on-agents/claude-marketplace-${profileId}`
      });
    }
    default:
      throw new Error(`Unsupported Bitterless Claude bridge profile: ${String(profileId)}`);
  }
};

export const resolveLegacyProductionDebugClaudeMarketplaceRoot = (params: {
  profile: Pick<ApplicationRuntimeProfile, 'id' | 'appName'>;
  appDataPath: string;
  userDataPath: string;
}): string | null => {
  if (params.profile.id !== 'production' || params.profile.appName !== 'Bitterless' ||
    !isAbsolute(params.appDataPath) || !isAbsolute(params.userDataPath) ||
    resolve(params.userDataPath) !== resolve(params.appDataPath, params.profile.appName)) return null;
  return resolve(
    params.appDataPath,
    'Bitterless_DEBUG_PROD',
    'eyes-on-agents',
    'claude-marketplace'
  );
};

interface ClaudePluginBridgeDependencies {
  identity: ClaudePluginBridgeIdentity;
  userDataPath: string;
  execPath: string;
  appRootPath: string;
  pluginVersion: string;
  executableCandidates: string[];
  legacyProductionDebugMarketplaceRoot?: string;
  helperSourcePath?: string;
  platform?: NodeJS.Platform;
  now?: () => number;
  idFactory?: () => string;
  runCommand?: typeof runClaudeCommand;
  runtimeStatus: () => { listening: boolean; listeningSince: number | null };
}

const atomicWrite = (path: string, content: Buffer | string, mode: number): void => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temp, content, { flag: 'wx', mode });
    renameSync(temp, path);
    if (process.platform !== 'win32') chmodSync(path, mode);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
};

const boundedError = (value: unknown): string => {
  const text = value instanceof Error ? value.message : String(value);
  return (text.trim() || 'Claude plugin operation failed').slice(0, MAX_ERROR_LENGTH);
};

export const resolveClaudeHookRuntimeExecutable = (params: {
  execPath: string;
  appImagePath?: string;
  isPackaged: boolean;
  platform?: NodeJS.Platform;
}): string => {
  if ((params.platform ?? process.platform) !== 'linux' || !params.isPackaged ||
    !params.appImagePath || !isAbsolute(params.appImagePath)) return params.execPath;
  try {
    const stat = lstatSync(params.appImagePath);
    if (stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o111) !== 0) {
      return params.appImagePath;
    }
  } catch {
    // A missing, unreadable, relative, non-regular, or non-executable APPIMAGE is untrusted.
  }
  return params.execPath;
};

const readBoundedRegularFile = (path: string, maxBytes: number): Buffer => {
  const pathStat = lstatSync(path);
  if (!pathStat.isFile() || pathStat.size > maxBytes) {
    throw new Error('Claude plugin file is not a bounded regular file');
  }
  const noFollow = process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(path, constants.O_RDONLY | noFollow);
  try {
    const openedStat = fstatSync(descriptor);
    if (!openedStat.isFile() || openedStat.size > maxBytes ||
      openedStat.dev !== pathStat.dev || openedStat.ino !== pathStat.ino) {
      throw new Error('Claude plugin file identity changed');
    }
    const content = Buffer.alloc(openedStat.size);
    let offset = 0;
    while (offset < content.length) {
      const bytesRead = readSync(descriptor, content, offset, content.length - offset, offset);
      if (bytesRead === 0) throw new Error('Claude plugin file ended unexpectedly');
      offset += bytesRead;
    }
    const finalStat = fstatSync(descriptor);
    if (finalStat.size !== openedStat.size || finalStat.dev !== openedStat.dev ||
      finalStat.ino !== openedStat.ino) {
      throw new Error('Claude plugin file changed while reading');
    }
    return content;
  } finally {
    closeSync(descriptor);
  }
};

const parseJsonArray = (text: string, label: string): Array<Record<string, unknown>> => {
  const value = JSON.parse(text) as unknown;
  if (!Array.isArray(value) || !value.every((entry) => entry !== null && typeof entry === 'object')) {
    throw new Error(`${label} output is invalid`);
  }
  return value as Array<Record<string, unknown>>;
};

const quoteSh = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;
const quotePowerShell = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const EMPTY_INSTALLATION_ID = '00000000-0000-4000-8000-000000000000';

export const claudePluginVersionFromVersionCode = (value: unknown): string => {
  if (typeof value !== 'string' || !/^\d{12}$/.test(value)) {
    throw new Error('Bitterless version_code must match YYMMDDHHmmss');
  }
  return `0.${value.slice(0, 6)}.${Number(value.slice(6))}`;
};

export class ClaudePluginBridgeService {
  private readonly platform: NodeJS.Platform;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly runCommand: typeof runClaudeCommand;
  private readonly marketplaceRoot: string;
  private readonly pluginRoot: string;
  private readonly statePath: string;
  private readonly helperSourcePath: string;
  private inspection: Inspection | null = null;
  private executable: string | null = null;
  private trustedUpgradeInstallationId: string | null = null;

  constructor(private readonly dependencies: ClaudePluginBridgeDependencies) {
    this.platform = dependencies.platform ?? process.platform;
    this.now = dependencies.now ?? Date.now;
    this.idFactory = dependencies.idFactory ?? randomUUID;
    this.runCommand = dependencies.runCommand ?? runClaudeCommand;
    this.marketplaceRoot = resolve(
      dependencies.userDataPath,
      dependencies.identity.artifactRootRelativePath
    );
    this.pluginRoot = join(this.marketplaceRoot, 'plugins', dependencies.identity.pluginName);
    this.statePath = join(dependencies.userDataPath, 'eyes-on-agents', 'claude-plugin-bridge.json');
    this.helperSourcePath = dependencies.helperSourcePath ?? join(
      dependencies.appRootPath,
      'out',
      'main',
      'claudeHookHelper.js'
    );
  }

  ensureInstallationId(): string {
    const inspected = this.inspectState();
    if (inspected.kind === 'valid') return inspected.value.installationId;
    if (inspected.kind === 'corrupt') throw new Error('Claude plugin bridge state is corrupt');
    const created: BridgeState = {
      schemaVersion: 1,
      installationId: parseEyesOnAgentsUuid(this.idFactory(), 'Claude installation ID'),
      installed: false,
      artifactDigest: null,
      firstReceiptAt: null,
      lastReceiptAt: null,
      restartRequired: false,
      recoveryReason: null
    };
    this.writeState(created);
    return created.installationId;
  }

  hasInstallationIntent(): boolean {
    const state = this.inspectState();
    return state.kind === 'valid' && (
      state.value.installed || state.value.restartRequired
    );
  }

  getInstallationId(): string {
    return this.ensureInstallationId();
  }

  acceptsInstallation(installationId: string): boolean {
    try {
      const state = this.readState();
      if (!state?.installed || state.installationId !== installationId ||
        state.recoveryReason !== null) return false;
      if (this.trustedUpgradeInstallationId === installationId) return true;
      return this.inspection === null || (
        this.inspection.marketplace === 'exact' &&
        this.inspection.pluginPresent &&
        this.inspection.enabled &&
        !this.inspection.drifted &&
        this.inspection.error === null
      );
    } catch {
      return false;
    }
  }

  getStatus(): EyesOnAgentsClaudeBridgeStatus {
    const stateInspection = this.inspectState();
    const state = stateInspection.kind === 'valid' ? stateInspection.value : {
      schemaVersion: 1 as const,
      installationId: EMPTY_INSTALLATION_ID,
      installed: false,
      artifactDigest: null,
      firstReceiptAt: null,
      lastReceiptAt: null,
      restartRequired: false,
      recoveryReason: null
    };
    const runtime = this.dependencies.runtimeStatus();
    const inspection = this.inspection;
    const configured = (inspection?.configured ?? false) || state.installed ||
      stateInspection.kind === 'corrupt' || existsSync(this.marketplaceRoot);
    const enabled = inspection?.enabled ?? false;
    const error = inspection?.error ?? (
      stateInspection.kind === 'corrupt'
        ? 'Claude plugin bridge state is corrupt'
        : state.recoveryReason === 'coverage_gap'
          ? 'Claude hook observation lost durable coverage; Repair is required'
          : state.recoveryReason === 'outbox_cleanup'
            ? 'Claude hook outbox cleanup failed; Repair is required'
          : null
    );
    let bridgeState: EyesOnAgentsClaudeBridgeState = 'not_installed';
    if (error) bridgeState = 'error';
    else if (inspection?.drifted) bridgeState = 'drifted';
    else if (configured && enabled && runtime.listening && !state.restartRequired &&
      state.firstReceiptAt !== null) {
      bridgeState = 'observing';
    } else if (configured && enabled && runtime.listening && !state.restartRequired) {
      bridgeState = 'needs_review';
    } else if (configured && !enabled) bridgeState = 'needs_review';
    else if (configured) bridgeState = 'installed';
    const exactInstalled = state.installed && state.recoveryReason === null &&
      inspection?.marketplace === 'exact' && inspection.marketplaceNamespaceExclusive &&
      inspection.catalogExact && inspection.pluginPresent && inspection.pluginVersionExact &&
      inspection.artifactExact && inspection.enablement === 'enabled' &&
      !inspection.drifted && inspection.error === null;
    let setupAction: EyesOnAgentsClaudeSetupAction = 'repair';
    if (inspection?.finishable === true) setupAction = 'finish';
    else if (exactInstalled) {
      setupAction = !runtime.listening
        ? 'retry'
        : state.restartRequired || state.firstReceiptAt === null ? 'reload' : 'none';
    } else if (!configured && error === null) {
      setupAction = 'enable';
    }
    return {
      state: bridgeState,
      setupAction,
      configured,
      enabled,
      listening: runtime.listening,
      listeningSince: runtime.listeningSince === null
        ? null
        : new Date(runtime.listeningSince).toISOString(),
      firstReceiptAt: state.firstReceiptAt === null ? null : new Date(state.firstReceiptAt).toISOString(),
      lastReceiptAt: state.lastReceiptAt === null ? null : new Date(state.lastReceiptAt).toISOString(),
      lastInspectedAt: inspection === null ? null : new Date(inspection.inspectedAt).toISOString(),
      observationProof: state.installed && state.firstReceiptAt !== null &&
        !state.restartRequired && state.recoveryReason === null
        ? 'receipt'
        : 'none',
      restartRequired: state.restartRequired,
      error
    };
  }

  async refresh(configDirectory?: string): Promise<EyesOnAgentsClaudeBridgeStatus> {
    try {
      await this.inspectCurrent(configDirectory);
      const upgrade = this.trustedAutomaticUpgradePlan();
      if (upgrade) {
        this.trustedUpgradeInstallationId = upgrade.state.installationId;
        try {
          await this.performTrustedAutomaticUpgrade(upgrade, configDirectory);
        } finally {
          this.trustedUpgradeInstallationId = null;
        }
      }
    } catch (error) {
      this.retainRefreshError(error);
    }
    return this.getStatus();
  }

  private async refreshWithoutAutomaticUpgrade(
    configDirectory?: string
  ): Promise<EyesOnAgentsClaudeBridgeStatus> {
    try {
      await this.inspectCurrent(configDirectory);
    } catch (error) {
      this.retainRefreshError(error);
    }
    return this.getStatus();
  }

  private async inspectCurrent(configDirectory?: string): Promise<void> {
    const stateInspection = this.inspectState();
    const installationId = stateInspection.kind === 'valid'
      ? stateInspection.value.installationId
      : EMPTY_INSTALLATION_ID;
    const artifacts = this.expectedArtifacts(installationId);
    const digest = this.digestArtifacts(artifacts);
    const executable = await this.resolveExecutable();
    const [pluginsResult, marketplacesResult] = await Promise.all([
      this.command(executable, ['plugin', 'list', '--json'], configDirectory),
      this.command(executable, ['plugin', 'marketplace', 'list', '--json'], configDirectory)
    ]);
    const plugins = parseJsonArray(pluginsResult.stdout, 'Claude plugin list');
    const marketplaces = parseJsonArray(marketplacesResult.stdout, 'Claude marketplace list');
    const plugin = plugins.find((entry) =>
      entry.id === this.dependencies.identity.pluginId && entry.scope === 'user'
    );
    const marketplacePlugins = plugins.filter((entry) => {
      const id = typeof entry.id === 'string' ? entry.id : null;
      return id?.endsWith(`@${this.dependencies.identity.marketplaceName}`) === true ||
        entry.marketplace === this.dependencies.identity.marketplaceName;
    });
    const marketplaceNamespaceExclusive = marketplacePlugins.length <= 1 &&
      marketplacePlugins.every((entry) =>
        entry.id === this.dependencies.identity.pluginId && entry.scope === 'user'
      );
    const state = stateInspection.kind === 'valid' ? stateInspection.value : null;
    const marketplaceEntries = marketplaces.filter((entry) =>
      entry.name === this.dependencies.identity.marketplaceName
    );
    const marketplaceExact = marketplaceEntries.length === 1 &&
      this.marketplaceEntryMatches(marketplaceEntries[0]);
    const marketplace = marketplaceEntries.length === 0
      ? 'absent'
      : marketplaceExact ? 'exact' : 'collision';
    const pluginPresent = plugin !== undefined;
    const pluginVersion = typeof plugin?.version === 'string' ? plugin.version : null;
    const pluginVersionExact = pluginVersion === this.dependencies.pluginVersion;
    const configured = marketplace === 'exact' || pluginPresent || state?.installed === true;
    const enablement = !pluginPresent
      ? 'unknown'
      : plugin?.enabled === true ? 'enabled'
        : plugin?.enabled === false ? 'disabled' : 'unknown';
    const enabled = enablement === 'enabled';
    const artifactExact = this.artifactsExact(artifacts);
    const catalogArtifact = artifacts.find(
      (artifact) => artifact.relativePath === '.claude-plugin/marketplace.json'
    );
    const catalogExact = marketplace === 'exact' && catalogArtifact !== undefined &&
      this.artifactExact(catalogArtifact);
    const drifted = marketplace === 'collision' || pluginPresent && marketplace !== 'exact' ||
      pluginPresent && !pluginVersionExact ||
      configured && (!artifactExact || state?.artifactDigest !== digest);
    const finishable = stateInspection.kind === 'valid' && !stateInspection.value.installed &&
      stateInspection.value.artifactDigest === null &&
      stateInspection.value.firstReceiptAt === null &&
      stateInspection.value.lastReceiptAt === null && stateInspection.value.restartRequired &&
      stateInspection.value.recoveryReason === null && marketplace === 'exact' &&
      marketplaceNamespaceExclusive && catalogExact && pluginPresent && pluginVersionExact &&
      artifactExact && enablement === 'enabled';
    this.inspection = {
      configured, enabled, enablement, drifted, marketplace, marketplaceNamespaceExclusive,
      catalogExact, pluginPresent, pluginVersion, pluginVersionExact, artifactExact, finishable,
      inspectedAt: this.now(), error: null
    };
  }

  private retainRefreshError(error: unknown): void {
    const state = this.inspectState();
    const installed = state.kind === 'valid' && state.value.installed;
    this.inspection = {
      configured: installed || existsSync(this.marketplaceRoot),
      enabled: false,
      enablement: 'unknown',
      drifted: false,
      marketplace: 'absent',
      marketplaceNamespaceExclusive: false,
      catalogExact: false,
      pluginPresent: false,
      pluginVersion: null,
      pluginVersionExact: false,
      artifactExact: false,
      finishable: false,
      inspectedAt: this.now(),
      error: boundedError(error)
    };
  }

  private trustedAutomaticUpgradePlan(): TrustedAutomaticUpgradePlan | null {
    const stateInspection = this.inspectState();
    const state = stateInspection.kind === 'valid' ? stateInspection.value : null;
    const inspection = this.inspection;
    if (!state?.installed || state.recoveryReason !== null || state.artifactDigest === null ||
      inspection?.error !== null || inspection.marketplace !== 'exact' ||
      !inspection.marketplaceNamespaceExclusive || !inspection.pluginPresent ||
      inspection.enablement !== 'enabled' || inspection.pluginVersion === null) return null;
    const artifacts = this.expectedArtifacts(state.installationId);
    const digest = this.digestArtifacts(artifacts);
    if (state.artifactDigest === digest) return null;

    // An exact current artifact tree is itself a durable pre-commit checkpoint: the generated
    // wrapper cryptographically carries the same validated installation ID, while the valid state
    // still supplies the previous committed digest and receipt/cutoff history. This remains
    // recoverable after a process exit between artifact staging and state commit.
    const staged = inspection.artifactExact;
    if (staged) return { state, artifacts, digest, artifactsStaged: true };

    if (inspection.pluginVersionExact || inspection.artifactExact) return null;
    const installedArtifacts = this.readPersistedArtifacts();
    if (!installedArtifacts || this.digestArtifacts(installedArtifacts) !== state.artifactDigest ||
      !this.persistedCatalogOwned(installedArtifacts) ||
      this.persistedPluginVersion(installedArtifacts) !== inspection.pluginVersion) return null;
    return { state, artifacts, digest, artifactsStaged: false };
  }

  private async performTrustedAutomaticUpgrade(
    plan: TrustedAutomaticUpgradePlan,
    configDirectory?: string
  ): Promise<void> {
    const executable = await this.resolveExecutable();
    if (!plan.artifactsStaged) this.writeArtifacts(plan.artifacts);
    await this.command(executable, [
      'plugin', 'marketplace', 'update', this.dependencies.identity.marketplaceName
    ], configDirectory);
    if (this.inspection?.pluginVersionExact !== true) {
      await this.command(executable, [
        'plugin', 'update', this.dependencies.identity.pluginId, '--scope', 'user'
      ], configDirectory);
    }
    await this.inspectCurrent(configDirectory);
    if (!this.isExactEnabledPluginInspection()) {
      throw new Error('Claude plugin automatic upgrade failed at final inspection');
    }
    const currentState = this.readState();
    if (!currentState?.installed || currentState.installationId !== plan.state.installationId ||
      currentState.artifactDigest !== plan.state.artifactDigest ||
      currentState.recoveryReason !== null) {
      throw new Error('Claude plugin automatic upgrade state changed before commit');
    }
    this.writeState({ ...currentState, artifactDigest: plan.digest });
    await this.inspectCurrent(configDirectory);
    if (!this.isExactEnabledPluginInspection() || this.inspection?.drifted) {
      throw new Error('Claude plugin automatic upgrade failed at committed inspection');
    }
  }

  private canRepairInstalledGeneration(previous: BridgeState | null): boolean {
    return previous?.installed === true && previous.recoveryReason === null &&
      this.inspection?.error === null && this.inspection.marketplace !== 'collision' &&
      this.inspection.marketplaceNamespaceExclusive &&
      (this.inspection.drifted || !this.inspection.pluginPresent ||
        this.inspection.marketplace === 'absent' || this.inspection.enablement === 'disabled') &&
      this.isOwnedArtifactRoot();
  }

  async install(configDirectory?: string): Promise<EyesOnAgentsClaudeBridgeStatus> {
    try {
      return await this.performInstall(configDirectory);
    } catch (error) {
      const message = this.safeInstallError(error);
      this.retainInstallError(message);
      throw new Error(message);
    }
  }

  private async performInstall(configDirectory?: string): Promise<EyesOnAgentsClaudeBridgeStatus> {
    const previous = this.readState();
    const executable = await this.resolveExecutable();
    await this.refreshWithoutAutomaticUpgrade(configDirectory);
    if (this.inspection?.error) throw new Error(this.inspection.error);
    if (await this.recoverLegacyProductionDebugMarketplace(executable, configDirectory)) {
      await this.refreshWithoutAutomaticUpgrade(configDirectory);
      if (this.inspection?.error) throw new Error(this.inspection.error);
    }
    this.assertSafeInstallOwnership(previous);
    const preservesInstalledGeneration = this.canRepairInstalledGeneration(previous);
    if (!preservesInstalledGeneration) {
      try {
        // Partial setup, coverage loss, and uncommitted generations retain the task-040 cutoff:
        // remove every older outbox before a fresh identity can be enabled.
        rmSync(getClaudeHookOutboxPath(this.dependencies.userDataPath), {
          recursive: true,
          force: true
        });
      } catch (error) {
        if (previous) {
          this.writeState({
            ...previous,
            firstReceiptAt: null,
            lastReceiptAt: null,
            restartRequired: true,
            recoveryReason: 'outbox_cleanup'
          });
        }
        throw error;
      }
    }
    const installationId = preservesInstalledGeneration && previous
      ? previous.installationId
      : parseEyesOnAgentsUuid(this.idFactory(), 'Claude installation ID');
    if (!preservesInstalledGeneration) {
      this.writeState({
        schemaVersion: 1,
        installationId,
        installed: previous?.installed ?? false,
        artifactDigest: null,
        firstReceiptAt: null,
        lastReceiptAt: null,
        restartRequired: true,
        recoveryReason: previous?.recoveryReason ?? null
      });
    }
    const artifacts = this.expectedArtifacts(installationId);
    this.writeArtifacts(artifacts);
    await this.refreshWithoutAutomaticUpgrade(configDirectory);
    if (this.inspection?.error) throw new Error(this.inspection.error);
    this.assertSafeInstallOwnership(previous);
    const pluginPresent = this.inspection?.pluginPresent === true;
    if (this.inspection?.marketplace === 'exact') {
      await this.command(executable, [
        'plugin', 'marketplace', 'update', this.dependencies.identity.marketplaceName
      ], configDirectory);
    } else {
      await this.command(executable, [
        'plugin', 'marketplace', 'add', this.marketplaceRoot, '--scope', 'user'
      ], configDirectory);
    }
    if (!pluginPresent) {
      await this.command(executable, [
        'plugin', 'install', this.dependencies.identity.pluginId, '--scope', 'user'
      ], configDirectory);
    } else {
      // Claude may keep a same-version plugin cache even when the local marketplace files changed.
      // Force an exact user-scoped reinstall before re-admitting the proven generation instead of
      // trusting a same-version update no-op.
      await this.command(executable, [
        'plugin', 'uninstall', this.dependencies.identity.pluginId, '--scope', 'user', '-y'
      ], configDirectory);
      await this.command(executable, [
        'plugin', 'install', this.dependencies.identity.pluginId, '--scope', 'user'
      ], configDirectory);
    }
    await this.refreshWithoutAutomaticUpgrade(configDirectory);
    if (!this.isExactPluginInspection()) {
      throw new Error('Claude plugin setup failed at final inspection: version or installation is not exact');
    }
    if (this.inspection?.enablement === 'disabled') {
      let enableError: unknown = null;
      try {
        await this.command(executable, [
          'plugin', 'enable', this.dependencies.identity.pluginId, '--scope', 'user'
        ], configDirectory);
      } catch (error) {
        enableError = error;
        // Claude may have committed enablement even when the command returned non-zero. The exact,
        // read-only inspection below is the sole idempotent success condition.
      }
      await this.refreshWithoutAutomaticUpgrade(configDirectory);
      if (!this.isExactEnabledPluginInspection()) {
        throw new Error(enableError === null
          ? 'Claude plugin enablement failed at final inspection'
          : boundedError(enableError));
      }
    } else if (this.inspection?.enablement !== 'enabled') {
      throw new Error('Claude plugin setup failed at final inspection: enablement is unknown');
    }
    const preservedState = preservesInstalledGeneration ? this.readState() : null;
    if (preservesInstalledGeneration && (!previous || !preservedState?.installed ||
      preservedState.installationId !== previous.installationId ||
      preservedState.recoveryReason !== null)) {
      throw new Error('Claude plugin repair state changed before commit');
    }
    this.writeState(preservesInstalledGeneration && preservedState ? {
      ...preservedState,
      artifactDigest: this.digestArtifacts(artifacts)
    } : {
      schemaVersion: 1,
      installationId,
      installed: true,
      artifactDigest: this.digestArtifacts(artifacts),
      firstReceiptAt: null,
      lastReceiptAt: null,
      restartRequired: true,
      recoveryReason: previous?.recoveryReason ?? null
    });
    await this.refreshWithoutAutomaticUpgrade(configDirectory);
    if (this.inspection?.error || this.inspection?.marketplace !== 'exact' ||
      !this.inspection.pluginPresent || !this.inspection.enabled || this.inspection.drifted ||
      !this.inspection.marketplaceNamespaceExclusive || !this.inspection.catalogExact) {
      throw new Error('Claude plugin setup failed at final inspection: version or installation is not exact');
    }
    const installedState = this.readState();
    if (installedState?.installationId === installationId &&
      installedState.recoveryReason !== null) {
      this.writeState({ ...installedState, recoveryReason: null });
    }
    return this.getStatus();
  }

  async remove(configDirectory?: string): Promise<EyesOnAgentsClaudeBridgeStatus> {
    const previous = this.readState();
    const executable = await this.resolveExecutable();
    await this.refreshWithoutAutomaticUpgrade(configDirectory);
    if (this.inspection?.error) throw new Error(this.inspection.error);
    if (this.inspection?.marketplace === 'collision' ||
      this.inspection?.pluginPresent && this.inspection.marketplace !== 'exact') {
      throw new Error('The Bitterless Claude plugin ownership could not be proven');
    }
    if (this.inspection?.marketplace === 'exact' &&
      (!this.inspection.marketplaceNamespaceExclusive || !this.inspection.catalogExact)) {
      throw new Error('The Bitterless Claude marketplace contains unowned or drifted entries; manual cleanup is required');
    }
    if (this.inspection?.pluginPresent && this.inspection.marketplace === 'exact') {
      await this.command(executable, [
        'plugin', 'uninstall', this.dependencies.identity.pluginId, '--scope', 'user', '-y'
      ], configDirectory);
    }
    if (this.inspection?.marketplace === 'exact') {
      await this.refreshWithoutAutomaticUpgrade(configDirectory);
      if (this.inspection?.error || this.inspection?.marketplace !== 'exact' ||
        this.inspection.pluginPresent || !this.inspection.marketplaceNamespaceExclusive ||
        !this.inspection.catalogExact) {
        throw new Error(this.inspection?.error ??
          'The Bitterless Claude marketplace changed during removal; manual cleanup is required');
      }
      await this.command(executable, [
        'plugin', 'marketplace', 'remove', this.dependencies.identity.marketplaceName,
        '--scope', 'user'
      ], configDirectory);
    }
    if (this.isOwnedArtifactRoot()) {
      rmSync(this.marketplaceRoot, { recursive: true, force: true });
    }
    rmSync(getClaudeHookOutboxPath(this.dependencies.userDataPath), {
      recursive: true,
      force: true
    });
    this.writeState({
      schemaVersion: 1,
      installationId: previous?.installed === false
        ? previous.installationId
        : parseEyesOnAgentsUuid(this.idFactory(), 'Claude installation ID'),
      installed: false,
      artifactDigest: null,
      firstReceiptAt: null,
      lastReceiptAt: null,
      restartRequired: false,
      recoveryReason: null
    });
    this.inspection = {
      configured: false,
      enabled: false,
      enablement: 'unknown',
      drifted: false,
      marketplace: 'absent',
      marketplaceNamespaceExclusive: true,
      catalogExact: false,
      pluginPresent: false,
      pluginVersion: null,
      pluginVersionExact: false,
      artifactExact: false,
      finishable: false,
      inspectedAt: this.now(),
      error: null
    };
    return this.getStatus();
  }

  recordLiveReceipt(installationId: string, committedAt: number): void {
    const state = this.readState();
    if (!state?.installed || state.installationId !== installationId ||
      state.recoveryReason !== null) return;
    this.writeState({
      ...state,
      firstReceiptAt: state.firstReceiptAt ?? committedAt,
      lastReceiptAt: Math.max(state.lastReceiptAt ?? 0, committedAt),
      restartRequired: false
    });
  }

  revokeObservationProof(reason: 'coverage_gap' | null = null): void {
    const state = this.readState();
    if (!state?.installed) return;
    this.writeState({
      ...state,
      firstReceiptAt: null,
      lastReceiptAt: null,
      restartRequired: true,
      recoveryReason: reason ?? state.recoveryReason
    });
  }

  private readState(): BridgeState | null {
    const state = this.inspectState();
    return state.kind === 'valid' ? state.value : null;
  }

  private inspectState():
    | { kind: 'missing' }
    | { kind: 'corrupt' }
    | { kind: 'valid'; value: BridgeState } {
    if (!existsSync(this.statePath)) return { kind: 'missing' };
    try {
      const parsed = JSON.parse(
        readBoundedRegularFile(this.statePath, MAX_STATE_BYTES).toString('utf8')
      ) as unknown;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { kind: 'corrupt' };
      }
      const value = parsed as Record<string, unknown>;
      if (Object.keys(value).sort().join(',') !== [...BRIDGE_STATE_KEYS].sort().join(',') ||
        value.schemaVersion !== 1 || typeof value.installed !== 'boolean' ||
        typeof value.restartRequired !== 'boolean') return { kind: 'corrupt' };
      const timestamp = (input: unknown): number | null => {
        if (input === null) return null;
        if (!Number.isSafeInteger(input) || (input as number) < 0 ||
          (input as number) > MAX_DATE_MILLISECONDS) throw new Error('invalid timestamp');
        return input as number;
      };
      const recoveryReason = value.recoveryReason === null
        ? null
        : value.recoveryReason === 'coverage_gap' || value.recoveryReason === 'outbox_cleanup'
          ? value.recoveryReason
          : null;
      if (value.recoveryReason !== null && recoveryReason === null) throw new Error('invalid recovery reason');
      const artifactDigest = value.artifactDigest === null
        ? null
        : typeof value.artifactDigest === 'string' && /^[0-9a-f]{64}$/.test(value.artifactDigest)
          ? value.artifactDigest
          : null;
      if (value.artifactDigest !== null && artifactDigest === null) {
        throw new Error('invalid artifact digest');
      }
      const firstReceiptAt = timestamp(value.firstReceiptAt);
      const lastReceiptAt = timestamp(value.lastReceiptAt);
      if ((firstReceiptAt === null) !== (lastReceiptAt === null) ||
        firstReceiptAt !== null && lastReceiptAt !== null && firstReceiptAt > lastReceiptAt) {
        throw new Error('invalid receipt timestamp range');
      }
      if (value.installed === false && firstReceiptAt !== null) {
        throw new Error('disabled bridge state cannot carry receipt proof');
      }
      return {
        kind: 'valid',
        value: {
          schemaVersion: 1,
          installationId: parseEyesOnAgentsUuid(value.installationId, 'Claude installation ID'),
          installed: value.installed as boolean,
          artifactDigest,
          firstReceiptAt,
          lastReceiptAt,
          restartRequired: value.restartRequired as boolean,
          recoveryReason
        }
      };
    } catch {
      return { kind: 'corrupt' };
    }
  }

  private writeState(state: BridgeState): void {
    atomicWrite(this.statePath, `${JSON.stringify(state, null, 2)}\n`, 0o600);
  }

  private expectedArtifacts(installationId: string): Artifact[] {
    const endpoint = getClaudeHookBridgeEndpoint(this.dependencies.userDataPath, this.platform);
    const outbox = getClaudeHookOutboxPath(this.dependencies.userDataPath, installationId);
    const helperTarget = join(this.pluginRoot, 'scripts', 'claudeHookHelper.js');
    const wrapperRelative = this.platform === 'win32' ? 'scripts/observe.ps1' : 'scripts/observe.sh';
    const command = this.platform === 'win32'
      ? {
          type: 'command', command: 'powershell.exe',
          args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
            '${CLAUDE_PLUGIN_ROOT}/scripts/observe.ps1'], timeout: 2
        }
      : { type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/scripts/observe.sh', args: [], timeout: 2 };
    const hooks = Object.fromEntries([
      'SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Stop', 'StopFailure', 'SessionEnd'
    ].map((event) => [event, [{ hooks: [command] }]]));
    const wrapper = this.platform === 'win32'
      ? [
          "$env:ELECTRON_RUN_AS_NODE = '1'",
          'try {',
          `  & ${quotePowerShell(this.dependencies.execPath)} (Join-Path $env:CLAUDE_PLUGIN_ROOT 'scripts/claudeHookHelper.js') ${quotePowerShell(CLAUDE_HOOK_HELPER_ARG)} ${quotePowerShell(CLAUDE_HOOK_SOCKET_ARG)} ${quotePowerShell(endpoint.path)} ${quotePowerShell(CLAUDE_HOOK_INSTALLATION_ARG)} ${quotePowerShell(installationId)} ${quotePowerShell(CLAUDE_HOOK_OUTBOX_ARG)} ${quotePowerShell(outbox)} *> $null`,
          '} catch {}',
          'exit 0',
          ''
        ].join('\r\n')
      : [
          '#!/bin/sh',
          `ELECTRON_RUN_AS_NODE=1 ${quoteSh(this.dependencies.execPath)} "\${CLAUDE_PLUGIN_ROOT}/scripts/claudeHookHelper.js" ${quoteSh(CLAUDE_HOOK_HELPER_ARG)} ${quoteSh(CLAUDE_HOOK_SOCKET_ARG)} ${quoteSh(endpoint.path)} ${quoteSh(CLAUDE_HOOK_INSTALLATION_ARG)} ${quoteSh(installationId)} ${quoteSh(CLAUDE_HOOK_OUTBOX_ARG)} ${quoteSh(outbox)} >/dev/null 2>&1 || exit 0`,
          'exit 0',
          ''
        ].join('\n');
    const base: Artifact[] = [
      {
        relativePath: OWNER_MARKER, mode: 0o600,
        content: Buffer.from(`${JSON.stringify({
          owner: 'Bitterless',
          plugin: this.dependencies.identity.pluginId
        }, null, 2)}\n`)
      },
      {
        relativePath: '.claude-plugin/marketplace.json', mode: 0o600,
        content: Buffer.from(`${JSON.stringify({
          name: this.dependencies.identity.marketplaceName,
          description: MARKETPLACE_DESCRIPTION,
          owner: { name: 'Bitterless' },
          plugins: [{
            name: this.dependencies.identity.pluginName,
            source: `./plugins/${this.dependencies.identity.pluginName}`,
            description: PLUGIN_DESCRIPTION
          }]
        }, null, 2)}\n`)
      },
      {
        relativePath: `plugins/${this.dependencies.identity.pluginName}/.claude-plugin/plugin.json`,
        mode: 0o600,
        content: Buffer.from(`${JSON.stringify({
          name: this.dependencies.identity.pluginName,
          version: this.dependencies.pluginVersion,
          author: { name: 'Bitterless' },
          description: PLUGIN_DESCRIPTION
        }, null, 2)}\n`)
      },
      {
        relativePath: `plugins/${this.dependencies.identity.pluginName}/hooks/hooks.json`,
        mode: 0o600,
        content: Buffer.from(`${JSON.stringify({ hooks }, null, 2)}\n`)
      },
      {
        relativePath: `plugins/${this.dependencies.identity.pluginName}/${wrapperRelative}`,
        mode: 0o700,
        content: Buffer.from(wrapper)
      }
    ];
    const helperFiles = this.collectHelperFiles().map((file) => ({
      ...file,
      relativePath: `plugins/${this.dependencies.identity.pluginName}/scripts/${file.relativePath}`,
      mode: 0o600
    }));
    if (!helperFiles.some((file) => resolve(this.marketplaceRoot, file.relativePath) === helperTarget)) {
      throw new Error('Claude hook helper entry is missing');
    }
    return [...base, ...helperFiles];
  }

  private collectHelperFiles(): Array<Pick<Artifact, 'relativePath' | 'content'>> {
    const sourceRoot = dirname(this.helperSourcePath);
    const queue = [this.helperSourcePath];
    const visited = new Set<string>();
    const files: Array<Pick<Artifact, 'relativePath' | 'content'>> = [];
    let bytes = 0;
    while (queue.length > 0) {
      const path = resolve(queue.shift() as string);
      if (visited.has(path)) continue;
      visited.add(path);
      const relativePath = relative(sourceRoot, path);
      if (!relativePath || relativePath.startsWith('..')) {
        throw new Error('Claude hook helper dependency escaped its build directory');
      }
      const content = readFileSync(path);
      bytes += content.length;
      if (files.length >= MAX_ARTIFACT_FILES || bytes > MAX_ARTIFACT_BYTES) {
        throw new Error('Claude hook helper artifact exceeds its limit');
      }
      files.push({ relativePath, content });
      const text = content.toString('utf8');
      for (const match of text.matchAll(/require\(["'](\.[^"']+)["']\)/g)) {
        let dependency = resolve(dirname(path), match[1]);
        if (!existsSync(dependency) && existsSync(`${dependency}.js`)) dependency = `${dependency}.js`;
        if (existsSync(dependency)) queue.push(dependency);
      }
    }
    return files;
  }

  private writeArtifacts(artifacts: Artifact[]): void {
    if (existsSync(this.marketplaceRoot) && !this.isOwnedArtifactRoot()) {
      throw new Error('Claude plugin artifact directory is not owned by Bitterless');
    }
    if (this.isOwnedArtifactRoot()) rmSync(this.marketplaceRoot, { recursive: true, force: true });
    for (const artifact of artifacts) {
      atomicWrite(resolve(this.marketplaceRoot, artifact.relativePath), artifact.content, artifact.mode);
    }
  }

  private readPersistedArtifacts(): Artifact[] | null {
    try {
      if (!this.isOwnedArtifactRoot()) return null;
      const rootStat = lstatSync(this.marketplaceRoot);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
      const wrapperRelative = this.platform === 'win32' ? 'scripts/observe.ps1' : 'scripts/observe.sh';
      const fixed: Array<{ relativePath: string; mode: number }> = [
        { relativePath: OWNER_MARKER, mode: 0o600 },
        { relativePath: '.claude-plugin/marketplace.json', mode: 0o600 },
        {
          relativePath: `plugins/${this.dependencies.identity.pluginName}/.claude-plugin/plugin.json`,
          mode: 0o600
        },
        {
          relativePath: `plugins/${this.dependencies.identity.pluginName}/hooks/hooks.json`,
          mode: 0o600
        },
        {
          relativePath: `plugins/${this.dependencies.identity.pluginName}/${wrapperRelative}`,
          mode: 0o700
        }
      ];
      const artifacts: Artifact[] = [];
      let bytes = 0;
      const readArtifact = (relativePath: string, mode: number): Artifact => {
        const path = resolve(this.marketplaceRoot, relativePath);
        if (relative(this.marketplaceRoot, path).startsWith('..')) {
          throw new Error('Claude plugin artifact escaped its root');
        }
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() ||
          this.platform !== 'win32' && (stat.mode & 0o777) !== mode) {
          throw new Error('Claude plugin artifact identity is invalid');
        }
        const content = readBoundedRegularFile(path, MAX_ARTIFACT_BYTES);
        bytes += content.length;
        if (bytes > MAX_ARTIFACT_BYTES + MAX_STATE_BYTES) {
          throw new Error('Claude plugin artifact tree exceeds its byte limit');
        }
        return { relativePath, content, mode };
      };
      for (const artifact of fixed) {
        artifacts.push(readArtifact(artifact.relativePath, artifact.mode));
      }

      const helperRoot = join(
        this.marketplaceRoot,
        'plugins',
        this.dependencies.identity.pluginName,
        'scripts'
      );
      const queue = ['claudeHookHelper.js'];
      const visited = new Set<string>();
      while (queue.length > 0) {
        const helperRelative = queue.shift() as string;
        if (visited.has(helperRelative)) continue;
        visited.add(helperRelative);
        if (visited.size > MAX_ARTIFACT_FILES) {
          throw new Error('Claude hook helper artifact exceeds its file limit');
        }
        const artifactRelative = relative(
          this.marketplaceRoot,
          resolve(helperRoot, helperRelative)
        );
        if (!artifactRelative || artifactRelative.startsWith('..')) {
          throw new Error('Claude hook helper dependency escaped its plugin directory');
        }
        const artifact = readArtifact(artifactRelative, 0o600);
        artifacts.push(artifact);
        for (const match of artifact.content.toString('utf8').matchAll(
          /require\(["'](\.[^"']+)["']\)/g
        )) {
          let dependency = resolve(dirname(resolve(helperRoot, helperRelative)), match[1]);
          if (!existsSync(dependency) && existsSync(`${dependency}.js`)) dependency = `${dependency}.js`;
          if (!existsSync(dependency)) continue;
          const dependencyRelative = relative(helperRoot, dependency);
          if (!dependencyRelative || dependencyRelative.startsWith('..')) {
            throw new Error('Claude hook helper dependency escaped its plugin directory');
          }
          queue.push(dependencyRelative);
        }
      }

      const expected = new Set(artifacts.map((artifact) => artifact.relativePath));
      const actual = this.listArtifactRelativePaths();
      if (actual.length !== expected.size || actual.some((path) => !expected.has(path))) return null;
      return artifacts;
    } catch {
      return null;
    }
  }

  private listArtifactRelativePaths(): string[] {
    const rootStat = lstatSync(this.marketplaceRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error('Claude plugin artifact root is invalid');
    }
    const actual: string[] = [];
    let entryCount = 0;
    const visit = (directory: string, depth: number): void => {
      if (depth > MAX_ARTIFACT_DEPTH) throw new Error('Claude plugin artifact tree is too deep');
      const handle = opendirSync(directory);
      try {
        let entry = handle.readSync();
        while (entry !== null) {
          entryCount += 1;
          if (entryCount > MAX_ARTIFACT_ENTRIES) {
            throw new Error('Claude plugin artifact tree has too many entries');
          }
          const path = join(directory, entry.name);
          if (entry.isDirectory()) visit(path, depth + 1);
          else if (entry.isFile()) actual.push(relative(this.marketplaceRoot, path));
          else throw new Error('Claude plugin artifact contains an unsupported entry');
          entry = handle.readSync();
        }
      } finally {
        handle.closeSync();
      }
    };
    visit(this.marketplaceRoot, 0);
    return actual;
  }

  private persistedCatalogOwned(artifacts: Artifact[]): boolean {
    try {
      const artifact = artifacts.find(
        (entry) => entry.relativePath === '.claude-plugin/marketplace.json'
      );
      if (!artifact) return false;
      const catalog = JSON.parse(artifact.content.toString('utf8')) as unknown;
      if (!this.exactRecord(catalog, ['name', 'description', 'owner', 'plugins']) ||
        catalog.name !== this.dependencies.identity.marketplaceName ||
        catalog.description !== MARKETPLACE_DESCRIPTION ||
        !this.exactRecord(catalog.owner, ['name']) || catalog.owner.name !== 'Bitterless' ||
        !Array.isArray(catalog.plugins) || catalog.plugins.length !== 1) return false;
      const plugin = catalog.plugins[0];
      return this.exactRecord(plugin, ['name', 'source', 'description']) &&
        plugin.name === this.dependencies.identity.pluginName &&
        plugin.source === `./plugins/${this.dependencies.identity.pluginName}` &&
        plugin.description === PLUGIN_DESCRIPTION;
    } catch {
      return false;
    }
  }

  private persistedPluginVersion(artifacts: Artifact[]): string | null {
    try {
      const artifact = artifacts.find((entry) => entry.relativePath ===
        `plugins/${this.dependencies.identity.pluginName}/.claude-plugin/plugin.json`);
      if (!artifact) return null;
      const plugin = JSON.parse(artifact.content.toString('utf8')) as unknown;
      if (!this.exactRecord(plugin, ['name', 'version', 'author', 'description']) ||
        plugin.name !== this.dependencies.identity.pluginName ||
        typeof plugin.version !== 'string' ||
        plugin.description !== PLUGIN_DESCRIPTION ||
        !this.exactRecord(plugin.author, ['name']) || plugin.author.name !== 'Bitterless') return null;
      return plugin.version;
    } catch {
      return null;
    }
  }

  private artifactsExact(artifacts: Artifact[]): boolean {
    try {
      if (!this.isOwnedArtifactRoot()) return false;
      const expected = new Set(artifacts.map((artifact) => artifact.relativePath));
      const actual = this.listArtifactRelativePaths();
      if (actual.length !== expected.size || actual.some((path) => !expected.has(path))) return false;
      return artifacts.every((artifact) => {
        const path = resolve(this.marketplaceRoot, artifact.relativePath);
        const stat = lstatSync(path);
        return stat.isFile() &&
          (this.platform === 'win32' || (stat.mode & 0o777) === artifact.mode) &&
          stat.size === artifact.content.length &&
          readBoundedRegularFile(path, artifact.content.length).equals(artifact.content);
      });
    } catch {
      return false;
    }
  }

  private assertSafeInstallOwnership(previous: BridgeState | null): void {
    if (this.inspection?.marketplace === 'collision') {
      throw new Error('The Bitterless Claude marketplace name is owned by another source');
    }
    if (this.inspection?.marketplaceNamespaceExclusive === false) {
      throw new Error('The Bitterless Claude marketplace namespace contains another plugin or scope');
    }
    const strongPriorOwnership = previous?.installed === true && this.isOwnedArtifactRoot();
    if (this.inspection?.pluginPresent && this.inspection.marketplace !== 'exact' &&
      !strongPriorOwnership) {
      throw new Error('The existing Claude plugin ownership could not be proven');
    }
    if (existsSync(this.marketplaceRoot) && !this.isOwnedArtifactRoot()) {
      throw new Error('Claude plugin artifact directory is not owned by Bitterless');
    }
  }

  private isExactPluginInspection(): boolean {
    return this.inspection?.error === null && this.inspection.marketplace === 'exact' &&
      this.inspection.marketplaceNamespaceExclusive && this.inspection.catalogExact &&
      this.inspection.pluginPresent && this.inspection.pluginVersionExact &&
      this.inspection.artifactExact;
  }

  private isExactEnabledPluginInspection(): boolean {
    return this.isExactPluginInspection() && this.inspection?.enablement === 'enabled';
  }

  private artifactExact(artifact: Artifact): boolean {
    try {
      if (!this.isOwnedArtifactRoot()) return false;
      const path = resolve(this.marketplaceRoot, artifact.relativePath);
      const stat = lstatSync(path);
      return stat.isFile() &&
        (this.platform === 'win32' || (stat.mode & 0o777) === artifact.mode) &&
        stat.size === artifact.content.length &&
        readBoundedRegularFile(path, artifact.content.length).equals(artifact.content);
    } catch {
      return false;
    }
  }

  private isOwnedArtifactRoot(): boolean {
    try {
      const value = JSON.parse(readBoundedRegularFile(
        join(this.marketplaceRoot, OWNER_MARKER),
        MAX_OWNER_MARKER_BYTES
      ).toString('utf8')) as unknown;
      return this.exactRecord(value, ['owner', 'plugin']) && value.owner === 'Bitterless' &&
        value.plugin === this.dependencies.identity.pluginId;
    } catch {
      return false;
    }
  }

  private digestArtifacts(artifacts: Artifact[]): string {
    const hash = createHash('sha256');
    for (const artifact of artifacts) {
      hash.update(artifact.relativePath).update(String(artifact.mode)).update(artifact.content);
    }
    return hash.digest('hex');
  }

  private async recoverLegacyProductionDebugMarketplace(
    executable: string,
    configDirectory?: string
  ): Promise<boolean> {
    const legacyRoot = this.dependencies.legacyProductionDebugMarketplaceRoot;
    if (!legacyRoot || !this.isProductionIdentity() || !isAbsolute(legacyRoot) ||
      resolve(legacyRoot) === this.marketplaceRoot ||
      basename(dirname(dirname(legacyRoot))) !== 'Bitterless_DEBUG_PROD') return false;

    const initial = await this.inspectClaudeNamespace(executable, configDirectory);
    const marketplaceEntries = initial.marketplaces.filter(
      (entry) => entry.name === PRODUCTION_MARKETPLACE_NAME
    );
    if (marketplaceEntries.length !== 1 ||
      !this.legacyMarketplaceEntryMatches(marketplaceEntries[0], legacyRoot)) return false;

    const proof = this.inspectLegacyMarketplaceOwnership(legacyRoot);
    if (!proof) {
      throw new Error(
        'The legacy Bitterless Claude marketplace ownership could not be proven'
      );
    }
    const namespacePlugins = this.marketplaceNamespacePlugins(
      initial.plugins,
      PRODUCTION_MARKETPLACE_NAME
    );
    const expectedPluginPresent = namespacePlugins.length === 1 &&
      namespacePlugins[0].id === PRODUCTION_PLUGIN_ID && namespacePlugins[0].scope === 'user';
    if (!expectedPluginPresent && namespacePlugins.length !== 0) {
      throw new Error(
        'The legacy Bitterless Claude marketplace namespace is shared; manual cleanup is required'
      );
    }
    if (expectedPluginPresent) {
      await this.command(executable, [
        'plugin', 'uninstall', PRODUCTION_PLUGIN_ID, '--scope', 'user', '-y'
      ], configDirectory);
    }

    const afterUninstall = await this.inspectClaudeNamespace(executable, configDirectory);
    const remainingPlugins = this.marketplaceNamespacePlugins(
      afterUninstall.plugins,
      PRODUCTION_MARKETPLACE_NAME
    );
    const remainingMarketplaces = afterUninstall.marketplaces.filter(
      (entry) => entry.name === PRODUCTION_MARKETPLACE_NAME
    );
    const repeatedProof = this.inspectLegacyMarketplaceOwnership(legacyRoot);
    if (remainingPlugins.length !== 0 || remainingMarketplaces.length !== 1 ||
      !this.legacyMarketplaceEntryMatches(remainingMarketplaces[0], legacyRoot) ||
      !repeatedProof || repeatedProof.device !== proof.device || repeatedProof.inode !== proof.inode) {
      throw new Error(
        'The legacy Bitterless Claude marketplace changed during recovery; manual cleanup is required'
      );
    }

    await this.command(executable, [
      'plugin', 'marketplace', 'remove', PRODUCTION_MARKETPLACE_NAME, '--scope', 'user'
    ], configDirectory);

    const afterRemoval = await this.inspectClaudeNamespace(executable, configDirectory);
    if (this.marketplaceNamespacePlugins(afterRemoval.plugins, PRODUCTION_MARKETPLACE_NAME).length !== 0 ||
      afterRemoval.marketplaces.some((entry) => entry.name === PRODUCTION_MARKETPLACE_NAME)) {
      throw new Error(
        'The legacy Bitterless Claude marketplace remained registered after recovery'
      );
    }
    this.inspection = null;
    return true;
  }

  private isProductionIdentity(): boolean {
    const identity = this.dependencies.identity;
    return identity.marketplaceName === PRODUCTION_MARKETPLACE_NAME &&
      identity.pluginName === PRODUCTION_PLUGIN_NAME && identity.pluginId === PRODUCTION_PLUGIN_ID &&
      identity.artifactRootRelativePath === 'eyes-on-agents/claude-marketplace';
  }

  private async inspectClaudeNamespace(
    executable: string,
    configDirectory?: string
  ): Promise<ClaudeNamespaceInspection> {
    const [pluginsResult, marketplacesResult] = await Promise.all([
      this.command(executable, ['plugin', 'list', '--json'], configDirectory),
      this.command(executable, ['plugin', 'marketplace', 'list', '--json'], configDirectory)
    ]);
    return {
      plugins: parseJsonArray(pluginsResult.stdout, 'Claude plugin list'),
      marketplaces: parseJsonArray(marketplacesResult.stdout, 'Claude marketplace list')
    };
  }

  private marketplaceNamespacePlugins(
    plugins: Array<Record<string, unknown>>,
    marketplaceName: string
  ): Array<Record<string, unknown>> {
    return plugins.filter((entry) => {
      const id = typeof entry.id === 'string' ? entry.id : null;
      return id?.endsWith(`@${marketplaceName}`) === true || entry.marketplace === marketplaceName;
    });
  }

  private inspectLegacyMarketplaceOwnership(root: string): LegacyMarketplaceProof | null {
    try {
      const profileRoot = dirname(dirname(root));
      for (const directory of [profileRoot, dirname(root), root, join(root, '.claude-plugin')]) {
        const stat = lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
      }
      const rootStat = lstatSync(root);
      const marker = JSON.parse(readBoundedRegularFile(
        join(root, OWNER_MARKER),
        MAX_OWNER_MARKER_BYTES
      ).toString('utf8')) as unknown;
      if (!this.exactRecord(marker, ['owner', 'plugin']) ||
        marker.owner !== 'Bitterless' || marker.plugin !== PRODUCTION_PLUGIN_ID) return null;

      const catalog = JSON.parse(readBoundedRegularFile(
        join(root, '.claude-plugin', 'marketplace.json'),
        MAX_LEGACY_CATALOG_BYTES
      ).toString('utf8')) as unknown;
      if (!this.exactRecord(catalog, ['name', 'description', 'owner', 'plugins']) ||
        catalog.name !== PRODUCTION_MARKETPLACE_NAME ||
        catalog.description !== MARKETPLACE_DESCRIPTION ||
        !this.exactRecord(catalog.owner, ['name']) || catalog.owner.name !== 'Bitterless' ||
        !Array.isArray(catalog.plugins) || catalog.plugins.length !== 1) return null;
      const plugin = catalog.plugins[0];
      if (!this.exactRecord(plugin, ['name', 'source', 'description']) ||
        plugin.name !== PRODUCTION_PLUGIN_NAME ||
        plugin.source !== `./plugins/${PRODUCTION_PLUGIN_NAME}` ||
        plugin.description !== PLUGIN_DESCRIPTION) return null;
      return { device: rootStat.dev, inode: rootStat.ino };
    } catch {
      return null;
    }
  }

  private exactRecord(
    value: unknown,
    keys: readonly string[]
  ): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value as Record<string, unknown>).sort().join(',') === [...keys].sort().join(',');
  }

  private legacyMarketplaceEntryMatches(
    entry: Record<string, unknown>,
    legacyRoot: string
  ): boolean {
    const sourcePath = this.marketplaceSourcePath(entry);
    return sourcePath !== null && resolve(sourcePath) === resolve(legacyRoot) &&
      this.marketplaceEntryMatchesRoot(entry, legacyRoot);
  }

  private marketplaceEntryMatches(entry: Record<string, unknown>): boolean {
    return this.marketplaceEntryMatchesRoot(entry, this.marketplaceRoot);
  }

  private marketplaceEntryMatchesRoot(entry: Record<string, unknown>, root: string): boolean {
    const sourcePath = this.marketplaceSourcePath(entry);
    if (sourcePath === null) return false;
    try {
      return realpathSync.native(sourcePath) === realpathSync.native(root);
    } catch {
      return resolve(sourcePath) === resolve(root);
    }
  }

  private marketplaceSourcePath(entry: Record<string, unknown>): string | null {
    const source = entry.source !== null && typeof entry.source === 'object'
      ? entry.source as Record<string, unknown>
      : null;
    const sourceKind = typeof entry.source === 'string' ? entry.source
      : typeof source?.source === 'string' ? source.source
        : typeof source?.type === 'string' ? source.type
          : null;
    const sourcePath = typeof entry.path === 'string' ? entry.path
      : typeof entry.sourcePath === 'string' ? entry.sourcePath
        : typeof source?.path === 'string' ? source.path
          : (sourceKind === 'directory' || sourceKind === 'local') && typeof entry.repo === 'string'
            ? entry.repo
            : null;
    if (sourceKind !== null && !['directory', 'local'].includes(sourceKind)) return null;
    return sourcePath;
  }

  private async resolveExecutable(): Promise<string> {
    if (this.executable !== null) return this.executable;
    for (const candidate of this.dependencies.executableCandidates) {
      try {
        const pluginHelp = await this.runCommand(candidate, ['plugin', '--help'], {
          timeoutMs: 30_000,
          maxOutputBytes: 1024 * 1024
        });
        const pluginHelpOutput = `${pluginHelp.stdout}\n${pluginHelp.stderr}`;
        if (pluginHelp.exitCode !== 0 || !pluginHelpOutput.includes('marketplace')) continue;
        const removeHelp = await this.runCommand(
          candidate,
          ['plugin', 'marketplace', 'remove', '--help'],
          { timeoutMs: 30_000, maxOutputBytes: 1024 * 1024 }
        );
        const removeHelpOutput = `${removeHelp.stdout}\n${removeHelp.stderr}`;
        if (removeHelp.exitCode !== 0 || !/(?:^|\s)--scope(?:[=\s,]|$)/m.test(removeHelpOutput)) {
          continue;
        }
        this.executable = candidate;
        return candidate;
      } catch {
        // Probe the next allowlisted Claude installation.
      }
    }
    throw new Error(
      'Update Claude Code to continue: scoped plugin marketplace removal is required'
    );
  }

  private async command(
    executable: string,
    args: string[],
    configDirectory?: string
  ): Promise<ClaudeCommandResult> {
    let result: ClaudeCommandResult;
    try {
      result = await this.runCommand(executable, args, {
        timeoutMs: 30_000,
        maxOutputBytes: 1024 * 1024,
        configDirectory
      });
    } catch {
      if (this.executable === executable) this.executable = null;
      throw new Error(this.commandFailureStage(args));
    }
    if (result.exitCode !== 0) {
      throw new Error(`${this.commandFailureStage(args)} (exit code ${result.exitCode})`);
    }
    return result;
  }

  private commandFailureStage(args: readonly string[]): string {
    if (args[0] === 'plugin' && args[1] === 'marketplace') {
      if (args[2] === 'add') return 'Claude plugin marketplace registration failed';
      if (args[2] === 'update') return 'Claude plugin marketplace update failed';
      if (args[2] === 'remove') return 'Claude plugin marketplace removal failed';
      if (args[2] === 'list') return 'Claude plugin marketplace inspection failed';
    }
    if (args[0] === 'plugin') {
      if (args[1] === 'install') return 'Claude plugin installation failed';
      if (args[1] === 'update') return 'Claude plugin update failed';
      if (args[1] === 'uninstall') return 'Claude plugin uninstall failed';
      if (args[1] === 'enable') return 'Claude plugin enablement failed';
      if (args[1] === 'list') return 'Claude plugin inspection failed';
    }
    return 'Claude plugin operation failed';
  }

  private safeInstallError(error: unknown): string {
    const message = boundedError(error);
    if (/^(?:Update Claude Code|Claude plugin |Claude hook |The Bitterless |The existing Claude |The legacy Bitterless )/.test(message)) {
      return message;
    }
    return 'Claude plugin setup failed; retry Repair';
  }

  private retainInstallError(message: string): void {
    if (this.inspection) {
      this.inspection = { ...this.inspection, error: message };
      return;
    }
    const state = this.inspectState();
    const configured = state.kind === 'valid' && state.value.installed ||
      existsSync(this.marketplaceRoot);
    this.inspection = {
      configured,
      enabled: false,
      enablement: 'unknown',
      drifted: false,
      marketplace: 'absent',
      marketplaceNamespaceExclusive: false,
      catalogExact: false,
      pluginPresent: false,
      pluginVersion: null,
      pluginVersionExact: false,
      artifactExact: false,
      finishable: false,
      inspectedAt: this.now(),
      error: message
    };
  }
}
