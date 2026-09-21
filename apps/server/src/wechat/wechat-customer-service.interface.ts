export interface WechatNewsArticle {
  title: string;
  description: string;
  url: string;
  picurl: string;
}

export interface IWechatCustomerServiceService {
  sendTextMessage(openid: string, content: string): Promise<boolean>;
  sendNewsMessage(openid: string, article: WechatNewsArticle): Promise<boolean>;
}

export const WECHAT_CUSTOMER_SERVICE = 'WECHAT_CUSTOMER_SERVICE';
