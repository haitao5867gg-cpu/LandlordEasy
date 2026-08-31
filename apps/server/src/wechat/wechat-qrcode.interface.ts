export interface WechatQrcodeResult {
  ticket: string;
  qrCodeImage: string;
}

export interface IWechatQrcodeService {
  createSceneQrcode(sceneValue: number, expireSeconds?: number): Promise<WechatQrcodeResult>;
}

export const WECHAT_QRCODE_SERVICE = 'WECHAT_QRCODE_SERVICE';
