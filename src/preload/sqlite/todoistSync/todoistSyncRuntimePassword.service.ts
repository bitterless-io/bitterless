import type { TodoistSyncPasswordProtection } from './todoistSyncPassword.service';
import type { TodoistSyncDatabaseDirectoryName } from './todoistSync.database';

export const TODOIST_SYNC_TEST_PASSWORD =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export interface TodoistSyncCredentialOptions {
  runtimePassword?: string;
  passwordProtection?: TodoistSyncPasswordProtection;
  databaseDirectoryName?: TodoistSyncDatabaseDirectoryName;
}

export const createTodoistSyncCredentialOptions = (
  mode: { e2e: boolean; viteMode: 'debug' | 'release' },
  createPasswordProtection: () => TodoistSyncPasswordProtection,
): TodoistSyncCredentialOptions => {
  if (mode.e2e) {
    return { runtimePassword: TODOIST_SYNC_TEST_PASSWORD };
  }
  if (mode.viteMode === 'debug') {
    return {
      runtimePassword: TODOIST_SYNC_TEST_PASSWORD,
      databaseDirectoryName: 'todoist-sync-v1-debug',
    };
  }
  return { passwordProtection: createPasswordProtection() };
};
