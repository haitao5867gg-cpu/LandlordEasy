import { Module } from '@nestjs/common';
import { WECHAT_AUTH_SERVICE } from './wechat-auth.interface';
import { WECHAT_NOTIFY_SERVICE } from './wechat-notify.interface';
import { MockWechatAuthService } from './mock-wechat-auth.service';
import { MockWechatNotifyService } from './mock-wechat-notify.service';
import { RealWechatAuthService } from './real-wechat-auth.service';
import { RealWechatNotifyService } from './real-wechat-notify.service';

const wechatMode = process.env.WECHAT_MODE || 'mock';

const authProvider = {
  provide: WECHAT_AUTH_SERVICE,
  useClass: wechatMode === 'real' ? RealWechatAuthService : MockWechatAuthService,
};

const notifyProvider = {
  provide: WECHAT_NOTIFY_SERVICE,
  useClass: wechatMode === 'real' ? RealWechatNotifyService : MockWechatNotifyService,
};

@Module({
  providers: [authProvider, notifyProvider],
  exports: [WECHAT_AUTH_SERVICE, WECHAT_NOTIFY_SERVICE],
})
export class WechatModule {}
