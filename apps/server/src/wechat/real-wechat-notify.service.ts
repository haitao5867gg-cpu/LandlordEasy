import { Injectable, Logger } from '@nestjs/common';
import { IWechatNotifyService, NotifyPayload } from './wechat-notify.interface';

/**
 * 真实模板消息服务(阶段二实现)
 * TODO: 接入微信模板消息 API
 */
@Injectable()
export class RealWechatNotifyService implements IWechatNotifyService {
  private readonly logger = new Logger(RealWechatNotifyService.name);

  async sendTemplateMessage(payload: NotifyPayload): Promise<boolean> {
    this.logger.log(`[REAL] 发送模板消息 -> openid=${payload.openid}`);
    // TODO: 调用微信 API 发送模板消息
    throw new Error('真实模板消息尚未实现,请设置 WECHAT_MODE=mock');
  }
}
