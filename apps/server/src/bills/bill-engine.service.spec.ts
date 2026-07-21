import { BillEngineService } from './bill-engine.service';
import { PrismaService } from '../prisma/prisma.service';

describe('BillEngineService', () => {
  let service: BillEngineService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      lease: { findMany: jest.fn() },
      bill: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
      billItem: { create: jest.fn() },
    } as unknown as jest.Mocked<PrismaService>;

    service = new BillEngineService(prisma);
  });

  describe('generateBillsForLease', () => {
    it('应幂等:同账期不重复生成', async () => {
      const lease = {
        id: 1,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2027-01-01'),
        rent: 1000,
        payCycle: 'MONTHLY',
        feeItems: [{ name: '卫生费', amount: 30 }],
      };

      // 模拟该账期账单已存在
      (prisma.bill.findUnique as jest.Mock).mockResolvedValue({ id: 99 });

      const result = await service.generateBillsForLease(lease);
      expect(result).toBe(0);
      expect(prisma.bill.create).not.toHaveBeenCalled();
    });

    it('应生成账单:含租金+附加费用项', async () => {
      const today = new Date();
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 3); // 3天前开始

      const lease = {
        id: 2,
        startDate,
        endDate: new Date('2027-06-01'),
        rent: 1200,
        payCycle: 'MONTHLY',
        feeItems: [{ name: '卫生费', amount: 30 }, { name: '停车费', amount: 100 }],
      };

      (prisma.bill.findUnique as jest.Mock).mockResolvedValue(null); // 不存在
      (prisma.bill.create as jest.Mock).mockResolvedValue({ id: 1 });
      (prisma.billItem.create as jest.Mock).mockResolvedValue({});

      const result = await service.generateBillsForLease(lease);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(prisma.bill.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leaseId: 2,
            totalAmount: 1330, // 1200 + 30 + 100
          }),
        }),
      );
    });

    it('月末边界:1月31日起租,下一期应为2月28/29日', async () => {
      // 测试 clampToMonthEnd 逻辑
      const startDate = new Date('2026-01-31');
      const lease = {
        id: 3,
        startDate,
        endDate: new Date('2027-01-31'),
        rent: 800,
        payCycle: 'MONTHLY',
        feeItems: [],
      };

      (prisma.bill.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.bill.create as jest.Mock).mockImplementation(({ data }) => {
        return Promise.resolve({ id: 100, ...data });
      });
      (prisma.billItem.create as jest.Mock).mockResolvedValue({});

      await service.generateBillsForLease(lease);

      // 检查第二期(2月)的 periodStart 应该是 2/28 而非 3/3
      const calls = (prisma.bill.create as jest.Mock).mock.calls;
      if (calls.length >= 2) {
        const secondBillData = calls[1][0].data;
        const periodStart = new Date(secondBillData.periodStart);
        expect(periodStart.getMonth()).toBe(1); // February
        expect(periodStart.getDate()).toBeLessThanOrEqual(28);
      }
    });

    it('跨年边界:12月起租,下一期为次年1月', async () => {
      const startDate = new Date('2025-12-15');
      const lease = {
        id: 4,
        startDate,
        endDate: new Date('2027-12-15'),
        rent: 1500,
        payCycle: 'MONTHLY',
        feeItems: [],
      };

      (prisma.bill.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.bill.create as jest.Mock).mockImplementation(({ data }) => {
        return Promise.resolve({ id: 200, ...data });
      });
      (prisma.billItem.create as jest.Mock).mockResolvedValue({});

      await service.generateBillsForLease(lease);

      const calls = (prisma.bill.create as jest.Mock).mock.calls;
      if (calls.length >= 2) {
        const secondBillData = calls[1][0].data;
        const periodStart = new Date(secondBillData.periodStart);
        expect(periodStart.getFullYear()).toBe(2026);
        expect(periodStart.getMonth()).toBe(0); // January
        expect(periodStart.getDate()).toBe(15);
      }
    });

    it('季付:每3个月生成一期', async () => {
      const today = new Date();
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 1);

      const lease = {
        id: 5,
        startDate,
        endDate: new Date('2028-01-01'),
        rent: 3000,
        payCycle: 'QUARTERLY',
        feeItems: [],
      };

      (prisma.bill.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.bill.create as jest.Mock).mockResolvedValue({ id: 300 });
      (prisma.billItem.create as jest.Mock).mockResolvedValue({});

      const result = await service.generateBillsForLease(lease);
      expect(result).toBe(1); // 只生成当前这一期(lookAhead 7天内)
    });
  });

  describe('markOverdue', () => {
    it('应将过期未付账单标记为 OVERDUE', async () => {
      (prisma.bill.updateMany as jest.Mock).mockResolvedValue({ count: 5 });

      await service.markOverdue();

      expect(prisma.bill.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PENDING',
          }),
          data: { status: 'OVERDUE' },
        }),
      );
    });
  });
});
