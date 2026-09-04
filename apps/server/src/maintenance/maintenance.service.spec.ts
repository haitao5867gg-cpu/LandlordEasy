import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MaintenanceService 租客在线报修', () => {
  let service: MaintenanceService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    prisma = {
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
