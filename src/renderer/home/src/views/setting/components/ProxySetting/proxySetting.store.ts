import { reactive } from 'vue';
import { settingEmitter } from '@/emitter/setting.emitter';
import type { ProxySetting } from './proxySetting.store.type';

export const SETTING_KEY_PROXY = 'PROXY';

class ProxySettingStore {
  loading: boolean = false;
  saveStatus: 'idle' | 'success' | 'failed' = 'idle';
  formSetting: ProxySetting = {
    switch: false,
    ip: '127.0.0.1',
    port: '7890',
  };
  activeSetting: ProxySetting = {
    switch: false,
    ip: '127.0.0.1',
    port: '7890',
  };
}

export const proxySettingStore = reactive<ProxySettingStore>(new ProxySettingStore());

export const loadProxySetting = async (): Promise<void> => {
  proxySettingStore.loading = true;
  try {
    const result = await settingEmitter.get({ key: SETTING_KEY_PROXY });
    if (result) {
      const data = result as ProxySetting;
      const setting = {
        switch: data.switch ?? false,
        ip: data.ip || '127.0.0.1',
        port: data.port || '7890',
      };
      proxySettingStore.formSetting = { ...setting };
      proxySettingStore.activeSetting = { ...setting };
    }
  } catch (err: any) {
    console.error('[proxySettingStore] loadProxySetting failed:', err.message);
  } finally {
    proxySettingStore.loading = false;
  }
};

export const saveProxySetting = async (): Promise<void> => {
  proxySettingStore.saveStatus = 'idle';
  try {
    await settingEmitter.upsert({
      key: SETTING_KEY_PROXY,
      value: {
        switch: proxySettingStore.formSetting.switch,
        ip: proxySettingStore.formSetting.ip,
        port: proxySettingStore.formSetting.port,
      },
    });
    proxySettingStore.activeSetting = { ...proxySettingStore.formSetting };
    proxySettingStore.saveStatus = 'success';
    setTimeout(() => {
      proxySettingStore.saveStatus = 'idle';
    }, 2000);
  } catch (err: any) {
    console.error('[proxySettingStore] saveProxySetting failed:', err.message);
    proxySettingStore.saveStatus = 'failed';
  }
};
