const path = require('path');
const { createCodesignRetryExecutor } = require('./codesignRetry.helper');

const osxSignMainPath = require.resolve('@electron/osx-sign');
const osxSignUtilPath = path.join(path.dirname(osxSignMainPath), 'util.js');
const osxSignUtil = require(osxSignUtilPath);

if (!osxSignUtil.__bitterlessCodesignRetryInstalled) {
  osxSignUtil.execFileAsync = createCodesignRetryExecutor(
    osxSignUtil.execFileAsync,
    {
      onRetry: ({ attempt, maxAttempts, retryDelayMs }) => {
        console.warn(
          `[codesign-retry] Apple timestamp service unavailable; retrying ${attempt}/${maxAttempts} in ${retryDelayMs}ms`,
        );
      },
    },
  );
  Object.defineProperty(osxSignUtil, '__bitterlessCodesignRetryInstalled', {
    value: true,
  });
}
