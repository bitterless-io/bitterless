export interface WechatMessageItem {
  talker: string;
  content: string;
  msg_type: number;
  msg_id: string;
  time: string;
  imagePath?: string;
}
