import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';

class TodoSettingState {
  showCompleted = false;

  async load(): Promise<void> {
    this.showCompleted = false;
  }

  async toggleShowCompleted(): Promise<void> {
    this.showCompleted = !this.showCompleted;
    xpcRenderer.broadcast('todo/setting_updated');
  }
}

export const todoSettingStore = reactive(new TodoSettingState()) as TodoSettingState;
