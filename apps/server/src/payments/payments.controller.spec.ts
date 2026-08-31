import { NotFoundException } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

describe('PaymentsController', () => {
  const originalPaymentMode = process.env.PAYMENT_MODE;

  afterEach(() => {
    if (originalPaymentMode === undefined) delete process.env.PAYMENT_MODE;
    else process.env.PAYMENT_MODE = originalPaymentMode;
  });

  it('安全性质：real 模式下 mock/simulate-success 接口直接返回 404', () => {
    process.env.PAYMENT_MODE = 'real';
    const paymentsService = {
      simulateSuccess: jest.fn(),
    } as unknown as PaymentsService;
    const controller = new PaymentsController(paymentsService);

    expect(() =>
      controller.mockSimulateSuccess({ outTradeNo: 'WX1TEST' }),
    ).toThrow(NotFoundException);
    expect(paymentsService.simulateSuccess).not.toHaveBeenCalled();
  });
});
