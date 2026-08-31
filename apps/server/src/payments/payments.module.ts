import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { AuthModule } from '../auth/auth.module';
import { WECHAT_PAY_SERVICE } from './gateways/wechat-pay.interface';
import { ALIPAY_SERVICE } from './gateways/alipay.interface';
import { MockWechatPayService } from './gateways/mock-wechat-pay.service';
import { RealWechatPayService } from './gateways/real-wechat-pay.service';
import { MockAlipayService } from './gateways/mock-alipay.service';
import { RealAlipayService } from './gateways/real-alipay.service';

const paymentMode = process.env.PAYMENT_MODE || 'mock';

const wechatPayProvider = {
  provide: WECHAT_PAY_SERVICE,
  useClass:
    paymentMode === 'real' ? RealWechatPayService : MockWechatPayService,
};

const alipayProvider = {
  provide: ALIPAY_SERVICE,
  useClass: paymentMode === 'real' ? RealAlipayService : MockAlipayService,
};

@Module({
  imports: [AuthModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, wechatPayProvider, alipayProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
