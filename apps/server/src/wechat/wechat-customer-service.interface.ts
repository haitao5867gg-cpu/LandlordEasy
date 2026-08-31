export interface IWechatCustomerServiceService {
  sendTextMessage(openid: string, content: string): Promise<boolean>;
}

export const WECHAT_CUSTOMER_SERVICE = 'WECHAT_CUSTOMER_SERVICE';
