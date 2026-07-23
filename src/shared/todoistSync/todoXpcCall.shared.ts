export const TODO_XPC_CALL_TIMEOUT_MS = 15_000;

export class TodoXpcTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`[todo xpc] ${label} timed out after ${timeoutMs}ms`);
    this.name = 'TodoXpcTimeoutError';
  }
}

export const withTodoXpcTimeout = <Result>(
  operation: Promise<Result>,
  label: string,
  timeoutMs = TODO_XPC_CALL_TIMEOUT_MS,
): Promise<Result> => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    return Promise.reject(new Error(`[todo xpc] ${label} timeout must be a positive integer`));
  }

  return new Promise<Result>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new TodoXpcTimeoutError(label, timeoutMs));
    }, timeoutMs);
    void operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
};

export const createBoundedTodoXpcClient = <Api extends object>(
  client: Api,
  clientName: string,
  timeoutMs = TODO_XPC_CALL_TIMEOUT_MS,
): Api => new Proxy(client, {
  get: (target, property, receiver) => {
    const method = Reflect.get(target, property, receiver);
    if (typeof method !== 'function') return method;

    return (...args: unknown[]): Promise<unknown> => {
      let result: unknown;
      try {
        result = Reflect.apply(method, target, args);
      } catch (error) {
        return Promise.reject(error);
      }
      return withTodoXpcTimeout(
        Promise.resolve(result),
        `${clientName}.${String(property)}`,
        timeoutMs,
      );
    };
  },
});
