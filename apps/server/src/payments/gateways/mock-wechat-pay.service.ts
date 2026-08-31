import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  IWechatPayService,
  WechatPayOrder,
  WechatPayParams,
} from './wechat-pay.interface';

@Injectable()
export class MockWechatPayService implements IWechatPayService {
  async createOrder(params: WechatPayParams): Promise<WechatPayOrder> {
    return {
      appId: process.env.WECHAT_APPID || 'mock-wechat-appid',
      timeStamp: Math.floor(Date.now() / 1000).toString(),
      nonceStr: randomBytes(16).toString('hex'),
      package: `prepay_id=mock_${params.outTradeNo}`,
      signType: 'RSA',
      paySign: `mock_pay_sign_${params.outTradeNo}`,
    };
  }
}
