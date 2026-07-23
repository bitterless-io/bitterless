import { xpcRenderer, type XpcPayload } from 'electron-xpc/renderer';
import { authStore } from '@/stores/auth/auth.store';
import {
  CORE_SQLITE_TARGET_PRELOAD_REGISTERED_EVENT,
  readCoreSqliteTargetPreloadRegistration,
} from '@shared/sqlite/coreSqliteRuntime.shared';

export const initTodoistSyncRuntimeSubscriber = (): void => {
  xpcRenderer.subscribe(
    CORE_SQLITE_TARGET_PRELOAD_REGISTERED_EVENT,
    (payload: XpcPayload) => {
      const registration = readCoreSqliteTargetPreloadRegistration(payload.params);
      if (!registration) {
        console.warn('[Home] Ignored invalid Core SQLite runtime registration');
        return;
      }
      authStore.onTodoistSyncRuntimeRegistered(registration.targetId);
    },
  );
};
