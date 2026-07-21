import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
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

    service = new PaymentsService(prisma);
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
});
