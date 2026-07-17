export const onceAsync = <Params extends unknown[], Result>(
  operation: (...params: Params) => Promise<Result>,
): ((...params: Params) => Promise<Result>) => {
  let operationPromise: Promise<Result> | null = null;
  return (...params) => {
    if (!operationPromise) operationPromise = operation(...params);
    return operationPromise;
  };
};
