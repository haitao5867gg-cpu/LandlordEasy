import { Injectable } from '@nestjs/common';
import { IWechatQrcodeService, WechatQrcodeResult } from './wechat-qrcode.interface';

@Injectable()
export class MockWechatQrcodeService implements IWechatQrcodeService {
  async createSceneQrcode(sceneValue: number): Promise<WechatQrcodeResult> {
    return {
      ticket: `mock-ticket-${sceneValue}`,
      qrCodeImage: 'data:image/png;base64,bW9jay1xci1jb2Rl',
    };
  }
}
