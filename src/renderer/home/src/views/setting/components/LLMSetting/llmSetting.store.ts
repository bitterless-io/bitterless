import { reactive } from 'vue';
import type { LLMSetting } from '../../store/setting.store.type';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';

export const settingEmitter = createXpcRendererEmitter<SettingDao>('SettingDao') as SettingDao;

const SETTING_KEY_LLM = 'LLM';

class LLMSettingStore {
  llmSetting: LLMSetting = {
    provider: 'openrouter',
    model: 'google/gemini-3-flash-preview',
    apiKey: '',
    endpoint: 'https://openrouter.ai/api/v1',
  };
  loading = false;
  saveStatus: 'idle' | 'success' | 'failed' = 'idle';
}

export const llmSettingStore = reactive<LLMSettingStore>(new LLMSettingStore());

export const loadLLMSetting = async (): Promise<void> => {
  llmSettingStore.loading = true;
  try {
    const result = await settingEmitter.get({ key: SETTING_KEY_LLM });
    console.log('loadLLMSetting',result);

    if (result) {
      const data = result as any;
      llmSettingStore.llmSetting.provider = data.provider || 'openrouter';
      llmSettingStore.llmSetting.model = data.model || 'google/gemini-flash-1.5-8b';
      llmSettingStore.llmSetting.apiKey = data.apiKey || '';
      llmSettingStore.llmSetting.endpoint = data.baseURL || data.endpoint || 'https://openrouter.ai/api/v1';
    }
  } catch (err: any) {
    console.error('[llmSettingStore] loadLLMSetting failed:', err.message);
  } finally {
    llmSettingStore.loading = false;
  }
};

export const saveLLMSetting = async (): Promise<void> => {
  llmSettingStore.saveStatus = 'idle';
  try {
    await settingEmitter.upsert({
      key: SETTING_KEY_LLM,
      value: {
        provider: llmSettingStore.llmSetting.provider,
        model: llmSettingStore.llmSetting.model,
        apiKey: llmSettingStore.llmSetting.apiKey,
        baseURL: llmSettingStore.llmSetting.endpoint,
      },
    });
    llmSettingStore.saveStatus = 'success';
    setTimeout(() => {
      llmSettingStore.saveStatus = 'idle';
    }, 2000);
  } catch (err: any) {
    console.error('[llmSettingStore] saveLLMSetting failed:', err.message);
    llmSettingStore.saveStatus = 'failed';
  }
};
