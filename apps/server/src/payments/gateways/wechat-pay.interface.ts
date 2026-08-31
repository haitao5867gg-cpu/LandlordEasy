export interface WechatPayParams {
  outTradeNo: string;
  amount: number;
  description: string;
  openid: string;
}

export interface WechatPayOrder {
  appId: string;
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: 'RSA';
  paySign: string;
}

export interface IWechatPayService {
  createOrder(params: WechatPayParams): Promise<WechatPayOrder>;
}

export const WECHAT_PAY_SERVICE = 'WECHAT_PAY_SERVICE';
