import { isTodoRendererOriginId } from '@shared/todoistSync/todoDataUpdate.shared';

export interface TodoRefreshRunContext {
  isCurrent(): boolean;
}

export interface TodoRefreshQueue {
  request(): Promise<void>;
  invalidateIfRunning(): void;
  isRunning(): boolean;
}

export interface TodoDetailReadFence {
  begin(): number;
  current(): number;
  invalidate(): void;
  isCurrent(generation: number): boolean;
}

export const createTodoRefreshQueue = (
  run: (context: TodoRefreshRunContext) => Promise<void>,
): TodoRefreshQueue => {
  let activePromise: Promise<void> | null = null;
  let invalidated = false;
  let generation = 0;

  const drain = async (): Promise<void> => {
    let latestError: unknown = null;
    while (invalidated) {
      invalidated = false;
      const runGeneration = generation;
      try {
        await run({ isCurrent: () => runGeneration === generation });
        latestError = null;
      } catch (error) {
        latestError = error;
      }
    }
    activePromise = null;
    if (latestError !== null) throw latestError;
  };

  const request = (): Promise<void> => {
    invalidated = true;
    generation += 1;
    if (!activePromise) {
      activePromise = Promise.resolve().then(drain);
    }
    return activePromise;
  };

  const invalidateIfRunning = (): void => {
    if (!activePromise) return;
    invalidated = true;
    generation += 1;
  };

  return {
    request,
    invalidateIfRunning,
    isRunning: () => activePromise !== null,
  };
};

export const reconcileById = <Item extends { id: string }>(
  target: Item[],
  incoming: readonly Item[],
  existingById: ReadonlyMap<string, Item> = new Map(target.map((item) => [item.id, item])),
): Item[] => {
  const next: Item[] = [];
  for (const item of incoming) {
    const existing = existingById.get(item.id);
    if (existing) {
      Object.assign(existing, item);
      next.push(existing);
    } else {
      next.push(item);
    }
  }
  target.splice(0, target.length, ...next);
  return target;
};

export const createTodoDetailReadFence = (): TodoDetailReadFence => {
  let generation = 0;
  return {
    begin: () => {
      generation += 1;
      return generation;
    },
    current: () => generation,
    invalidate: () => {
      generation += 1;
    },
    isCurrent: (candidate) => candidate === generation,
  };
};

export const reconcileSubTodoEditingTexts = (
  target: Record<string, string>,
  params: {
    subTodos: readonly { id: string; title: string }[];
    activeSubTodoId: string | null;
  },
): string | null => {
  const currentIds = new Set<string>();
  for (const subTodo of params.subTodos) {
    currentIds.add(subTodo.id);
    if (subTodo.id !== params.activeSubTodoId) target[subTodo.id] = subTodo.title;
  }
  for (const id of Object.keys(target)) {
    if (!currentIds.has(id)) delete target[id];
  }
  return params.activeSubTodoId && currentIds.has(params.activeSubTodoId)
    ? params.activeSubTodoId
    : null;
};

export const shouldRefreshFromDataUpdated = (
  payload: unknown,
  ownOriginRendererId: string,
): boolean => {
  if (!isTodoRendererOriginId(ownOriginRendererId)) return true;
  if (!payload || typeof payload !== 'object') return true;
  const originRendererId = (payload as { originRendererId?: unknown }).originRendererId;
  if (!isTodoRendererOriginId(originRendererId)) return true;
  return originRendererId !== ownOriginRendererId;
};
