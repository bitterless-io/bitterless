import type { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';
import { z } from 'zod';
import {
  COIN_X_BROWSER_DISPLAY_MODES,
  type CoinXBrowserDisplayMode,
} from '@shared/coin/coinAnalysis.type';
import type {
  CoinXBrowserErrorCode,
  CoinXBrowserOpenInput,
  CoinXBrowserSetDisplayModeInput,
  CoinXBrowserStatus,
} from '@shared/coin/coinBridge.type';

const X_HOME_URL = 'https://x.com/home';
const X_SEARCH_URL = 'https://x.com/search';
const OPEN_TIMEOUT_MS = 30_000;

const openInputSchema = z.object({
  query: z.string().trim().max(512),
  displayMode: z.enum(COIN_X_BROWSER_DISPLAY_MODES),
}).strict();

const setDisplayModeInputSchema = z.object({
  displayMode: z.enum(COIN_X_BROWSER_DISPLAY_MODES),
}).strict();

export interface CoinXBrowserServiceDependencies {
  getUserDataDir(): string;
  cdpEndpoint?: string;
  now?: () => number;
}

const isLoopbackEndpoint = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
};

const launchErrorCode = (error: unknown): CoinXBrowserErrorCode => {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (
    message.includes('singleton') ||
    message.includes('user data directory is already in use') ||
    message.includes('profile in use')
  ) {
    return 'profile-busy';
  }
  if (
    message.includes('executable doesn\'t exist') ||
    message.includes('browser was not found') ||
    message.includes('chrome distribution')
  ) {
    return 'chrome-unavailable';
  }
  return 'launch-failed';
};

const targetUrl = (query: string): string => {
  if (!query) return X_HOME_URL;
  const url = new URL(X_SEARCH_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('src', 'typed_query');
  url.searchParams.set('f', 'live');
  return url.href;
};

export class CoinXBrowserService {
  private readonly now: () => number;
  private readonly mode: CoinXBrowserStatus['mode'];
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private operation: Promise<CoinXBrowserStatus> | null = null;
  private lastQuery = '';
  private status: CoinXBrowserStatus;

  constructor(private readonly dependencies: CoinXBrowserServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.mode = dependencies.cdpEndpoint ? 'cdp' : 'managed_profile';
    this.status = {
      schema: 'coin-x-browser-v1',
      state: 'closed',
      mode: this.mode,
      displayMode: this.mode === 'cdp' ? 'external' : 'visible',
      errorCode: null,
      openedAt: null,
    };
  }

  async getStatus(): Promise<CoinXBrowserStatus> {
    if (this.operation) return await this.operation;
    await this.refreshLoginState();
    return this.snapshot();
  }

  async open(value: unknown): Promise<CoinXBrowserStatus> {
    let input: CoinXBrowserOpenInput;
    try {
      input = openInputSchema.parse(value) as CoinXBrowserOpenInput;
    } catch {
      return this.setError('navigation-failed');
    }
    if (this.operation) return await this.operation;
    const operation = this.performOpen(input).finally(() => {
      if (this.operation === operation) this.operation = null;
    });
    this.operation = operation;
    return await operation;
  }

  async setDisplayMode(value: unknown): Promise<CoinXBrowserStatus> {
    let input: CoinXBrowserSetDisplayModeInput;
    try {
      input = setDisplayModeInputSchema.parse(value) as CoinXBrowserSetDisplayModeInput;
    } catch {
      return this.setError('display-mode-unavailable');
    }
    if (this.mode === 'cdp') return this.setError('display-mode-unavailable');
    if (this.operation) return await this.operation;
    const operation = this.performSetDisplayMode(input.displayMode).finally(() => {
      if (this.operation === operation) this.operation = null;
    });
    this.operation = operation;
    return await operation;
  }

  async focus(): Promise<CoinXBrowserStatus> {
    if (this.operation) return await this.operation;
    const page = this.livePage();
    if (!page) return this.snapshot();
    try {
      await page.bringToFront();
      await this.refreshLoginState();
      return this.snapshot();
    } catch {
      return this.setError('navigation-failed');
    }
  }

  async close(): Promise<CoinXBrowserStatus> {
    if (this.operation) await this.operation.catch(() => undefined);
    const displayMode = this.status.displayMode;
    await this.closeConnection();
    this.status = {
      schema: 'coin-x-browser-v1',
      state: 'closed',
      mode: this.mode,
      displayMode,
      errorCode: null,
      openedAt: null,
    };
    return this.snapshot();
  }

  private async performOpen(input: CoinXBrowserOpenInput): Promise<CoinXBrowserStatus> {
    if (
      this.mode === 'managed_profile' &&
      this.context &&
      this.status.displayMode !== input.displayMode
    ) {
      await this.closeConnection();
    }
    this.lastQuery = input.query;
    this.status = {
      ...this.status,
      state: 'launching',
      displayMode: this.mode === 'cdp' ? 'external' : input.displayMode,
      errorCode: null,
    };

    if (!this.context) {
      const connected = await this.connect();
      if (!connected) return this.snapshot();
    }

    const context = this.context;
    if (!context) return this.setError('launch-failed');
    const page = this.livePage() ?? await context.newPage();
    this.page = page;
    this.attachPageLifecycle(page);

    try {
      await page.goto(targetUrl(input.query), {
        waitUntil: 'domcontentloaded',
        timeout: OPEN_TIMEOUT_MS,
      });
      await page.bringToFront();
      this.status = {
        ...this.status,
        state: await this.detectLoginState(page),
        errorCode: null,
        openedAt: this.status.openedAt ?? this.now(),
      };
      return this.snapshot();
    } catch {
      return this.setError('navigation-failed');
    }
  }

  private async connect(): Promise<boolean> {
    if (this.mode === 'cdp') return await this.connectCdp();
    try {
      const context = await chromium.launchPersistentContext(
        this.dependencies.getUserDataDir(),
        {
          channel: 'chrome',
          headless: this.status.displayMode === 'hidden',
          viewport: this.status.displayMode === 'hidden'
            ? { width: 1_440, height: 900 }
            : null,
        },
      );
      this.context = context;
      this.attachContextLifecycle(context);
      return true;
    } catch (error) {
      this.setError(launchErrorCode(error));
      return false;
    }
  }

  private async connectCdp(): Promise<boolean> {
    const endpoint = this.dependencies.cdpEndpoint?.trim() ?? '';
    if (!endpoint || !isLoopbackEndpoint(endpoint)) {
      this.setError('cdp-invalid');
      return false;
    }
    try {
      const browser = await chromium.connectOverCDP(endpoint, {
        isLocal: true,
        timeout: 10_000,
      });
      const context = browser.contexts()[0];
      if (!context) {
        await browser.close().catch(() => undefined);
        this.setError('cdp-unavailable');
        return false;
      }
      this.browser = browser;
      this.context = context;
      browser.on('disconnected', () => this.handleClosedContext(context));
      this.attachContextLifecycle(context);
      return true;
    } catch {
      this.setError('cdp-unavailable');
      return false;
    }
  }

  private attachContextLifecycle(context: BrowserContext): void {
    context.on('close', () => this.handleClosedContext(context));
  }

  private attachPageLifecycle(page: Page): void {
    page.on('close', () => {
      if (this.page === page) this.page = null;
    });
  }

  private handleClosedContext(context: BrowserContext): void {
    if (this.context !== context) return;
    this.context = null;
    this.browser = null;
    this.page = null;
    this.status = {
      schema: 'coin-x-browser-v1',
      state: 'closed',
      mode: this.mode,
      displayMode: this.status.displayMode,
      errorCode: null,
      openedAt: null,
    };
  }

  private livePage(): Page | null {
    if (this.page && !this.page.isClosed()) return this.page;
    const page = this.context?.pages().find((candidate) => !candidate.isClosed()) ?? null;
    this.page = page;
    return page;
  }

  private async refreshLoginState(): Promise<void> {
    if (!['ready', 'login_required'].includes(this.status.state)) return;
    const page = this.livePage();
    if (!page) return;
    this.status = {
      ...this.status,
      state: await this.detectLoginState(page),
      errorCode: null,
    };
  }

  private async detectLoginState(page: Page): Promise<'login_required' | 'ready'> {
    const url = page.url();
    if (/^https:\/\/(?:www\.)?x\.com\/(?:login|i\/flow\/login)(?:[/?#]|$)/i.test(url)) {
      return 'login_required';
    }
    try {
      if (await page.locator('[data-testid="AppTabBar_Profile_Link"]').count()) return 'ready';
      if (await page.locator('a[href="/login"], [data-testid="loginButton"]').count()) {
        return 'login_required';
      }
    } catch {
      // A transient navigation still leaves the visible browser usable.
    }
    return 'ready';
  }

  private setError(errorCode: CoinXBrowserErrorCode): CoinXBrowserStatus {
    this.status = {
      ...this.status,
      state: 'error',
      errorCode,
    };
    return this.snapshot();
  }

  private snapshot(): CoinXBrowserStatus {
    return { ...this.status };
  }

  private async performSetDisplayMode(
    displayMode: CoinXBrowserDisplayMode,
  ): Promise<CoinXBrowserStatus> {
    const shouldReopen = Boolean(this.context);
    if (shouldReopen) await this.closeConnection();
    this.status = {
      schema: 'coin-x-browser-v1',
      state: 'closed',
      mode: this.mode,
      displayMode,
      errorCode: null,
      openedAt: null,
    };
    if (!shouldReopen) return this.snapshot();
    return await this.performOpen({ query: this.lastQuery, displayMode });
  }

  private async closeConnection(): Promise<void> {
    const context = this.context;
    const browser = this.browser;
    this.context = null;
    this.browser = null;
    this.page = null;
    try {
      if (this.mode === 'managed_profile') await context?.close();
      else await browser?.close();
    } catch {
      // The browser may already have been closed by the user.
    }
  }
}
