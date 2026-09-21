import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { LeasesService } from '../leases/leases.service';
import { MaintenanceService } from '../maintenance/maintenance.service';
import {
  CreateTerminationRequestDto,
  CreateTransferRequestDto,
} from '../leases/leases.dto';
import { CreateRepairRequestDto } from '../maintenance/maintenance.dto';

@Injectable()
export class TenantApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leasesService: LeasesService,
    private readonly maintenanceService: MaintenanceService,
  ) {}

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

  createRepairRequest(leaseId: number, tenantId: number, dto: CreateRepairRequestDto) {
    return this.maintenanceService.createRepairRequest(leaseId, tenantId, dto);
  }

  listMyRepairRequests(tenantId: number) {
    return this.maintenanceService.listMyRepairRequests(tenantId);
  }

  previewTerminationPenalty(leaseId: number, tenantId: number) {
    return this.leasesService.previewTerminationPenalty(leaseId, tenantId);
  }

  createTerminationRequest(
    leaseId: number,
    tenantId: number,
    dto: CreateTerminationRequestDto,
  ) {
    return this.leasesService.createTerminationRequest(leaseId, tenantId, dto);
  }

  listMyTerminationRequests(tenantId: number) {
    return this.leasesService.listMyTerminationRequests(tenantId);
  }

  createTransferRequest(leaseId: number, tenantId: number, dto: CreateTransferRequestDto) {
    return this.leasesService.createTransferRequest(leaseId, tenantId, dto);
  }

  listMyTransferRequests(tenantId: number) {
    return this.leasesService.listMyTransferRequests(tenantId);
  }
}
