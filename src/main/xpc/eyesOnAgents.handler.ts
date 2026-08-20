import { app, clipboard, dialog, shell } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createXpcMainEmitter, XpcMainHandler, xpcMain } from 'electron-xpc/main';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type {
  EyesOnAgentsApi,
  EyesOnAgentsBridgeStatus,
  EyesOnAgentsClaudeBridgeStatus,
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
  parseEyesOnAgentsCreateDomainParams,
  parseEyesOnAgentsDomainParams,
  parseEyesOnAgentsMoveThreadParams,
  parseEyesOnAgentsRenameDomainParams,
  parseEyesOnAgentsReorderDomainsParams,
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

const claudeDirectoryConfig = new ClaudeDirectoryConfigService({
  settings,
  pickDirectory: async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Claude config directory',
      properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  }
});
const claudeWatcher = new ClaudeWatcherSupervisor({
  userDataPath: app.getPath('userData'),
  execPath: process.execPath,
  helperEntryPath: join(app.getAppPath(), 'out', 'main', 'claudeDirectoryWatcher.js'),
  roots: { desktopRoots: [], projectsRoot: null },
  onInvalidation: () => {
    void claudeObservation.invalidate().catch(() => undefined);
  },
  onTerminated: (error) => {
    void claudeObservation.handleWatcherFailure(error).catch(() => undefined);
  }
});
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
  watcher: claudeWatcher,
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

  async previewThread(params: { sessionKey: EyesOnAgentsSessionKey }): Promise<void> {
    await eyesOnAgentsService.previewThread(parseEyesOnAgentsSessionKeyParams(params));
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

  async installClaudeBridge(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.installClaudeBridge();
  }

  async refreshClaudeBridgeStatus(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.refreshClaudeBridgeStatus();
  }

  async removeClaudeBridge(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.removeClaudeBridge();
  }

  async getClaudeBridgeStatus(): Promise<EyesOnAgentsClaudeBridgeStatus> {
    return await eyesOnAgentsService.getClaudeBridgeStatus();
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

  async retryClaudeDirectory(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.retryClaudeDirectory();
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
