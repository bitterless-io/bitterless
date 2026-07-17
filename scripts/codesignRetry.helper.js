const path = require('path');

const defaultRetryDelaysMs = [2000, 5000, 10000, 20000, 30000];

const isTimestampServiceUnavailable = (error) => {
  const output = [error?.message, error?.stdout, error?.stderr]
    .filter(Boolean)
    .join('\n');
  return /timestamp service is not available/i.test(output);
};

const createCodesignRetryExecutor = (execute, dependencies = {}) => {
  const retryDelaysMs = dependencies.retryDelaysMs ?? defaultRetryDelaysMs;
  const delay = dependencies.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const onRetry = dependencies.onRetry ?? (() => {});

  return async (file, args, options) => {
    if (path.basename(file) !== 'codesign') {
      return execute(file, args, options);
    }

    for (let attempt = 0; ; attempt++) {
      try {
        return await execute(file, args, options);
      } catch (error) {
        const retryDelayMs = retryDelaysMs[attempt];
        if (retryDelayMs === undefined || !isTimestampServiceUnavailable(error)) {
          throw error;
        }
        onRetry({
          attempt: attempt + 2,
          maxAttempts: retryDelaysMs.length + 1,
          retryDelayMs,
        });
        await delay(retryDelayMs);
      }
    }
  };
};

module.exports = {
  createCodesignRetryExecutor,
  isTimestampServiceUnavailable,
};
