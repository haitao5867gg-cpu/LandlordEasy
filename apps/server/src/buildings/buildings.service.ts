import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BuildingsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.building.findMany({ orderBy: { sort: 'asc' } });
  }

  async findOne(id: number) {
    const building = await this.prisma.building.findUnique({ where: { id } });
    if (!building) throw new NotFoundException('楼栋不存在');
    return building;
  }

  async create(data: { name: string; sort?: number }) {
    return this.prisma.building.create({ data });
  }

  async update(id: number, data: { name?: string; sort?: number }) {
    await this.findOne(id);
    return this.prisma.building.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    // 检查是否有关联房间
    const roomCount = await this.prisma.room.count({ where: { buildingId: id } });
    if (roomCount > 0) {
      throw new Error('该楼栋下有房间,无法删除');
    }
    return this.prisma.building.delete({ where: { id } });
  }
}
