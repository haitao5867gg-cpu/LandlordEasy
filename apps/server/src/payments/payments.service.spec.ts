import {
  createCipheriv,
  createSign,
  generateKeyPairSync,
} from 'crypto';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { IWechatPayService } from './gateways/wechat-pay.interface';
import { IAlipayService } from './gateways/alipay.interface';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: jest.Mocked<PrismaService>;
  let wechatPayService: jest.Mocked<IWechatPayService>;
  let alipayService: jest.Mocked<IAlipayService>;
  const originalPaymentMode = process.env.PAYMENT_MODE;
  const originalWechatPayPublicKey = process.env.WECHAT_PAY_PUBLIC_KEY;
  const originalWechatPayPublicKeyId = process.env.WECHAT_PAY_PUBLIC_KEY_ID;
  const originalWechatPayApiV3Key = process.env.WECHAT_PAY_APIV3_KEY;

  beforeEach(() => {
    delete process.env.PAYMENT_MODE;
    prisma = {
      payment: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      bill: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    wechatPayService = {
      createOrder: jest.fn(),
    };
    alipayService = {
      createOrder: jest.fn(),
    };
    service = new PaymentsService(prisma, wechatPayService, alipayService);
  });

  afterAll(() => {
    if (originalPaymentMode === undefined) delete process.env.PAYMENT_MODE;
    else process.env.PAYMENT_MODE = originalPaymentMode;
    if (originalWechatPayPublicKey === undefined) {
      delete process.env.WECHAT_PAY_PUBLIC_KEY;
    } else {
      process.env.WECHAT_PAY_PUBLIC_KEY = originalWechatPayPublicKey;
    }
    if (originalWechatPayPublicKeyId === undefined) {
      delete process.env.WECHAT_PAY_PUBLIC_KEY_ID;
    } else {
      process.env.WECHAT_PAY_PUBLIC_KEY_ID = originalWechatPayPublicKeyId;
    }
    if (originalWechatPayApiV3Key === undefined) {
      delete process.env.WECHAT_PAY_APIV3_KEY;
    } else {
      process.env.WECHAT_PAY_APIV3_KEY = originalWechatPayApiV3Key;
    }
  });

  describe('confirmOrReject', () => {
    it('确认支付:PENDING_CONFIRM → CONFIRMED', async () => {
      const mockPayment = {
        id: 1,
        billId: 10,
        amount: 1000,
        status: 'PENDING_CONFIRM',
        bill: { id: 10, totalAmount: 1000 },
      };

      (prisma.payment.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockPayment) // 第一次查找支付记录
        .mockResolvedValueOnce({ ...mockPayment, status: 'CONFIRMED' }); // 返回结果

      (prisma.payment.update as jest.Mock).mockResolvedValue({
        ...mockPayment,
        status: 'CONFIRMED',
      });

      // checkBillPaid 需要的 mock
      (prisma.bill.findUnique as jest.Mock).mockResolvedValue({
        id: 10,
        totalAmount: 1000,
      });
      (prisma.payment.findMany as jest.Mock).mockResolvedValue([
        { amount: 1000, status: 'CONFIRMED' },
      ]);
      (prisma.bill.update as jest.Mock).mockResolvedValue({});

      await service.confirmOrReject(1, 'confirm', 1);

      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({ status: 'CONFIRMED' }),
        }),
      );
    });

    it('驳回支付:PENDING_CONFIRM → REJECTED', async () => {
      const mockPayment = {
        id: 2,
        billId: 11,
        amount: 800,
        status: 'PENDING_CONFIRM',
        bill: { id: 11 },
      };

      (prisma.payment.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockPayment)
        .mockResolvedValueOnce({ ...mockPayment, status: 'REJECTED' });

      (prisma.payment.update as jest.Mock).mockResolvedValue({
        ...mockPayment,
        status: 'REJECTED',
      });

      await service.confirmOrReject(2, 'reject', 1);

      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 2 },
          data: expect.objectContaining({ status: 'REJECTED' }),
        }),
      );
    });

    it('已处理的支付记录不可重复操作', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue({
        id: 3,
        billId: 12,
        status: 'CONFIRMED',
        bill: { id: 12 },
      });

      await expect(service.confirmOrReject(3, 'confirm', 1)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('不存在的支付记录应报错', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.confirmOrReject(999, 'confirm', 1)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('checkBillPaid (通过 confirmOrReject 间接测试)', () => {
    it('确认后实收>=应收:账单自动标记 PAID', async () => {
      const mockPayment = {
        id: 4,
        billId: 20,
        amount: 1200,
        status: 'PENDING_CONFIRM',
        bill: { id: 20, totalAmount: 1200 },
      };

      (prisma.payment.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockPayment)
        .mockResolvedValueOnce({ ...mockPayment, status: 'CONFIRMED' });
      (prisma.payment.update as jest.Mock).mockResolvedValue({});

      // checkBillPaid
      (prisma.bill.findUnique as jest.Mock).mockResolvedValue({
        id: 20,
        totalAmount: 1200,
      });
      (prisma.payment.findMany as jest.Mock).mockResolvedValue([
        { amount: 1200, status: 'CONFIRMED' },
      ]);
      (prisma.bill.update as jest.Mock).mockResolvedValue({});

      await service.confirmOrReject(4, 'confirm', 1);

      expect(prisma.bill.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 20 },
          data: { status: 'PAID' },
        }),
      );
    });

    it('部分支付:实收<应收,账单不标记 PAID', async () => {
      const mockPayment = {
        id: 5,
        billId: 21,
        amount: 500,
        status: 'PENDING_CONFIRM',
        bill: { id: 21, totalAmount: 1200 },
      };

      (prisma.payment.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockPayment)
        .mockResolvedValueOnce({ ...mockPayment, status: 'CONFIRMED' });
      (prisma.payment.update as jest.Mock).mockResolvedValue({});

      (prisma.bill.findUnique as jest.Mock).mockResolvedValue({
        id: 21,
        totalAmount: 1200,
      });
      (prisma.payment.findMany as jest.Mock).mockResolvedValue([
        { amount: 500, status: 'CONFIRMED' },
      ]);

      await service.confirmOrReject(5, 'confirm', 1);

      // bill.update 不应被调用(未付清)
      expect(prisma.bill.update).not.toHaveBeenCalled();
    });

    it('超额支付(>=):账单仍正常标记 PAID', async () => {
      const mockPayment = {
        id: 6,
        billId: 22,
        amount: 1500,
        status: 'PENDING_CONFIRM',
        bill: { id: 22, totalAmount: 1200 },
      };

      (prisma.payment.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockPayment)
        .mockResolvedValueOnce({ ...mockPayment, status: 'CONFIRMED' });
      (prisma.payment.update as jest.Mock).mockResolvedValue({});

      (prisma.bill.findUnique as jest.Mock).mockResolvedValue({
        id: 22,
        totalAmount: 1200,
      });
      (prisma.payment.findMany as jest.Mock).mockResolvedValue([
        { amount: 1500, status: 'CONFIRMED' },
      ]);
      (prisma.bill.update as jest.Mock).mockResolvedValue({});

      await service.confirmOrReject(6, 'confirm', 1);

      expect(prisma.bill.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 22 },
          data: { status: 'PAID' },
        }),
      );
    });
  });

  describe('manualRecord', () => {
    it('手动记账直接 CONFIRMED', async () => {
      (prisma.bill.findUnique as jest.Mock).mockResolvedValue({
        id: 30,
        totalAmount: 800,
      });
      (prisma.payment.create as jest.Mock).mockResolvedValue({
        id: 7,
        status: 'CONFIRMED',
      });
      (prisma.payment.findMany as jest.Mock).mockResolvedValue([
        { amount: 800, status: 'CONFIRMED' },
      ]);
      (prisma.bill.update as jest.Mock).mockResolvedValue({});

      const result = await service.manualRecord(
        { billId: 30, channel: 'CASH', amount: 800, paidAt: '2026-07-20' },
        1,
      );

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CONFIRMED',
            channel: 'CASH',
          }),
        }),
      );
    });
  });

  describe('tenantReport', () => {
    it('租客上报:状态为 PENDING_CONFIRM', async () => {
      (prisma.bill.findUnique as jest.Mock).mockResolvedValue({ id: 40 });
      (prisma.payment.create as jest.Mock).mockResolvedValue({
        id: 8,
        status: 'PENDING_CONFIRM',
        channel: 'QRCODE',
      });

      const result = await service.tenantReport({
        billId: 40,
        amount: 1000,
        paidAt: '2026-07-20',
        proofUrl: 'https://example.com/proof.jpg',
      });

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PENDING_CONFIRM',
            channel: 'QRCODE',
            proofUrl: 'https://example.com/proof.jpg',
          }),
        }),
      );
    });
  });

  describe('在线支付下单', () => {
    const payableBill = {
      id: 50,
      status: 'PENDING',
      totalAmount: 1288.5,
      lease: { tenantId: 7 },
    };

    it('创建微信订单并保存 PENDING 支付记录', async () => {
      (prisma.bill.findUnique as jest.Mock).mockResolvedValue(payableBill);
      (prisma.payment.create as jest.Mock).mockResolvedValue({ id: 20 });
      wechatPayService.createOrder.mockResolvedValue({
        appId: 'mock-appid',
        timeStamp: '123',
        nonceStr: 'nonce',
        package: 'prepay_id=mock',
        signType: 'RSA',
        paySign: 'sign',
      });

      const result = await service.createWechatOrder(50, 7, 'tenant-openid');

      expect(result.mode).toBe('mock');
      expect(result.outTradeNo).toMatch(/^WX50/);
      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          billId: 50,
          channel: 'WECHATPAY',
          status: 'PENDING',
          outTradeNo: result.outTradeNo,
        }),
      });
      expect(wechatPayService.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          outTradeNo: result.outTradeNo,
          amount: 1288.5,
          openid: 'tenant-openid',
        }),
      );
    });

    it('创建支付宝订单并在后端生成 PNG data URI', async () => {
      (prisma.bill.findUnique as jest.Mock).mockResolvedValue({
        ...payableBill,
        status: 'OVERDUE',
      });
      (prisma.payment.create as jest.Mock).mockResolvedValue({ id: 21 });
      alipayService.createOrder.mockResolvedValue('mock-alipay-qr-content');

      const result = await service.createAlipayOrder(50, 7, 'tenant-openid');

      expect(result.outTradeNo).toMatch(/^ALI50/);
      expect(result.qrCodeImage).toMatch(/^data:image\/png;base64,/);
      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          channel: 'ALIPAY',
          status: 'PENDING',
        }),
      });
    });

    it('禁止租客支付其他租客的账单', async () => {
      (prisma.bill.findUnique as jest.Mock).mockResolvedValue(payableBill);
      await expect(
        service.createWechatOrder(50, 8, 'tenant-openid'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('已支付账单返回“该账单无需支付”', async () => {
      (prisma.bill.findUnique as jest.Mock).mockResolvedValue({
        ...payableBill,
        status: 'PAID',
      });
      await expect(
        service.createAlipayOrder(50, 7, 'tenant-openid'),
      ).rejects.toThrow('该账单无需支付');
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });
  });

  describe('在线支付回调', () => {
    it('微信成功回调确认支付，重复回调保持幂等', async () => {
      const pendingPayment = {
        id: 30,
        billId: 60,
        channel: 'WECHATPAY',
        status: 'PENDING',
        amount: 500,
      };
      (prisma.payment.findUnique as jest.Mock)
        .mockResolvedValueOnce(pendingPayment)
        .mockResolvedValueOnce({ ...pendingPayment, status: 'CONFIRMED' });
      (prisma.payment.update as jest.Mock).mockResolvedValue({});
      (prisma.bill.findUnique as jest.Mock).mockResolvedValue({
        id: 60,
        totalAmount: 500,
      });
      (prisma.payment.findMany as jest.Mock).mockResolvedValue([
        { amount: 500, status: 'CONFIRMED' },
      ]);
      (prisma.bill.update as jest.Mock).mockResolvedValue({});

      await service.handleWechatNotify({
        out_trade_no: 'WX60TEST',
        transaction_id: 'WX-GATEWAY-1',
        trade_state: 'SUCCESS',
      });
      const repeated = await service.handleWechatNotify({
        out_trade_no: 'WX60TEST',
        transaction_id: 'WX-GATEWAY-1',
        trade_state: 'SUCCESS',
      });

      expect(repeated).toEqual({ code: 'SUCCESS', message: '成功' });
      expect(prisma.payment.update).toHaveBeenCalledTimes(1);
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 30 },
        data: expect.objectContaining({
          status: 'CONFIRMED',
          gatewayTradeNo: 'WX-GATEWAY-1',
          confirmedBy: null,
        }),
      });
      expect(prisma.bill.update).toHaveBeenCalledTimes(1);
    });

    it('找不到支付记录时仍向网关返回成功', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.handleAlipayNotify({
          out_trade_no: 'UNKNOWN',
          trade_no: 'ALI-GATEWAY-1',
          trade_status: 'TRADE_SUCCESS',
        }),
      ).resolves.toEqual({ code: 'SUCCESS', message: '成功' });
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });
  });

  describe('微信支付回调公钥验签', () => {
    const timestamp = '1725000000';
    const nonce = 'wechat-notify-nonce';
    const publicKeyId = 'PUB_KEY_ID_TEST';
    const apiV3Key = '0123456789abcdef0123456789abcdef';
    const resourceNonce = '0123456789ab';
    const associatedData = 'transaction';
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(apiV3Key, 'utf8'),
      Buffer.from(resourceNonce, 'utf8'),
    );
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const encryptedResource = Buffer.concat([
      cipher.update(JSON.stringify({ trade_state: 'NOTPAY' }), 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64');
    const body = {
      id: 'notify-test',
      resource: {
        algorithm: 'AEAD_AES_256_GCM',
        ciphertext: encryptedResource,
        associated_data: associatedData,
        nonce: resourceNonce,
      },
    };
    const rawBody = Buffer.from(JSON.stringify(body), 'utf8');

    const sign = (bodyToSign: Buffer) => {
      const signer = createSign('RSA-SHA256');
      signer.update(Buffer.from(`${timestamp}\n${nonce}\n`, 'utf8'));
      signer.update(bodyToSign);
      signer.update(Buffer.from('\n', 'utf8'));
      signer.end();
      return signer.sign(privateKey).toString('base64');
    };

    const headers = (bodyToSign: Buffer = rawBody) => ({
      'wechatpay-timestamp': timestamp,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': sign(bodyToSign),
      'wechatpay-serial': publicKeyId,
    });

    beforeEach(() => {
      process.env.PAYMENT_MODE = 'real';
      process.env.WECHAT_PAY_PUBLIC_KEY = publicKey;
      process.env.WECHAT_PAY_PUBLIC_KEY_ID = publicKeyId;
      process.env.WECHAT_PAY_APIV3_KEY = apiV3Key;
    });

    it('使用真实 RSA 密钥对验证原始请求体签名', async () => {
      await expect(
        service.handleWechatNotify(body, rawBody, headers()),
      ).resolves.toEqual({ code: 'SUCCESS', message: '成功' });
      expect(prisma.payment.findUnique).not.toHaveBeenCalled();
    });

    it('签名与原始请求体不匹配时拒绝回调', async () => {
      const signedDifferentBody = Buffer.from('{"tampered":true}', 'utf8');

      await expect(
        service.handleWechatNotify(
          body,
          rawBody,
          headers(signedDifferentBody),
        ),
      ).rejects.toThrow('微信回调签名无效');
      expect(prisma.payment.findUnique).not.toHaveBeenCalled();
    });

    it('Wechatpay-Serial 与配置的公钥 ID 不匹配时拒绝回调', async () => {
      await expect(
        service.handleWechatNotify(body, rawBody, {
          ...headers(),
          'wechatpay-serial': 'PUB_KEY_ID_OTHER',
        }),
      ).rejects.toThrow(
        '微信回调 Wechatpay-Serial 与 WECHAT_PAY_PUBLIC_KEY_ID 不匹配',
      );
      expect(prisma.payment.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('mock 支付成功模拟', () => {
    it('mock 模式复用回调确认逻辑完成支付', async () => {
      const payment = {
        id: 40,
        billId: 70,
        channel: 'ALIPAY',
        status: 'PENDING',
        amount: 300,
      };
      (prisma.payment.findUnique as jest.Mock)
        .mockResolvedValueOnce(payment)
        .mockResolvedValueOnce(payment);
      (prisma.payment.update as jest.Mock).mockResolvedValue({});
      (prisma.bill.findUnique as jest.Mock).mockResolvedValue({
        id: 70,
        totalAmount: 300,
      });
      (prisma.payment.findMany as jest.Mock).mockResolvedValue([
        { amount: 300, status: 'CONFIRMED' },
      ]);
      (prisma.bill.update as jest.Mock).mockResolvedValue({});

      await expect(service.simulateSuccess('ALI70TEST')).resolves.toEqual({
        code: 'SUCCESS',
        message: '成功',
      });
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 40 },
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      });
    });

    it('安全性质：PAYMENT_MODE=real 时必须 404 且不查询数据库', async () => {
      process.env.PAYMENT_MODE = 'real';
      await expect(service.simulateSuccess('WX70TEST')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.payment.findUnique).not.toHaveBeenCalled();
    });
  });
});
