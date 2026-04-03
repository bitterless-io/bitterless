import { XpcPreloadHandler, createXpcPreloadEmitter } from 'electron-xpc/preload';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type { DingtalkStoreHandler } from '@renderer/home/src/views/connector/dingtalk/dingtalk.store';
import { DWClient } from 'dingtalk-stream';

const settingEmitter = createXpcPreloadEmitter<SettingDao>('SettingDao') as SettingDao;

const DINGTALK_SETTING_KEY = 'DINGTALK_CONFIG';

interface DingtalkConfig {
  clientId: string;
  clientSecret: string;
}

const dingtalkEmitter = createXpcPreloadEmitter<DingtalkStoreHandler>('DingtalkStoreHandler') as DingtalkStoreHandler;

let client: any = null;
let isConnected = false;
let botName = '';

const loadConfig = async (): Promise<DingtalkConfig | null> => {
  try {
    const data = await settingEmitter.get<DingtalkConfig>({ key: DINGTALK_SETTING_KEY });
    if (data && data.clientId && data.clientSecret) {
      console.log('[dingtalk] config loaded');
      return data;
    }
    return null;
  } catch {
    console.warn('[dingtalk] failed to load config');
    return null;
  }
};

const connectBot = async (clientId: string, clientSecret: string): Promise<void> => {
  try {
    client = new DWClient({
      clientId,
      clientSecret,
      subscriptions: [
        {
          type: 'CALLBACK',
          topic: '*',
        },
      ],
    });

    client.registerCallbackListener({
      async onReceive(res: any) {
        const { headers, data } = res;
        console.log('[dingtalk] received callback:', { headers, data });

        if (data.conversationType === '1') {
          const messageData = {
            senderId: data.senderId,
            senderNick: data.senderNick,
            text: data.text?.content || '',
            conversationId: data.conversationId,
            msgId: data.msgId,
            createAt: data.createAt,
          };

          dingtalkEmitter.onMessage(messageData).catch((err) =>
            console.error('[dingtalk] emit message failed:', err)
          );
        }

        return { status: 200, message: 'OK' };
      },
    });

    await client.connect();
    isConnected = true;
    botName = clientId;

    console.log('[dingtalk] bot connected');
    dingtalkEmitter.onLogin({ botName }).catch((err) =>
      console.error('[dingtalk] emit login failed:', err)
    );
  } catch (err: any) {
    console.error('[dingtalk] connect failed:', err);
    isConnected = false;
    dingtalkEmitter.onError({ message: err?.message || 'Connection failed' }).catch((e) =>
      console.error('[dingtalk] emit error failed:', e)
    );
    throw err;
  }
};

const disconnectBot = async (): Promise<void> => {
  if (client) {
    try {
      await client.disconnect();
      console.log('[dingtalk] bot disconnected');
    } catch (err) {
      console.error('[dingtalk] disconnect error:', err);
    }
    client = null;
  }
  isConnected = false;
  botName = '';
  dingtalkEmitter.onLogout().catch((err) =>
    console.error('[dingtalk] emit logout failed:', err)
  );
};

export class DingtalkHandler extends XpcPreloadHandler {
  async init(): Promise<void> {
    console.log('[dingtalk] init called by renderer');
  }

  async checkLogin(): Promise<{ loggedIn: boolean; botName: string } | null> {
    const config = await loadConfig();
    if (!config) {
      console.log('[dingtalk] checkLogin: no config');
      return null;
    }
    console.log('[dingtalk] checkLogin:', { loggedIn: isConnected, botName });
    return { loggedIn: isConnected, botName };
  }

  async connect(params: { clientId: string; clientSecret: string }): Promise<void> {
    console.log('[dingtalk] connect called');
    await connectBot(params.clientId, params.clientSecret);
  }

  async disconnect(): Promise<void> {
    console.log('[dingtalk] disconnect called');
    await disconnectBot();
  }

  async restoreConnection(): Promise<void> {
    const config = await loadConfig();
    if (config && config.clientId && config.clientSecret) {
      console.log('[dingtalk] restoring connection');
      await connectBot(config.clientId, config.clientSecret);
    }
  }
}

export const dingtalkHandler = new DingtalkHandler();
