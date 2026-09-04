import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

describe('PaymentsController', () => {
  const originalPaymentMode = process.env.PAYMENT_MODE;
  const originalWechatPayMode = process.env.WECHAT_PAY_MODE;
  const originalAlipayMode = process.env.ALIPAY_MODE;
  const originalAlipayEnabled = process.env.ALIPAY_ENABLED;

  beforeEach(() => {
    delete process.env.PAYMENT_MODE;
    delete process.env.WECHAT_PAY_MODE;
    delete process.env.ALIPAY_MODE;
    delete process.env.ALIPAY_ENABLED;
  });

  afterAll(() => {
    if (originalPaymentMode === undefined) delete process.env.PAYMENT_MODE;
    else process.env.PAYMENT_MODE = originalPaymentMode;
    if (originalWechatPayMode === undefined) delete process.env.WECHAT_PAY_MODE;
    else process.env.WECHAT_PAY_MODE = originalWechatPayMode;
    if (originalAlipayMode === undefined) delete process.env.ALIPAY_MODE;
    else process.env.ALIPAY_MODE = originalAlipayMode;
    if (originalAlipayEnabled === undefined) delete process.env.ALIPAY_ENABLED;
    else process.env.ALIPAY_ENABLED = originalAlipayEnabled;
  });

  it('未设置 ALIPAY_ENABLED 时拒绝创建支付宝订单', () => {
    const paymentsService = {
      createAlipayOrder: jest.fn(),
    } as unknown as PaymentsService;
    const controller = new PaymentsController(paymentsService);

    expect(() =>
      controller.createAlipayOrder(
        { billId: 50 },
        { user: { tenantId: 7, openid: 'tenant-openid' } } as unknown as Request,
      ),
    ).toThrow(BadRequestException);
    expect(paymentsService.createAlipayOrder).not.toHaveBeenCalled();
  });

  it('ALIPAY_ENABLED=true 时正常交给 service 创建支付宝订单', async () => {
    process.env.ALIPAY_ENABLED = 'true';
    const order = {
      outTradeNo: 'ALI50TEST',
      mode: 'mock',
      qrCodeImage: 'data:image/png;base64,test',
    };
    const paymentsService = {
      createAlipayOrder: jest.fn().mockResolvedValue(order),
    } as unknown as PaymentsService;
    const controller = new PaymentsController(paymentsService);

    await expect(
      controller.createAlipayOrder(
        { billId: 50 },
        { user: { tenantId: 7, openid: 'tenant-openid' } } as unknown as Request,
      ),
    ).resolves.toEqual(order);
    expect(paymentsService.createAlipayOrder).toHaveBeenCalledWith(
      50,
      7,
      'tenant-openid',
    );
  });

  it('安全性质：两个渠道都是 real 时 mock 接口直接返回 404', () => {
    process.env.WECHAT_PAY_MODE = 'real';
    process.env.ALIPAY_MODE = 'real';
    const paymentsService = {
      simulateSuccess: jest.fn(),
    } as unknown as PaymentsService;
    const controller = new PaymentsController(paymentsService);

    expect(() =>
      controller.mockSimulateSuccess({ outTradeNo: 'WX1TEST' }),
    ).toThrow(NotFoundException);
    expect(paymentsService.simulateSuccess).not.toHaveBeenCalled();
  });

  it('两个渠道都是 mock 时把请求交给 service', async () => {
    process.env.WECHAT_PAY_MODE = 'mock';
    process.env.ALIPAY_MODE = 'mock';
    const success = { code: 'SUCCESS', message: '成功' };
    const paymentsService = {
      simulateSuccess: jest.fn().mockResolvedValue(success),
    } as unknown as PaymentsService;
    const controller = new PaymentsController(paymentsService);

    await expect(
      controller.mockSimulateSuccess({ outTradeNo: 'ALI1TEST' }),
    ).resolves.toEqual(success);
    expect(paymentsService.simulateSuccess).toHaveBeenCalledWith('ALI1TEST');
  });

  it('混合模式下不提前拦截，由 service 按渠道分别允许或拒绝', async () => {
    process.env.WECHAT_PAY_MODE = 'real';
    process.env.ALIPAY_MODE = 'mock';
    const success = { code: 'SUCCESS', message: '成功' };
    const paymentsService = {
      simulateSuccess: jest.fn((outTradeNo: string) =>
        outTradeNo.startsWith('ALI')
          ? Promise.resolve(success)
          : Promise.reject(new NotFoundException()),
      ),
    } as unknown as PaymentsService;
    const controller = new PaymentsController(paymentsService);

    await expect(
      controller.mockSimulateSuccess({ outTradeNo: 'ALI2TEST' }),
    ).resolves.toEqual(success);
    await expect(
      controller.mockSimulateSuccess({ outTradeNo: 'WX2TEST' }),
    ).rejects.toThrow(NotFoundException);
    expect(paymentsService.simulateSuccess).toHaveBeenNthCalledWith(
      1,
      'ALI2TEST',
    );
    expect(paymentsService.simulateSuccess).toHaveBeenNthCalledWith(
      2,
      'WX2TEST',
    );
  });
});
