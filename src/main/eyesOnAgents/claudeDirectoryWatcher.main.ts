import {
  runClaudeDirectoryWatcher,
  type ClaudeDirectoryWatcherHelper
} from './claudeDirectoryWatcher.helper';
import { CLAUDE_INVENTORY_WATCHER_READY } from '@shared/eyesOnAgents/claudeInventoryBridge.contract';

let helper: ClaudeDirectoryWatcherHelper | null = null;
try {
  if (typeof process.send !== 'function') throw new Error('Watcher IPC is unavailable');
  helper = runClaudeDirectoryWatcher(process.argv, () => process.exit(1));
  const stop = (): void => {
    helper?.stop();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.once('disconnect', stop);
  process.send(CLAUDE_INVENTORY_WATCHER_READY, (error) => {
    if (!error) return;
    helper?.stop();
    process.exit(1);
  });
  setInterval(() => {
    if (process.ppid === 1) stop();
  }, 1_000);
} catch {
  helper?.stop();
  process.exit(1);
}
