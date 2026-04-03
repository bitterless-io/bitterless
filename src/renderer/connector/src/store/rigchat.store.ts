import { reactive } from 'vue'
import moment from 'moment'
import {
  RIGCHAT_EVENT,
  type RigchatQrcodeDetail,
  type RigchatLoginDetail,
  type RigchatMessageDetail,
  type RigchatErrorDetail,
} from '../../../../preload/connector/connector.preload.type'
import type { RigchatMessageItem } from './rigchat.store.type'

class RigchatStore {
  qrcodeUrl: string | null = null
  loggedIn = false
  nickName = ''
  messages: RigchatMessageItem[] = []
  error: string | null = null
}

export const rigchatStore = reactive<RigchatStore>(new RigchatStore())

window.addEventListener(RIGCHAT_EVENT.QRCODE, ((e: CustomEvent<RigchatQrcodeDetail>) => {
  rigchatStore.qrcodeUrl = e.detail.qrcodeUrl
  rigchatStore.loggedIn = false
}) as EventListener)

window.addEventListener(RIGCHAT_EVENT.LOGIN, ((e: CustomEvent<RigchatLoginDetail>) => {
  rigchatStore.loggedIn = true
  rigchatStore.nickName = e.detail.nickName
  rigchatStore.qrcodeUrl = null
}) as EventListener)

window.addEventListener(RIGCHAT_EVENT.LOGOUT, (() => {
  rigchatStore.loggedIn = false
  rigchatStore.nickName = ''
}) as EventListener)

window.addEventListener(RIGCHAT_EVENT.MESSAGE, ((e: CustomEvent<RigchatMessageDetail>) => {
  const { talker, content, msg_type, msg_id, imagePath } = e.detail

  if (imagePath) {
    const existing = rigchatStore.messages.find((m) => m.msg_id === msg_id)
    if (existing) {
      existing.imagePath = imagePath
      existing.content = ''
      return
    }
  }

  rigchatStore.messages.unshift({
    talker,
    content,
    msg_type,
    msg_id,
    time: moment().format('HH:mm:ss'),
    imagePath,
  })
  if (rigchatStore.messages.length > 200) {
    rigchatStore.messages.length = 200
  }
}) as EventListener)

window.addEventListener(RIGCHAT_EVENT.ERROR, ((e: CustomEvent<RigchatErrorDetail>) => {
  rigchatStore.error = e.detail.message
}) as EventListener)

window.rigchatApi?.init()
