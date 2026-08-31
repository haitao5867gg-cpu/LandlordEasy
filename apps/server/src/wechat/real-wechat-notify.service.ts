import { Injectable, Logger } from '@nestjs/common';
import { WechatAccessTokenService } from './wechat-access-token.service';
import { IWechatNotifyService, NotifyPayload } from './wechat-notify.interface';

interface TemplateMessageResponse {
  errcode?: number;
  errmsg?: string;
  msgid?: number;
}

/**
 * 真实模板消息服务
 * 调用微信模板消息 API 发送通知
 * 需要: access_token(通过 AppID+Secret 获取) + template_id
 */
@Injectable()
export class RealWechatNotifyService implements IWechatNotifyService {
  private readonly logger = new Logger(RealWechatNotifyService.name);

  constructor(private readonly accessTokenService: WechatAccessTokenService) {}

  async sendTemplateMessage(payload: NotifyPayload, retried = false): Promise<boolean> {
    this.logger.log('[REAL] 开始发送模板消息');

    try {
      const token = await this.accessTokenService.getAccessToken();
      const url = `https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=${encodeURIComponent(token)}`;
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
      const result = (await response.json()) as TemplateMessageResponse;

      if (result.errcode === 0) {
        this.logger.log(`[REAL] 模板消息发送成功 msgid=${result.msgid}`);
        return true;
      }

      this.logger.error(
        `[REAL] 模板消息发送失败: errcode=${result.errcode}, errmsg=${result.errmsg}`,
      );
      if (!retried && (result.errcode === 40001 || result.errcode === 42001)) {
        this.accessTokenService.invalidateAccessToken();
        return this.sendTemplateMessage(payload, true);
      }
      return false;
    } catch (error) {
      this.logger.error('[REAL] 模板消息发送异常:', error);
      return false;
    }
  }
}
