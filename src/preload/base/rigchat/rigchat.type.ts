export interface RigchatProp {
  uuid: string
  uin: string
  sid: string
  skey: string
  passTicket: string
  formatedSyncKey: string
  webwxDataTicket: string
  syncKey: { List: SyncKeyItem[] }
}

export interface SyncKeyItem {
  Key: number
  Val: number
}

export interface RigchatConf {
  origin: string
  baseUri: string
  API_jsLogin: string
  API_login: string
  API_synccheck: string
  API_webwxdownloadmedia: string
  API_webwxuploadmedia: string
  API_webwxinit: string
  API_webwxgetcontact: string
  API_webwxsync: string
  API_webwxbatchgetcontact: string
  API_webwxsendmsg: string
  API_webwxsendmsgimg: string
  API_webwxsendemoticon: string
  API_webwxsendappmsg: string
  API_webwxsendvideomsg: string
  API_webwxstatusnotify: string
  API_webwxlogout: string
  API_webwxgetmsgimg: string
  API_webwxgetvideo: string
  API_webwxgetvoice: string
  API_webwxgetheadimg: string
  API_webwxoplog: string
  API_webwxverifyuser: string
  API_webwxupdatechatroom: string
  API_webwxcreatechatroom: string
  API_webwxreport: string
  API_webwxrevokemsg: string
  SYNCCHECK_RET_SUCCESS: number
  SYNCCHECK_RET_LOGOUT: number
  SYNCCHECK_SELECTOR_NORMAL: number
  SYNCCHECK_SELECTOR_MSG: number
  MSGTYPE_TEXT: number
  MSGTYPE_IMAGE: number
  MSGTYPE_VOICE: number
  MSGTYPE_VIDEO: number
  MSGTYPE_MICROVIDEO: number
  MSGTYPE_EMOTICON: number
  MSGTYPE_APP: number
  MSGTYPE_LOCATION: number
  MSGTYPE_STATUSNOTIFY: number
  MSGTYPE_SYS: number
  MSGTYPE_RECALLED: number
  MSGTYPE_POSSIBLEFRIEND_MSG: number
  MSGTYPE_VERIFYMSG: number
  MSGTYPE_SHARECARD: number
  STATE: {
    init: string
    uuid: string
    login: string
    logout: string
  }
  [key: string]: unknown
}

export interface RigchatUser {
  UserName: string
  NickName: string
  HeadImgUrl: string
  Sex: number
  Signature: string
  [key: string]: unknown
}

export interface RigchatContact {
  UserName: string
  NickName: string
  RemarkName: string
  HeadImgUrl: string
  Sex: number
  Signature: string
  VerifyFlag: number
  ContactFlag: number
  MemberCount: number
  MemberList: RigchatContact[]
  DisplayName: string
  PYQuanPin: string
  RemarkPYQuanPin: string
  [key: string]: unknown
}

export interface RigchatMessage {
  msg_id: string
  msg_type: number
  content: string
  from_user_name: string
  to_user_name: string
  create_time: number
  status_notify_user_name: string
  status_notify_code: number
  file_name: string
  file_size: string
  media_id: string
  url: string
  app_msg_type: number
  sub_msg_type: number
  original_content: string
  // parsed fields
  is_send_by_self: boolean
  is_group: boolean
  chat_id: string
  from_user_id: string
  to_user_id: string
  sender_id: string
  sender_display_name: string
  to_user_display_name: string
  mention_list: string[]
  is_mention_self: boolean
  [key: string]: unknown
}

export interface RigchatBaseRequest {
  Uin: number
  Sid: string
  Skey: string
  DeviceID: string
}

export interface RigchatSyncData {
  BaseResponse: { Ret: number }
  AddMsgCount: number
  AddMsgList: any[]
  ModContactCount: number
  ModContactList: RigchatContact[]
  SKey: string
  SyncKey: { List: SyncKeyItem[] }
  SyncCheckKey: { List: SyncKeyItem[] }
}

export interface RigchatInitData {
  BaseResponse: { Ret: number }
  User: RigchatUser
  SKey: string
  SyncKey: { List: SyncKeyItem[] }
  SyncCheckKey: { List: SyncKeyItem[] }
  ContactList: RigchatContact[]
}

export interface RigchatResolvedContact {
  id: string
  display_name: string
}

export type RigchatEventMap = {
  uuid: (uuid: string) => void
  'user-avatar': (avatar: string) => void
  login: () => void
  logout: () => void
  message: (msg: RigchatMessage) => void
  'contacts-updated': (contacts: RigchatContact[]) => void
  'contact-resolved': (resolved: RigchatResolvedContact[]) => void
  error: (err: Error) => void
}
