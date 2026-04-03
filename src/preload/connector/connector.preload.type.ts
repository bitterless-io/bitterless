export const RIGCHAT_EVENT = {
  QRCODE: 'rigchat:qrcode',
  LOGIN: 'rigchat:login',
  LOGOUT: 'rigchat:logout',
  MESSAGE: 'rigchat:message',
  CONTACT_RESOLVED: 'rigchat:contact-resolved',
  ERROR: 'rigchat:error',
} as const;

export interface RigchatQrcodeDetail {
  qrcodeUrl: string;
}

export interface RigchatLoginDetail {
  nickName: string;
}

export interface RigchatMessageDetail {
  talker: string;
  content: string;
  msg_type: number;
  msg_id: string;
  imagePath?: string;
  chat_id: string;
  is_group: boolean;
  sender_id: string;
  from_user_id: string;
  to_user_id: string;
  sender_display_name: string;
  mention_list: string[];
  is_mention_self: boolean;
  is_send_by_self: boolean;
}

export interface RigchatResolvedContactItem {
  id: string;
  display_name: string;
}

export interface RigchatContactResolvedDetail {
  contacts: RigchatResolvedContactItem[];
}

export interface RigchatOwnerVerifyDetail {
  code: string;
}

export interface RigchatOwnerVerifiedDetail {
  owner_id: string;
  owner_name: string;
}

export interface RigchatErrorDetail {
  message: string;
}

export interface RigchatApi {
  init: () => void;
}
