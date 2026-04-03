import { EventEmitter } from 'events'
import { getConf } from './rigchat.conf'
import { RigchatRequest } from './rigchat.request'
import type {
  RigchatProp,
  RigchatConf,
  RigchatUser,
  RigchatContact,
  RigchatMessage,
  RigchatBaseRequest,
  RigchatSyncData,
  RigchatInitData,
  RigchatEventMap,
  SyncKeyItem,
} from './rigchat.type'

const getDeviceID = (): string =>
  'e' + ('' + Math.random().toFixed(15)).substring(2, 17)

const convertEmoji = (s: string): string => {
  return s
    ? s.replace(
        /<span.*?class="(qq)?emoji (qq)?emoji([\da-f]*?)".*?<\/span>/g,
        (_a, _b, _c, code) => {
          try {
            if (code.length === 4 || code.length === 5) {
              return String.fromCodePoint(parseInt(code, 16))
            } else if (code.length === 8) {
              return String.fromCodePoint(
                parseInt(code.slice(0, 4), 16),
                parseInt(code.slice(4, 8), 16)
              )
            }
            return '*'
          } catch {
            return '*'
          }
        }
      )
    : ''
}

export class Rigchat extends EventEmitter {
  PROP: RigchatProp
  CONF: RigchatConf
  user: RigchatUser = {} as RigchatUser
  contacts: Record<string, RigchatContact> = {}
  rooms: Record<string, RigchatContact> = {}
  state: string

  private request: RigchatRequest
  private rediUri = ''
  private lastSyncTime = 0
  private syncPollingId = 0
  private syncErrorCount = 0
  private checkPollingId: ReturnType<typeof setTimeout> | null = null
  private retryPollingId: ReturnType<typeof setTimeout> | null = null

  // in-flight batch request dedup: key = "memberId|roomId"
  private _pendingContactFetches: Map<string, Promise<RigchatContact | null>> = new Map()

  constructor() {
    super()
    this.PROP = {
      uuid: '',
      uin: '',
      sid: '',
      skey: '',
      passTicket: '',
      formatedSyncKey: '',
      webwxDataTicket: '',
      syncKey: { List: [] },
    }
    this.CONF = getConf()
    this.state = this.CONF.STATE.init
    this.request = new RigchatRequest()
  }

  // --- typed emit/on helpers ---
  override emit<K extends keyof RigchatEventMap>(
    event: K,
    ...args: Parameters<RigchatEventMap[K]>
  ): boolean {
    return super.emit(event, ...args)
  }

  override on<K extends keyof RigchatEventMap>(
    event: K,
    listener: RigchatEventMap[K]
  ): this {
    return super.on(event, listener)
  }

  // --- session persistence ---

  get botData(): { PROP: RigchatProp; CONF: RigchatConf; COOKIE: Record<string, string>; user: RigchatUser } {
    return {
      PROP: { ...this.PROP },
      CONF: { ...this.CONF },
      COOKIE: this.request.getCookies(),
      user: { ...this.user },
    }
  }

  set botData(data: { PROP?: Partial<RigchatProp>; CONF?: Partial<RigchatConf>; COOKIE?: Record<string, string>; user?: Partial<RigchatUser> }) {
    if (data.PROP) Object.assign(this.PROP, data.PROP)
    if (data.CONF) Object.assign(this.CONF, data.CONF)
    if (data.COOKIE) this.request.setCookies(data.COOKIE)
    if (data.user) Object.assign(this.user, data.user)
  }

  // --- public API ---

  async start(): Promise<void> {
    console.log('[rigchat] starting...')
    try {
      await this._login()
      await this._init(true)
    } catch (err: any) {
      console.error('[rigchat] start error:', err)
      this.emit('error', err)
      this.stop()
    }
  }

  async restart(): Promise<void> {
    console.log('[rigchat] restarting with saved session...')
    try {
      await this._init(true)
    } catch (err: any) {
      console.error('[rigchat] restart with session failed:', err.message)
      console.log('[rigchat] falling back to fresh login...')
      this.emit('error', err)
      await this.start()
    }
  }

  stop(): void {
    console.log('[rigchat] stopping...')
    if (this.retryPollingId) clearTimeout(this.retryPollingId)
    if (this.checkPollingId) clearTimeout(this.checkPollingId)
    this._pendingContactFetches.clear()
    this._logout().catch(() => {})
    this.state = this.CONF.STATE.logout
    this.emit('logout')
  }

  // --- login flow ---

  private async _login(): Promise<void> {
    const uuid = await this._getUUID()
    console.log('[rigchat] got uuid:', uuid)
    this.emit('uuid', uuid)
    this.state = this.CONF.STATE.uuid

    // poll for scan
    let loggedIn = false
    while (!loggedIn) {
      const res = await this._checkLogin()
      if (res.code === 201 && res.userAvatar) {
        this.emit('user-avatar', res.userAvatar)
      }
      if (res.code === 200) {
        loggedIn = true
      }
    }

    await this._doLogin()
  }

  private async _getUUID(): Promise<string> {
    const res = await this.request.exec({
      method: 'POST',
      url: this.CONF.API_jsLogin,
    })
    const body = typeof res.data === 'string' ? res.data : String(res.data)
    const codeMatch = body.match(/code\s*=\s*(\d+)/)
    const uuidMatch = body.match(/uuid\s*=\s*"(.+?)"/)
    if (!codeMatch || codeMatch[1] !== '200' || !uuidMatch) {
      throw new Error('[rigchat] getUUID failed: ' + body)
    }
    this.PROP.uuid = uuidMatch[1]
    return uuidMatch[1]
  }

  private async _checkLogin(): Promise<{
    code: number
    redirect_uri?: string
    userAvatar?: string
  }> {
    const res = await this.request.exec({
      method: 'GET',
      url: this.CONF.API_login,
      params: {
        tip: 0,
        uuid: this.PROP.uuid,
        loginicon: true,
        r: ~new Date(),
      },
    })
    const body = typeof res.data === 'string' ? res.data : String(res.data)
    const codeMatch = body.match(/code\s*=\s*(\d+)/)
    const code = codeMatch ? parseInt(codeMatch[1]) : 0

    if (code === 400) {
      throw new Error('[rigchat] UUID expired')
    }

    const result: { code: number; redirect_uri?: string; userAvatar?: string } =
      { code }

    if (code === 200) {
      const uriMatch = body.match(/redirect_uri\s*=\s*"(.+?)"/)
      if (uriMatch) {
        result.redirect_uri = uriMatch[1]
        this.CONF = getConf(uriMatch[1].match(/(?:\w+\.)+\w+/)?.[0])
        this.rediUri = uriMatch[1]
      }
    } else if (code === 201) {
      const avatarMatch = body.match(/userAvatar\s*=\s*'(.+?)'/)
      if (avatarMatch) {
        result.userAvatar = avatarMatch[1]
      }
    }

    return result
  }

  private async _doLogin(): Promise<void> {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'client-version': '2.0.0',
      referer: 'https://wx.qq.com/?&lang=zh_CN&target=t',
      extspam:
        'Go8FCIkFEokFCggwMDAwMDAwMRAGGvAESySibk50w5Wb3uTl2c2h64jVVrV7gNs06GFlWplHQbY/5FfiO++1yH4ykCyNPWKXmco+wfQzK5R98D3so7rJ5LmGFvBLjGceleySrc3SOf2Pc1gVehzJgODeS0lDL3/I/0S2SSE98YgKleq6Uqx6ndTy9yaL9qFxJL7eiA/R3SEfTaW1SBoSITIu+EEkXff+Pv8NHOk7N57rcGk1w0ZzRrQDkXTOXFN2iHYIzAAZPIOY45Lsh+A4slpgnDiaOvRtlQYCt97nmPLuTipOJ8Qc5pM7ZsOsAPPrCQL7nK0I7aPrFDF0q4ziUUKettzW8MrAaiVfmbD1/VkmLNVqqZVvBCtRblXb5FHmtS8FxnqCzYP4WFvz3T0TcrOqwLX1M/DQvcHaGGw0B0y4bZMs7lVScGBFxMj3vbFi2SRKbKhaitxHfYHAOAa0X7/MSS0RNAjdwoyGHeOepXOKY+h3iHeqCvgOH6LOifdHf/1aaZNwSkGotYnYScW8Yx63LnSwba7+hESrtPa/huRmB9KWvMCKbDThL/nne14hnL277EDCSocPu3rOSYjuB9gKSOdVmWsj9Dxb/iZIe+S6AiG29Esm+/eUacSba0k8wn5HhHg9d4tIcixrxveflc8vi2/wNQGVFNsGO6tB5WF0xf/plngOvQ1/ivGV/C1Qpdhzznh0ExAVJ6dwzNg7qIEBaw+BzTJTUuRcPk92Sn6QDn2Pu3mpONaEumacjW4w6ipPnPw+g2TfywJjeEcpSZaP4Q3YV5HG8D6UjWA4GSkBKculWpdCMadx0usMomsSS/74QgpYqcPkmamB4nVv1JxczYITIqItIKjD35IGKAUwAA==',
    }

    const res = await this.request.exec({
      method: 'GET',
      url: this.rediUri,
      maxRedirects: 0,
      headers,
    })

    const data = typeof res.data === 'string' ? res.data : String(res.data)

    if (res.status === 301 || res.status === 200) {
      const pm = data.match(/<ret>(.*)<\/ret>/)
      if (pm && pm[1] === '0') {
        this.PROP.skey = data.match(/<skey>(.*)<\/skey>/)?.[1] || ''
        this.PROP.sid = data.match(/<wxsid>(.*)<\/wxsid>/)?.[1] || ''
        this.PROP.uin = data.match(/<wxuin>(.*)<\/wxuin>/)?.[1] || ''
        this.PROP.passTicket =
          data.match(/<pass_ticket>(.*)<\/pass_ticket>/)?.[1] || ''
      }
    }

    const setCookie = res.headers['set-cookie']
    if (setCookie) {
      const items = Array.isArray(setCookie) ? setCookie : [setCookie]
      items.forEach((item) => {
        if (/webwx.*?data.*?ticket/i.test(item)) {
          this.PROP.webwxDataTicket = item.match(/=(.*?);/)?.[1] || ''
        }
      })
    }

    if (!this.PROP.skey || !this.PROP.sid) {
      throw new Error('[rigchat] login failed: could not parse credentials')
    }
  }

  // --- init & sync ---

  private async _init(drainMessages = false): Promise<void> {
    const data = await this._webwxInit()
    this._updateContacts(data.ContactList)
    this._notifyMobile().catch((err) => this.emit('error', err))
    this._getContact().catch((err) => this.emit('error', err))

    // consume initial offline messages silently — only on first login
    if (drainMessages) {
      await this._drainInitialMessages()
    }

    this.state = this.CONF.STATE.login
    this.lastSyncTime = Date.now()
    this.emit('login')
    this._syncPolling()
    this._checkPolling()
  }

  private async _drainInitialMessages(): Promise<void> {
    try {
      const checkResult = await this._syncCheck()
      if (+checkResult !== this.CONF.SYNCCHECK_SELECTOR_NORMAL) {
        await this._sync()
      }
    } catch {
      // ignore errors during drain — non-critical
    }
  }

  private async _webwxInit(): Promise<RigchatInitData> {
    const res = await this.request.exec({
      method: 'POST',
      url: this.CONF.API_webwxinit,
      params: {
        pass_ticket: this.PROP.passTicket,
        r: Math.ceil(Date.now() / -1579),
      },
      data: { BaseRequest: this._getBaseRequest() },
    })
    const data = res.data as RigchatInitData
    if (data.BaseResponse.Ret !== 0) {
      throw new Error('[rigchat] webwxinit failed: Ret=' + data.BaseResponse.Ret)
    }
    this.PROP.skey = data.SKey || this.PROP.skey
    this._updateSyncKey(data)
    Object.assign(this.user, data.User)
    return data
  }

  private async _notifyMobile(): Promise<void> {
    await this.request.exec({
      method: 'POST',
      url: this.CONF.API_webwxstatusnotify,
      params: { pass_ticket: this.PROP.passTicket, lang: 'zh_CN' },
      data: {
        BaseRequest: this._getBaseRequest(),
        Code: 3,
        FromUserName: this.user.UserName,
        ToUserName: this.user.UserName,
        ClientMsgId: Date.now(),
      },
    })
  }

  private async _getContact(): Promise<void> {
    let seq = 0
    const allContacts: RigchatContact[] = []
    do {
      const res = await this.request.exec({
        method: 'GET',
        url: this.CONF.API_webwxgetcontact,
        params: { seq, skey: this.PROP.skey, r: +new Date() },
      })
      const data = res.data
      if (data.BaseResponse?.Ret !== 0) break
      if (data.MemberList) allContacts.push(...data.MemberList)
      seq = data.Seq || 0
    } while (seq !== 0)

    this._updateContacts(allContacts)
  }

  // --- sync polling ---

  private _syncPolling(id: number = ++this.syncPollingId): void {
    if (this.state !== this.CONF.STATE.login || this.syncPollingId !== id) return

    this._syncCheck()
      .then((selector) => {
        if (+selector !== this.CONF.SYNCCHECK_SELECTOR_NORMAL) {
          return this._sync().then((data) => {
            this.syncErrorCount = 0
            return this._handleSync(data)
          })
        }
        return
      })
      .then(() => {
        this.lastSyncTime = Date.now()
        this._syncPolling(id)
      })
      .catch((err) => {
        if (this.state !== this.CONF.STATE.login) return
        console.error('[rigchat] sync error:', err.message)
        this.emit('error', err)
        if (++this.syncErrorCount > 2) {
          console.error(
            `[rigchat] ${this.syncErrorCount} consecutive sync failures, restarting in 5s`
          )
          if (this.retryPollingId) clearTimeout(this.retryPollingId)
          this.retryPollingId = setTimeout(() => this._restart(), 5000)
        } else {
          if (this.retryPollingId) clearTimeout(this.retryPollingId)
          this.retryPollingId = setTimeout(
            () => this._syncPolling(id),
            2000 * this.syncErrorCount
          )
        }
      })
  }

  private async _syncCheck(): Promise<string> {
    const res = await this.request.exec({
      method: 'GET',
      url: this.CONF.API_synccheck,
      params: {
        r: +new Date(),
        sid: this.PROP.sid,
        uin: this.PROP.uin,
        skey: this.PROP.skey,
        deviceid: getDeviceID(),
        synckey: this.PROP.formatedSyncKey,
      },
    })
    const body = typeof res.data === 'string' ? res.data : String(res.data)
    const retcodeMatch = body.match(/retcode\s*:\s*"(\d+)"/)
    const selectorMatch = body.match(/selector\s*:\s*"(\d+)"/)
    const retcode = retcodeMatch ? retcodeMatch[1] : '0'
    const selector = selectorMatch ? selectorMatch[1] : '0'

    if (retcode === String(this.CONF.SYNCCHECK_RET_LOGOUT)) {
      this.stop()
      throw new Error('[rigchat] already logged out')
    }
    if (retcode !== '0') {
      throw new Error('[rigchat] syncCheck retcode=' + retcode)
    }
    return selector
  }

  private async _sync(): Promise<RigchatSyncData> {
    const res = await this.request.exec({
      method: 'POST',
      url: this.CONF.API_webwxsync,
      params: {
        sid: this.PROP.sid,
        skey: this.PROP.skey,
        pass_ticket: this.PROP.passTicket,
        lang: 'zh_CN',
      },
      data: {
        BaseRequest: this._getBaseRequest(),
        SyncKey: this.PROP.syncKey,
        rr: ~new Date(),
      },
    })
    const data = res.data as RigchatSyncData
    if (data.BaseResponse.Ret === this.CONF.SYNCCHECK_RET_LOGOUT) {
      this.stop()
      throw new Error('[rigchat] already logged out')
    }
    if (data.BaseResponse.Ret !== 0) {
      throw new Error('[rigchat] sync failed: Ret=' + data.BaseResponse.Ret)
    }
    this._updateSyncKey(data)
    this.PROP.skey = data.SKey || this.PROP.skey
    return data
  }

  private async _handleSync(data: RigchatSyncData): Promise<void> {
    if (!data) {
      this._restart()
      return
    }
    if (data.AddMsgCount) {
      await this._handleMessages(data.AddMsgList)
    }
    if (data.ModContactCount) {
      this._updateContacts(data.ModContactList)
    }
  }

  private _isGroupId(id: string): boolean {
    return /^@@|@chatroom$/.test(id)
  }

  private _normalizeMsg(raw: any): RigchatMessage {
    return {
      msg_id:                   raw.MsgId          || '',
      msg_type:                 raw.MsgType        || 0,
      content:                  raw.Content        || '',
      from_user_name:           raw.FromUserName   || '',
      to_user_name:             raw.ToUserName     || '',
      create_time:              raw.CreateTime     || 0,
      status_notify_user_name:  raw.StatusNotifyUserName || '',
      status_notify_code:       raw.StatusNotifyCode    || 0,
      file_name:                raw.FileName       || '',
      file_size:                raw.FileSize       || '',
      media_id:                 raw.MediaId        || '',
      url:                      raw.Url            || '',
      app_msg_type:             raw.AppMsgType     || 0,
      sub_msg_type:             raw.SubMsgType     || 0,
      original_content:         '',
      is_send_by_self:          false,
      is_group:                 false,
      chat_id:                  '',
      from_user_id:             '',
      to_user_id:               '',
      sender_id:                '',
      sender_display_name:      '',
      to_user_display_name:     '',
      mention_list:             [],
      is_mention_self:          false,
    } as RigchatMessage
  }

  private async _handleMessages(msgList: any[]): Promise<void> {
    for (const raw of msgList) {
      const msg = this._normalizeMsg(raw)

      msg.is_send_by_self =
        msg.from_user_name === this.user.UserName || msg.from_user_name === ''

      msg.from_user_id = msg.from_user_name
      msg.to_user_id = msg.to_user_name

      // group: from_user_name starts with @@ or ends with @chatroom
      msg.is_group = this._isGroupId(msg.from_user_name) || this._isGroupId(msg.to_user_name)
      msg.chat_id = this._isGroupId(msg.from_user_name)
        ? msg.from_user_name
        : this._isGroupId(msg.to_user_name)
          ? msg.to_user_name
          : msg.is_send_by_self ? msg.to_user_name : msg.from_user_name

      // original_content preserves raw content before any decoding
      msg.original_content = msg.content

      if (msg.is_group) {
        // extract sender_id from original_content: format is "wxid_xxx:<br/>content"
        const separatorIdx = (msg.original_content || '').indexOf(':<br/>')
        if (separatorIdx !== -1) {
          msg.sender_id = msg.original_content.substring(0, separatorIdx)
        } else if (msg.is_send_by_self) {
          const selfMatch = (msg.original_content || '').match(/^(@[a-zA-Z0-9]+|[a-zA-Z0-9_-]+):<br\/>/)
          msg.sender_id = selfMatch ? selfMatch[1] : this.user.UserName
        } else {
          msg.sender_id = msg.from_user_name
        }

        // extract actual content: strip "sender_id:<br/>" prefix
        const brSepIdx = (msg.content || '').indexOf(':<br/>')
        if (brSepIdx !== -1) {
          msg.content = msg.content.substring(brSepIdx + 6)
        }

        const groupId = this._isGroupId(msg.from_user_name) ? msg.from_user_name : msg.to_user_name
        msg.sender_display_name = await this._tryGetDisplayName(msg.sender_id, groupId)
        msg.to_user_display_name = await this._tryGetDisplayName(msg.chat_id, '')
      } else {
        msg.sender_id = msg.from_user_name
        msg.sender_display_name = await this._tryGetDisplayName(msg.from_user_name, '')
        msg.to_user_display_name = await this._tryGetDisplayName(msg.to_user_name, '')
      }

      msg.content = (msg.content || '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/<br\/>/g, '\n')
      msg.content = convertEmoji(msg.content)

      // parse @mentions — separators: U+2005 (mobile), U+0020 (PC), \s (web)
      const AT_SEP = /[\u2005\u0020\s]+/
      const mention_list: string[] = (msg.content || '')
        .split(AT_SEP)
        .filter((s) => s.startsWith('@'))
        .map((s) => s.slice(1))
        .filter((s) => s.length > 0)
      msg.mention_list = mention_list

      const selfNickName = this.user.NickName || ''
      msg.is_mention_self = selfNickName.length > 0
        ? mention_list.some((name) => selfNickName.includes(name) || name.includes(selfNickName))
        : false

      this.emit('message', msg)
    }
  }

  // --- contact name resolution ---

  private _getDisplayNameFromCache(id: string, roomId: string): string | null {
    // 1. if id is a group, look up rooms dict directly
    if (this._isGroupId(id)) {
      const room = this.rooms[id]
      if (room) {
        return room.RemarkName || room.NickName || null
      }
      return null
    }
    // 2. check room MemberList for group member lookup
    if (roomId) {
      const room = this.rooms[roomId]
      const member = room?.MemberList?.find((m: any) => m.UserName === id)
      if (member) {
        return member.DisplayName || member.RemarkName || member.NickName || null
      }
    }
    // 3. check contacts dict
    const contact = this.contacts[id]
    if (contact) {
      return contact.RemarkName || contact.NickName || null
    }
    return null
  }

  private async _fetchContactsBatch(items: Array<{ UserName: string; EncryChatRoomId: string }>): Promise<RigchatContact[]> {
    const res = await this.request.exec({
      method: 'POST',
      url: this.CONF.API_webwxbatchgetcontact,
      params: {
        pass_ticket: this.PROP.passTicket,
        type: 'ex',
        r: +new Date(),
        lang: 'zh_CN',
      },
      data: {
        BaseRequest: this._getBaseRequest(),
        Count: items.length,
        List: items,
      },
    })
    const data = res.data as { ContactList?: RigchatContact[] }
    return data.ContactList || []
  }

  private async _tryGetDisplayName(id: string, roomId: string): Promise<string> {
    if (!id) return id
    // self
    if (id === this.user.UserName) {
      return this.user.NickName || id
    }

    // 1. try cache first
    const cached = this._getDisplayNameFromCache(id, roomId)
    if (cached) return cached

    // 2. fetch via batchGetContact — dedup in-flight requests per id+roomId
    const key = `${id}|${roomId}`
    let pending = this._pendingContactFetches.get(key)
    if (!pending) {
      pending = this._fetchContactsBatch([{ UserName: id, EncryChatRoomId: roomId }])
        .then((contacts) => {
          if (contacts.length > 0) {
            this._updateContacts(contacts)
            return contacts[0]
          }
          return null
        })
        .catch((err: Error) => {
          console.error('[rigchat] _tryGetDisplayName fetch error:', err.message)
          return null
        })
        .finally(() => {
          this._pendingContactFetches.delete(key)
        })
      this._pendingContactFetches.set(key, pending)
    }

    const contact = await pending
    if (contact) {
      return contact.RemarkName || contact.NickName || contact.DisplayName || id
    }
    return id
  }

  // --- heartbeat ---

  private _checkPolling(): void {
    if (this.state !== this.CONF.STATE.login) return
    const interval = Date.now() - this.lastSyncTime
    if (interval > 60000) {
      console.error(
        `[rigchat] sync timeout ${(interval / 1000).toFixed(0)}s, restarting in 5s`
      )
      if (this.checkPollingId) clearTimeout(this.checkPollingId)
      setTimeout(() => this._restart(), 5000)
    } else {
      this._notifyMobile().catch((err) => this.emit('error', err))
      if (this.checkPollingId) clearTimeout(this.checkPollingId)
      this.checkPollingId = setTimeout(() => this._checkPolling(), 5 * 60 * 1000)
    }
  }

  private async _restart(): Promise<void> {
    console.log('[rigchat] restarting...')
    try {
      await this._init(false)
    } catch (err: any) {
      console.error('[rigchat] restart failed:', err.message)
      this.emit('error', err)
      this.stop()
    }
  }

  private async _logout(): Promise<void> {
    try {
      await this.request.exec({
        method: 'POST',
        url: this.CONF.API_webwxlogout,
        params: {
          redirect: 1,
          type: 0,
          skey: this.PROP.skey,
          lang: 'zh_CN',
        },
      })
    } catch {
      // ignore logout errors
    }
  }

  // --- contacts ---

  private _updateContacts(contacts: RigchatContact[]): void {
    if (!contacts || contacts.length === 0) return
    for (const contact of contacts) {
      contact.NickName = convertEmoji(contact.NickName || '')
      contact.RemarkName = convertEmoji(contact.RemarkName || '')
      contact.DisplayName = convertEmoji(contact.DisplayName || '')
      if (this._isGroupId(contact.UserName)) {
        this.rooms[contact.UserName] = contact
      } else {
        this.contacts[contact.UserName] = contact
      }
    }
    this.emit('contacts-updated', contacts)
  }

  // --- sync key ---

  private _updateSyncKey(
    data: Pick<RigchatSyncData, 'SyncKey' | 'SyncCheckKey'>
  ): void {
    if (data.SyncKey) {
      this.PROP.syncKey = data.SyncKey
    }
    const keyList: SyncKeyItem[] =
      data.SyncCheckKey?.List || data.SyncKey?.List || []
    if (keyList.length > 0) {
      this.PROP.formatedSyncKey = keyList
        .map((e) => e.Key + '_' + e.Val)
        .join('|')
    }
  }

  // --- image ---

  async getMsgImg(msgId: string): Promise<{ data: Buffer; type: string }> {
    const res = await this.request.exec({
      method: 'GET',
      url: this.CONF.API_webwxgetmsgimg,
      params: {
        MsgID: msgId,
        skey: this.PROP.skey,
        type: 'big',
      },
      responseType: 'arraybuffer',
    })
    return {
      data: res.data as Buffer,
      type: (res.headers['content-type'] as string) || 'image/jpeg',
    }
  }

  // --- helpers ---

  private _getBaseRequest(): RigchatBaseRequest {
    return {
      Uin: parseInt(this.PROP.uin),
      Sid: this.PROP.sid,
      Skey: this.PROP.skey,
      DeviceID: getDeviceID(),
    }
  }
}
