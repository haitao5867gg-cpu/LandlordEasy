import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantApiService {
  constructor(private readonly prisma: PrismaService) {}

  /** 邀请码绑定租约,成功后返回刷新的 JWT */
  async bindInviteCode(openid: string, inviteCode: string) {
    const lease = await this.prisma.lease.findUnique({
      where: { inviteCode },
      include: { tenant: true },
    });
    if (!lease) throw new NotFoundException('邀请码无效');
    if (lease.status !== 'ACTIVE') {
      throw new BadRequestException('该租约已结束');
    }

    // 检查 openid 是否已绑定其他租客
    const existingTenant = await this.prisma.tenant.findUnique({ where: { openid } });
    if (existingTenant && existingTenant.id !== lease.tenantId) {
      throw new BadRequestException('该微信号已绑定其他租客,请联系房东合并');
    }

    // 将 openid 绑定到租客
    const tenant = await this.prisma.tenant.update({
      where: { id: lease.tenantId },
      data: { openid },
    });

    // 签发包含 tenantId 的新 JWT
    const jwtSecret = process.env.JWT_SECRET || 'dev-secret';
    const token = jwt.sign(
      { sub: tenant.id, openid, role: 'tenant', tenantId: tenant.id },
      jwtSecret,
      { expiresIn: 7 * 24 * 60 * 60 },
    );

    return { message: '绑定成功', tenantId: tenant.id, leaseId: lease.id, token };
  }

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
