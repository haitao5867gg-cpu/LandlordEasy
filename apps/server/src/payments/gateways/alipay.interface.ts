export interface AlipayParams {
  outTradeNo: string;
  amount: number;
  description: string;
}

export interface IAlipayService {
  createOrder(params: AlipayParams): Promise<string>;
}

export const ALIPAY_SERVICE = 'ALIPAY_SERVICE';
