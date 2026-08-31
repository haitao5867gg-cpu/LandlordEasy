import { BadGatewayException, Injectable } from '@nestjs/common';
import { createSign, createVerify } from 'crypto';
import { AlipayParams, IAlipayService } from './alipay.interface';
import { loadPemKey } from './pem-key.util';

interface AlipayResponse {
  alipay_trade_precreate_response?: {
    code?: string;
    msg?: string;
    sub_msg?: string;
    qr_code?: string;
  };
  sign?: string;
}

@Injectable()
export class RealAlipayService implements IAlipayService {
  private readonly appId = process.env.ALIPAY_APP_ID || '';
  private readonly privateKeyValue = process.env.ALIPAY_PRIVATE_KEY || '';
  private readonly publicKeyValue = process.env.ALIPAY_PUBLIC_KEY || '';
  private readonly notifyBaseUrl = process.env.PAYMENT_NOTIFY_BASE_URL || '';

  async createOrder(params: AlipayParams): Promise<string> {
    this.validateConfiguration();
    const privateKey = loadPemKey(
      this.privateKeyValue,
      'ALIPAY_PRIVATE_KEY',
      'PRIVATE KEY',
    );
    const commonParams: Record<string, string> = {
      app_id: this.appId,
      method: 'alipay.trade.precreate',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: this.alipayTimestamp(),
      version: '1.0',
      notify_url: `${this.notifyBaseUrl.replace(/\/$/, '')}/api/v1/payments/alipay/notify`,
      biz_content: JSON.stringify({
        out_trade_no: params.outTradeNo,
        total_amount: params.amount.toFixed(2),
        subject: params.description,
      }),
    };
    const unsigned = this.canonicalize(commonParams);
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned, 'utf8');
    signer.end();

    const form = new URLSearchParams({
      ...commonParams,
      sign: signer.sign(privateKey, 'base64'),
    });
    const response = await fetch('https://openapi.alipay.com/gateway.do', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: form.toString(),
    });
    const raw = await response.text();
    let result: AlipayResponse;
    try {
      result = JSON.parse(raw) as AlipayResponse;
    } catch {
      throw new BadGatewayException('支付宝预下单返回了无效响应');
    }

    const precreate = result.alipay_trade_precreate_response;
    if (!response.ok || precreate?.code !== '10000' || !precreate.qr_code) {
      throw new BadGatewayException(
        `支付宝预下单失败: ${precreate?.sub_msg || precreate?.msg || response.status}`,
      );
    }
    this.verifyResponse(raw, result.sign);
    return precreate.qr_code;
  }

  private validateConfiguration() {
    const required = {
      ALIPAY_APP_ID: this.appId,
      ALIPAY_PRIVATE_KEY: this.privateKeyValue,
      ALIPAY_PUBLIC_KEY: this.publicKeyValue,
      PAYMENT_NOTIFY_BASE_URL: this.notifyBaseUrl,
    };
    const missing = Object.entries(required)
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length) throw new Error(`${missing.join(', ')} 未配置`);
  }

  private canonicalize(params: Record<string, string>): string {
    return Object.keys(params)
      .filter((key) => params[key] !== '')
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');
  }

  private alipayTimestamp(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value || '';
    return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}:${value('second')}`;
  }

  private verifyResponse(raw: string, signature?: string) {
    if (!signature) throw new BadGatewayException('支付宝响应缺少签名');
    const signedContent = this.extractResponseObject(
      raw,
      'alipay_trade_precreate_response',
    );
    const verifier = createVerify('RSA-SHA256');
    verifier.update(signedContent, 'utf8');
    verifier.end();
    const publicKey = loadPemKey(
      this.publicKeyValue,
      'ALIPAY_PUBLIC_KEY',
      'PUBLIC KEY',
    );
    if (!verifier.verify(publicKey, signature, 'base64')) {
      throw new BadGatewayException('支付宝响应签名验证失败');
    }
  }

  /** 保留支付宝响应节点的原始 JSON 字符串，避免重新序列化导致验签失败。 */
  private extractResponseObject(raw: string, key: string): string {
    const keyIndex = raw.indexOf(`"${key}"`);
    const start = raw.indexOf('{', keyIndex + key.length + 2);
    if (keyIndex < 0 || start < 0) {
      throw new BadGatewayException('支付宝响应结构无效');
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}' && --depth === 0) return raw.slice(start, index + 1);
    }
    throw new BadGatewayException('支付宝响应结构无效');
  }
}
