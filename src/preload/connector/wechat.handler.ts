import { ipcRenderer } from 'electron';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { XpcPreloadHandler, createXpcPreloadEmitter } from 'electron-xpc/preload';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import { Rigchat } from '@preload/base/rigchat';
import type { WechatStoreHandler } from '@renderer/home/src/views/connector/wechat/wechat.store';
import type { RigchatOwnerVerifiedDetail } from '@preload/connector/connector.preload.type';

const settingEmitter = createXpcPreloadEmitter<SettingDao>('SettingDao') as SettingDao;

const RIGCHAT_SETTING_KEY = 'RIGCHAT';
const OWNER_SETTING_KEY = 'WECHAT_OWNER';

interface RigchatSettingValue {
  session: any;
}

const wechatEmitter = createXpcPreloadEmitter<WechatStoreHandler>('WechatStoreHandler') as WechatStoreHandler;

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

let rigchatPath = '';
let imagesPath = '';

let owner_id = '';
let owner_name = '';
let verifyCode = '';

const generateVerifyCode = (): string => {
  return String(Math.floor(100000 + Math.random() * 900000));
};

const loadOwner = async (): Promise<void> => {
  try {
    const data = await settingEmitter.get<RigchatOwnerVerifiedDetail>({ key: OWNER_SETTING_KEY });
    if (data && data.owner_id && data.owner_name) {
      owner_id = data.owner_id;
      owner_name = data.owner_name;
      console.log('[wechat] owner loaded:', owner_name, owner_id);
    }
  } catch {
    console.warn('[wechat] failed to load owner, starting without owner');
  }
};

const getRigchatPath = async (): Promise<string> => {
  if (!rigchatPath) {
    rigchatPath = await ipcRenderer.invoke('rigchat:get-path');
  }
  return rigchatPath;
};

const getImagesPath = async (): Promise<string> => {
  if (!imagesPath) {
    imagesPath = await ipcRenderer.invoke('rigchat:get-images-path');
  }
  return imagesPath;
};

const saveSession = async (): Promise<void> => {
  const value: RigchatSettingValue = {
    session: bot.botData,
  };
  await settingEmitter.upsert({ key: RIGCHAT_SETTING_KEY, value });
  console.log('[wechat] session saved to database');
};

const loadSession = async (): Promise<any | null> => {
  try {
    const data = await settingEmitter.get<RigchatSettingValue>({ key: RIGCHAT_SETTING_KEY });
    if (!data || !data.session) return null;
    console.log('[wechat] session loaded from database');
    return data.session;
  } catch {
    console.warn('[wechat] failed to load session from database, starting fresh');
    return null;
  }
};

const deleteSession = async (): Promise<void> => {
  await settingEmitter.upsert({ key: RIGCHAT_SETTING_KEY, value: { session: null } });
  console.log('[wechat] session deleted from database');
};

const saveImage = async (msgId: string, data: Buffer, contentType: string): Promise<string> => {
  const dir = await getImagesPath();
  const ext = MIME_EXT[contentType] || '.jpg';
  const filename = `${msgId}${ext}`;
  const filePath = join(dir, filename);
  await writeFile(filePath, Buffer.from(data));
  return filePath;
};

export const bot = new Rigchat();

bot.on('uuid', (uuid) => {
  const qrcodeUrl = `https://login.weixin.qq.com/qrcode/${uuid}`;
  console.log('[wechat] scan qrcode:', qrcodeUrl);
  wechatEmitter.onQrcode({ qrcodeUrl }).catch((err) => console.error('[wechat] emit qrcode failed:', err));
});

bot.on('login', () => {
  const nickName = bot.user.NickName || '';
  console.log('[wechat] logged in:', nickName);
  wechatEmitter.onLogin({ nickName }).catch((err) => console.error('[wechat] emit login failed:', err));
  saveSession().catch((err) => console.error('[wechat] save session failed:', err.message));
});

bot.on('logout', () => {
  console.log('[wechat] logged out');
  wechatEmitter.onLogout({}).catch((err) => console.error('[wechat] emit logout failed:', err));
  deleteSession().catch((err) => console.error('[wechat] delete session failed:', err.message));
  verifyCode = '';
});

bot.on('message', (msg) => {
  console.log('完整消息', msg);
  const isImage = msg.msg_type === bot.CONF.MSGTYPE_IMAGE || msg.msg_type === bot.CONF.MSGTYPE_EMOTICON;

  console.log(`[wechat] message from ${msg.sender_display_name} (${msg.is_group ? 'group' : 'private'} ${msg.chat_id}): ${isImage ? '[image]' : msg.content}`);

  // owner verify: private message whose trimmed content matches current verifyCode
  if (!msg.is_group && !msg.is_send_by_self && verifyCode && msg.content.trim() === verifyCode) {
    owner_id = msg.sender_id;
    owner_name = msg.sender_display_name;
    console.log('[wechat] owner verified:', owner_name, owner_id);
    settingEmitter.upsert({ key: OWNER_SETTING_KEY, value: { owner_id, owner_name } })
      .catch((err) => console.error('[wechat] save owner failed:', err.message));
    wechatEmitter.onOwnerVerified({ owner_id, owner_name })
      .catch((err) => console.error('[wechat] emit owner verified failed:', err));
    return;
  }

  const baseDetail = {
    talker: msg.sender_display_name,
    content: msg.content,
    msg_type: msg.msg_type,
    msg_id: msg.msg_id,
    chat_id: msg.chat_id,
    is_group: msg.is_group,
    sender_id: msg.sender_id,
    from_user_id: msg.from_user_id,
    to_user_id: msg.to_user_id,
    sender_display_name: msg.sender_display_name,
    mention_list: msg.mention_list,
    is_mention_self: msg.is_mention_self,
    is_send_by_self: msg.is_send_by_self,
  };

  wechatEmitter.onMessage(baseDetail).catch((err) => console.error('[wechat] emit message failed:', err));

  if (isImage) {
    bot.getMsgImg(msg.msg_id)
      .then((img) => saveImage(msg.msg_id, img.data, img.type))
      .then((filePath) => {
        wechatEmitter.onMessage({
          ...baseDetail,
          content: filePath,
          imagePath: filePath,
        }).catch((err) => console.error('[wechat] emit message with image failed:', err));
      })
      .catch((err) => console.error('[wechat] download image failed:', err.message));
  }
});

bot.on('error', (err) => {
  console.error('[wechat] error:', err.message);
  wechatEmitter.onError({ message: err.message }).catch((e) => console.error('[wechat] emit error failed:', e));
});

let isInitialized = false;

const startLogin = async (): Promise<void> => {
  console.log('[wechat] starting login flow');
  await bot.start();
};

const restoreSession = async (): Promise<void> => {
  const sessionData = await loadSession();
  if (sessionData && sessionData.PROP?.uin) {
    console.log('[wechat] restoring session');
    bot.botData = sessionData;
    await bot.restart();
  }
};

export class WechatHandler extends XpcPreloadHandler {
  async init(): Promise<void> {
    console.log('[wechat] init called by renderer');
    if (!isInitialized) {
      isInitialized = true;
      console.log('[wechat] initialized, waiting for login request');
    }
  }

  async checkLogin(): Promise<{ loggedIn: boolean; nickName: string } | null> {
    const sessionData = await loadSession();
    if (!sessionData) {
      console.log('[wechat] checkLogin: no session data');
      return null;
    }
    const loggedIn = !!(sessionData.PROP?.uin);
    const nickName = sessionData?.User?.NickName || '';
    console.log('[wechat] checkLogin:', { loggedIn, nickName });
    return { loggedIn, nickName };
  }

  async startLogin(): Promise<void> {
    console.log('[wechat] startLogin called');
    await loadOwner();
    const sessionData = await loadSession();
    if (sessionData && sessionData.PROP?.uin) {
      await restoreSession();
    } else {
      await startLogin();
    }
  }

  async getVerifyCode(): Promise<string> {
    verifyCode = generateVerifyCode();
    return verifyCode;
  }

}

export const wechatHandler = new WechatHandler();
