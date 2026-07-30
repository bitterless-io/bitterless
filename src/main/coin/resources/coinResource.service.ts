import type {
  CoinAlchemyProbeReceipt,
  CoinAlchemySaveReceipt,
  CoinCodexActionReceipt,
  CoinCodexLoginMethod,
  CoinCodexStatus,
  CoinGmgnProbeReceipt,
  CoinGmgnSaveReceipt,
  CoinGmgnStatus,
  CoinResourcesStatus,
  CoinServiceSaveReceipt,
} from '@shared/coin/coinResource.type';
import {
  CodexCredentialError,
  type CodexConnectObserver,
  type CodexCredentialService,
  type CodexCredentialStatus,
} from '@main/codex/codexCredential.service';
import {
  COIN_AI_DEFAULT_EFFORT,
  COIN_AI_DEFAULT_MODEL,
} from '@shared/coin/coinAnalysis.type';
import type { AlchemyResourceService } from './alchemyResource.service';
import type { GmgnCliService } from './gmgnCli.service';
import type { ServiceEndpointService } from './serviceEndpoint.service';

export interface CoinResourceServiceDependencies {
  codex: CodexCredentialService;
  gmgn: GmgnCliService;
  alchemy: AlchemyResourceService;
  services: ServiceEndpointService;
  now?: () => number;
}

const mapCodexStatus = (status: CodexCredentialStatus): CoinCodexStatus => ({
  provider: 'openai-codex',
  connected: status.connected,
  loginInProgress: status.loginInProgress,
  model: COIN_AI_DEFAULT_MODEL,
  effort: COIN_AI_DEFAULT_EFFORT,
  lastVerifiedAt: status.lastVerifiedAt,
  ...(status.errorCode ? { errorCode: status.errorCode } : {}),
});

const parseCodexLoginMethod = (value: unknown): CoinCodexLoginMethod => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    (record.method !== 'browser' && record.method !== 'device_code')
  ) {
    throw new Error('invalid');
  }
  return record.method;
};

export class CoinResourceService {
  private readonly now: () => number;

  constructor(private readonly dependencies: CoinResourceServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
  }

  async getStatus(): Promise<CoinResourcesStatus> {
    const [codex, gmgn] = await Promise.all([
      this.getCodexStatus(),
      this.dependencies.gmgn.detect(),
    ]);
    return {
      schema: 'coin-resources-v1',
      observedAt: this.now(),
      codex,
      gmgn,
      services: this.dependencies.services.getStatuses(),
    };
  }

  async getCodexStatus(): Promise<CoinCodexStatus> {
    return mapCodexStatus(await this.dependencies.codex.getStatus());
  }

  async connectCodex(
    value: unknown,
    observer: CodexConnectObserver = {},
  ): Promise<CoinCodexActionReceipt> {
    try {
      const method = parseCodexLoginMethod(value);
      const status = await this.dependencies.codex.connect({ method, ...observer });
      return { ok: status.connected, status: mapCodexStatus(status) };
    } catch (error) {
      const status = await this.getCodexStatus();
      return {
        ok: false,
        status,
        errorCode:
          error instanceof CodexCredentialError ? error.code : 'login-failed',
      };
    }
  }

  async disconnectCodex(): Promise<CoinCodexActionReceipt> {
    try {
      const status = await this.dependencies.codex.disconnect();
      return { ok: !status.connected, status: mapCodexStatus(status) };
    } catch (error) {
      return {
        ok: false,
        status: await this.getCodexStatus(),
        errorCode:
          error instanceof CodexCredentialError ? error.code : 'logout-failed',
      };
    }
  }

  async detectGmgn(): Promise<CoinGmgnStatus> {
    return await this.dependencies.gmgn.detect();
  }

  async saveGmgnApiKey(value: unknown): Promise<CoinGmgnSaveReceipt> {
    return await this.dependencies.gmgn.saveApiKey(value);
  }

  async verifyGmgn(): Promise<CoinGmgnProbeReceipt> {
    return await this.dependencies.gmgn.verify();
  }

  cancelGmgnVerify(): boolean {
    return this.dependencies.gmgn.cancelVerify();
  }

  async openGmgnOfficialLink(value: unknown): Promise<boolean> {
    const target =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).target
        : undefined;
    if (Object.keys((value as Record<string, unknown>) || {}).length !== 1) return false;
    return await this.dependencies.gmgn.openOfficialLink(target);
  }

  async saveAlchemy(value: unknown): Promise<CoinAlchemySaveReceipt> {
    return await this.dependencies.alchemy.save(value);
  }

  async testAlchemy(value: unknown): Promise<CoinAlchemyProbeReceipt> {
    return await this.dependencies.alchemy.test(value);
  }

  async saveService(value: unknown): Promise<CoinServiceSaveReceipt> {
    return await this.dependencies.services.save(value);
  }
}
