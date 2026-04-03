import type { RigchatConf } from './rigchat.type'

const BASE_CONF = {
  SYNCCHECK_RET_SUCCESS: 0,
  SYNCCHECK_RET_LOGOUT: 1101,
  SYNCCHECK_SELECTOR_NORMAL: 0,
  SYNCCHECK_SELECTOR_MSG: 2,
  MSGTYPE_TEXT: 1,
  MSGTYPE_IMAGE: 3,
  MSGTYPE_VOICE: 34,
  MSGTYPE_VIDEO: 43,
  MSGTYPE_MICROVIDEO: 62,
  MSGTYPE_EMOTICON: 47,
  MSGTYPE_APP: 49,
  MSGTYPE_LOCATION: 48,
  MSGTYPE_STATUSNOTIFY: 51,
  MSGTYPE_SYS: 1e4,
  MSGTYPE_RECALLED: 10002,
  MSGTYPE_POSSIBLEFRIEND_MSG: 40,
  MSGTYPE_VERIFYMSG: 37,
  MSGTYPE_SHARECARD: 42,
  STATE: {
    init: 'init',
    uuid: 'uuid',
    login: 'login',
    logout: 'logout',
  },
}

export const getConf = (host?: string): RigchatConf => {
  host = host || 'wx.qq.com'
  const origin = `https://${host}`
  let loginUrl = 'login.wx.qq.com'
  let fileUrl = 'file.wx.qq.com'
  let pushUrl = 'webpush.weixin.qq.com'

  const matchResult = host.match(/(\w+)(.qq.com|.wechat.com)/)
  if (matchResult && matchResult[1] && matchResult[2]) {
    let prefix = matchResult[1]
    const suffix = matchResult[2]
    if (suffix === '.qq.com') {
      prefix = ['wx', 'wx2', 'wx8'].includes(prefix) ? prefix : 'wx'
    } else {
      prefix = ['web', 'web2'].includes(prefix) ? prefix : 'web'
    }
    loginUrl = `login.${prefix}${suffix}`
    fileUrl = `file.${prefix}${suffix}`
    pushUrl = `webpush.${prefix}${suffix}`
  }

  return {
    ...BASE_CONF,
    origin,
    baseUri: origin + '/cgi-bin/mmwebwx-bin',
    API_jsLogin: `https://${loginUrl}/jslogin?appid=wx782c26e4c19acffb&fun=new&lang=zh-CN&redirect_uri=https://wx.qq.com/cgi-bin/mmwebwx-bin/webwxnewloginpage?mod=desktop`,
    API_login: `https://${loginUrl}/cgi-bin/mmwebwx-bin/login`,
    API_synccheck: `https://${pushUrl}/cgi-bin/mmwebwx-bin/synccheck`,
    API_webwxdownloadmedia: `https://${fileUrl}/cgi-bin/mmwebwx-bin/webwxgetmedia`,
    API_webwxuploadmedia: `https://${fileUrl}/cgi-bin/mmwebwx-bin/webwxuploadmedia`,
    API_webwxinit: origin + '/cgi-bin/mmwebwx-bin/webwxinit',
    API_webwxgetcontact: origin + '/cgi-bin/mmwebwx-bin/webwxgetcontact',
    API_webwxsync: origin + '/cgi-bin/mmwebwx-bin/webwxsync',
    API_webwxbatchgetcontact: origin + '/cgi-bin/mmwebwx-bin/webwxbatchgetcontact',
    API_webwxsendmsg: origin + '/cgi-bin/mmwebwx-bin/webwxsendmsg',
    API_webwxsendmsgimg: origin + '/cgi-bin/mmwebwx-bin/webwxsendmsgimg',
    API_webwxsendvideomsg: origin + '/cgi-bin/mmwebwx-bin/webwxsendvideomsg',
    API_webwxsendemoticon: origin + '/cgi-bin/mmwebwx-bin/webwxsendemoticon',
    API_webwxsendappmsg: origin + '/cgi-bin/mmwebwx-bin/webwxsendappmsg',
    API_webwxstatusnotify: origin + '/cgi-bin/mmwebwx-bin/webwxstatusnotify',
    API_webwxlogout: origin + '/cgi-bin/mmwebwx-bin/webwxlogout',
    API_webwxgetmsgimg: origin + '/cgi-bin/mmwebwx-bin/webwxgetmsgimg',
    API_webwxgetvideo: origin + '/cgi-bin/mmwebwx-bin/webwxgetvideo',
    API_webwxgetvoice: origin + '/cgi-bin/mmwebwx-bin/webwxgetvoice',
    API_webwxgetheadimg: origin + '/cgi-bin/mmwebwx-bin/webwxgetheadimg',
    API_webwxoplog: origin + '/cgi-bin/mmwebwx-bin/webwxoplog',
    API_webwxverifyuser: origin + '/cgi-bin/mmwebwx-bin/webwxverifyuser',
    API_webwxupdatechatroom: origin + '/cgi-bin/mmwebwx-bin/webwxupdatechatroom',
    API_webwxcreatechatroom: origin + '/cgi-bin/mmwebwx-bin/webwxcreatechatroom',
    API_webwxreport: origin + '/cgi-bin/mmwebwx-bin/webwxstatreport',
    API_webwxrevokemsg: origin + '/cgi-bin/mmwebwx-bin/webwxrevokemsg',
  }
}
