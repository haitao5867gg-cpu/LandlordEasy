import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLeaseDto, EndLeaseDto, RenewLeaseDto } from './leases.dto';

@Injectable()
export class LeasesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(roomId?: number, status?: string) {
    const where: Record<string, unknown> = {};
    if (roomId) where.roomId = roomId;
    if (status) where.status = status;

    return this.prisma.lease.findMany({
      where,
      include: { room: { include: { building: true } }, tenant: true },
      orderBy: { startDate: 'desc' },
    });
  }

  async findOne(id: number) {
    const lease = await this.prisma.lease.findUnique({
      where: { id },
      include: {
        room: { include: { building: true } },
        tenant: true,
        bills: { include: { items: true, payments: true }, orderBy: { periodStart: 'desc' } },
        depositRecords: true,
        handoverRecords: true,
      },
    });
    if (!lease) throw new NotFoundException('租约不存在');
    return lease;
  }

  /** 新签租约 */
  async create(dto: CreateLeaseDto, operatorId: number) {
    // 检查房间是否空置
    const room = await this.prisma.room.findUnique({ where: { id: dto.roomId } });
    if (!room) throw new NotFoundException('房间不存在');
    if (room.status !== 'VACANT') {
      throw new BadRequestException('房间不是空置状态,无法签约');
    }

    // 创建或查找租客
    let tenant = await this.prisma.tenant.findFirst({
      where: { phone: dto.tenantPhone },
    });
    if (!tenant) {
      tenant = await this.prisma.tenant.create({
        data: {
          name: dto.tenantName,
          phone: dto.tenantPhone,
          idCard: dto.tenantIdCard,
        },
      });
    }

    const inviteCode = this.generateInviteCode();

    const lease = await this.prisma.lease.create({
      data: {
        roomId: dto.roomId,
        tenantId: tenant.id,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        rent: dto.rent,
        deposit: dto.deposit,
        payCycle: dto.payCycle || 'MONTHLY',
        feeItems: dto.feeItems ? JSON.parse(JSON.stringify(dto.feeItems)) : undefined,
        carPlate: dto.carPlate,
        commission: dto.commission,
        inviteCode,
      },
    });

    // 房间转已租
    await this.prisma.room.update({
      where: { id: dto.roomId },
      data: { status: 'RENTED' },
    });

    // 押金入台账
    await this.prisma.depositRecord.create({
      data: {
        leaseId: lease.id,
        type: 'RECEIVE',
        amount: dto.deposit,
        operatorId,
      },
    });

    return lease;
  }

  /** 退租 */
  async endLease(id: number, dto: EndLeaseDto, operatorId: number) {
    const lease = await this.prisma.lease.findUnique({ where: { id } });
    if (!lease) throw new NotFoundException('租约不存在');
    if (lease.status !== 'ACTIVE') {
      throw new BadRequestException('租约已结束');
    }

    // 押金结算
    const depositAmount = Number(lease.deposit);
    if (dto.depositRefund > 0) {
      await this.prisma.depositRecord.create({
        data: {
          leaseId: id,
          type: 'REFUND',
          amount: dto.depositRefund,
          operatorId,
        },
      });
    }
    const deductAmount = depositAmount - dto.depositRefund;
    if (deductAmount > 0) {
      await this.prisma.depositRecord.create({
        data: {
          leaseId: id,
          type: 'DEDUCT',
          amount: deductAmount,
          reason: dto.depositDeductReason || '退租扣款',
          operatorId,
        },
      });
    }

    // 租约归档
    const updatedLease = await this.prisma.lease.update({
      where: { id },
      data: {
        status: 'ENDED',
        endedAt: new Date(dto.endDate),
        endReason: dto.endReason,
      },
    });

    // 房间转空置
    await this.prisma.room.update({
      where: { id: lease.roomId },
      data: { status: 'VACANT' },
    });

    return updatedLease;
  }

  /** 续签 */
  async renew(id: number, dto: RenewLeaseDto) {
    const lease = await this.prisma.lease.findUnique({ where: { id } });
    if (!lease) throw new NotFoundException('租约不存在');
    if (lease.status !== 'ACTIVE') {
      throw new BadRequestException('只能续签活跃租约');
    }

    return this.prisma.lease.update({
      where: { id },
      data: {
        endDate: new Date(dto.newEndDate),
        ...(dto.newRent !== undefined && { rent: dto.newRent }),
      },
    });
  }

  private generateInviteCode(): string {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  }
}
