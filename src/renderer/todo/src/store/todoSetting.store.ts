import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import { settingEmitter } from '../emitter/setting.emitter';

const SETTING_KEY = 'todo_setting';
const SHOW_FOCUSED_SUB_KEY = 'show_focused';
const FOCUSED_FILTERS_SUB_KEY = 'focused_filters';
const ALWAYS_ON_TOP_SUB_KEY = 'always_on_top';

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
  alwaysOnTop = false;

  async load(): Promise<void> {
    this.showCompleted = false;
    const savedFocused = await settingEmitter.get<boolean>({ key: SETTING_KEY, sub_key: SHOW_FOCUSED_SUB_KEY });
    this.showFocused = savedFocused ?? false;
    const savedFilters = await settingEmitter.get<FocusedFilters>({ key: SETTING_KEY, sub_key: FOCUSED_FILTERS_SUB_KEY });
    this.focusedFilters = savedFilters ?? { ...DEFAULT_FILTERS };
    const savedAlwaysOnTop = await settingEmitter.get<boolean>({ key: SETTING_KEY, sub_key: ALWAYS_ON_TOP_SUB_KEY });
    this.alwaysOnTop = savedAlwaysOnTop ?? false;
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

  async setAlwaysOnTop(enable: boolean): Promise<void> {
    this.alwaysOnTop = enable;
    await settingEmitter.upsert({ key: SETTING_KEY, sub_key: ALWAYS_ON_TOP_SUB_KEY, value: enable });
  }
}

export const todoSettingStore = reactive(new TodoSettingState()) as TodoSettingState;
