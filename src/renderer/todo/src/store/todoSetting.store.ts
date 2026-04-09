import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import { settingEmitter } from '../emitter/setting.emitter';

const SETTING_KEY = 'todo_setting';
const SHOW_FOCUSED_SUB_KEY = 'show_focused';
const FOCUSED_FILTERS_SUB_KEY = 'focused_filters';

export interface FocusedFilters {
  important: boolean;
  overdue: boolean;
  today: boolean;
}

const DEFAULT_FILTERS: FocusedFilters = { important: true, overdue: true, today: true };

class TodoSettingState {
  showCompleted = false;
  showFocused = false;
  focusedFilters: FocusedFilters = { ...DEFAULT_FILTERS };

  async load(): Promise<void> {
    this.showCompleted = false;
    const savedFocused = await settingEmitter.get<boolean>({ key: SETTING_KEY, sub_key: SHOW_FOCUSED_SUB_KEY });
    this.showFocused = savedFocused ?? false;
    const savedFilters = await settingEmitter.get<FocusedFilters>({ key: SETTING_KEY, sub_key: FOCUSED_FILTERS_SUB_KEY });
    this.focusedFilters = savedFilters ?? { ...DEFAULT_FILTERS };
  }

  async toggleShowCompleted(): Promise<void> {
    this.showCompleted = !this.showCompleted;
    xpcRenderer.broadcast('todo/setting_updated');
  }

  async toggleShowFocused(): Promise<void> {
    this.showFocused = !this.showFocused;
    await settingEmitter.upsert({ key: SETTING_KEY, sub_key: SHOW_FOCUSED_SUB_KEY, value: this.showFocused });
    xpcRenderer.broadcast('todo/setting_updated');
  }

  async setFocusedFilters(filters: FocusedFilters): Promise<void> {
    this.focusedFilters = filters;
    await settingEmitter.upsert({ key: SETTING_KEY, sub_key: FOCUSED_FILTERS_SUB_KEY, value: filters });
  }
}

export const todoSettingStore = reactive(new TodoSettingState()) as TodoSettingState;
