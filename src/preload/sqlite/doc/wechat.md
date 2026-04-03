# 微信字段说明文档

## 一、Session (会话/登录状态) 相关类型

### 1. RigchatProp - 登录凭证
保持登录状态的必要信息

| 字段 | 类型 | 说明 |
|---|---|---|
| `uuid` | string | 登录二维码 UUID |
| `uin` | string | 用户 ID |
| `sid` | string | Session ID |
| `skey` | string | Session Key |
| `passTicket` | string | 通行票据 |
| `formatedSyncKey` | string | 格式化的同步键（用于 synccheck） |
| `webwxDataTicket` | string | 数据票据（上传媒体用） |
| `syncKey` | object | 同步键对象 `{ List: SyncKeyItem[] }` |

**SyncKeyItem 结构：**
```typescript
{
  Key: number
  Val: number
}
```

### 2. RigchatUser - 当前登录用户信息

| 字段 | 类型 | 说明 |
|---|---|---|
| `UserName` | string | 用户 ID（@xxx 格式） |
| `NickName` | string | 昵称 |
| `HeadImgUrl` | string | 头像 URL |
| `Sex` | number | 性别（1=男，2=女） |
| `Signature` | string | 个性签名 |

### 3. RigchatContact - 联系人/群信息

| 字段 | 类型 | 说明 |
|---|---|---|
| `UserName` | string | 联系人 ID（@xxx 或 @@xxx） |
| `NickName` | string | 昵称 |
| `RemarkName` | string | 备注名 |
| `HeadImgUrl` | string | 头像 URL |
| `Sex` | number | 性别 |
| `Signature` | string | 签名 |
| `VerifyFlag` | number | 验证标志（公众号等） |
| `ContactFlag` | number | 联系人标志 |
| `MemberCount` | number | 群成员数（群聊） |
| `MemberList` | RigchatContact[] | 群成员列表（群聊） |
| `DisplayName` | string | 群内显示名（群成员） |
| `PYQuanPin` | string | 拼音全拼 |
| `RemarkPYQuanPin` | string | 备注拼音全拼 |

---

## 二、Message (消息) 相关类型

### 1. RigchatMessage - 原始消息对象（Core 层）

#### 微信原始字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `MsgId` | string | 消息 ID |
| `MsgType` | number | 消息类型（文本/图片/语音等） |
| `Content` | string | 消息内容（已解码） |
| `FromUserName` | string | 发送方 ID |
| `ToUserName` | string | 接收方 ID |
| `CreateTime` | number | 创建时间（秒级时间戳） |
| `StatusNotifyUserName` | string | 状态通知用户 |
| `StatusNotifyCode` | number | 状态通知代码 |
| `FileName` | string | 文件名 |
| `FileSize` | string | 文件大小 |
| `MediaId` | string | 媒体 ID |
| `Url` | string | URL |
| `AppMsgType` | number | App 消息类型 |
| `SubMsgType` | number | 子消息类型 |
| `OriginalContent` | string | 原始内容（未解码） |

#### 解析后字段（由 _handleMessages 填充）

| 字段 | 类型 | 说明 |
|---|---|---|
| `isSendBySelf` | boolean | 是否自己发的 |
| `isGroup` | boolean | 是否群消息 |
| `chatId` | string | 会话 ID（私聊=对方ID，群聊=群ID） |
| `senderUserName` | string | 实际发言人 ID（群消息中提取） |
| `senderDisplayName` | string | 发言人显示名（优先 DisplayName > RemarkName > NickName） |
| `mentionList` | string[] | @提及的昵称列表 |
| `isMentionSelf` | boolean | 是否 @了自己 |

### 2. RigchatMessageDetail - 传递给 Renderer 的消息（Preload 层）

| 字段 | 类型 | 说明 |
|---|---|---|
| `talker` | string | 发言人显示名（= senderDisplayName） |
| `content` | string | 消息内容 |
| `msgType` | number | 消息类型 |
| `msgId` | string | 消息 ID |
| `imagePath` | string? | 图片本地路径（图片消息） |
| `chatId` | string | 会话 ID |
| `isGroup` | boolean | 是否群消息 |
| `senderUserName` | string | 发言人 ID |
| `senderDisplayName` | string | 发言人显示名 |
| `mentionList` | string[] | @提及列表 |
| `isMentionSelf` | boolean | 是否 @自己 |
| `isSendBySelf` | boolean | 是否自己发的 |

---

## 三、消息类型常量（MSGTYPE）

| 常量 | 值 | 说明 |
|---|---|---|
| `MSGTYPE_TEXT` | 1 | 文本消息 |
| `MSGTYPE_IMAGE` | 3 | 图片消息 |
| `MSGTYPE_VOICE` | 34 | 语音消息 |
| `MSGTYPE_VIDEO` | 43 | 视频消息 |
| `MSGTYPE_MICROVIDEO` | 62 | 小视频消息 |
| `MSGTYPE_EMOTICON` | 47 | 表情消息 |
| `MSGTYPE_APP` | 49 | 应用消息（文件、链接等） |
| `MSGTYPE_LOCATION` | 48 | 位置消息 |
| `MSGTYPE_STATUSNOTIFY` | 51 | 状态通知 |
| `MSGTYPE_SYS` | 10000 | 系统消息 |
| `MSGTYPE_RECALLED` | 10002 | 撤回消息 |
| `MSGTYPE_POSSIBLEFRIEND_MSG` | 40 | 可能认识的人 |
| `MSGTYPE_VERIFYMSG` | 37 | 好友验证消息 |
| `MSGTYPE_SHARECARD` | 42 | 名片分享 |

---

## 四、关键字段说明

### chatId - 会话唯一标识
- **私聊**: 对方的 `UserName`，格式 `@xxx`
- **群聊**: 群的 `UserName`，格式 `@@xxx` 或 `xxx@chatroom`
- **自己发的消息**: 使用 `ToUserName`
- **别人发的消息**: 使用 `FromUserName`

### 群消息识别规则
群 ID 满足以下任一条件：
- 以 `@@` 开头
- 以 `@chatroom` 结尾

### 群消息 sender 提取逻辑
1. **别人发的群消息**: 
   - `OriginalContent` 格式: `"wxid_xxx:<br/>实际内容"`
   - 从 `:<br/>` 前提取 `senderUserName`
   - 从群成员列表中查找对应成员，获取显示名

2. **自己发的群消息**:
   - 使用正则 `/^(@[a-zA-Z0-9]+|[a-zA-Z0-9_-]+):<br\/>/` 提取
   - 若提取失败，使用 `user.UserName`

### senderDisplayName 优先级
1. `DisplayName` (群内显示名)
2. `RemarkName` (备注名)
3. `NickName` (昵称)
4. `senderUserName` (兜底)

### mentionList - @提及解析
- **分隔符**: `[\u2005\u0020\s]+`
  - `\u2005`: 移动端
  - `\u0020`: PC 端
  - `\s`: Web 端
- **提取逻辑**: 按分隔符分割 `Content`，提取以 `@` 开头的字符串，去掉 `@` 前缀

### isMentionSelf - 是否 @自己
模糊匹配逻辑：
```typescript
mentionList.some((name) => 
  selfNickName.includes(name) || name.includes(selfNickName)
)
```

---

## 五、同步数据结构

### RigchatSyncData - 同步响应

| 字段 | 类型 | 说明 |
|---|---|---|
| `BaseResponse` | object | `{ Ret: number }` 返回码 |
| `AddMsgCount` | number | 新消息数量 |
| `AddMsgList` | RigchatMessage[] | 新消息列表 |
| `ModContactCount` | number | 更新的联系人数量 |
| `ModContactList` | RigchatContact[] | 更新的联系人列表 |
| `SKey` | string | Session Key |
| `SyncKey` | object | 同步键 |
| `SyncCheckKey` | object | 同步检查键 |

### RigchatInitData - 初始化响应

| 字段 | 类型 | 说明 |
|---|---|---|
| `BaseResponse` | object | `{ Ret: number }` 返回码 |
| `User` | RigchatUser | 当前用户信息 |
| `SKey` | string | Session Key |
| `SyncKey` | object | 同步键 |
| `SyncCheckKey` | object | 同步检查键 |
| `ContactList` | RigchatContact[] | 初始联系人列表 |

---

## 六、事件类型

| 事件名 | 参数类型 | 说明 |
|---|---|---|
| `uuid` | string | 获取到登录二维码 UUID |
| `user-avatar` | string | 获取到用户头像 Data URL |
| `login` | void | 登录成功 |
| `logout` | void | 登出 |
| `message` | RigchatMessage | 收到新消息 |
| `contacts-updated` | RigchatContact[] | 联系人更新 |
| `error` | Error | 发生错误 |

---

## 七、状态常量

### 登录状态
- `STATE.init`: 初始化
- `STATE.uuid`: 已获取 UUID
- `STATE.login`: 已登录
- `STATE.logout`: 已登出

### 同步检查返回码
- `SYNCCHECK_RET_SUCCESS`: 0 - 成功
- `SYNCCHECK_RET_LOGOUT`: 1101 - 已登出

### 同步检查选择器
- `SYNCCHECK_SELECTOR_NORMAL`: 0 - 无新消息
- `SYNCCHECK_SELECTOR_MSG`: 2 - 有新消息
