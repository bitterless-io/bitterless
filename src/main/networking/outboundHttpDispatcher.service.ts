import {
  Dispatcher,
  getGlobalDispatcher,
  setGlobalDispatcher,
  type Dispatcher as DispatcherType
} from 'undici';

const CODEX_PROXY_DOMAINS = [
  'openai.com',
  'chatgpt.com',
  'oaistatic.com',
  'oaiusercontent.com',
  'oaistatsig.com',
  'openaimerge.com'
] as const;

export const isCodexProxyDestination = (origin: string | URL | undefined): boolean => {
  if (!origin) return false;

  let url: URL;
  try {
    url = origin instanceof URL ? origin : new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const hostname = url.hostname.toLowerCase();
  return CODEX_PROXY_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
};

const isLoopbackDestination = (origin: string | URL | undefined): boolean => {
  if (!origin) return false;

  let url: URL;
  try {
    url = origin instanceof URL ? origin : new URL(origin);
  } catch {
    return false;
  }
  const hostname = url.hostname.toLowerCase();
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
};

class OutboundHttpRoutingDispatcher extends Dispatcher {
  codexProxyDispatcher: DispatcherType | null = null;
  maestroProxyDispatcher: DispatcherType | null = null;
  maestroProxyLeases = 0;
  private readonly lifecycleDispatchers = new Set<DispatcherType>();

  constructor(private readonly fallbackDispatcher: DispatcherType) {
    super();
    this.lifecycleDispatchers.add(fallbackDispatcher);
  }

  addLifecycleDispatcher(dispatcher: DispatcherType): void {
    this.lifecycleDispatchers.add(dispatcher);
  }

  dispatch(
    options: DispatcherType.DispatchOptions,
    handler: DispatcherType.DispatchHandler
  ): boolean {
    if (this.codexProxyDispatcher && isCodexProxyDestination(options.origin)) {
      return this.codexProxyDispatcher.dispatch(options, handler);
    }
    if (isLoopbackDestination(options.origin)) {
      return this.fallbackDispatcher.dispatch(options, handler);
    }
    if (this.maestroProxyDispatcher && this.maestroProxyLeases > 0) {
      return this.maestroProxyDispatcher.dispatch(options, handler);
    }
    return this.fallbackDispatcher.dispatch(options, handler);
  }

  close(): Promise<void>;
  close(callback: () => void): void;
  close(callback?: () => void): Promise<void> | void {
    const completion = Promise.all(
      [...this.lifecycleDispatchers].map(async (dispatcher) => await dispatcher.close())
    ).then(() => undefined);
    if (!callback) return completion;
    void completion.then(callback, callback);
  }

  destroy(): Promise<void>;
  destroy(error: Error | null): Promise<void>;
  destroy(callback: () => void): void;
  destroy(error: Error | null, callback: () => void): void;
  destroy(
    errorOrCallback?: Error | null | (() => void),
    callback?: () => void
  ): Promise<void> | void {
    const error = typeof errorOrCallback === 'function' ? null : (errorOrCallback ?? null);
    const completionCallback =
      typeof errorOrCallback === 'function' ? errorOrCallback : callback;
    const completion = Promise.all(
      [...this.lifecycleDispatchers].map(
        async (dispatcher) => await dispatcher.destroy(error)
      )
    ).then(() => undefined);
    if (!completionCallback) return completion;
    void completion.then(completionCallback, completionCallback);
  }
}

export interface OutboundHttpDispatcherRuntime {
  getGlobalDispatcher(): DispatcherType;
  setGlobalDispatcher(dispatcher: DispatcherType): void;
}

const defaultRuntime: OutboundHttpDispatcherRuntime = {
  getGlobalDispatcher,
  setGlobalDispatcher
};

export class OutboundHttpDispatcherCoordinator {
  private routingDispatcher: OutboundHttpRoutingDispatcher | null = null;

  constructor(private readonly runtime: OutboundHttpDispatcherRuntime = defaultRuntime) {}

  private ensureInstalled(): OutboundHttpRoutingDispatcher {
    if (this.routingDispatcher) return this.routingDispatcher;

    const routingDispatcher = new OutboundHttpRoutingDispatcher(
      this.runtime.getGlobalDispatcher()
    );
    this.runtime.setGlobalDispatcher(routingDispatcher);
    this.routingDispatcher = routingDispatcher;
    return routingDispatcher;
  }

  configureCodexProxy(dispatcher: DispatcherType): void {
    const routingDispatcher = this.ensureInstalled();
    if (
      routingDispatcher.codexProxyDispatcher &&
      routingDispatcher.codexProxyDispatcher !== dispatcher
    ) {
      throw new Error('Codex proxy dispatcher is already configured.');
    }
    routingDispatcher.addLifecycleDispatcher(dispatcher);
    routingDispatcher.codexProxyDispatcher = dispatcher;
  }

  acquireMaestroProxy(dispatcher: DispatcherType): () => void {
    const routingDispatcher = this.ensureInstalled();
    if (
      routingDispatcher.maestroProxyLeases > 0 &&
      routingDispatcher.maestroProxyDispatcher !== dispatcher
    ) {
      throw new Error('Maestro proxy dispatcher changed during an active lease.');
    }

    routingDispatcher.addLifecycleDispatcher(dispatcher);
    routingDispatcher.maestroProxyDispatcher = dispatcher;
    routingDispatcher.maestroProxyLeases += 1;

    let released = false;
    return (): void => {
      if (released) return;
      released = true;
      routingDispatcher.maestroProxyLeases = Math.max(
        0,
        routingDispatcher.maestroProxyLeases - 1
      );
      if (routingDispatcher.maestroProxyLeases === 0) {
        routingDispatcher.maestroProxyDispatcher = null;
      }
    };
  }
}

const coordinator = new OutboundHttpDispatcherCoordinator();

export const configureCodexProxyDispatcher = (dispatcher: DispatcherType): void => {
  coordinator.configureCodexProxy(dispatcher);
};

export const acquireMaestroProxyLease = (dispatcher: DispatcherType): (() => void) =>
  coordinator.acquireMaestroProxy(dispatcher);
