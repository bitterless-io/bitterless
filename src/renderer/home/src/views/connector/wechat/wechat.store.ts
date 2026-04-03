import { reactive } from 'vue';
import moment from 'moment';
import { XpcRendererHandler, createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { WechatHandler } from '@preload/connector/wechat.handler';
import { settingEmitter } from '@/emitter/setting.emitter';
import type {
  RigchatQrcodeDetail,
  RigchatLoginDetail,
  RigchatMessageDetail,
  RigchatContactResolvedDetail,
  RigchatOwnerVerifiedDetail,
  RigchatErrorDetail,
} from '@preload/connector/connector.preload.type';

const wechatPreloadEmitter = createXpcRendererEmitter<WechatHandler>(
  'WechatHandler'
) as WechatHandler;

class WechatStore {
  drawerVisible = false;
  qrcodeUrl: string | null = null;
  loggedIn = false;
  nickName = '';
  error: string | null = null;
  loggingIn = false;
  loading = false;
  verifyCode = '';
  ownerName = '';
  ownerID = '';

  async init(): Promise<void> {
    console.log('[wechat] initializing connector...');
    try {
      await wechatPreloadEmitter.init();
      const result = await wechatPreloadEmitter.checkLogin();
      if (result) {
        this.loggedIn = result.loggedIn;
        this.nickName = result.nickName;
        if (result.loggedIn) {
          console.log('[wechat] session restored:', result.nickName);
          await wechatPreloadEmitter.startLogin();
        }
      } else {
        this.loggedIn = false;
        this.nickName = '';
        console.log('[wechat] no saved session found');
      }
    } catch (err) {
      console.error('[wechat] init failed:', err);
    }
  }

  async loadOwner(): Promise<void> {
    try {
      const data = await settingEmitter.get<{ owner_id: string; owner_name: string }>({ key: 'WECHAT_OWNER' });
      if (data && data.owner_id && data.owner_name) {
        this.ownerID = data.owner_id;
        this.ownerName = data.owner_name;
      } else {
        this.ownerID = '';
        this.ownerName = '';
      }
    } catch {
      this.ownerID = '';
      this.ownerName = '';
    }
  }

  async openDrawer(): Promise<void> {
    this.drawerVisible = true;
    try {
      const result = await wechatPreloadEmitter.checkLogin();
      if (result) {
        this.loggedIn = result.loggedIn;
        this.nickName = result.nickName;
      } else {
        this.loggedIn = false;
        this.nickName = '';
      }
    } catch (err) {
      console.error('[wechat] openDrawer checkLogin failed:', err);
    }
    await this.loadOwner();
    startVerifyCodePolling();
  }

  closeDrawer(): void {
    this.drawerVisible = false;
    stopVerifyCodePolling();
  }

  async startLoginFlow(): Promise<void> {
    this.error = null;
    this.qrcodeUrl = null;
    this.loggingIn = true;
    try {
      await wechatPreloadEmitter.startLogin();
    } catch (err: any) {
      console.error('[wechat] startLoginFlow failed:', err);
      this.error = err?.message || 'Login failed';
      this.loggingIn = false;
    }
  }
}

export const wechatStore = reactive<WechatStore>(new WechatStore());

let _verifyCodeTimer: ReturnType<typeof setInterval> | null = null;

const stopVerifyCodePolling = (): void => {
  if (_verifyCodeTimer !== null) {
    clearInterval(_verifyCodeTimer);
    _verifyCodeTimer = null;
  }
};

const startVerifyCodePolling = (): void => {
  stopVerifyCodePolling();
  const fetch = (): void => {
    if (!wechatStore.loggedIn) return;
    wechatPreloadEmitter.getVerifyCode()
      .then((code) => { wechatStore.verifyCode = code; })
      .catch(() => {});
  };
  fetch();
  _verifyCodeTimer = setInterval(fetch, 20000);
};

export class WechatStoreHandler extends XpcRendererHandler {
  async onQrcode(params: RigchatQrcodeDetail): Promise<void> {
    wechatStore.qrcodeUrl = params.qrcodeUrl;
    wechatStore.loggedIn = false;
    wechatStore.loggingIn = false;
  }

  async onLogin(params: RigchatLoginDetail): Promise<void> {
    wechatStore.loggedIn = true;
    wechatStore.nickName = params.nickName;
    wechatStore.qrcodeUrl = null;
    wechatStore.loggingIn = false;
  }

  async onLogout(): Promise<void> {
    wechatStore.loggedIn = false;
    wechatStore.nickName = '';
  }

  async onMessage(params: RigchatMessageDetail): Promise<void> {
    const { talker, content, msg_type, msg_id, imagePath } = params;
    const time = moment().format('HH:mm:ss');
    console.log('[WeChat Message]', { time, talker, content, msg_type, msg_id, imagePath });
  }

  async onOwnerVerified(params: RigchatOwnerVerifiedDetail): Promise<void> {
    console.log('onOwnerVerified', params);
    wechatStore.ownerID = params.owner_id;
    wechatStore.ownerName = params.owner_name;
    await wechatStore.loadOwner();
  }

  async onError(params: RigchatErrorDetail): Promise<void> {
    wechatStore.error = params.message;
    wechatStore.loggedIn = false;
    wechatStore.loggingIn = false;
    wechatStore.qrcodeUrl = null;
  }
}

new WechatStoreHandler();
