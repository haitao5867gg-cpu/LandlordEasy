import { RoomsService } from './rooms.service';
import { PrismaService } from '../prisma/prisma.service';

describe('RoomsService', () => {
  let service: RoomsService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      room: { findUnique: jest.fn() },
      auditLog: { findMany: jest.fn() },
    } as unknown as jest.Mocked<PrismaService>;
    service = new RoomsService(prisma);
  });

  describe('findOne', () => {
    const room = {
      id: 12,
      roomNo: '301',
      leases: [{ id: 101 }, { id: 102 }],
    };

    it('聚合房间及其全部租约日志，并按创建时间倒序查询', async () => {
      const leaseLog = {
        id: 2,
        entityType: 'leases',
        entityId: 102,
        detail: { body: { action: 'renew' } },
        createdAt: new Date('2026-09-20T10:00:00Z'),
      };
      const roomLog = {
        id: 1,
        entityType: 'rooms',
        entityId: 12,
        detail: { body: { status: 'RENTED' } },
        createdAt: new Date('2026-09-20T09:00:00Z'),
      };
      (prisma.room.findUnique as jest.Mock).mockResolvedValue(room);
      (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([leaseLog, roomLog]);

      const result = await service.findOne(12);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { entityType: 'rooms', entityId: 12 },
            { entityType: 'leases', entityId: { in: [101, 102] } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { operator: { select: { name: true } } },
      });
      expect(result.auditLogs.map((log) => log.id)).toEqual([2, 1]);
    });

    it('租约日志 detail 返回前仍会脱敏手机号', async () => {
      (prisma.room.findUnique as jest.Mock).mockResolvedValue(room);
      (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 3,
          entityType: 'leases',
          entityId: 101,
          detail: { body: { tenantPhone: '13912340000' } },
          createdAt: new Date('2026-09-20T11:00:00Z'),
        },
      ]);

      const result = await service.findOne(12);

      expect(result.auditLogs[0].detail).toEqual({
        body: { tenantPhone: '139****0000' },
      });
    });
  });
});
