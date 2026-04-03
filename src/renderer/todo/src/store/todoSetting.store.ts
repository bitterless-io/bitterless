import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import { settingEmitter } from '../emitter/setting.emitter';

const SETTING_KEY = 'todo_settings';

interface TodoSettings {
  showCompleted: boolean;
}

const DEFAULT_SETTINGS: TodoSettings = {
  showCompleted: false,
};

class TodoSettingState {
  showCompleted = false;

  async load(): Promise<void> {
    const saved = await settingEmitter.get<TodoSettings>({ key: SETTING_KEY });
    if (saved) {
      this.showCompleted = saved.showCompleted ?? DEFAULT_SETTINGS.showCompleted;
    }
  }

  async save(): Promise<void> {
    const settings: TodoSettings = {
      showCompleted: this.showCompleted,
    };
    await settingEmitter.upsert({ key: SETTING_KEY, value: settings });
    xpcRenderer.broadcast('todo/setting_updated');
  }

  async toggleShowCompleted(): Promise<void> {
    this.showCompleted = !this.showCompleted;
    await this.save();
  }
}

export const todoSettingStore = reactive(new TodoSettingState()) as TodoSettingState;
