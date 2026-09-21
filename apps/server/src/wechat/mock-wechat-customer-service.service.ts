import { Injectable, Logger } from '@nestjs/common';
import {
  IWechatCustomerServiceService,
  WechatNewsArticle,
} from './wechat-customer-service.interface';

@Injectable()
export class MockWechatCustomerServiceService implements IWechatCustomerServiceService {
  private readonly logger = new Logger(MockWechatCustomerServiceService.name);

  async sendTextMessage(openid: string, content: string): Promise<boolean> {
    this.logger.log(`[MOCK] 发送客服文本消息 -> openid=${openid}, content=${content}`);
    return true;
  }

  async sendNewsMessage(openid: string, article: WechatNewsArticle): Promise<boolean> {
    this.logger.log(
      `[MOCK] 发送客服图文消息 -> openid=${openid}, title=${article.title}, url=${article.url}`,
    );
    return true;
  }
}
