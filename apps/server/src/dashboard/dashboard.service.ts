import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** 空置看板:空置房+空置天数,按楼栋分组 */
  async getVacancyBoard() {
    const vacantRooms = await this.prisma.room.findMany({
      where: { status: 'VACANT' },
      include: { building: true },
      orderBy: [{ buildingId: 'asc' }, { roomNo: 'asc' }],
    });

    // 计算空置天数:从最后一次租约结束开始计算
    const result = await Promise.all(
      vacantRooms.map(async (room) => {
        const lastLease = await this.prisma.lease.findFirst({
          where: { roomId: room.id, status: 'ENDED' },
          orderBy: { endedAt: 'desc' },
        });
        const vacantSince = lastLease?.endedAt || room.createdAt;
        const vacantDays = Math.floor(
          (Date.now() - new Date(vacantSince).getTime()) / (1000 * 60 * 60 * 24),
        );
        return { ...room, vacantDays, vacantSince };
      }),
    );

    // 按楼栋分组
    const grouped: Record<string, typeof result> = {};
    for (const room of result) {
      const buildingName = room.building.name;
      if (!grouped[buildingName]) grouped[buildingName] = [];
      grouped[buildingName].push(room);
    }

    return { total: result.length, buildings: grouped };
  }

  /** 到期预警:30/15/7天内到期的租约 */
  async getExpiringLeases() {
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const leases = await this.prisma.lease.findMany({
      where: {
        status: 'ACTIVE',
        endDate: { lte: in30Days },
      },
      include: { room: { include: { building: true } }, tenant: true },
      orderBy: { endDate: 'asc' },
    });

    return leases.map((lease) => {
      const daysLeft = Math.ceil(
        (new Date(lease.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      return { ...lease, daysLeft };
    });
  }

  /** 逾期看板:欠租人、欠租天数、金额,按楼栋分组 */
  async getOverdueBoard() {
    const overdueBills = await this.prisma.bill.findMany({
      where: { status: 'OVERDUE' },
      include: {
        lease: { include: { room: { include: { building: true } }, tenant: true } },
      },
      orderBy: { dueDate: 'asc' },
    });

    const now = new Date();
    const items = overdueBills.map((bill) => ({
      billId: bill.id,
      tenantName: bill.lease.tenant.name,
      tenantPhone: bill.lease.tenant.phone,
      roomNo: bill.lease.room.roomNo,
      buildingName: bill.lease.room.building.name,
      amount: bill.totalAmount,
      dueDate: bill.dueDate,
      overdueDays: Math.floor(
        (now.getTime() - new Date(bill.dueDate).getTime()) / (1000 * 60 * 60 * 24),
      ),
    }));

    // 按楼栋分组
    const grouped: Record<string, typeof items> = {};
    for (const item of items) {
      if (!grouped[item.buildingName]) grouped[item.buildingName] = [];
      grouped[item.buildingName].push(item);
    }

    return { total: items.length, buildings: grouped };
  }
}
