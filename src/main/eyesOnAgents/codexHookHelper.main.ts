import { runCodexHookHelper } from './codexHookBridge.helper';

void runCodexHookHelper(process.argv, process.stdin).finally(() => {
  process.exitCode = 0;
});
