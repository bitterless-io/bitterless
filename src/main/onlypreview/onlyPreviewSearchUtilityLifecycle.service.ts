import { utilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { OnlyPreviewHostCapability } from './onlyPreviewHost.registry';
import { onlyPreviewSearchUtilityRpcService } from './onlyPreviewSearchUtilityRpc.service';
import {
  ONLY_PREVIEW_SEARCH_UTILITY_READY_MESSAGE,
  type OnlyPreviewSearchUtilityReadyMessage
} from '@shared/onlypreview/onlyPreviewSearchUtility.types';

const SEARCH_UTILITY_READY_TIMEOUT_MS = 10_000;

const searchUtilityEnvironment = (): Record<string, string> => {
  const environment: Record<string, string> = {};
  for (const name of [
    'PATH',
    'Path',
    'SYSTEMROOT',
    'WINDIR',
    'TMPDIR',
    'TEMP',
    'TMP',
    'LANG',
    'LC_ALL'
  ]) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  if (process.env.BITTERLESS_E2E === '1') environment.BITTERLESS_E2E = '1';
  return environment;
};

const waitForSearchUtilityReady = async (
  utility: Electron.UtilityProcess,
  instanceId: string
): Promise<void> =>
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timeout);
      utility.off('message', onMessage);
      utility.off('exit', onExit);
      utility.off('error', onError);
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onMessage = (message: unknown): void => {
      const ready = message as OnlyPreviewSearchUtilityReadyMessage | undefined;
      if (
        ready?.type === ONLY_PREVIEW_SEARCH_UTILITY_READY_MESSAGE &&
        ready.instanceId === instanceId
      ) {
        finish();
      }
    };
    const onExit = (): void => finish(new Error('OnlyPreview search utility exited at startup.'));
    const onError = (): void => finish(new Error('OnlyPreview search utility failed at startup.'));
    const timeout = setTimeout(
      () => finish(new Error('OnlyPreview search utility readiness timed out.')),
      SEARCH_UTILITY_READY_TIMEOUT_MS
    );
    utility.on('message', onMessage);
    utility.once('exit', onExit);
    utility.once('error', onError);
  });

export class OnlyPreviewSearchUtilityLifecycleService {
  private utility: Electron.UtilityProcess | null = null;

  async start(params: {
    host: OnlyPreviewHostCapability;
    searchToken: string;
    broadcast(eventName: string, value: unknown): void;
    onUnexpectedExit(): void;
  }): Promise<void> {
    this.stop();
    const instanceId = randomUUID();
    const utility = utilityProcess.fork(
      join(__dirname, 'onlypreviewSearchUtility.js'),
      [
        `--onlypreview-host-token=${params.host.hostToken}`,
        `--onlypreview-search-instance=${instanceId}`
      ],
      {
        env: searchUtilityEnvironment(),
        execArgv: [],
        serviceName: 'OnlyPreview Search Index',
        stdio: 'pipe'
      }
    );
    utility.stdout?.resume();
    utility.stderr?.resume();
    this.utility = utility;
    onlyPreviewSearchUtilityRpcService.attach({
      hostToken: params.host.hostToken,
      hostId: params.host.hostId,
      searchToken: params.searchToken,
      child: utility,
      broadcast: params.broadcast,
      onUnexpectedExit: () => {
        if (this.utility === utility) params.onUnexpectedExit();
      }
    });
    try {
      await waitForSearchUtilityReady(utility, instanceId);
      if (this.utility !== utility) {
        throw new Error('OnlyPreview search utility startup was superseded.');
      }
    } catch (error) {
      if (this.utility === utility) this.stop();
      throw error;
    }
  }

  stop(): void {
    const utility = this.utility;
    this.utility = null;
    onlyPreviewSearchUtilityRpcService.detach();
    utility?.kill();
  }
}

export const onlyPreviewSearchUtilityLifecycleService =
  new OnlyPreviewSearchUtilityLifecycleService();
