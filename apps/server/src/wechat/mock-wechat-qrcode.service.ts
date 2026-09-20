import { Injectable } from '@nestjs/common';
import { IWechatQrcodeService, WechatQrcodeResult } from './wechat-qrcode.interface';

// 1x1 transparent PNG used as a valid placeholder in mock mode.
const MOCK_QR_CODE_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

@Injectable()
export class MockWechatQrcodeService implements IWechatQrcodeService {
  async createSceneQrcode(sceneValue: number): Promise<WechatQrcodeResult> {
    return {
      ticket: `mock-ticket-${sceneValue}`,
      qrCodeImage: MOCK_QR_CODE_IMAGE,
    };
  }
}
