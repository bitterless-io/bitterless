import type {
  TodoistSyncActivateParams,
  TodoistSyncActivationResult,
} from '@shared/todoistSync/todoistSync.type';

type TodoistSyncActivator = (
  params: TodoistSyncActivateParams,
) => Promise<TodoistSyncActivationResult | null>;

type TodoistSyncActivationState = 'idle' | 'pending' | 'ready' | 'failed';

const sameContext = (
  left: TodoistSyncActivateParams | null,
  right: TodoistSyncActivateParams,
): boolean => (
  left?.coreToken === right.coreToken &&
  left.customerId === right.customerId &&
  left.deviceId === right.deviceId
);

const assertActiveResult = (
  result: TodoistSyncActivationResult | null,
  params: TodoistSyncActivateParams,
): void => {
  if (!result || typeof result !== 'object') {
    throw new Error('Todo runtime activation returned no result');
  }
  if (result.status === 'active') {
    if (
      result.customerId !== params.customerId ||
      result.deviceId !== params.deviceId ||
      !Number.isSafeInteger(result.sessionGeneration) ||
      result.sessionGeneration < 1
    ) {
      throw new Error('Todo runtime activation acknowledged a different session');
    }
    return;
  }
  if (result.status === 'failed' && typeof result.error === 'string' && result.error.trim()) {
    throw new Error(result.error);
  }
  throw new Error('Todo runtime activation returned an invalid result');
};

export class TodoistSyncActivationService {
  private context: TodoistSyncActivateParams | null = null;
  private state: TodoistSyncActivationState = 'idle';
  private activationPromise: Promise<void> | null = null;
  private generation = 0;
  private runtimeTargetId: string | null = null;
  private readonly activateRuntime: TodoistSyncActivator;

  constructor(activateRuntime: TodoistSyncActivator) {
    this.activateRuntime = activateRuntime;
  }

  start(params: TodoistSyncActivateParams): Promise<void> {
    return this.getOrStart(params, false);
  }

  ensureReady(params: TodoistSyncActivateParams): Promise<void> {
    return this.getOrStart(params, true);
  }

  registerRuntimeTarget(targetId: string): boolean {
    const nextTargetId = targetId.trim();
    if (!nextTargetId) throw new Error('Todo runtime target ID is required');
    if (nextTargetId === this.runtimeTargetId) return false;

    this.runtimeTargetId = nextTargetId;
    this.invalidate();
    return true;
  }

  invalidate(): void {
    this.generation += 1;
    this.context = null;
    this.state = 'idle';
    this.activationPromise = null;
  }

  private getOrStart(params: TodoistSyncActivateParams, retryFailed: boolean): Promise<void> {
    if (!sameContext(this.context, params)) {
      this.invalidate();
      this.context = { ...params };
    }
    if (
      this.activationPromise &&
      (this.state === 'pending' || this.state === 'ready' || (this.state === 'failed' && !retryFailed))
    ) {
      return this.activationPromise;
    }

    const generation = ++this.generation;
    this.state = 'pending';
    const promise = this.activateRuntime(params).then((result) => {
      assertActiveResult(result, params);
      if (generation !== this.generation || !sameContext(this.context, params)) {
        throw new Error('Todo runtime activation was superseded');
      }
    });
    this.activationPromise = promise;
    void promise.then(
      () => {
        if (generation === this.generation) this.state = 'ready';
      },
      () => {
        if (generation === this.generation) this.state = 'failed';
      },
    );
    return promise;
  }
}
