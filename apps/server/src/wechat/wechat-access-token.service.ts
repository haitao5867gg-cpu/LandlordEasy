import { Injectable, Logger } from '@nestjs/common';

interface AccessTokenResponse {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
}

/**
 * 微信公众号全局接口调用凭据。
 * 与网页授权 token 不同，由 WECHAT_APPID + WECHAT_SECRET 获取并在进程内共享缓存。
 */
@Injectable()
export class WechatAccessTokenService {
  private readonly logger = new Logger(WechatAccessTokenService.name);
  private readonly appId = process.env.WECHAT_APPID || '';
  private readonly appSecret = process.env.WECHAT_SECRET || '';
  private accessToken = '';
  private tokenExpireAt = 0;
  private pendingRequest?: Promise<string>;

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpireAt) {
      return this.accessToken;
    }

    if (!this.pendingRequest) {
      this.pendingRequest = this.fetchAccessToken().finally(() => {
        this.pendingRequest = undefined;
      });
    }

    return this.pendingRequest;
  }

  invalidateAccessToken(): void {
    this.accessToken = '';
    this.tokenExpireAt = 0;
  }

  private async fetchAccessToken(): Promise<string> {
    const url =
      'https://api.weixin.qq.com/cgi-bin/token' +
      `?grant_type=client_credential&appid=${encodeURIComponent(this.appId)}` +
      `&secret=${encodeURIComponent(this.appSecret)}`;
    const response = await fetch(url);
    const data = (await response.json()) as AccessTokenResponse;

    if (!data.access_token) {
      throw new Error(`获取 access_token 失败: ${data.errmsg || JSON.stringify(data)}`);
    }

    const expiresIn = data.expires_in ?? 7200;
    this.accessToken = data.access_token;
    // 提前 5 分钟失效，避免在微信端过期边界继续使用。
    this.tokenExpireAt = Date.now() + Math.max(0, expiresIn - 300) * 1000;
    this.logger.log(`[REAL] access_token 刷新成功,有效期 ${expiresIn}s`);
    return this.accessToken;
  }
}
