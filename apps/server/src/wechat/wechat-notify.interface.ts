export interface NotifyPayload {
  openid: string;
  templateId: string;
  data: Record<string, { value: string }>;
}

export interface IWechatNotifyService {
  sendTemplateMessage(payload: NotifyPayload): Promise<boolean>;
}

export const WECHAT_NOTIFY_SERVICE = 'WECHAT_NOTIFY_SERVICE';
