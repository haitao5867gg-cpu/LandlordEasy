import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateMaintenanceDto,
  CreateRepairRequestDto,
  UpdateRepairRequestDto,
} from './maintenance.dto';

@Injectable()
export class MaintenanceService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(roomId?: number, propertyId?: number) {
    const where: Record<string, unknown> = {};
    if (roomId) where.roomId = roomId;
    if (propertyId) where.room = { building: { propertyId } };
    return this.prisma.maintenanceRecord.findMany({
      where,
      include: { room: { include: { building: true } } },
      orderBy: { date: 'desc' },
    });
  }

  async create(dto: CreateMaintenanceDto, operatorId: number) {
    const room = await this.prisma.room.findUnique({ where: { id: dto.roomId } });
    if (!room) {
      throw new BadRequestException('房间不存在');
    }

    return this.prisma.maintenanceRecord.create({
      data: {
        roomId: dto.roomId,
        date: new Date(dto.date),
        content: dto.content,
        cost: dto.cost,
        operatorId,
      },
    });
  }

  // ========== 租客在线报修 ==========

  async createRepairRequest(leaseId: number, tenantId: number, dto: CreateRepairRequestDto) {
    const lease = await this.prisma.lease.findUnique({ where: { id: leaseId } });
    if (!lease || lease.tenantId !== tenantId) throw new NotFoundException('租约不存在');
    if (lease.status !== 'ACTIVE') throw new BadRequestException('租约已结束,无法提交报修');

    return this.prisma.repairRequest.create({
      data: {
        leaseId,
        tenantId,
        roomId: lease.roomId,
        description: dto.description,
      },
    });
  }

  async listMyRepairRequests(tenantId: number) {
    return this.prisma.repairRequest.findMany({
      where: { tenantId },
      include: { room: { include: { building: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listRepairRequests(status?: string, propertyId?: number) {
    return this.prisma.repairRequest.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(propertyId ? { room: { building: { propertyId } } } : {}),
      },
      include: { room: { include: { building: true } }, tenant: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateRepairRequest(id: number, dto: UpdateRepairRequestDto, operatorId: number) {
    const req = await this.prisma.repairRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('报修申请不存在');
    if (req.status === 'RESOLVED') throw new BadRequestException('该报修已完成,不能再修改');

    const updated = await this.prisma.repairRequest.update({
      where: { id },
      data: {
        status: dto.status,
        landlordNote: dto.landlordNote,
        ...(dto.status === 'RESOLVED'
          ? { resolvedCost: dto.resolvedCost ?? 0, resolvedBy: operatorId, resolvedAt: new Date() }
          : {}),
      },
    });

    if (dto.status === 'RESOLVED' && dto.resolvedCost && dto.resolvedCost > 0) {
      await this.prisma.maintenanceRecord.create({
        data: {
          roomId: req.roomId,
          date: new Date(),
          content: `租客报修:${req.description}`,
          cost: dto.resolvedCost,
          operatorId,
        },
      });
    }

    return updated;
  }
}
