import { xpcRenderer } from 'electron-xpc/renderer';
import { todoStore } from '../store/todo.store';
import { todoSettingStore } from '../store/todoSetting.store';
import type { TodoistSyncClockCheckRequested } from '@shared/todoistSync/todoistSync.type';
import { todoistSyncStore } from '../store/todoistSync.store';

const observeSubscriberOperation = (label: string, operation: Promise<unknown>): void => {
  void operation.catch((error) => {
    console.error(`[todo] ${label} subscriber failed:`, error);
  });
};

export const initTodoSubscriber = () => {
  xpcRenderer.subscribe('todo/data_updated', () => {
    observeSubscriberOperation('data refresh', todoStore.loadAll());
  });

  xpcRenderer.subscribe('todo/setting_updated', () => {
    observeSubscriberOperation('setting refresh', (async () => {
      await todoSettingStore.load();
      await todoStore.loadAll();
    })());
  });

  xpcRenderer.subscribe('todoist-sync/status_updated', () => {
    observeSubscriberOperation('sync status refresh', todoistSyncStore.refreshStatus());
  });

  xpcRenderer.subscribe('todoist-sync/clock-check-requested', (payload) => {
    observeSubscriberOperation(
      'clock check request',
      todoistSyncStore.handleClockCheckRequested(
        payload.params as TodoistSyncClockCheckRequested,
      ),
    );
  });

};
