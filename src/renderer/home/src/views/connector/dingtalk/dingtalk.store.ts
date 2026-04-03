import { reactive } from 'vue';
import { XpcRendererHandler, createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { DingtalkHandler } from '@preload/connector/dingtalk.handler';
import { settingEmitter } from '@/emitter/setting.emitter';

const dingtalkPreloadEmitter = createXpcRendererEmitter<DingtalkHandler>(
  'DingtalkHandler'
) as DingtalkHandler;


interface DingtalkLoginDetail {
  botName: string;
}

interface DingtalkErrorDetail {
  message: string;
}

interface DingtalkConfig {
  clientId: string;
  clientSecret: string;
}

const DINGTALK_SETTING_KEY = 'DINGTALK_CONFIG';

class DingtalkStore {
  drawerVisible = false;
  loggedIn = false;
  botName = '';
  error: string | null = null;
  connecting = false;
  loading = false;

  formData = {
    clientId: '',
    clientSecret: '',
  };

  async init(): Promise<void> {
    console.log('[dingtalk] initializing connector...');
    try {
      await dingtalkPreloadEmitter.init();
      const result = await dingtalkPreloadEmitter.checkLogin();
      if (result) {
        this.loggedIn = result.loggedIn;
        this.botName = result.botName;
        if (result.loggedIn) {
          console.log('[dingtalk] session restored:', result.botName);
          await dingtalkPreloadEmitter.restoreConnection();
        }
      } else {
        this.loggedIn = false;
        this.botName = '';
        console.log('[dingtalk] no saved config found');
      }
    } catch (err) {
      console.error('[dingtalk] init failed:', err);
    }
  }

  async openDrawer(): Promise<void> {
    this.drawerVisible = true;
    try {
      const result = await dingtalkPreloadEmitter.checkLogin();
      if (result) {
        this.loggedIn = result.loggedIn;
        this.botName = result.botName;
      } else {
        this.loggedIn = false;
        this.botName = '';
      }

      const config = await settingEmitter.get<DingtalkConfig>({ key: DINGTALK_SETTING_KEY });
      if (config && config.clientId && config.clientSecret) {
        this.formData.clientId = config.clientId;
        this.formData.clientSecret = config.clientSecret;
      } else {
        this.formData.clientId = '';
        this.formData.clientSecret = '';
      }
    } catch (err) {
      console.error('[dingtalk] openDrawer failed:', err);
    }
  }

  closeDrawer(): void {
    this.drawerVisible = false;
    this.error = null;
  }

  async saveOnly(): Promise<void> {
    this.error = null;
    this.loading = true;
    try {
      await settingEmitter.upsert({
        key: DINGTALK_SETTING_KEY,
        value: {
          clientId: this.formData.clientId,
          clientSecret: this.formData.clientSecret,
        },
      });
      console.log('[dingtalk] config saved');
    } catch (err: any) {
      console.error('[dingtalk] save failed:', err);
      this.error = err?.message || 'Save failed';
    } finally {
      this.loading = false;
    }
  }

  async saveAndConnect(): Promise<void> {
    this.error = null;
    this.connecting = true;
    try {
      await settingEmitter.upsert({
        key: DINGTALK_SETTING_KEY,
        value: {
          clientId: this.formData.clientId,
          clientSecret: this.formData.clientSecret,
        },
      });
      await dingtalkPreloadEmitter.connect({
        clientId: this.formData.clientId,
        clientSecret: this.formData.clientSecret,
      });
    } catch (err: any) {
      console.error('[dingtalk] connect failed:', err);
      this.error = err?.message || 'Connection failed';
      this.connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await dingtalkPreloadEmitter.disconnect();
    } catch (err) {
      console.error('[dingtalk] disconnect failed:', err);
    }
  }
}

export const dingtalkStore = reactive<DingtalkStore>(new DingtalkStore());

export class DingtalkStoreHandler extends XpcRendererHandler {
  async onLogin(params: DingtalkLoginDetail): Promise<void> {
    dingtalkStore.loggedIn = true;
    dingtalkStore.botName = params.botName;
    dingtalkStore.connecting = false;
    dingtalkStore.error = null;
  }

  async onLogout(): Promise<void> {
    dingtalkStore.loggedIn = false;
    dingtalkStore.botName = '';
  }

  async onError(params: DingtalkErrorDetail): Promise<void> {
    dingtalkStore.error = params.message;
    dingtalkStore.loggedIn = false;
    dingtalkStore.connecting = false;
  }
}

new DingtalkStoreHandler();
