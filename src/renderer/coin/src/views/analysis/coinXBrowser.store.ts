import { reactive } from 'vue';
import type { CoinXBrowserDisplayMode } from '@shared/coin/coinAnalysis.type';
import type { CoinXBrowserStatus } from '@shared/coin/coinBridge.type';

const initialStatus = (): CoinXBrowserStatus => ({
  schema: 'coin-x-browser-v1',
  state: 'closed',
  mode: 'managed_profile',
  displayMode: 'visible',
  errorCode: null,
  openedAt: null,
});

class CoinXBrowserState {
  status: CoinXBrowserStatus = initialStatus();
  loading = false;

  async initialize(): Promise<void> {
    try {
      this.status = await window.coin.xBrowser.getStatus();
    } catch {
      this.status = {
        ...this.status,
        state: 'error',
        errorCode: 'launch-failed',
      };
    }
  }

  async open(query: string, displayMode: CoinXBrowserDisplayMode): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      this.status = await window.coin.xBrowser.open({
        query: query.trim(),
        displayMode,
      });
    } catch {
      this.status = {
        ...this.status,
        state: 'error',
        errorCode: 'launch-failed',
      };
    } finally {
      this.loading = false;
    }
  }

  async setDisplayMode(displayMode: CoinXBrowserDisplayMode): Promise<void> {
    if (this.loading || this.status.mode === 'cdp') return;
    this.loading = true;
    try {
      this.status = await window.coin.xBrowser.setDisplayMode({ displayMode });
    } catch {
      this.status = {
        ...this.status,
        state: 'error',
        errorCode: 'display-mode-unavailable',
      };
    } finally {
      this.loading = false;
    }
  }

  async focus(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      this.status = await window.coin.xBrowser.focus();
    } finally {
      this.loading = false;
    }
  }

  async close(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      this.status = await window.coin.xBrowser.close();
    } finally {
      this.loading = false;
    }
  }
}

export const coinXBrowserStore = reactive<CoinXBrowserState>(new CoinXBrowserState());
