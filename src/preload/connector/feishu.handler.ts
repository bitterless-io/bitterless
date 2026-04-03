import { XpcPreloadHandler, createXpcPreloadEmitter } from 'electron-xpc/preload';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type { FeishuStoreHandler } from '@renderer/home/src/views/connector/feishu/feishu.store';
import * as lark from '@larksuiteoapi/node-sdk';

const settingEmitter = createXpcPreloadEmitter<SettingDao>('SettingDao') as SettingDao;

const FEISHU_SETTING_KEY = 'FEISHU_CONFIG';

interface FeishuConfig {
  appId: string;
  appSecret: string;
}

const feishuEmitter = createXpcPreloadEmitter<FeishuStoreHandler>('FeishuStoreHandler') as FeishuStoreHandler;

let client: any = null;
let isConnected = false;
let botName = '';

const loadConfig = async (): Promise<FeishuConfig | null> => {
  try {
    const data = await settingEmitter.get<FeishuConfig>({ key: FEISHU_SETTING_KEY });
    if (data && data.appId && data.appSecret) {
      console.log('[feishu] config loaded');
      return data;
    }
    return null;
  } catch {
    console.warn('[feishu] failed to load config');
    return null;
  }
};

const connectBot = async (appId: string, appSecret: string): Promise<void> => {
  try {
    client = new lark.WSClient({
      appId,
      appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
    });

    client.start({
      eventDispatcher: new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data: any) => {
          console.log('[feishu] received message:', data);
        },
      }),
    });

    isConnected = true;
    botName = appId;

    console.log('[feishu] bot connected');
    feishuEmitter.onLogin({ botName }).catch((err) =>
      console.error('[feishu] emit login failed:', err)
    );
  } catch (err: any) {
    console.error('[feishu] connect failed:', err);
    isConnected = false;
    feishuEmitter.onError({ message: err?.message || 'Connection failed' }).catch((e) =>
      console.error('[feishu] emit error failed:', e)
    );
    throw err;
  }
};

const disconnectBot = async (): Promise<void> => {
  if (client) {
    try {
      client = null;
      console.log('[feishu] bot disconnected');
    } catch (err) {
      console.error('[feishu] disconnect error:', err);
    }
  }
  isConnected = false;
  botName = '';
  feishuEmitter.onLogout().catch((err) =>
    console.error('[feishu] emit logout failed:', err)
  );
};

export class FeishuHandler extends XpcPreloadHandler {
  async init(): Promise<void> {
    console.log('[feishu] init called by renderer');
  }

  async checkLogin(): Promise<{ loggedIn: boolean; botName: string } | null> {
    const config = await loadConfig();
    if (!config) {
      console.log('[feishu] checkLogin: no config');
      return null;
    }
    console.log('[feishu] checkLogin:', { loggedIn: isConnected, botName });
    return { loggedIn: isConnected, botName };
  }

  async connect(params: { appId: string; appSecret: string }): Promise<void> {
    console.log('[feishu] connect called');
    await connectBot(params.appId, params.appSecret);
  }

  async disconnect(): Promise<void> {
    console.log('[feishu] disconnect called');
    await disconnectBot();
  }

  async restoreConnection(): Promise<void> {
    const config = await loadConfig();
    if (config && config.appId && config.appSecret) {
      console.log('[feishu] restoring connection');
      await connectBot(config.appId, config.appSecret);
    }
  }
}

export const feishuHandler = new FeishuHandler();
