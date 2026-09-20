export interface NotifyPayload {
  openid: string;
  templateId: string;
  data: Record<string, { value: string }>;
  /** 模板消息点击跳转URL(微信模板发送接口的顶层url字段);不填则无跳转 */
  url?: string;
}

export interface IWechatNotifyService {
  sendTemplateMessage(payload: NotifyPayload): Promise<boolean>;
}

export const WECHAT_NOTIFY_SERVICE = 'WECHAT_NOTIFY_SERVICE';
