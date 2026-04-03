import { reactive } from 'vue';
import { settingEmitter } from '@/emitter/setting.emitter';
import type { SystemPromptSetting } from './systemPromptSetting.store.type';

export const SETTING_KEY_SYS_PROMPT = 'sys_prompt';

class SystemPromptSettingStore {
  loading: boolean = false;
  saveStatus: 'idle' | 'success' | 'failed' = 'idle';
  formSetting: SystemPromptSetting = {
    content: '',
  };
  activeSetting: SystemPromptSetting = {
    content: '',
  };
}

export const systemPromptSettingStore = reactive<SystemPromptSettingStore>(new SystemPromptSettingStore());

export const loadSystemPromptSetting = async (): Promise<void> => {
  systemPromptSettingStore.loading = true;
  try {
    const result = await settingEmitter.get({ key: SETTING_KEY_SYS_PROMPT });
    if (result) {
      const data = result as SystemPromptSetting;
      const setting = {
        content: data.content || '',
      };
      systemPromptSettingStore.formSetting = { ...setting };
      systemPromptSettingStore.activeSetting = { ...setting };
    }
  } catch (err: any) {
    console.error('[systemPromptSettingStore] loadSystemPromptSetting failed:', err.message);
  } finally {
    systemPromptSettingStore.loading = false;
  }
};

export const saveSystemPromptSetting = async (): Promise<void> => {
  systemPromptSettingStore.saveStatus = 'idle';
  try {
    await settingEmitter.upsert({
      key: SETTING_KEY_SYS_PROMPT,
      value: {
        content: systemPromptSettingStore.formSetting.content,
      },
    });
    systemPromptSettingStore.activeSetting = { ...systemPromptSettingStore.formSetting };
    systemPromptSettingStore.saveStatus = 'success';
    setTimeout(() => {
      systemPromptSettingStore.saveStatus = 'idle';
    }, 2000);
  } catch (err: any) {
    console.error('[systemPromptSettingStore] saveSystemPromptSetting failed:', err.message);
    systemPromptSettingStore.saveStatus = 'failed';
  }
};
