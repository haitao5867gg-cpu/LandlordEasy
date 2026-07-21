import { Injectable, Logger } from '@nestjs/common';
import { IWechatAuthService, WechatAuthResult } from './wechat-auth.interface';

/**
 * 真实微信授权服务(阶段二实现)
 * TODO: 接入真实微信 OAuth2.0
 */
@Injectable()
export class RealWechatAuthService implements IWechatAuthService {
  private readonly logger = new Logger(RealWechatAuthService.name);

  async getOpenidByCode(code: string): Promise<WechatAuthResult> {
    this.logger.log(`[REAL] 微信授权 code=${code}`);
    // TODO: 调用微信 API 换取 openid
    // const url = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${appid}&secret=${secret}&code=${code}&grant_type=authorization_code`;
    throw new Error('真实微信授权尚未实现,请设置 WECHAT_MODE=mock');
  }
}
