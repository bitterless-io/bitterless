export interface CoinWindowPort<TWindow> {
  getCurrent(): TWindow | null;
  isDestroyed(window: TWindow): boolean;
  create(signal: AbortSignal): Promise<TWindow>;
  showAndFocus(window: TWindow): void;
  destroy(window: TWindow | null): Promise<void>;
}

export class CoinWindowLifecycle<TWindow> {
  private readonly port: CoinWindowPort<TWindow>;
  private bootPromise: Promise<TWindow> | null = null;
  private bootController: AbortController | null = null;
  private cleanupPromise: Promise<void> | null = null;
  private authenticated = false;
  private hostStopping = false;

  constructor(port: CoinWindowPort<TWindow>) {
    this.port = port;
  }

  async prepareForAuthenticatedSession(): Promise<void> {
    if (this.hostStopping) throw new Error('[coin] host cleanup has started');
    await this.cleanupPromise;
    this.authenticated = true;
  }

  lockForAuthInvalidation(): void {
    this.authenticated = false;
    this.bootController?.abort();
  }

  async open(): Promise<void> {
    await this.cleanupPromise;
    this.assertCanOpen();

    let pendingBoot = this.bootPromise;
    if (!pendingBoot) {
      const current = this.port.getCurrent();
      if (current && !this.port.isDestroyed(current)) {
        this.port.showAndFocus(current);
        return;
      }

      const controller = new AbortController();
      this.bootController = controller;
      const boot = this.port.create(controller.signal);
      const tracked = boot.finally(() => {
        if (this.bootPromise === tracked) this.bootPromise = null;
        if (this.bootController === controller) this.bootController = null;
      });
      this.bootPromise = tracked;
      pendingBoot = tracked;
    }

    const window = await pendingBoot;
    this.assertCanOpen();
    if (this.port.isDestroyed(window)) {
      throw new Error('[coin] window closed before startup completed');
    }
    this.port.showAndFocus(window);
  }

  async destroyForAuth(): Promise<void> {
    this.lockForAuthInvalidation();
    await this.cleanup();
  }

  async destroyForHostQuit(): Promise<void> {
    this.hostStopping = true;
    this.lockForAuthInvalidation();
    await this.cleanup();
  }

  private assertCanOpen(): void {
    if (this.hostStopping) throw new Error('[coin] host cleanup has started');
    if (!this.authenticated) throw new Error('[coin auth] session is not authenticated');
  }

  private cleanup(): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.bootController?.abort();
    const pendingBoot = this.bootPromise;
    const cleanup = (async () => {
      await pendingBoot?.catch(() => undefined);
      await this.port.destroy(this.port.getCurrent());
    })();
    const tracked = cleanup.finally(() => {
      if (this.cleanupPromise === tracked) this.cleanupPromise = null;
    });
    this.cleanupPromise = tracked;
    return tracked;
  }
}
