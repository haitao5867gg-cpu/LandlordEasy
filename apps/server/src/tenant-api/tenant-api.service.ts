import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantApiService {
  constructor(private readonly prisma: PrismaService) {}

  /** 获取收款码图片 URL */
  async getQrcodeUrl() {
    const settingsFile = path.join(process.cwd(), 'data/settings.json');
    let qrcodeImageUrl = '';
    try {
      if (fs.existsSync(settingsFile)) {
        const data = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
        qrcodeImageUrl = data.qrcodeImageUrl || '';
      }
    } catch {
      // ignore
    }
    return { qrcodeImageUrl };
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
