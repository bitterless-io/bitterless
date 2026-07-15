import { reactive } from 'vue';
import { Message } from '@arco-design/web-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type {
  CoinAlchemyStatus,
  CoinCodexDeviceCodeNotice,
  CoinCodexLoginMethod,
  CoinGmgnOfficialLinkTarget,
  CoinResourceChain,
  CoinResourcesStatus,
  CoinServiceId,
  CoinServiceStatus,
} from '@shared/coin/coinResource.type';

const INSTALL_COMMAND = 'yarn global add gmgn-cli';

class CoinResourcesState {
  status: CoinResourcesStatus | null = null;
  statusLoading = false;
  statusError = '';
  codexLoading = false;
  gmgnDetecting = false;
  gmgnSaving = false;
  gmgnVerifying = false;
  gmgnCancelling = false;
  copyLoading = false;
  officialLinkLoading: CoinGmgnOfficialLinkTarget | null = null;
  alchemySaving: CoinResourceChain | null = null;
  alchemyTesting: CoinResourceChain | null = null;
  serviceSaving: CoinServiceId | null = null;
  gmgnKeyVisible = false;
  gmgnGuideVisible = false;
  gmgnApiKey = '';
  alchemyModalChain: CoinResourceChain | null = null;
  alchemyHttpUrl = '';
  alchemyWssUrl = '';
  serviceModal: CoinServiceId | null = null;
  serviceHttpUrl = '';
  serviceWsUrl = '';
  deviceNotice: CoinCodexDeviceCodeNotice | null = null;
  private stopDeviceListener: (() => void) | null = null;
  private deviceListenerAttempted = false;
  private deviceListenerFailed = false;

  async initialize(): Promise<void> {
    if (!this.deviceListenerAttempted) {
      this.deviceListenerAttempted = true;
      try {
        this.stopDeviceListener = window.coin.codex.onDeviceCode((notice) => {
          this.deviceNotice = notice;
        });
      } catch {
        this.deviceListenerFailed = true;
        document.documentElement.dataset.coinBootstrap = 'degraded';
        console.error(
          '[Coin] Codex device notification listener is unavailable; continuing without device notices.',
        );
      }
    }
    if (!this.status) await this.refreshAll();
    if (this.deviceListenerFailed && !this.statusError) {
      this.statusError = i18nHelper.coin.resourcePage.feedback.statusFailed;
    }
  }

  async refreshAll(): Promise<void> {
    if (this.statusLoading) return;
    this.statusLoading = true;
    this.statusError = '';
    try {
      const status = await window.coin.resources.getStatus();
      if (status.schema !== 'coin-resources-v1') throw new Error('Invalid resource status.');
      this.status = status;
    } catch (error) {
      console.error('[Coin] Resource status failed:', error);
      this.statusError = i18nHelper.coin.resourcePage.feedback.statusFailed;
    } finally {
      this.statusLoading = false;
    }
  }

  async connectCodex(method: CoinCodexLoginMethod): Promise<void> {
    if (this.codexLoading) return;
    this.codexLoading = true;
    try {
      const receipt = await window.coin.codex.connect({ method });
      this.updateCodex(receipt.status);
      if (receipt.ok) Message.success(i18nHelper.coin.resourcePage.feedback.codexConnected);
      else Message.error(this.codexError(receipt.errorCode));
    } catch (error) {
      console.error('[Coin] Codex connect failed:', error);
      Message.error(i18nHelper.coin.resourcePage.feedback.codexConnectFailed);
    } finally {
      this.codexLoading = false;
      this.deviceNotice = null;
    }
  }

  async disconnectCodex(): Promise<void> {
    if (this.codexLoading) return;
    this.codexLoading = true;
    try {
      const receipt = await window.coin.codex.disconnect();
      this.updateCodex(receipt.status);
      if (receipt.ok) Message.success(i18nHelper.coin.resourcePage.feedback.codexDisconnected);
      else Message.error(this.codexError(receipt.errorCode));
    } catch (error) {
      console.error('[Coin] Codex disconnect failed:', error);
      Message.error(i18nHelper.coin.resourcePage.feedback.codexDisconnectFailed);
    } finally {
      this.codexLoading = false;
    }
  }

  async recheckGmgn(): Promise<void> {
    if (this.gmgnDetecting) return;
    this.gmgnDetecting = true;
    try {
      const status = await window.coin.resources.detectGmgn();
      this.updateGmgn(status);
      Message.success(
        status.installed
          ? i18nHelper.coin.resourcePage.feedback.gmgnDetected
          : i18nHelper.coin.resourcePage.feedback.gmgnMissing,
      );
    } catch (error) {
      console.error('[Coin] GMGN detection failed:', error);
      Message.error(i18nHelper.coin.resourcePage.feedback.gmgnDetectFailed);
    } finally {
      this.gmgnDetecting = false;
    }
  }

  async copyInstallCommand(): Promise<void> {
    if (this.copyLoading) return;
    this.copyLoading = true;
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      Message.success(i18nHelper.coin.resourcePage.feedback.commandCopied);
    } catch {
      Message.error(i18nHelper.coin.resourcePage.feedback.commandCopyFailed);
    } finally {
      this.copyLoading = false;
    }
  }

  openGmgnKey(): void {
    this.gmgnApiKey = '';
    this.gmgnKeyVisible = true;
  }

  closeGmgnKey(): void {
    if (this.gmgnSaving) return;
    this.gmgnKeyVisible = false;
    this.gmgnApiKey = '';
  }

  async saveGmgnKey(): Promise<void> {
    if (this.gmgnSaving) return;
    if (!this.gmgnApiKey.trim()) {
      Message.error(i18nHelper.coin.resourcePage.feedback.apiKeyRequired);
      return;
    }
    this.gmgnSaving = true;
    try {
      const receipt = await window.coin.resources.saveGmgnApiKey({
        apiKey: this.gmgnApiKey,
      });
      if (!receipt.ok) {
        Message.error(
          receipt.errorCode === 'invalid-api-key'
            ? i18nHelper.coin.resourcePage.feedback.apiKeyInvalid
            : i18nHelper.coin.resourcePage.feedback.apiKeySaveFailed,
        );
        return;
      }
      this.gmgnApiKey = '';
      this.gmgnKeyVisible = false;
      await this.recheckGmgn();
      Message.success(i18nHelper.coin.resourcePage.feedback.apiKeySaved);
    } catch (error) {
      console.error('[Coin] GMGN key save failed:', error);
      Message.error(i18nHelper.coin.resourcePage.feedback.apiKeySaveFailed);
    } finally {
      this.gmgnSaving = false;
    }
  }

  async verifyGmgn(): Promise<void> {
    if (this.gmgnVerifying) return;
    this.gmgnVerifying = true;
    try {
      const receipt = await window.coin.resources.verifyGmgn();
      if (this.status) this.status.gmgn.lastProbe = receipt;
      if (receipt.ok) Message.success(i18nHelper.coin.resourcePage.feedback.gmgnVerified);
      else Message.error(this.gmgnProbeError(receipt.code));
    } catch (error) {
      console.error('[Coin] GMGN verification failed:', error);
      Message.error(i18nHelper.coin.resourcePage.feedback.gmgnVerifyFailed);
    } finally {
      this.gmgnVerifying = false;
      this.gmgnCancelling = false;
    }
  }

  async cancelGmgnVerify(): Promise<void> {
    if (!this.gmgnVerifying || this.gmgnCancelling) return;
    this.gmgnCancelling = true;
    try {
      await window.coin.resources.cancelGmgnVerify();
    } finally {
      this.gmgnCancelling = false;
    }
  }

  async openOfficialLink(target: CoinGmgnOfficialLinkTarget): Promise<void> {
    if (this.officialLinkLoading) return;
    this.officialLinkLoading = target;
    try {
      const opened = await window.coin.resources.openGmgnOfficialLink({ target });
      if (!opened) Message.error(i18nHelper.coin.resourcePage.feedback.officialLinkFailed);
    } catch {
      Message.error(i18nHelper.coin.resourcePage.feedback.officialLinkFailed);
    } finally {
      this.officialLinkLoading = null;
    }
  }

  openAlchemy(chain: CoinResourceChain): void {
    this.alchemyModalChain = chain;
    this.alchemyHttpUrl = '';
    this.alchemyWssUrl = '';
  }

  closeAlchemy(): void {
    if (this.alchemySaving) return;
    this.alchemyModalChain = null;
    this.alchemyHttpUrl = '';
    this.alchemyWssUrl = '';
  }

  async saveAlchemy(): Promise<void> {
    const chain = this.alchemyModalChain;
    if (!chain || this.alchemySaving) return;
    if (!this.alchemyHttpUrl.trim() || !this.alchemyWssUrl.trim()) {
      Message.error(i18nHelper.coin.resourcePage.feedback.alchemyBothRequired);
      return;
    }
    this.alchemySaving = chain;
    try {
      const receipt = await window.coin.resources.saveAlchemy({
        chain,
        httpUrl: this.alchemyHttpUrl,
        wssUrl: this.alchemyWssUrl,
      });
      this.updateAlchemy(receipt.status);
      if (!receipt.ok) {
        Message.error(this.alchemySaveError(receipt.errorCode));
        return;
      }
      this.closeAlchemyAfterSave();
      Message.success(i18nHelper.coin.resourcePage.feedback.alchemySaved);
    } catch (error) {
      console.error('[Coin] Alchemy save failed:', error);
      Message.error(i18nHelper.coin.resourcePage.feedback.alchemySaveFailed);
    } finally {
      this.alchemySaving = null;
    }
  }

  async testAlchemy(chain: CoinResourceChain): Promise<void> {
    if (this.alchemyTesting) return;
    this.alchemyTesting = chain;
    try {
      const receipt = await window.coin.resources.testAlchemy({ chain });
      const current = this.status?.alchemy.find((item) => item.chain === chain);
      if (current) current.lastProbe = receipt;
      Message[receipt.ok ? 'success' : 'error'](
        receipt.ok
          ? i18nHelper.coin.resourcePage.feedback.alchemyVerified
          : this.alchemyProbeError(receipt.code),
      );
    } catch (error) {
      console.error('[Coin] Alchemy test failed:', error);
      Message.error(i18nHelper.coin.resourcePage.feedback.alchemyTestFailed);
    } finally {
      this.alchemyTesting = null;
    }
  }

  openService(service: CoinServiceId): void {
    this.serviceModal = service;
    this.serviceHttpUrl = '';
    this.serviceWsUrl = '';
  }

  closeService(): void {
    if (this.serviceSaving) return;
    this.serviceModal = null;
    this.serviceHttpUrl = '';
    this.serviceWsUrl = '';
  }

  async saveService(): Promise<void> {
    const service = this.serviceModal;
    if (!service || this.serviceSaving) return;
    if (!this.serviceHttpUrl.trim() || (service === 'monitor' && !this.serviceWsUrl.trim())) {
      Message.error(i18nHelper.coin.resourcePage.feedback.serviceRequired);
      return;
    }
    this.serviceSaving = service;
    try {
      const receipt = await window.coin.resources.saveService(
        service === 'monitor'
          ? { service, httpUrl: this.serviceHttpUrl, wsUrl: this.serviceWsUrl }
          : { service, httpUrl: this.serviceHttpUrl },
      );
      this.updateService(receipt.status);
      if (!receipt.ok) {
        Message.error(
          receipt.errorCode === 'invalid-input'
            ? i18nHelper.coin.resourcePage.feedback.serviceInvalid
            : i18nHelper.coin.resourcePage.feedback.serviceSaveFailed,
        );
        return;
      }
      this.closeServiceAfterSave();
      Message.success(i18nHelper.coin.resourcePage.feedback.serviceSaved);
    } catch (error) {
      console.error('[Coin] Service save failed:', error);
      Message.error(i18nHelper.coin.resourcePage.feedback.serviceSaveFailed);
    } finally {
      this.serviceSaving = null;
    }
  }

  private updateCodex(status: CoinResourcesStatus['codex']): void {
    if (this.status) this.status.codex = status;
  }

  private updateGmgn(status: CoinResourcesStatus['gmgn']): void {
    if (this.status) this.status.gmgn = status;
  }

  private updateAlchemy(status: CoinAlchemyStatus): void {
    if (!this.status) return;
    const index = this.status.alchemy.findIndex((item) => item.chain === status.chain);
    if (index >= 0) this.status.alchemy[index] = status;
  }

  private updateService(status: CoinServiceStatus): void {
    if (!this.status) return;
    const index = this.status.services.findIndex((item) => item.service === status.service);
    if (index >= 0) this.status.services[index] = status;
  }

  private closeAlchemyAfterSave(): void {
    this.alchemyModalChain = null;
    this.alchemyHttpUrl = '';
    this.alchemyWssUrl = '';
  }

  private closeServiceAfterSave(): void {
    this.serviceModal = null;
    this.serviceHttpUrl = '';
    this.serviceWsUrl = '';
  }

  private codexError(code: string | undefined): string {
    if (code === 'timeout') return i18nHelper.coin.resourcePage.feedback.codexTimeout;
    if (code === 'login-in-progress') return i18nHelper.coin.resourcePage.feedback.codexBusy;
    return i18nHelper.coin.resourcePage.feedback.codexConnectFailed;
  }

  private gmgnProbeError(code: string): string {
    const feedback = i18nHelper.coin.resourcePage.feedback;
    if (code === 'cli-missing') return feedback.gmgnCliRequired;
    if (code === 'key-missing') return feedback.gmgnKeyRequired;
    if (code === 'private-key-detected') return feedback.gmgnPrivateKeyBlocked;
    if (code === 'timeout') return feedback.gmgnTimeout;
    if (code === 'cancelled') return feedback.gmgnCancelled;
    if (code === 'unauthorized') return feedback.gmgnUnauthorized;
    if (code === 'rate-limited') return feedback.gmgnRateLimited;
    return feedback.gmgnVerifyFailed;
  }

  private alchemySaveError(code: string | undefined): string {
    const feedback = i18nHelper.coin.resourcePage.feedback;
    if (code === 'secure-storage-unavailable') return feedback.safeStorageUnavailable;
    if (code === 'invalid-input') return feedback.alchemyInvalid;
    return feedback.alchemySaveFailed;
  }

  private alchemyProbeError(code: string): string {
    const feedback = i18nHelper.coin.resourcePage.feedback;
    if (code === 'not-configured') return feedback.alchemyRequired;
    if (code === 'timeout') return feedback.alchemyTimeout;
    if (code === 'invalid-response') return feedback.alchemyInvalidResponse;
    return feedback.alchemyTestFailed;
  }
}

export const coinResourcesStore = reactive<CoinResourcesState>(new CoinResourcesState());
