import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MaintenanceService 租客在线报修', () => {
  let service: MaintenanceService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((callback) => callback(prisma)),
      $queryRaw: jest.fn(),
      lease: { findUnique: jest.fn() },
      repairRequest: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      maintenanceRecord: { create: jest.fn() },
    } as unknown as jest.Mocked<PrismaService>;
    service = new MaintenanceService(prisma);
  });

  describe('createRepairRequest', () => {
    it('租约不属于该租客时抛404', async () => {
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({ id: 1, tenantId: 99, status: 'ACTIVE', roomId: 5 });
      await expect(
        service.createRepairRequest(1, 1, { description: '空调不制冷' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('租约已结束时拒绝提交', async () => {
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({ id: 1, tenantId: 1, status: 'ENDED', roomId: 5 });
      await expect(
        service.createRepairRequest(1, 1, { description: '空调不制冷' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('成功提交时带上租约的roomId', async () => {
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({ id: 1, tenantId: 1, status: 'ACTIVE', roomId: 5 });
      (prisma.repairRequest.create as jest.Mock).mockImplementation(({ data }) => data);
      const result = await service.createRepairRequest(1, 1, { description: '空调不制冷' });
      expect(result.roomId).toBe(5);
      expect(result.status).toBeUndefined(); // 默认值由数据库/schema决定,不在create data里显式指定
    });
  });

  describe('updateRepairRequest', () => {
    it('已完成的报修不能再修改', async () => {
      (prisma.repairRequest.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: 'RESOLVED' });
      await expect(
        service.updateRepairRequest(1, { status: 'IN_PROGRESS' }, 1),
      ).rejects.toThrow('该报修已完成');
    });

    it('标记完成且填了费用时,自动生成一条维修记录', async () => {
      (prisma.repairRequest.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        status: 'IN_PROGRESS',
        roomId: 5,
        description: '空调不制冷',
      });
      (prisma.repairRequest.update as jest.Mock).mockResolvedValue({ id: 1, status: 'RESOLVED' });

      await service.updateRepairRequest(1, { status: 'RESOLVED', resolvedCost: 200 }, 1);

      expect(prisma.maintenanceRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ roomId: 5, cost: 200, operatorId: 1 }),
        }),
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('维修记录写入失败时事务整体失败,不会返回已完成结果', async () => {
      (prisma.repairRequest.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        status: 'IN_PROGRESS',
        roomId: 5,
        description: '空调不制冷',
      });
      (prisma.repairRequest.update as jest.Mock).mockResolvedValue({
        id: 1,
        status: 'RESOLVED',
      });
      (prisma.maintenanceRecord.create as jest.Mock).mockRejectedValue(
        new Error('injected maintenance record failure'),
      );

      await expect(
        service.updateRepairRequest(1, { status: 'RESOLVED', resolvedCost: 200 }, 1),
      ).rejects.toThrow('injected maintenance record failure');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.repairRequest.update).toHaveBeenCalledTimes(1);
    });

    it('并发完成同一报修时行锁确保只生成一条维修记录', async () => {
      let status = 'IN_PROGRESS';
      let tail = Promise.resolve<unknown>(undefined);
      (prisma.$transaction as jest.Mock).mockImplementation((callback) => {
        const run = tail.then(() => callback(prisma));
        tail = run.catch(() => undefined);
        return run;
      });
      (prisma.repairRequest.findUnique as jest.Mock).mockImplementation(async () => ({
        id: 1,
        status,
        roomId: 5,
        description: '空调不制冷',
      }));
      (prisma.repairRequest.update as jest.Mock).mockImplementation(async ({ data }) => {
        status = data.status;
        return { id: 1, ...data };
      });
      (prisma.maintenanceRecord.create as jest.Mock).mockResolvedValue({ id: 9 });

      const results = await Promise.allSettled([
        service.updateRepairRequest(1, { status: 'RESOLVED', resolvedCost: 200 }, 1),
        service.updateRepairRequest(1, { status: 'RESOLVED', resolvedCost: 200 }, 1),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(prisma.maintenanceRecord.create).toHaveBeenCalledTimes(1);
    });

    it('标记完成但没有费用时,不生成维修记录', async () => {
      (prisma.repairRequest.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        status: 'IN_PROGRESS',
        roomId: 5,
        description: '灯泡坏了',
      });
      (prisma.repairRequest.update as jest.Mock).mockResolvedValue({ id: 1, status: 'RESOLVED' });

      await service.updateRepairRequest(1, { status: 'RESOLVED' }, 1);

      expect(prisma.maintenanceRecord.create).not.toHaveBeenCalled();
    });

    it('标记处理中时,不生成维修记录也不设置resolvedAt', async () => {
      (prisma.repairRequest.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        status: 'SUBMITTED',
        roomId: 5,
      });
      (prisma.repairRequest.update as jest.Mock).mockImplementation(({ data }) => data);

      const result = await service.updateRepairRequest(1, { status: 'IN_PROGRESS' }, 1);

      expect(prisma.maintenanceRecord.create).not.toHaveBeenCalled();
      expect(result.resolvedAt).toBeUndefined();
    });
  });
});
