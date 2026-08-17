import { runClaudeHookHelper } from './claudeHookBridge.helper';

void runClaudeHookHelper(process.argv, process.stdin).finally(() => {
  process.exitCode = 0;
});
