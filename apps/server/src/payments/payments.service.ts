import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createDecipheriv, createVerify, randomBytes } from 'crypto';
import QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConfirmPaymentDto,
  ManualPaymentDto,
  TenantReportPaymentDto,
} from './payments.dto';
import {
  IWechatPayService,
  WECHAT_PAY_SERVICE,
} from './gateways/wechat-pay.interface';
import { ALIPAY_SERVICE, IAlipayService } from './gateways/alipay.interface';
import { loadPemKey } from './gateways/pem-key.util';

export interface WechatNotifyBody {
  out_trade_no?: string;
  transaction_id?: string;
  trade_state?: string;
  resource?: {
    algorithm?: string;
    ciphertext?: string;
    associated_data?: string;
    nonce?: string;
  };
  [key: string]: unknown;
}

export interface AlipayNotifyBody {
  out_trade_no?: string;
  trade_no?: string;
  trade_status?: string;
  sign?: string;
  sign_type?: string;
  [key: string]: unknown;
}

type NotifyHeaders = Record<string, string | string[] | undefined>;
type OnlineChannel = 'WECHATPAY' | 'ALIPAY';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WECHAT_PAY_SERVICE)
    private readonly wechatPayService: IWechatPayService,
    @Inject(ALIPAY_SERVICE)
    private readonly alipayService: IAlipayService,
  ) {}

  /** 获取待确认的支付记录 */
  async getPending(propertyId?: number) {
    return this.prisma.payment.findMany({
      where: {
        status: 'PENDING_CONFIRM',
        ...(propertyId && { bill: { lease: { room: { building: { propertyId } } } } }),
      },
      include: {
        bill: {
          include: { lease: { include: { room: { include: { building: true } }, tenant: true } } },
        },
      },
      orderBy: { paidAt: 'desc' },
    });
  }

  /** 确认或驳回 */
  async confirmOrReject(id: number, action: 'confirm' | 'reject', landlordId: number) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { bill: true },
    });
    if (!payment) throw new NotFoundException('支付记录不存在');
    if (payment.status !== 'PENDING_CONFIRM') {
      throw new BadRequestException('该支付记录已处理');
    }

    if (action === 'confirm') {
      await this.prisma.payment.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          confirmedBy: landlordId,
          confirmedAt: new Date(),
        },
      });
      await this.checkBillPaid(payment.billId);
    } else {
      await this.prisma.payment.update({
        where: { id },
        data: { status: 'REJECTED' },
      });
    }

    return this.prisma.payment.findUnique({ where: { id } });
  }

  /** 房东手动记账 */
  async manualRecord(dto: ManualPaymentDto, landlordId: number) {
    const bill = await this.prisma.bill.findUnique({ where: { id: dto.billId } });
    if (!bill) throw new NotFoundException('账单不存在');

    const payment = await this.prisma.payment.create({
      data: {
        billId: dto.billId,
        channel: dto.channel,
        amount: dto.amount,
        status: 'CONFIRMED',
        paidAt: new Date(dto.paidAt),
        confirmedBy: landlordId,
        confirmedAt: new Date(),
      },
    });
    await this.checkBillPaid(dto.billId);
    return payment;
  }

  /** 租客上报 */
  async tenantReport(dto: TenantReportPaymentDto) {
    const bill = await this.prisma.bill.findUnique({ where: { id: dto.billId } });
    if (!bill) throw new NotFoundException('账单不存在');

    return this.prisma.payment.create({
      data: {
        billId: dto.billId,
        channel: 'QRCODE',
        amount: dto.amount,
        status: 'PENDING_CONFIRM',
        proofUrl: dto.proofUrl,
        paidAt: new Date(dto.paidAt),
      },
    });
  }

  async createWechatOrder(
    billId: number,
    tenantId: number | undefined,
    openid: string | undefined,
  ) {
    const bill = await this.getPayableTenantBill(billId, tenantId);
    if (!openid) throw new BadRequestException('缺少openid');

    const outTradeNo = this.generateOutTradeNo('WX', billId);
    const amount = Number(bill.totalAmount);
    await this.prisma.payment.create({
      data: {
        billId,
        channel: 'WECHATPAY',
        outTradeNo,
        amount: bill.totalAmount,
        status: 'PENDING',
        paidAt: new Date(),
      },
    });
    const wechatParams = await this.wechatPayService.createOrder({
      outTradeNo,
      amount,
      description: `账单 #${billId}`,
      openid,
    });
    return { outTradeNo, mode: this.wechatPayMode, wechatParams };
  }

  async createAlipayOrder(
    billId: number,
    tenantId: number | undefined,
    openid: string | undefined,
  ) {
    const bill = await this.getPayableTenantBill(billId, tenantId);
    if (!openid) throw new BadRequestException('缺少openid');
    const outTradeNo = this.generateOutTradeNo('ALI', billId);
    const amount = Number(bill.totalAmount);
    await this.prisma.payment.create({
      data: {
        billId,
        channel: 'ALIPAY',
        outTradeNo,
        amount: bill.totalAmount,
        status: 'PENDING',
        paidAt: new Date(),
      },
    });
    const qrCodeContent = await this.alipayService.createOrder({
      outTradeNo,
      amount,
      description: `账单 #${billId}`,
    });
    const qrCodeImage = await QRCode.toDataURL(qrCodeContent, {
      type: 'image/png',
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    return { outTradeNo, mode: this.alipayMode, qrCodeImage };
  }

  async handleWechatNotify(
    body: WechatNotifyBody,
    rawBody?: Buffer,
    headers: NotifyHeaders = {},
  ) {
    let transaction = body;
    if (this.wechatPayMode === 'real') {
      this.verifyWechatNotifyHeaders(headers, rawBody);
      transaction = this.decryptWechatResource(body);
    }
    if (transaction.trade_state && transaction.trade_state !== 'SUCCESS') {
      return this.notifySuccess();
    }
    if (!transaction.out_trade_no) {
      throw new BadRequestException('微信回调缺少 out_trade_no');
    }
    await this.confirmOnlinePayment(
      transaction.out_trade_no,
      transaction.transaction_id,
      'WECHATPAY',
    );
    return this.notifySuccess();
  }

  async handleAlipayNotify(body: AlipayNotifyBody) {
    if (this.alipayMode === 'real') this.verifyAlipayNotify(body);
    if (
      body.trade_status &&
      !['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(body.trade_status)
    ) {
      return this.notifySuccess();
    }
    if (!body.out_trade_no) {
      throw new BadRequestException('支付宝回调缺少 out_trade_no');
    }
    await this.confirmOnlinePayment(
      body.out_trade_no,
      body.trade_no,
      'ALIPAY',
    );
    return this.notifySuccess();
  }

  async simulateSuccess(outTradeNo: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { outTradeNo },
    });
    if (!payment) throw new NotFoundException('支付记录不存在');
    if (!['WECHATPAY', 'ALIPAY'].includes(payment.channel)) {
      throw new BadRequestException('该支付记录不支持在线支付模拟');
    }
    const channelMode =
      payment.channel === 'WECHATPAY' ? this.wechatPayMode : this.alipayMode;
    if (channelMode !== 'mock') throw new NotFoundException();
    if (payment.status !== 'PENDING') {
      throw new BadRequestException('该支付记录不是待支付状态');
    }
    await this.confirmOnlinePayment(
      outTradeNo,
      `MOCK_${Date.now()}_${randomBytes(3).toString('hex')}`,
      payment.channel as OnlineChannel,
    );
    return this.notifySuccess();
  }

  /** 按账单查支付记录 */
  async findByBill(billId: number) {
    return this.prisma.payment.findMany({
      where: { billId },
      orderBy: { paidAt: 'desc' },
    });
  }

  private get wechatPayMode(): string {
    return process.env.WECHAT_PAY_MODE || process.env.PAYMENT_MODE || 'mock';
  }

  private get alipayMode(): string {
    return process.env.ALIPAY_MODE || process.env.PAYMENT_MODE || 'mock';
  }

  private async getPayableTenantBill(
    billId: number,
    tenantId: number | undefined,
  ) {
    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: { lease: true },
    });
    if (!bill) throw new NotFoundException('账单不存在');
    if (!tenantId || bill.lease.tenantId !== tenantId) {
      throw new ForbiddenException('无权支付该账单');
    }
    if (!['PENDING', 'OVERDUE'].includes(bill.status)) {
      throw new BadRequestException('该账单无需支付');
    }
    return bill;
  }

  private generateOutTradeNo(prefix: 'WX' | 'ALI', billId: number): string {
    return `${prefix}${billId}${Date.now()}${randomBytes(6).toString('hex')}`;
  }

  private async confirmOnlinePayment(
    outTradeNo: string,
    gatewayTradeNo: string | undefined,
    channel: OnlineChannel,
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { outTradeNo },
    });
    if (!payment || payment.status === 'CONFIRMED') return;
    if (payment.channel !== channel) {
      throw new BadRequestException('支付渠道不匹配');
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'CONFIRMED',
        gatewayTradeNo: gatewayTradeNo || null,
        confirmedAt: new Date(),
        confirmedBy: null,
      },
    });
    await this.checkBillPaid(payment.billId);
  }

  private notifySuccess() {
    return { code: 'SUCCESS', message: '成功' };
  }

  /** 按微信支付公钥模式校验回调公钥 ID 和原始请求体签名。 */
  private verifyWechatNotifyHeaders(
    headers: NotifyHeaders,
    rawBody: Buffer | undefined,
  ) {
    const readHeader = (name: string) => {
      const value = headers[name];
      return typeof value === 'string' ? value : undefined;
    };
    const timestamp = readHeader('wechatpay-timestamp');
    const nonce = readHeader('wechatpay-nonce');
    const signature = readHeader('wechatpay-signature');
    const serial = readHeader('wechatpay-serial');
    if (!timestamp || !nonce || !signature || !serial) {
      throw new BadRequestException('微信回调签名头不完整');
    }

    const publicKeyId = process.env.WECHAT_PAY_PUBLIC_KEY_ID || '';
    if (!publicKeyId) throw new Error('WECHAT_PAY_PUBLIC_KEY_ID 未配置');
    if (serial !== publicKeyId) {
      throw new BadRequestException(
        '微信回调 Wechatpay-Serial 与 WECHAT_PAY_PUBLIC_KEY_ID 不匹配',
      );
    }
    if (!rawBody) throw new BadRequestException('微信回调缺少原始请求体');

    const verifier = createVerify('RSA-SHA256');
    verifier.update(Buffer.from(`${timestamp}\n${nonce}\n`, 'utf8'));
    verifier.update(rawBody);
    verifier.update(Buffer.from('\n', 'utf8'));
    verifier.end();
    const publicKey = loadPemKey(
      process.env.WECHAT_PAY_PUBLIC_KEY || '',
      'WECHAT_PAY_PUBLIC_KEY',
      'PUBLIC KEY',
    );
    if (!verifier.verify(publicKey, Buffer.from(signature, 'base64'))) {
      throw new BadRequestException('微信回调签名无效');
    }
  }

  private decryptWechatResource(body: WechatNotifyBody): WechatNotifyBody {
    const resource = body.resource;
    if (
      resource?.algorithm !== 'AEAD_AES_256_GCM' ||
      !resource.ciphertext ||
      !resource.nonce
    ) {
      throw new BadRequestException('微信回调 resource 格式无效');
    }
    const apiV3Key = process.env.WECHAT_PAY_APIV3_KEY || '';
    if (Buffer.byteLength(apiV3Key, 'utf8') !== 32) {
      throw new Error('WECHAT_PAY_APIV3_KEY 必须为 32 字节');
    }
    const encrypted = Buffer.from(resource.ciphertext, 'base64');
    const authTag = encrypted.subarray(encrypted.length - 16);
    const ciphertext = encrypted.subarray(0, encrypted.length - 16);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(apiV3Key, 'utf8'),
      Buffer.from(resource.nonce, 'utf8'),
    );
    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from(resource.associated_data || '', 'utf8'));
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plaintext) as WechatNotifyBody;
  }

  private verifyAlipayNotify(body: AlipayNotifyBody) {
    if (!body.sign) throw new BadRequestException('支付宝回调缺少签名');
    const unsigned = Object.keys(body)
      .filter((key) => key !== 'sign' && key !== 'sign_type' && body[key] !== '')
      .sort()
      .map((key) => `${key}=${String(body[key])}`)
      .join('&');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(unsigned, 'utf8');
    verifier.end();
    const publicKey = loadPemKey(
      process.env.ALIPAY_PUBLIC_KEY || '',
      'ALIPAY_PUBLIC_KEY',
      'PUBLIC KEY',
    );
    if (!verifier.verify(publicKey, body.sign, 'base64')) {
      throw new BadRequestException('支付宝回调签名无效');
    }
  }

  /** 检查账单是否已付清:confirmed 合计 ≥ totalAmount 则标记 PAID */
  private async checkBillPaid(billId: number) {
    const bill = await this.prisma.bill.findUnique({ where: { id: billId } });
    if (!bill) return;

    const payments = await this.prisma.payment.findMany({
      where: { billId, status: 'CONFIRMED' },
    });
    const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    if (paidTotal >= Number(bill.totalAmount)) {
      await this.prisma.bill.update({
        where: { id: billId },
        data: { status: 'PAID' },
      });
    }
  }
}
