import type {
  CoinGmgnOfficialLinkTarget,
  CoinGmgnProbeCode,
  CoinGmgnProbeReceipt,
  CoinGmgnSaveReceipt,
  CoinGmgnStatus,
} from '@shared/coin/coinResource.type';

export type TrenchGmgnSettingsOperation =
  | 'load'
  | 'recheck'
  | 'save-verify'
  | 'verify'
  | null;

export type TrenchGmgnSettingsFeedbackCode =
  | CoinGmgnProbeCode
  | 'invalid-api-key'
  | 'link-unavailable'
  | 'status-unavailable'
  | 'write-failed';

export interface TrenchGmgnSettingsFeedback {
  code: TrenchGmgnSettingsFeedbackCode;
  tone: 'error' | 'success';
}

export interface TrenchGmgnSettingsClient {
  detectGmgn(): Promise<CoinGmgnStatus>;
  saveGmgnApiKey(params: { apiKey: string }): Promise<CoinGmgnSaveReceipt>;
  verifyGmgn(): Promise<CoinGmgnProbeReceipt>;
  openGmgnOfficialLink(params: { target: CoinGmgnOfficialLinkTarget }): Promise<boolean>;
}

const probeFeedback = (receipt: CoinGmgnProbeReceipt): TrenchGmgnSettingsFeedback => ({
  code: receipt.code,
  tone: receipt.ok ? 'success' : 'error',
});

export class TrenchGmgnSettingsStore {
  visible = false;
  status: CoinGmgnStatus | null = null;
  operation: TrenchGmgnSettingsOperation = null;
  feedback: TrenchGmgnSettingsFeedback | null = null;
  apiKey = '';
  private loadSequence = 0;

  constructor(private readonly client: TrenchGmgnSettingsClient) {}

  get pending(): boolean {
    return this.operation !== null;
  }

  open(): void {
    this.visible = true;
    this.apiKey = '';
    this.feedback = null;
    void this.load();
  }

  close(): void {
    if (this.pending) return;
    this.visible = false;
    this.apiKey = '';
    this.feedback = null;
  }

  async load(): Promise<boolean> {
    return await this.detect('load');
  }

  async recheck(): Promise<boolean> {
    return await this.detect('recheck');
  }

  async verifyExisting(): Promise<boolean> {
    if (this.pending) return false;
    this.operation = 'verify';
    this.feedback = null;
    try {
      const receipt = await this.client.verifyGmgn();
      if (this.status) this.status.lastProbe = receipt;
      this.feedback = probeFeedback(receipt);
      return receipt.ok;
    } catch {
      this.feedback = { code: 'status-unavailable', tone: 'error' };
      return false;
    } finally {
      this.operation = null;
    }
  }

  async saveAndVerify(): Promise<boolean> {
    if (this.pending) return false;
    const apiKey = this.apiKey.trim();
    if (!apiKey) {
      this.feedback = { code: 'invalid-api-key', tone: 'error' };
      return false;
    }
    this.operation = 'save-verify';
    this.feedback = null;
    try {
      const saveReceipt = await this.client.saveGmgnApiKey({ apiKey });
      this.apiKey = '';
      if (!saveReceipt.ok) {
        this.feedback = {
          code: saveReceipt.errorCode ?? 'write-failed',
          tone: 'error',
        };
        return false;
      }

      try {
        this.status = await this.client.detectGmgn();
      } catch {
        this.feedback = { code: 'status-unavailable', tone: 'error' };
        return false;
      }

      const probeReceipt = await this.client.verifyGmgn();
      this.status.lastProbe = probeReceipt;
      this.feedback = probeFeedback(probeReceipt);
      return probeReceipt.ok;
    } catch {
      this.feedback = { code: 'status-unavailable', tone: 'error' };
      return false;
    } finally {
      this.apiKey = '';
      this.operation = null;
    }
  }

  async openApiKeyPage(): Promise<boolean> {
    try {
      const opened = await this.client.openGmgnOfficialLink({ target: 'apiKey' });
      if (!opened) this.feedback = { code: 'link-unavailable', tone: 'error' };
      return opened;
    } catch {
      this.feedback = { code: 'link-unavailable', tone: 'error' };
      return false;
    }
  }

  private async detect(operation: Exclude<TrenchGmgnSettingsOperation, 'save-verify' | 'verify' | null>): Promise<boolean> {
    if (this.pending) return false;
    const sequence = ++this.loadSequence;
    this.operation = operation;
    this.feedback = null;
    try {
      const status = await this.client.detectGmgn();
      if (sequence !== this.loadSequence) return false;
      this.status = status;
      return true;
    } catch {
      if (sequence === this.loadSequence) {
        this.feedback = { code: 'status-unavailable', tone: 'error' };
      }
      return false;
    } finally {
      if (sequence === this.loadSequence) this.operation = null;
    }
  }
}
