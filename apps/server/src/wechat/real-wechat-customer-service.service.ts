import { Injectable, Logger } from '@nestjs/common';
import { WechatAccessTokenService } from './wechat-access-token.service';
import { IWechatCustomerServiceService } from './wechat-customer-service.interface';

interface CustomerMessageResponse {
  errcode?: number;
  errmsg?: string;
}

@Injectable()
export class RealWechatCustomerServiceService implements IWechatCustomerServiceService {
  private readonly logger = new Logger(RealWechatCustomerServiceService.name);

  constructor(private readonly accessTokenService: WechatAccessTokenService) {}

  async sendTextMessage(openid: string, content: string, retried = false): Promise<boolean> {
    try {
      const token = await this.accessTokenService.getAccessToken();
      const response = await fetch(
        `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            touser: openid,
            msgtype: 'text',
            text: { content },
          }),
        },
      );
      const result = (await response.json()) as CustomerMessageResponse;

      if (result.errcode === 0) return true;

      if (!retried && (result.errcode === 40001 || result.errcode === 42001)) {
        this.accessTokenService.invalidateAccessToken();
        return this.sendTextMessage(openid, content, true);
      }

      this.logger.error(
        `[REAL] 客服消息发送失败: errcode=${result.errcode}, errmsg=${result.errmsg}`,
      );
      return false;
    } catch (error) {
      this.logger.error('[REAL] 客服消息发送异常:', error);
      return false;
    }
  }
}
