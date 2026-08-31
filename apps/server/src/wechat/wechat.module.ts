import { Module } from '@nestjs/common';
import { WECHAT_AUTH_SERVICE } from './wechat-auth.interface';
import { WECHAT_NOTIFY_SERVICE } from './wechat-notify.interface';
import { WECHAT_QRCODE_SERVICE } from './wechat-qrcode.interface';
import { WECHAT_EVENT_SERVICE } from './wechat-event.interface';
import { WECHAT_CUSTOMER_SERVICE } from './wechat-customer-service.interface';
import { MockWechatAuthService } from './mock-wechat-auth.service';
import { MockWechatNotifyService } from './mock-wechat-notify.service';
import { MockWechatQrcodeService } from './mock-wechat-qrcode.service';
import { MockWechatCustomerServiceService } from './mock-wechat-customer-service.service';
import { RealWechatAuthService } from './real-wechat-auth.service';
import { RealWechatNotifyService } from './real-wechat-notify.service';
import { RealWechatQrcodeService } from './real-wechat-qrcode.service';
import { RealWechatCustomerServiceService } from './real-wechat-customer-service.service';
import { WechatAccessTokenService } from './wechat-access-token.service';
import { WechatEventService } from './wechat-event.service';

const wechatMode = process.env.WECHAT_MODE || 'mock';

const authProvider = {
  provide: WECHAT_AUTH_SERVICE,
  useClass: wechatMode === 'real' ? RealWechatAuthService : MockWechatAuthService,
};

const notifyProvider = {
  provide: WECHAT_NOTIFY_SERVICE,
  useClass: wechatMode === 'real' ? RealWechatNotifyService : MockWechatNotifyService,
};

const qrcodeProvider = {
  provide: WECHAT_QRCODE_SERVICE,
  useClass: wechatMode === 'real' ? RealWechatQrcodeService : MockWechatQrcodeService,
};

const eventProvider = {
  provide: WECHAT_EVENT_SERVICE,
  useClass: WechatEventService,
};

const customerServiceProvider = {
  provide: WECHAT_CUSTOMER_SERVICE,
  useClass:
    wechatMode === 'real'
      ? RealWechatCustomerServiceService
      : MockWechatCustomerServiceService,
};

@Module({
  providers: [
    WechatAccessTokenService,
    authProvider,
    notifyProvider,
    qrcodeProvider,
    eventProvider,
    customerServiceProvider,
  ],
  exports: [
    WECHAT_AUTH_SERVICE,
    WECHAT_NOTIFY_SERVICE,
    WECHAT_QRCODE_SERVICE,
    WECHAT_EVENT_SERVICE,
    WECHAT_CUSTOMER_SERVICE,
  ],
})
export class WechatModule {}
