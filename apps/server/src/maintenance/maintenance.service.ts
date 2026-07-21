import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMaintenanceDto } from './maintenance.dto';

@Injectable()
export class MaintenanceService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(roomId?: number) {
    const where = roomId ? { roomId } : {};
    return this.prisma.maintenanceRecord.findMany({
      where,
      include: { room: { include: { building: true } } },
      orderBy: { date: 'desc' },
    });
  }

  async create(dto: CreateMaintenanceDto, operatorId: number) {
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
