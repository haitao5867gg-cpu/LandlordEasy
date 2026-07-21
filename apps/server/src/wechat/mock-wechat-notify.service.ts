import { Injectable, Logger } from '@nestjs/common';
import { IWechatNotifyService, NotifyPayload } from './wechat-notify.interface';

/**
 * Mock 模板消息服务
 * 只打印日志,不真正发送
 */
@Injectable()
export class MockWechatNotifyService implements IWechatNotifyService {
  private readonly logger = new Logger(MockWechatNotifyService.name);

  async sendTemplateMessage(payload: NotifyPayload): Promise<boolean> {
    this.logger.log(
      `[MOCK] 发送模板消息 -> openid=${payload.openid}, template=${payload.templateId}`,
    );
    this.logger.debug(`[MOCK] 消息内容: ${JSON.stringify(payload.data)}`);
    return true;
  }
}
