import { BadGatewayException, Injectable } from '@nestjs/common';
import { createSign, randomBytes } from 'crypto';
import { loadPemKey } from './pem-key.util';
import {
  IWechatPayService,
  WechatPayOrder,
  WechatPayParams,
} from './wechat-pay.interface';

interface WechatPrepayResponse {
  prepay_id?: string;
  code?: string;
  message?: string;
}

@Injectable()
export class RealWechatPayService implements IWechatPayService {
  private readonly appId = process.env.WECHAT_APPID || '';
  private readonly mchId = process.env.WECHAT_PAY_MCH_ID || '';
  private readonly apiV3Key = process.env.WECHAT_PAY_APIV3_KEY || '';
  private readonly serialNo = process.env.WECHAT_PAY_SERIAL_NO || '';
  private readonly privateKeyValue = process.env.WECHAT_PAY_PRIVATE_KEY || '';
  private readonly notifyBaseUrl = process.env.PAYMENT_NOTIFY_BASE_URL || '';

  async createOrder(params: WechatPayParams): Promise<WechatPayOrder> {
    this.validateConfiguration();
    const privateKey = loadPemKey(
      this.privateKeyValue,
      'WECHAT_PAY_PRIVATE_KEY',
      'PRIVATE KEY',
    );
    const body = JSON.stringify({
      appid: this.appId,
      mchid: this.mchId,
      description: params.description,
      out_trade_no: params.outTradeNo,
      notify_url: `${this.notifyBaseUrl.replace(/\/$/, '')}/api/v1/payments/wechat/notify`,
      amount: {
        total: Math.round(params.amount * 100),
        currency: 'CNY',
      },
      payer: { openid: params.openid },
    });

    const method = 'POST';
    const canonicalUrl = '/v3/pay/transactions/jsapi';
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = randomBytes(16).toString('hex');
    const requestSignature = this.sign(
      `${method}\n${canonicalUrl}\n${timeStamp}\n${nonceStr}\n${body}\n`,
      privateKey,
    );
    const authorization =
      'WECHATPAY2-SHA256-RSA2048 ' +
      `mchid="${this.mchId}",nonce_str="${nonceStr}",timestamp="${timeStamp}",` +
      `serial_no="${this.serialNo}",signature="${requestSignature}"`;

    const response = await fetch(`https://api.mch.weixin.qq.com${canonicalUrl}`, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authorization,
        'User-Agent': 'LandlordEasy/1.0',
      },
      body,
    });
    const result = (await response.json()) as WechatPrepayResponse;
    if (!response.ok || !result.prepay_id) {
      throw new BadGatewayException(
        `微信支付下单失败: ${result.message || result.code || response.status}`,
      );
    }

    const paymentPackage = `prepay_id=${result.prepay_id}`;
    const payNonceStr = randomBytes(16).toString('hex');
    const payTimeStamp = Math.floor(Date.now() / 1000).toString();
    const paySign = this.sign(
      `${this.appId}\n${payTimeStamp}\n${payNonceStr}\n${paymentPackage}\n`,
      privateKey,
    );

    return {
      appId: this.appId,
      timeStamp: payTimeStamp,
      nonceStr: payNonceStr,
      package: paymentPackage,
      signType: 'RSA',
      paySign,
    };
  }

  private validateConfiguration() {
    const required = {
      WECHAT_APPID: this.appId,
      WECHAT_PAY_MCH_ID: this.mchId,
      WECHAT_PAY_APIV3_KEY: this.apiV3Key,
      WECHAT_PAY_SERIAL_NO: this.serialNo,
      WECHAT_PAY_PRIVATE_KEY: this.privateKeyValue,
      PAYMENT_NOTIFY_BASE_URL: this.notifyBaseUrl,
    };
    const missing = Object.entries(required)
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length) throw new Error(`${missing.join(', ')} 未配置`);
    if (Buffer.byteLength(this.apiV3Key, 'utf8') !== 32) {
      throw new Error('WECHAT_PAY_APIV3_KEY 必须为 32 字节');
    }
  }

  private sign(message: string, privateKey: string): string {
    const signer = createSign('RSA-SHA256');
    signer.update(message);
    signer.end();
    return signer.sign(privateKey, 'base64');
  }
}
