import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoomTypeDto, UpdateRoomTypeDto } from './room-types.dto';

@Injectable()
export class RoomTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.roomType.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: number) {
    const roomType = await this.prisma.roomType.findUnique({ where: { id } });
    if (!roomType) throw new NotFoundException('房型不存在');
    return roomType;
  }

  async create(dto: CreateRoomTypeDto) {
    return this.prisma.roomType.create({
      data: {
        name: dto.name,
        description: dto.description,
        defaultRent: dto.defaultRent,
        defaultDeposit: dto.defaultDeposit,
        defaultPayCycle: dto.defaultPayCycle || 'MONTHLY',
        defaultFeeItems: dto.defaultFeeItems ? JSON.parse(JSON.stringify(dto.defaultFeeItems)) : undefined,
        furnitureList: dto.furnitureList ? JSON.parse(JSON.stringify(dto.furnitureList)) : undefined,
      },
    });
  }

  async update(id: number, dto: UpdateRoomTypeDto) {
    await this.findOne(id);
    return this.prisma.roomType.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.defaultRent !== undefined && { defaultRent: dto.defaultRent }),
        ...(dto.defaultDeposit !== undefined && { defaultDeposit: dto.defaultDeposit }),
        ...(dto.defaultPayCycle !== undefined && { defaultPayCycle: dto.defaultPayCycle }),
        ...(dto.defaultFeeItems !== undefined && {
          defaultFeeItems: JSON.parse(JSON.stringify(dto.defaultFeeItems)),
        }),
        ...(dto.furnitureList !== undefined && {
          furnitureList: JSON.parse(JSON.stringify(dto.furnitureList)),
        }),
      },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    const roomCount = await this.prisma.room.count({ where: { roomTypeId: id } });
    if (roomCount > 0) {
      throw new BadRequestException('有房间使用该房型,无法删除');
    }
    return this.prisma.roomType.delete({ where: { id } });
  }
}
