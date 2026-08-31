import { Injectable, Logger } from '@nestjs/common';
import { IWechatCustomerServiceService } from './wechat-customer-service.interface';

@Injectable()
export class MockWechatCustomerServiceService implements IWechatCustomerServiceService {
  private readonly logger = new Logger(MockWechatCustomerServiceService.name);

  async sendTextMessage(openid: string, content: string): Promise<boolean> {
    this.logger.log(`[MOCK] 发送客服文本消息 -> openid=${openid}, content=${content}`);
    return true;
  }
}
