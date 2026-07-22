import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { IWechatAuthService, WechatAuthResult } from './wechat-auth.interface';

/**
 * 真实微信授权服务
 * 用 code 调用微信 OAuth2.0 接口换取 openid
 */
@Injectable()
export class RealWechatAuthService implements IWechatAuthService {
  private readonly logger = new Logger(RealWechatAuthService.name);
  private readonly appId: string;
  private readonly appSecret: string;

  constructor() {
    this.appId = process.env.WECHAT_APPID || '';
    this.appSecret = process.env.WECHAT_SECRET || '';
  }

  async getOpenidByCode(code: string): Promise<WechatAuthResult> {
    this.logger.log(`[REAL] 微信授权 code=${code}`);

    if (!this.appId || !this.appSecret) {
      throw new Error('WECHAT_APPID 或 WECHAT_SECRET 未配置');
    }

    const url = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${this.appId}&secret=${this.appSecret}&code=${code}&grant_type=authorization_code`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.errcode) {
      this.logger.error(`微信授权失败: errcode=${data.errcode}, errmsg=${data.errmsg}`);
      throw new UnauthorizedException(`微信授权失败: ${data.errmsg || '未知错误'}`);
    }

    if (!data.openid) {
      throw new UnauthorizedException('微信授权未返回 openid');
    }

    this.logger.log(`[REAL] 授权成功 openid=${data.openid}`);
    return { openid: data.openid, sessionKey: data.session_key };
  }
}
