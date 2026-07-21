import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantApiService {
  constructor(private readonly prisma: PrismaService) {}

  /** 邀请码绑定租约 */
  async bindInviteCode(openid: string, inviteCode: string) {
    const lease = await this.prisma.lease.findUnique({
      where: { inviteCode },
      include: { tenant: true },
    });
    if (!lease) throw new NotFoundException('邀请码无效');
    if (lease.status !== 'ACTIVE') {
      throw new BadRequestException('该租约已结束');
    }

    // 将 openid 绑定到租客
    const tenant = await this.prisma.tenant.update({
      where: { id: lease.tenantId },
      data: { openid },
    });

    return { message: '绑定成功', tenantId: tenant.id, leaseId: lease.id };
  }

  /** 获取租客的所有账单(按租约状态驱动) */
  async getMyBills(tenantId: number) {
    const leases = await this.prisma.lease.findMany({
      where: { tenantId },
      include: {
        bills: {
          include: { items: true, payments: true },
          orderBy: { dueDate: 'desc' },
        },
        room: { include: { building: true } },
      },
    });

    // 按租约状态过滤
    const result = leases.map((lease) => {
      let bills = lease.bills;
      if (lease.status === 'ENDED') {
        // 已退租:只展示未结清账单
        const hasUnpaid = bills.some((b) => ['PENDING', 'OVERDUE'].includes(b.status));
        if (!hasUnpaid) {
          // 全部结清:只读历史
          return { ...lease, bills, readonly: true };
        }
        bills = bills.filter((b) => ['PENDING', 'OVERDUE'].includes(b.status));
      }
      return { ...lease, bills, readonly: false };
    });

    return result;
  }

  /** 获取租客的租约列表 */
  async getMyLeases(tenantId: number) {
    return this.prisma.lease.findMany({
      where: { tenantId },
      include: { room: { include: { building: true } } },
      orderBy: { startDate: 'desc' },
    });
  }
}
