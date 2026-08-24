export const RIGCHAT_EVENT = {
  QRCODE: 'rigchat:qrcode',
  LOGIN: 'rigchat:login',
  LOGOUT: 'rigchat:logout',
  MESSAGE: 'rigchat:message',
  CONTACT_RESOLVED: 'rigchat:contact-resolved',
  ERROR: 'rigchat:error',
} as const

export interface RigchatQrcodeDetail {
  qrcodeUrl: string
}

export interface RigchatLoginDetail {
  nickName: string
}

export interface RigchatMessageDetail {
  talker: string
  content: string
  msg_type: number
  msg_id: string
  imagePath?: string
  chat_id: string
  is_group: boolean
  sender_id: string
  from_user_id: string
  to_user_id: string
  sender_display_name: string
  mention_list: string[]
  is_mention_self: boolean
  is_send_by_self: boolean
}

export interface RigchatResolvedContactItem {
  id: string
  display_name: string
}

export interface RigchatContactResolvedDetail {
  contacts: RigchatResolvedContactItem[]
}

export interface RigchatOwnerVerifyDetail {
  code: string
}

export interface RigchatOwnerVerifiedDetail {
  owner_id: string
  owner_name: string
}

export interface RigchatErrorDetail {
  message: string
}

export interface RigchatApi {
  init(): void
}

export interface WechatConnectorRuntimeApi {
  init(): Promise<void>
  checkLogin(): Promise<{ loggedIn: boolean; nickName: string } | null>
  startLogin(): Promise<void>
  getVerifyCode(): Promise<string>
}

export interface WechatConnectorRendererApi {
  onQrcode(params: RigchatQrcodeDetail): Promise<void>
  onLogin(params: RigchatLoginDetail): Promise<void>
  onLogout(params?: Record<string, never>): Promise<void>
  onMessage(params: RigchatMessageDetail): Promise<void>
  onOwnerVerified(params: RigchatOwnerVerifiedDetail): Promise<void>
  onError(params: RigchatErrorDetail): Promise<void>
}

export interface DingtalkConnectorRuntimeApi {
  init(): Promise<void>
  checkLogin(): Promise<{ loggedIn: boolean; botName: string } | null>
  connect(params: { clientId: string; clientSecret: string }): Promise<void>
  disconnect(): Promise<void>
  restoreConnection(): Promise<void>
}

export interface DingtalkConnectorRendererApi {
  onLogin(params: { botName: string }): Promise<void>
  onLogout(): Promise<void>
  onMessage(params: {
    senderId: string
    senderNick: string
    text: string
    conversationId: string
    msgId: string
    createAt: number
  }): Promise<void>
  onError(params: { message: string }): Promise<void>
}

export interface FeishuConnectorRuntimeApi {
  init(): Promise<void>
  checkLogin(): Promise<{ loggedIn: boolean; botName: string } | null>
  connect(params: { appId: string; appSecret: string }): Promise<void>
  disconnect(): Promise<void>
  restoreConnection(): Promise<void>
}

export interface FeishuConnectorRendererApi {
  onLogin(params: { botName: string }): Promise<void>
  onLogout(): Promise<void>
  onError(params: { message: string }): Promise<void>
}
