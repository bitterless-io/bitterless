import type {
  SnipingSessionActivateInput,
  SnipingSessionBridge,
  SnipingSessionClearInput,
} from '@shared/sniping/snipingSession.type';

const DEFAULT_TIMEOUT_MS = 2_000;

export class SnipingSessionActivationService {
  private generation = 0;
  private operationTail: Promise<void> = Promise.resolve();
  private desired: { kind: 'active'; input: SnipingSessionActivateInput } |
    { kind: 'cleared'; input: SnipingSessionClearInput } | null = null;

  constructor(
    private readonly bridge: SnipingSessionBridge,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly unavailable: (operation: 'activate' | 'clear') => void = () => undefined,
  ) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('Sniping session lifecycle timeout must be positive');
    }
  }

  async activate(input: SnipingSessionActivateInput): Promise<void> {
    const generation = ++this.generation;
    this.desired = { kind: 'active', input };
    await this.enqueue('activate', async () => {
      if (!this.isCurrent(generation)) return;
      await this.bridge.activate(input);
      if (!this.isCurrent(generation)) await this.compensateStaleActivation(input);
    });
  }

  async clear(input: SnipingSessionClearInput): Promise<void> {
    const generation = ++this.generation;
    this.desired = { kind: 'cleared', input };
    await this.enqueue('clear', async () => {
      if (!this.isCurrent(generation)) return;
      await this.bridge.clear(input);
      if (!this.isCurrent(generation)) await this.reconcileLatest();
    });
  }

  async replace(
    previous: SnipingSessionClearInput,
    next: SnipingSessionActivateInput,
  ): Promise<void> {
    const generation = ++this.generation;
    this.desired = { kind: 'active', input: next };
    await this.enqueue('activate', async () => {
      if (!this.isCurrent(generation)) return;
      await this.bridge.clear(previous);
      if (!this.isCurrent(generation)) return;
      await this.bridge.activate(next);
      if (!this.isCurrent(generation)) await this.compensateStaleActivation(next);
    });
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private enqueue(operation: 'activate' | 'clear', request: () => Promise<void>): Promise<void> {
    const queued = this.operationTail.then(request, request);
    const bounded = this.settle(operation, queued);
    this.operationTail = bounded;
    return bounded;
  }

  private async reconcileLatest(): Promise<void> {
    const desired = this.desired;
    const generation = this.generation;
    if (!desired) return;
    if (desired.kind === 'active') {
      await this.bridge.activate(desired.input);
      if (!this.isCurrent(generation)) {
        await this.compensateStaleActivation(desired.input);
      }
      return;
    }
    await this.bridge.clear(desired.input);
    if (!this.isCurrent(generation)) await this.reconcileLatest();
  }

  private async compensateStaleActivation(input: SnipingSessionActivateInput): Promise<void> {
    await this.bridge.clear({ sessionId: input.sessionId });
    await this.reconcileLatest();
  }

  private async settle(operation: 'activate' | 'clear', request: Promise<unknown>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('SNIPING_SESSION_LIFECYCLE_TIMEOUT')), this.timeoutMs);
    });
    try {
      await Promise.race([request, timeout]);
    } catch {
      this.unavailable(operation);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
