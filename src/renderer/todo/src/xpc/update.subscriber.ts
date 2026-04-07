import { xpcRenderer } from 'electron-xpc/renderer';
import { todoStore } from '../store/todo.store';
import { todoSettingStore } from '../store/todoSetting.store';

export const initTodoSubscriber = () => {
  xpcRenderer.subscribe('todo/data_updated', () => {
    todoStore.loadAll();
  });

  xpcRenderer.subscribe('todo/setting_updated', async () => {
    await todoSettingStore.load();
    await todoStore.loadAll();
  });

};
