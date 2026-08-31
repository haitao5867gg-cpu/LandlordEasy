import { Injectable } from '@nestjs/common';
import { AlipayParams, IAlipayService } from './alipay.interface';

@Injectable()
export class MockAlipayService implements IAlipayService {
  async createOrder(params: AlipayParams): Promise<string> {
    return `landlord-easy://mock-alipay/pay?out_trade_no=${encodeURIComponent(params.outTradeNo)}&amount=${params.amount.toFixed(2)}`;
  }
}
