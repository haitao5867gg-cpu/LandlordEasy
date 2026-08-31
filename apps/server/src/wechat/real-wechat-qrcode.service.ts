import { BadRequestException, Injectable } from '@nestjs/common';
import { WechatAccessTokenService } from './wechat-access-token.service';
import { IWechatQrcodeService, WechatQrcodeResult } from './wechat-qrcode.interface';

interface QrcodeCreateResponse {
  ticket?: string;
  errcode?: number;
  errmsg?: string;
}

@Injectable()
export class RealWechatQrcodeService implements IWechatQrcodeService {
  constructor(private readonly accessTokenService: WechatAccessTokenService) {}

  async createSceneQrcode(
    sceneValue: number,
    expireSeconds = 2592000,
    retried = false,
  ): Promise<WechatQrcodeResult> {
    if (!Number.isInteger(sceneValue) || sceneValue <= 0 || sceneValue > 0x7fffffff) {
      throw new BadRequestException('sceneValue 必须是 32 位非零正整数');
    }

    const token = await this.accessTokenService.getAccessToken();
    const response = await fetch(
      `https://api.weixin.qq.com/cgi-bin/qrcode/create?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expire_seconds: expireSeconds,
          action_name: 'QR_SCENE',
          action_info: { scene: { scene_id: sceneValue } },
        }),
      },
    );
    const result = (await response.json()) as QrcodeCreateResponse;

    if (!result.ticket) {
      if (!retried && (result.errcode === 40001 || result.errcode === 42001)) {
        this.accessTokenService.invalidateAccessToken();
        return this.createSceneQrcode(sceneValue, expireSeconds, true);
      }
      throw new Error(`创建微信场景二维码失败: ${result.errmsg || JSON.stringify(result)}`);
    }

    const imageResponse = await fetch(
      `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(result.ticket)}`,
    );
    if (!imageResponse.ok) {
      throw new Error(`下载微信二维码失败: HTTP ${imageResponse.status}`);
    }

    const image = Buffer.from(await imageResponse.arrayBuffer()).toString('base64');
    return { ticket: result.ticket, qrCodeImage: `data:image/png;base64,${image}` };
  }
}
