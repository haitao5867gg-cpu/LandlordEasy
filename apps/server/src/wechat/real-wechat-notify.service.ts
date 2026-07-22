import { Injectable, Logger } from '@nestjs/common';
import { IWechatNotifyService, NotifyPayload } from './wechat-notify.interface';

/**
 * 真实模板消息服务
 * 调用微信模板消息 API 发送通知
 * 需要: access_token(通过 AppID+Secret 获取) + template_id
 */
@Injectable()
export class RealWechatNotifyService implements IWechatNotifyService {
  private readonly logger = new Logger(RealWechatNotifyService.name);
  private readonly appId: string;
  private readonly appSecret: string;
  private accessToken = '';
  private tokenExpireAt = 0;

  constructor() {
    this.appId = process.env.WECHAT_APPID || '';
    this.appSecret = process.env.WECHAT_SECRET || '';
  }

  async sendTemplateMessage(payload: NotifyPayload, retried = false): Promise<boolean> {
    this.logger.log(`[REAL] 发送模板消息 -> openid=${payload.openid}, template=${payload.templateId}`);

    try {
      const token = await this.getAccessToken();

      const url = `https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=${token}`;
      const body = {
        touser: payload.openid,
        template_id: payload.templateId,
        data: payload.data,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();

      if (result.errcode === 0) {
        this.logger.log(`[REAL] 模板消息发送成功 msgid=${result.msgid}`);
        return true;
      } else {
        this.logger.error(`[REAL] 模板消息发送失败: errcode=${result.errcode}, errmsg=${result.errmsg}`);
        // access_token 过期重试一次(最多一次)
        if (!retried && (result.errcode === 40001 || result.errcode === 42001)) {
          this.accessToken = '';
          this.tokenExpireAt = 0;
          return this.sendTemplateMessage(payload, true);
        }
        return false;
      }
    } catch (error) {
      this.logger.error(`[REAL] 模板消息发送异常:`, error);
      return false;
    }
  }

  /**
   * 获取 access_token(带缓存,2小时有效期)
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpireAt) {
      return this.accessToken;
    }

    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${this.appId}&secret=${this.appSecret}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.access_token) {
      this.accessToken = data.access_token;
      // 提前 5 分钟过期,避免边界问题
      this.tokenExpireAt = Date.now() + (data.expires_in - 300) * 1000;
      this.logger.log(`[REAL] access_token 刷新成功,有效期 ${data.expires_in}s`);
      return this.accessToken;
    }

    throw new Error(`获取 access_token 失败: ${data.errmsg || JSON.stringify(data)}`);
  }
}
