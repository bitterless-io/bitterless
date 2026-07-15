import { reactive } from 'vue';
import { Message } from '@arco-design/web-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type { CoinShellStatus } from '@shared/coin/coinBridge.type';
import type { CoinMemeMode, CoinTab, CoinWindowAction } from './coinShell.type';
import { coinResourcesStore } from './views/resources/coinResources.store';

class CoinShellStore {
  activeTab: CoinTab = 'monitor';
  memeMode: CoinMemeMode = 'discover';
  resourcesActive = false;
  sourcesVisible = false;
  status: CoinShellStatus | null = null;
  statusLoading = false;
  statusError = '';
  pendingWindowAction: CoinWindowAction | null = null;
  private initializationErrorLogged = false;

  async initialize(): Promise<void> {
    const results = await Promise.allSettled([
      this.refreshStatus(),
      coinResourcesStore.initialize(),
    ]);
    if (!results.some((result) => result.status === 'rejected')) return;

    document.documentElement.dataset.coinBootstrap = 'degraded';
    if (!this.statusError) this.statusError = i18nHelper.coin.errors.shellStatus;
    if (!this.initializationErrorLogged) {
      this.initializationErrorLogged = true;
      console.error('[Coin] Status initialization failed; continuing with unavailable state.');
    }
  }

  async openSources(): Promise<void> {
    this.sourcesVisible = true;
    await Promise.all([
      this.status ? Promise.resolve() : this.refreshStatus(),
      coinResourcesStore.initialize(),
    ]);
  }

  openTab(tab: CoinTab): void {
    this.activeTab = tab;
    this.resourcesActive = false;
  }

  openResources(): void {
    this.sourcesVisible = false;
    this.resourcesActive = true;
  }

  async refreshStatus(): Promise<void> {
    if (this.statusLoading) return;
    this.statusLoading = true;
    this.statusError = '';
    try {
      const status = await window.coin.shell.getStatus();
      if (status.schema !== 'coin-shell-v1' || status.shell !== 'ready') {
        throw new Error('Invalid Coin shell status');
      }
      this.status = status;
    } catch (err) {
      console.error('[Coin] Failed to load shell status:', err);
      this.statusError = i18nHelper.coin.errors.shellStatus;
    } finally {
      this.statusLoading = false;
    }
  }

  async refreshStatuses(): Promise<void> {
    await Promise.all([this.refreshStatus(), coinResourcesStore.refreshAll()]);
  }

  async minimize(): Promise<void> {
    await this.runWindowAction('minimize', async () => await window.coin.window.minimize());
  }

  async toggleMaximize(): Promise<void> {
    await this.runWindowAction(
      'maximize',
      async () => await window.coin.window.toggleMaximize(),
    );
  }

  async close(): Promise<void> {
    await this.runWindowAction('close', async () => await window.coin.window.close());
  }

  private async runWindowAction(
    action: CoinWindowAction,
    operation: () => Promise<unknown>,
  ): Promise<void> {
    if (this.pendingWindowAction) return;
    this.pendingWindowAction = action;
    try {
      await operation();
    } catch (err) {
      console.error(`[Coin] Window ${action} failed:`, err);
      Message.error(i18nHelper.coin.errors.windowAction);
    } finally {
      this.pendingWindowAction = null;
    }
  }
}

export const coinShellStore = reactive<CoinShellStore>(new CoinShellStore());
