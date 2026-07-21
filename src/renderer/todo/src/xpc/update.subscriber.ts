import { xpcRenderer } from 'electron-xpc/renderer';
import { todoStore } from '../store/todo.store';
import { todoSettingStore } from '../store/todoSetting.store';
import type { TodoistSyncClockCheckRequested } from '@shared/todoistSync/todoistSync.type';
import { todoistSyncStore } from '../store/todoistSync.store';

export const initTodoSubscriber = () => {
  xpcRenderer.subscribe('todo/data_updated', () => {
    todoStore.loadAll();
  });

  xpcRenderer.subscribe('todo/setting_updated', async () => {
    await todoSettingStore.load();
    await todoStore.loadAll();
  });

  xpcRenderer.subscribe('todoist-sync/status_updated', () => {
    void todoistSyncStore.refreshStatus();
  });

  xpcRenderer.subscribe('todoist-sync/clock-check-requested', (payload) => {
    void todoistSyncStore.handleClockCheckRequested(
      payload.params as TodoistSyncClockCheckRequested,
    );
  });

};
