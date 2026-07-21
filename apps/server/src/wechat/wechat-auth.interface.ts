export interface WechatAuthResult {
  openid: string;
  sessionKey?: string;
}

export interface IWechatAuthService {
  getOpenidByCode(code: string): Promise<WechatAuthResult>;
}

export const WECHAT_AUTH_SERVICE = 'WECHAT_AUTH_SERVICE';
