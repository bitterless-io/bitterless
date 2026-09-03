import { app, clipboard, dialog, shell } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createXpcMainEmitter, XpcMainHandler, xpcMain } from 'electron-xpc/main';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type {
  EyesOnAgentsApi,
  EyesOnAgentsBridgeStatus,
  EyesOnAgentsClaudeBridgeStatus,
  EyesOnAgentsClaudeEnvironment,
  EyesOnAgentsRepositoryApi,
  EyesOnAgentsSessionKey,
  EyesOnAgentsSnapshot,
  EyesOnAgentsThreadPagesRefreshResult
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import {
  getCodexHookBridgeEndpoint,
  getCodexHookOutboxPath
} from '@shared/eyesOnAgents/codexHookBridge.contract';
import {
  parseEyesOnAgentsAddClaudeEnvironmentParams,
  parseEyesOnAgentsClaudeBridgeEnvironmentParams,
  parseEyesOnAgentsClaudeEnvironmentIdParams,
  parseEyesOnAgentsCreateDomainParams,
  parseEyesOnAgentsDomainParams,
  parseEyesOnAgentsMoveThreadParams,
  parseEyesOnAgentsRenameClaudeEnvironmentParams,
  parseEyesOnAgentsRenameDomainParams,
  parseEyesOnAgentsReorderDomainsParams,
  parseEyesOnAgentsSetClaudeEnvironmentEnabledParams,
  parseEyesOnAgentsSetClaudeProviderEnabledParams,
  parseEyesOnAgentsSetLastUserPromptCaptureEnabledParams,
  parseEyesOnAgentsSessionKeyParams,
  parseEyesOnAgentsSetThreadUnreadParams,
} from '@shared/eyesOnAgents/eyesOnAgents.contract';
import { codexHookBridgeServer } from '../eyesOnAgents/codexHookBridge.server';
import type { CodexHookOutboxCoverageGap } from '../eyesOnAgents/codexHookOutbox.service';
import { CodexDesktopBridgeService } from '../eyesOnAgents/codexDesktopBridge.service';
import { CodexAppServerSupervisor } from '../eyesOnAgents/codexAppServer.supervisor';
import { EyesOnAgentsService } from '../eyesOnAgents/eyesOnAgents.service';
import { LastUserPromptPreferenceService } from '../eyesOnAgents/lastUserPromptPreference.service';
import { notifyHelper } from '../notificationcenter/notify.helper';
import { openRegisteredOnlyPreviewExplicitTarget } from '../onlypreview/onlyPreviewExplicitTarget.registry';
import {
  resolveAutomaticClaudeConfigDirectory,
  resolveClaudeDirectory
} from '../eyesOnAgents/claudePath.resolver';
import { ClaudeDirectoryConfigService } from '../eyesOnAgents/claudeDirectoryConfig.service';
import { resolveClaudeBridgeEnvironment } from '../eyesOnAgents/claudeBridgeEnvironment.resolver';
import { logClaudeBridgeAction } from '../eyesOnAgents/claudeBridgeLog.helper';
import { resolveClaudeExecutables } from '../eyesOnAgents/claudeExecutable.resolver';
import { ClaudeAgentsAdapter } from '../eyesOnAgents/claudeAgents.adapter';
import { ClaudeWatcherSupervisor } from '../eyesOnAgents/claudeWatcher.supervisor';
import { ClaudeObservationService } from '../eyesOnAgents/claudeObservation.service';
import {
  ClaudePluginBridgeService,
  claudePluginVersionFromVersionCode,
  resolveClaudePluginBridgeIdentity,
  resolveClaudeHookRuntimeExecutable,
  resolveLegacyProductionDebugClaudeMarketplaceRoot
} from '../eyesOnAgents/claudePluginBridge.service';
import { getRuntimeProfile } from '../environment/runtimeProfile.runtime';
import { claudeHookBridgeServer } from '../eyesOnAgents/claudeHookBridge.server';
import {
  getClaudeHookBridgeEndpoint,
  getClaudeHookOutboxPath
} from '@shared/eyesOnAgents/claudeHookBridge.contract';
import { clearClaudeHookOutboxRoot } from '../eyesOnAgents/claudeHookOutbox.service';
import { ClaudeProviderPreferenceService } from
  '../eyesOnAgents/claudeProviderPreference.service';

const repository = createXpcMainEmitter<EyesOnAgentsRepositoryApi>('EyesOnAgentsRepositoryDao');
const settings = createXpcMainEmitter<SettingDao>('SettingDao');
const lastUserPromptPreference = new LastUserPromptPreferenceService(app.getPath('userData'));
const claudeLastUserPromptPreference = new LastUserPromptPreferenceService(
  app.getPath('userData'),
  'claude'
);
const claudeProviderPreference = new ClaudeProviderPreferenceService(settings);

const desktopBridge = new CodexDesktopBridgeService({
  userDataPath: app.getPath('userData'),
  homePath: app.getPath('home'),
  execPath: process.execPath,
  appRootPath: app.getAppPath(),
  runtimeStatus: () => ({
    listening: codexHookBridgeServer.isListening(),
    listeningSince: codexHookBridgeServer.getListeningSince(),
    lastEventAt: codexHookBridgeServer.getLastEventAt()
  })
});

let eyesOnAgentsService: EyesOnAgentsService;
let claudeObservation: ClaudeObservationService;
let bridgeStartPromise: Promise<void> | null = null;
let claudeBridgeStartPromise: Promise<void> | null = null;

const startBridgeListener = async (): Promise<void> => {
  if (codexHookBridgeServer.isListening()) return;
  if (bridgeStartPromise) return await bridgeStartPromise;
  bridgeStartPromise = (async () => {
    const installationId = desktopBridge.ensureInstallationId();
    await codexHookBridgeServer.start({
      endpoint: getCodexHookBridgeEndpoint(app.getPath('userData')),
      installationId,
      outboxPath: getCodexHookOutboxPath(app.getPath('userData')),
      consume: async (delivery) => {
        return await eyesOnAgentsService.commitCodexHookDelivery(delivery);
      },
      onCoverageGap: async (gap) => {
        await eyesOnAgentsService.reportCodexHookCoverageGap(gap);
      }
    });
  })();
  try {
    await bridgeStartPromise;
  } finally {
    bridgeStartPromise = null;
  }
};

const stopBridgeListener = async (): Promise<void> => {
  if (bridgeStartPromise) await bridgeStartPromise;
  await codexHookBridgeServer.stop();
};

const runtimeProfile = getRuntimeProfile();
const userDataPath = app.getPath('userData');
const legacyProductionDebugMarketplaceRoot = resolveLegacyProductionDebugClaudeMarketplaceRoot({
  profile: runtimeProfile,
  appDataPath: app.getPath('appData'),
  userDataPath
});
const claudePluginBridge = new ClaudePluginBridgeService({
  identity: resolveClaudePluginBridgeIdentity(runtimeProfile.id),
  userDataPath,
  execPath: resolveClaudeHookRuntimeExecutable({
    execPath: process.execPath,
    appImagePath: process.env.APPIMAGE,
    isPackaged: app.isPackaged
  }),
  appRootPath: app.getAppPath(),
  pluginVersion: claudePluginVersionFromVersionCode((JSON.parse(
    readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')
  ) as { version_code?: unknown }).version_code),
  executableCandidates: resolveClaudeExecutables({
    homePath: app.getPath('home'),
    pathValue: process.env.PATH
  }),
  ...(legacyProductionDebugMarketplaceRoot === null ? {} : {
    legacyProductionDebugMarketplaceRoot
  }),
  runtimeStatus: () => ({
    listening: claudeHookBridgeServer.isListening(),
    listeningSince: claudeHookBridgeServer.getListeningSince()
  })
});

const startClaudeHookListener = async (): Promise<void> => {
  if (claudeBridgeStartPromise) return await claudeBridgeStartPromise;
  const installationId = claudePluginBridge.getInstallationId();
  claudeBridgeStartPromise = claudeHookBridgeServer.start({
    endpoint: getClaudeHookBridgeEndpoint(app.getPath('userData')),
    installationId,
    outboxPath: getClaudeHookOutboxPath(app.getPath('userData'), installationId),
    consume: async (delivery) => await eyesOnAgentsService.commitClaudeHookDelivery(delivery),
    onCommitted: ({ committedAt, duplicate, origin, installationId: committedInstallationId }) => {
      if (!duplicate && origin === 'live') {
        claudePluginBridge.recordLiveReceipt(committedInstallationId, committedAt);
      }
    },
    onCoverageGap: async (gap) => await eyesOnAgentsService.reportClaudeHookCoverageGap(gap),
    deferReplay: true,
    canArm: () => eyesOnAgentsService.canArmClaudeHookListener()
  });
  try {
    await claudeBridgeStartPromise;
  } finally {
    claudeBridgeStartPromise = null;
  }
};

const stopClaudeHookListener = async (): Promise<void> => {
  if (claudeBridgeStartPromise) await claudeBridgeStartPromise.catch(() => undefined);
  await claudeHookBridgeServer.stop();
};

const appServer = new CodexAppServerSupervisor({
  onNotification: async (method, params) => {
    await eyesOnAgentsService.handleAppServerNotification(method, params);
  },
  onStatusChanged: () => {
    xpcMain.broadcast('eyes-on-agents/changed', {});
  }
});

const pickClaudeConfigDirectory = async (): Promise<string | null> => {
  const result = await dialog.showOpenDialog({
    title: 'Select Claude config directory',
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
};

const claudeDirectoryConfig = new ClaudeDirectoryConfigService({
  settings,
  pickDirectory: pickClaudeConfigDirectory
});

// One ClaudeWatcherSupervisor per configured Claude environment (task 085) — each gets its own
// child process, its own inventory-bridge socket/pipe (scoped by environment id so simultaneously
// running environments never collide on the same endpoint path), and callbacks that report back
// to claudeObservation scoped to that one environment's id, so one environment's watcher failure
// never touches another's generation/retry/status.
const createClaudeWatcher = (environment: EyesOnAgentsClaudeEnvironment): ClaudeWatcherSupervisor => (
  new ClaudeWatcherSupervisor({
    userDataPath: app.getPath('userData'),
    execPath: process.execPath,
    helperEntryPath: join(app.getAppPath(), 'out', 'main', 'claudeDirectoryWatcher.js'),
    roots: { desktopRoots: [], projectsRoot: null },
    environmentId: environment.id,
    environmentLabel: environment.label,
    onInvalidation: () => {
      void claudeObservation.invalidate(environment.id).catch(() => undefined);
    },
    onTerminated: (error) => {
      void claudeObservation.handleWatcherFailure(environment.id, error).catch(() => undefined);
    }
  })
);
claudeObservation = new ClaudeObservationService({
  repository,
  directoryConfig: claudeDirectoryConfig,
  resolveDirectory: (config) => resolveClaudeDirectory({
    configDirectory: config.mode === 'custom'
      ? config.configDirectory as string
      : resolveAutomaticClaudeConfigDirectory({
          homePath: app.getPath('home'),
          env: process.env
        }),
    homePath: app.getPath('home'),
    env: process.env
  }),
  agents: new ClaudeAgentsAdapter(resolveClaudeExecutables({
    homePath: app.getPath('home'),
    pathValue: process.env.PATH
  })),
  createWatcher: createClaudeWatcher,
  broadcastChanged: () => xpcMain.broadcast('eyes-on-agents/changed', {})
});

eyesOnAgentsService = new EyesOnAgentsService({
  repository,
  settings,
  appServer,
  lastUserPromptPreference,
  claudeLastUserPromptPreference,
  claudeProviderPreference,
  desktopBridge,
  bridgeListener: {
    start: startBridgeListener,
    stop: stopBridgeListener,
    recoverOutboxCoverageGap: async (expectedGap: CodexHookOutboxCoverageGap) => {
      await codexHookBridgeServer.recoverOutboxCoverageGap(expectedGap);
    },
    replayOutbox: async () => {
      await codexHookBridgeServer.replayOutbox();
    }
  },
  openExternal: async (url) => await shell.openExternal(url),
  writeClipboardText: (text) => clipboard.writeText(text),
  previewAbsoluteTarget: openRegisteredOnlyPreviewExplicitTarget,
  validateClaudeTranscript: (path, expectedThreadId) => {
    return claudeObservation.requireCanonicalTranscript(path, expectedThreadId);
  },
  claudeObservation,
  // Task 088: the same claudeDirectoryConfig singleton this file's own environment-CRUD/bridge
  // methods already use, injected so EyesOnAgentsService can satisfy EyesOnAgentsApi's environment
  // surface and resolve installClaudeBridge/refreshClaudeBridgeStatus/removeClaudeBridge's
  // { environmentId } internally.
  claudeDirectoryConfig,
  pickClaudeConfigDirectory,
  claudeBridge: claudePluginBridge,
  claudeHookListener: {
    start: startClaudeHookListener,
    stop: stopClaudeHookListener,
    replayOutbox: async () => await claudeHookBridgeServer.replayOutbox(),
    clearOutbox: async () => {
      clearClaudeHookOutboxRoot(getClaudeHookOutboxPath(app.getPath('userData')));
    }
  },
  notifyThreadCompleted: (intent) => notifyHelper.notifyThreadCompleted(intent),
  broadcastChanged: () => xpcMain.broadcast('eyes-on-agents/changed', {})
});

export const startEyesOnAgentsRuntime = async (): Promise<void> => {
  await eyesOnAgentsService.initialize();
};

export const stopEyesOnAgentsRuntime = async (): Promise<void> => {
  await eyesOnAgentsService.shutdown();
};

export const suspendEyesOnAgentsForAuth = async (): Promise<void> => {
  await eyesOnAgentsService.shutdown();
};

export const resumeEyesOnAgentsAfterAuth = async (): Promise<void> => {
  await eyesOnAgentsService.initialize();
};

export class EyesOnAgentsHandler extends XpcMainHandler implements EyesOnAgentsApi {
  async getSnapshot(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.getSnapshot();
  }

  async connectAppServer(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.connectAppServer();
  }

  async disconnectAppServer(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.disconnectAppServer();
  }

  async syncThreads(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.syncThreads();
  }

  async refreshClaudeInventory(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.refreshClaudeInventory();
  }

  async refreshThreadPages(): Promise<EyesOnAgentsThreadPagesRefreshResult> {
    return await eyesOnAgentsService.refreshThreadPages();
  }

  async openThread(params: { sessionKey: EyesOnAgentsSessionKey }): Promise<{
    url: string;
    snapshot: EyesOnAgentsSnapshot;
  }> {
    return await eyesOnAgentsService.openThread(parseEyesOnAgentsSessionKeyParams(params));
  }

  async openThreadInIterm2(params: { sessionKey: EyesOnAgentsSessionKey }): Promise<{
    url: string;
    snapshot: EyesOnAgentsSnapshot;
  }> {
    return await eyesOnAgentsService.openThreadInIterm2(parseEyesOnAgentsSessionKeyParams(params));
  }

  async archiveThread(params: {
    sessionKey: EyesOnAgentsSessionKey;
  }): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.archiveThread(parseEyesOnAgentsSessionKeyParams(params));
  }

  async previewThread(params: { sessionKey: EyesOnAgentsSessionKey }): Promise<void> {
    await eyesOnAgentsService.previewThread(parseEyesOnAgentsSessionKeyParams(params));
  }

  async copySessionPath(params: { sessionKey: EyesOnAgentsSessionKey }): Promise<void> {
    await eyesOnAgentsService.copySessionPath(parseEyesOnAgentsSessionKeyParams(params));
  }

  async markAllRead(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.markAllRead();
  }

  async setThreadUnread(params: {
    sessionKey: EyesOnAgentsSessionKey;
    isUnread: boolean;
  }): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.setThreadUnread(
      parseEyesOnAgentsSetThreadUnreadParams(params)
    );
  }

  async installCodexBridge(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.installCodexBridge();
  }

  async reviewCodexBridge(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.reviewCodexBridge();
  }

  async refreshCodexBridgeStatus(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.refreshCodexBridgeStatus();
  }

  async removeCodexBridge(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.removeCodexBridge();
  }

  async getCodexBridgeStatus(): Promise<EyesOnAgentsBridgeStatus> {
    return await eyesOnAgentsService.getCodexBridgeStatus();
  }

  // Each method below resolves { environmentId } (task 086) against task 084's configured
  // environment list, then passes that one environment's configDirectory (undefined for the
  // automatic environment) down to the existing, byte-for-byte unmodified install/refresh/remove/
  // status sequence — the shared installationId/socket/outbox continuity state machine itself is
  // untouched; only which CLAUDE_CONFIG_DIR the underlying claude CLI targets changes.
  async installClaudeBridge(
    params?: { environmentId?: string }
  ): Promise<EyesOnAgentsSnapshot> {
    const environment = resolveClaudeBridgeEnvironment(
      claudeDirectoryConfig.listEnvironments(),
      parseEyesOnAgentsClaudeBridgeEnvironmentParams(params)
    );
    try {
      const snapshot = await eyesOnAgentsService.installClaudeBridge({
        environmentId: environment.id
      });
      logClaudeBridgeAction('install', environment);
      return snapshot;
    } catch (error) {
      logClaudeBridgeAction('install', environment, error);
      throw error;
    }
  }

  async refreshClaudeBridgeStatus(
    params?: { environmentId?: string }
  ): Promise<EyesOnAgentsSnapshot> {
    const environment = resolveClaudeBridgeEnvironment(
      claudeDirectoryConfig.listEnvironments(),
      parseEyesOnAgentsClaudeBridgeEnvironmentParams(params)
    );
    try {
      const snapshot = await eyesOnAgentsService.refreshClaudeBridgeStatus({
        environmentId: environment.id
      });
      logClaudeBridgeAction('refresh', environment);
      return snapshot;
    } catch (error) {
      logClaudeBridgeAction('refresh', environment, error);
      throw error;
    }
  }

  async removeClaudeBridge(
    params?: { environmentId?: string }
  ): Promise<EyesOnAgentsSnapshot> {
    const environment = resolveClaudeBridgeEnvironment(
      claudeDirectoryConfig.listEnvironments(),
      parseEyesOnAgentsClaudeBridgeEnvironmentParams(params)
    );
    try {
      const snapshot = await eyesOnAgentsService.removeClaudeBridge({
        environmentId: environment.id
      });
      logClaudeBridgeAction('remove', environment);
      return snapshot;
    } catch (error) {
      logClaudeBridgeAction('remove', environment, error);
      throw error;
    }
  }

  async getClaudeBridgeStatus(
    params?: { environmentId?: string }
  ): Promise<EyesOnAgentsClaudeBridgeStatus> {
    const environment = resolveClaudeBridgeEnvironment(
      claudeDirectoryConfig.listEnvironments(),
      parseEyesOnAgentsClaudeBridgeEnvironmentParams(params)
    );
    try {
      return await eyesOnAgentsService.getClaudeBridgeStatus();
    } catch (error) {
      logClaudeBridgeAction('status', environment, error);
      throw error;
    }
  }

  async openNewClaudeSession(): Promise<void> {
    await eyesOnAgentsService.openNewClaudeSession();
  }

  async copyClaudeReloadCommand(): Promise<void> {
    await eyesOnAgentsService.copyClaudeReloadCommand();
  }

  async changeClaudeDirectory(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.changeClaudeDirectory();
  }

  async useAutomaticClaudeDirectory(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.useAutomaticClaudeDirectory();
  }

  // Task 088 (gap 1): resolved the same way as the 4 bridge methods above — an omitted
  // environmentId retries environments[0], an explicit one must match a real configured
  // environment, then the resolved id is passed down for the service's own independent resolution.
  async retryClaudeDirectory(
    params?: { environmentId?: string }
  ): Promise<EyesOnAgentsSnapshot> {
    const environment = resolveClaudeBridgeEnvironment(
      claudeDirectoryConfig.listEnvironments(),
      parseEyesOnAgentsClaudeBridgeEnvironmentParams(params)
    );
    return await eyesOnAgentsService.retryClaudeDirectory({ environmentId: environment.id });
  }

  // Environment-scoped CRUD (task 084). Each mutation persists the environment list, then applies
  // it against claudeObservation's environment map (task 085) so enabling/adding starts that one
  // environment's own supervisor and disabling/removing stops and joins only that one — every
  // other environment's watcher/generation/retry/status is untouched.
  async listClaudeEnvironments(): Promise<EyesOnAgentsClaudeEnvironment[]> {
    return claudeDirectoryConfig.listEnvironments();
  }

  async addClaudeEnvironment(params: { label: string }): Promise<EyesOnAgentsClaudeEnvironment[]> {
    const { label } = parseEyesOnAgentsAddClaudeEnvironmentParams(params);
    const configDirectory = await pickClaudeConfigDirectory();
    if (configDirectory !== null) await claudeDirectoryConfig.addEnvironment({ label, configDirectory });
    await claudeObservation.applyEnvironments();
    return claudeDirectoryConfig.listEnvironments();
  }

  async renameClaudeEnvironment(params: {
    id: string;
    label: string;
  }): Promise<EyesOnAgentsClaudeEnvironment[]> {
    await claudeDirectoryConfig.renameEnvironment(parseEyesOnAgentsRenameClaudeEnvironmentParams(params));
    await claudeObservation.applyEnvironments();
    return claudeDirectoryConfig.listEnvironments();
  }

  async removeClaudeEnvironment(params: { id: string }): Promise<EyesOnAgentsClaudeEnvironment[]> {
    await claudeDirectoryConfig.removeEnvironment(parseEyesOnAgentsClaudeEnvironmentIdParams(params));
    await claudeObservation.applyEnvironments();
    return claudeDirectoryConfig.listEnvironments();
  }

  async setClaudeEnvironmentEnabled(params: {
    id: string;
    enabled: boolean;
  }): Promise<EyesOnAgentsClaudeEnvironment[]> {
    await claudeDirectoryConfig.setEnvironmentEnabled(
      parseEyesOnAgentsSetClaudeEnvironmentEnabledParams(params)
    );
    await claudeObservation.applyEnvironments();
    return claudeDirectoryConfig.listEnvironments();
  }

  async chooseClaudeEnvironmentDirectory(params: {
    id: string;
  }): Promise<EyesOnAgentsClaudeEnvironment[]> {
    await claudeDirectoryConfig.chooseCustomDirectory(parseEyesOnAgentsClaudeEnvironmentIdParams(params));
    await claudeObservation.applyEnvironments();
    return claudeDirectoryConfig.listEnvironments();
  }

  async useAutomaticClaudeEnvironment(params: {
    id: string;
  }): Promise<EyesOnAgentsClaudeEnvironment[]> {
    await claudeDirectoryConfig.useAutomatic(parseEyesOnAgentsClaudeEnvironmentIdParams(params));
    await claudeObservation.applyEnvironments();
    return claudeDirectoryConfig.listEnvironments();
  }

  // Task 089: validates the row id here (the XPC-registered boundary) so an absent/empty/non-UUID
  // id fails before the service resolves anything, then delegates to the service's clipboard write.
  // Nothing about the resolved environment is logged — see the service method's own note.
  async copyClaudeEnvironmentSetupCommand(params: { id: string }): Promise<void> {
    await eyesOnAgentsService.copyClaudeEnvironmentSetupCommand(
      parseEyesOnAgentsClaudeEnvironmentIdParams(params)
    );
  }

  async setClaudeProviderEnabled(
    params: { enabled: boolean }
  ): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.setClaudeProviderEnabled(
      parseEyesOnAgentsSetClaudeProviderEnabledParams(params)
    );
  }

  async setLastUserPromptCaptureEnabled(
    params: { enabled: boolean }
  ): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.setLastUserPromptCaptureEnabled(
      parseEyesOnAgentsSetLastUserPromptCaptureEnabledParams(params)
    );
  }

  async setClaudeLastUserPromptCaptureEnabled(
    params: { enabled: boolean }
  ): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.setClaudeLastUserPromptCaptureEnabled(
      parseEyesOnAgentsSetLastUserPromptCaptureEnabledParams(params)
    );
  }

  async createDomain(params: { title: string }): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.createDomain(parseEyesOnAgentsCreateDomainParams(params));
  }

  async renameDomain(params: { domainId: number; title: string }): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.renameDomain(parseEyesOnAgentsRenameDomainParams(params));
  }

  async deleteDomain(params: { domainId: number }): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.deleteDomain(parseEyesOnAgentsDomainParams(params));
  }

  async reorderDomains(params: { domainIds: number[] }): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.reorderDomains(parseEyesOnAgentsReorderDomainsParams(params));
  }

  async moveThread(params: {
    sessionKey: EyesOnAgentsSessionKey;
    domainId: number;
  }): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.moveThread(parseEyesOnAgentsMoveThreadParams(params));
  }
}

export const eyesOnAgentsHandler = new EyesOnAgentsHandler();
