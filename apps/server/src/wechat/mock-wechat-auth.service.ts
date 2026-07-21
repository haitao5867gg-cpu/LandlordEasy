import { Injectable, Logger } from '@nestjs/common';
import { IWechatAuthService, WechatAuthResult } from './wechat-auth.interface';

/**
 * Mock 微信授权服务
 * 前端带 ?mock_openid=xxx 即视为完成微信授权
 */
@Injectable()
export class MockWechatAuthService implements IWechatAuthService {
  private readonly logger = new Logger(MockWechatAuthService.name);

  async getOpenidByCode(code: string): Promise<WechatAuthResult> {
    // mock 模式下 code 就是 openid
    this.logger.log(`[MOCK] 微信授权 code=${code}, 直接作为 openid 返回`);
    return { openid: code };
  }
}
