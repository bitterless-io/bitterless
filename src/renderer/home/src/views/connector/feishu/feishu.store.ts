import { reactive } from 'vue';
import { XpcRendererHandler, createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { FeishuHandler } from '@preload/connector/feishu.handler';
import { settingEmitter } from '@/emitter/setting.emitter';

const feishuPreloadEmitter = createXpcRendererEmitter<FeishuHandler>(
  'FeishuHandler'
) as FeishuHandler;

interface FeishuLoginDetail {
  botName: string;
}

interface FeishuErrorDetail {
  message: string;
}

interface FeishuConfig {
  appId: string;
  appSecret: string;
}

const FEISHU_SETTING_KEY = 'FEISHU_CONFIG';

class FeishuState {
  drawerVisible = false;
  loggedIn = false;
  botName = '';
  error: string | null = null;
  connecting = false;
  loading = false;

  formData = {
    appId: '',
    appSecret: '',
  };

  async init(): Promise<void> {
    console.log('[feishu] initializing connector...');
    try {
      await feishuPreloadEmitter.init();
      const result = await feishuPreloadEmitter.checkLogin();
      if (result) {
        this.loggedIn = result.loggedIn;
        this.botName = result.botName;
        if (result.loggedIn) {
          console.log('[feishu] session restored:', result.botName);
          await feishuPreloadEmitter.restoreConnection();
        }
      } else {
        this.loggedIn = false;
        this.botName = '';
        console.log('[feishu] no saved config found');
      }
    } catch (err) {
      console.error('[feishu] init failed:', err);
    }
  }

  async openDrawer(): Promise<void> {
    this.drawerVisible = true;
    try {
      const result = await feishuPreloadEmitter.checkLogin();
      if (result) {
        this.loggedIn = result.loggedIn;
        this.botName = result.botName;
      } else {
        this.loggedIn = false;
        this.botName = '';
      }

      const config = await settingEmitter.get<FeishuConfig>({ key: FEISHU_SETTING_KEY });
      if (config && config.appId && config.appSecret) {
        this.formData.appId = config.appId;
        this.formData.appSecret = config.appSecret;
      } else {
        this.formData.appId = '';
        this.formData.appSecret = '';
      }
    } catch (err) {
      console.error('[feishu] openDrawer failed:', err);
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
        key: FEISHU_SETTING_KEY,
        value: {
          appId: this.formData.appId,
          appSecret: this.formData.appSecret,
        },
      });
      console.log('[feishu] config saved');
    } catch (err: any) {
      console.error('[feishu] save failed:', err);
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
        key: FEISHU_SETTING_KEY,
        value: {
          appId: this.formData.appId,
          appSecret: this.formData.appSecret,
        },
      });
      await feishuPreloadEmitter.connect({
        appId: this.formData.appId,
        appSecret: this.formData.appSecret,
      });
    } catch (err: any) {
      console.error('[feishu] connect failed:', err);
      this.error = err?.message || 'Connection failed';
      this.connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await feishuPreloadEmitter.disconnect();
    } catch (err) {
      console.error('[feishu] disconnect failed:', err);
    }
  }
}

export const feishuStore = reactive<FeishuState>(new FeishuState())as FeishuState;

export class FeishuStoreHandler extends XpcRendererHandler {
  async onLogin(params: FeishuLoginDetail): Promise<void> {
    feishuStore.loggedIn = true;
    feishuStore.botName = params.botName;
    feishuStore.connecting = false;
    feishuStore.error = null;
  }

  async onLogout(): Promise<void> {
    feishuStore.loggedIn = false;
    feishuStore.botName = '';
  }

  async onError(params: FeishuErrorDetail): Promise<void> {
    feishuStore.error = params.message;
    feishuStore.loggedIn = false;
    feishuStore.connecting = false;
  }
}

new FeishuStoreHandler();
