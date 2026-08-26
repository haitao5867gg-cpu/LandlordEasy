import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMaintenanceDto } from './maintenance.dto';

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
}
