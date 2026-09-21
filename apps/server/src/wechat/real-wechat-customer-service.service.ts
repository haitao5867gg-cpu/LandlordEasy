import { Injectable, Logger } from '@nestjs/common';
import { WechatAccessTokenService } from './wechat-access-token.service';
import {
  IWechatCustomerServiceService,
  WechatNewsArticle,
} from './wechat-customer-service.interface';

interface CustomerMessageResponse {
  errcode?: number;
  errmsg?: string;
}

@Injectable()
export class RealWechatCustomerServiceService implements IWechatCustomerServiceService {
  private readonly logger = new Logger(RealWechatCustomerServiceService.name);

  constructor(private readonly accessTokenService: WechatAccessTokenService) {}

  async sendTextMessage(openid: string, content: string, retried = false): Promise<boolean> {
    const result = await this.post(openid, { msgtype: 'text', text: { content } });
    return this.handleResult(result, 'text', retried, () =>
      this.sendTextMessage(openid, content, true),
    );
  }

  async sendNewsMessage(
    openid: string,
    article: WechatNewsArticle,
    retried = false,
  ): Promise<boolean> {
    const result = await this.post(openid, { msgtype: 'news', news: { articles: [article] } });
    return this.handleResult(result, 'news', retried, () =>
      this.sendNewsMessage(openid, article, true),
    );
  }

  private async post(openid: string, payload: Record<string, unknown>) {
    try {
      const token = await this.accessTokenService.getAccessToken();
      const response = await fetch(
        `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ touser: openid, ...payload }),
        },
      );
      return (await response.json()) as CustomerMessageResponse;
    } catch (error) {
      this.logger.error(`[REAL] 客服消息发送异常:`, error);
      return { errcode: -1, errmsg: 'request failed' } as CustomerMessageResponse;
    }
  }

  private async handleResult(
    result: CustomerMessageResponse,
    kind: string,
    retried: boolean,
    retry: () => Promise<boolean>,
  ): Promise<boolean> {
    if (result.errcode === 0) return true;
    if (!retried && (result.errcode === 40001 || result.errcode === 42001)) {
      this.accessTokenService.invalidateAccessToken();
      return retry();
    }
    this.logger.error(
      `[REAL] 客服消息(${kind})发送失败: errcode=${result.errcode}, errmsg=${result.errmsg}`,
    );
    return false;
  }
}
